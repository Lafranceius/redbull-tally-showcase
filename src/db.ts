import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';
import type { Config } from './config';

export type DB = DatabaseSync;

/** Append-only. Each entry runs once, in order, tracked by `PRAGMA user_version`. */
const MIGRATIONS = [
  `
  CREATE TABLE members (
    email TEXT PRIMARY KEY,
    added_at INTEGER NOT NULL
  );
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    display_name TEXT UNIQUE COLLATE NOCASE, -- NULL until chosen on first login
    active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE login_codes (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    ip TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    used_at INTEGER
  );
  CREATE INDEX login_codes_email ON login_codes(email, created_at);
  CREATE INDEX login_codes_created ON login_codes(created_at);
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    user_agent TEXT
  );
  CREATE INDEX sessions_user ON sessions(user_id);
  CREATE TABLE cans (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    created_at INTEGER NOT NULL,
    month TEXT NOT NULL,
    price_ore INTEGER NOT NULL,
    created_by_admin INTEGER NOT NULL DEFAULT 0,
    deleted_at INTEGER,
    deleted_by INTEGER REFERENCES users(id),
    idem_key TEXT
  );
  CREATE INDEX cans_month_user ON cans(month, user_id);
  CREATE INDEX cans_user_created ON cans(user_id, created_at);
  CREATE UNIQUE INDEX cans_idem ON cans(user_id, idem_key) WHERE idem_key IS NOT NULL;
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE admin_log (
    id INTEGER PRIMARY KEY,
    at INTEGER NOT NULL,
    action TEXT NOT NULL,
    details_json TEXT NOT NULL
  );
  `,
  `
  ALTER TABLE login_codes ADD COLUMN send_failed INTEGER NOT NULL DEFAULT 0;
  -- Before v2, refused sends were marked used at the instant they were created; no real code is used that fast.
  UPDATE login_codes SET send_failed = 1 WHERE used_at = created_at;
  `,
  `
  -- "Jeg har betalt": a user clears everything they owe. Cans keep a link to the clearing that covered them.
  CREATE TABLE settlements (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    at INTEGER NOT NULL,
    amount_ore INTEGER NOT NULL,
    cans INTEGER NOT NULL,
    reversed_at INTEGER,
    reversed_by INTEGER REFERENCES users(id)
  );
  CREATE INDEX settlements_user ON settlements(user_id, at);
  ALTER TABLE cans ADD COLUMN settlement_id INTEGER REFERENCES settlements(id);
  CREATE INDEX cans_user_settlement ON cans(user_id, settlement_id);
  CREATE TABLE avatars (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    mime TEXT NOT NULL,
    data BLOB NOT NULL,
    updated_at INTEGER NOT NULL
  );
  `,
];

export function openDb(path: string): DB {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  return db;
}

export function migrate(db: DB): void {
  const { user_version } = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (let v = user_version; v < MIGRATIONS.length; v++) {
    tx(db, () => {
      db.exec(MIGRATIONS[v]!);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

/** Makes sure the admin can always log in and a price exists. Safe to run on every start. */
export function seed(db: DB, config: Pick<Config, 'adminEmail' | 'defaultPriceOre'>, now: number): void {
  run(db, 'INSERT OR IGNORE INTO members (email, added_at) VALUES (?, ?)', config.adminEmail, now);
  run(db, "INSERT OR IGNORE INTO settings (key, value) VALUES ('price_ore', ?)", String(config.defaultPriceOre));
}

export function tx<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

const statements = new WeakMap<DB, Map<string, StatementSync>>();

function stmt(db: DB, sql: string): StatementSync {
  let cache = statements.get(db);
  if (!cache) statements.set(db, (cache = new Map()));
  let s = cache.get(sql);
  if (!s) cache.set(sql, (s = db.prepare(sql)));
  return s;
}

export function one<T>(db: DB, sql: string, ...params: SQLInputValue[]): T | undefined {
  return stmt(db, sql).get(...params) as T | undefined;
}

export function all<T>(db: DB, sql: string, ...params: SQLInputValue[]): T[] {
  return stmt(db, sql).all(...params) as T[];
}

export function run(db: DB, sql: string, ...params: SQLInputValue[]): { changes: number; id: number } {
  const r = stmt(db, sql).run(...params);
  return { changes: Number(r.changes), id: Number(r.lastInsertRowid) };
}
