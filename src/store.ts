import { normalizeEmail } from './config';
import { all, one, run, tx, type DB } from './db';

export type User = {
  id: number;
  email: string;
  display_name: string | null;
  active: number;
  created_at: number;
};

export type SessionUser = User & { token_hash: string; last_seen_at: number };

export type Can = {
  id: number;
  user_id: number;
  created_at: number;
  month: string;
  price_ore: number;
  created_by_admin: number;
  deleted_at: number | null;
  deleted_by: number | null;
  idem_key: string | null;
  settlement_id: number | null;
};

export type LoginCode = {
  id: number;
  email: string;
  code_hash: string;
  created_at: number;
  expires_at: number;
  attempts: number;
  used_at: number | null;
  send_failed: number;
};

// ── settings ────────────────────────────────────────────────────────────────

export function getPriceOre(db: DB): number {
  const row = one<{ value: string }>(db, "SELECT value FROM settings WHERE key = 'price_ore'");
  return row ? Number(row.value) : 1000;
}

export function setPriceOre(db: DB, ore: number): void {
  run(db, "INSERT INTO settings (key, value) VALUES ('price_ore', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", String(ore));
}

// ── members ─────────────────────────────────────────────────────────────────

export function isMember(db: DB, email: string): boolean {
  return !!one(db, 'SELECT 1 AS x FROM members WHERE email = ?', email);
}

/** Returns the emails that were not already members. */
export function addMembers(db: DB, emails: string[], now: number): string[] {
  return tx(db, () =>
    [...new Set(emails.map(normalizeEmail))].filter(
      (email) => run(db, 'INSERT OR IGNORE INTO members (email, added_at) VALUES (?, ?)', email, now).changes === 1,
    ),
  );
}

function removeMemberInTx(db: DB, email: string): { removed: boolean; deactivated: boolean } {
  const removed = run(db, 'DELETE FROM members WHERE email = ?', email).changes === 1;
  const user = getUserByEmail(db, email);
  let deactivated = false;
  if (user) {
    deactivated = run(db, 'UPDATE users SET active = 0 WHERE id = ? AND active = 1', user.id).changes === 1;
    run(db, 'DELETE FROM sessions WHERE user_id = ?', user.id);
  }
  return { removed, deactivated };
}

/** Removes an email from the allowlist, deactivates its user and deletes their sessions. */
export function removeMember(db: DB, email: string): { removed: boolean; deactivated: boolean } {
  return tx(db, () => removeMemberInTx(db, normalizeEmail(email)));
}

/** Makes the allowlist exactly `emails` (plus `keep`, the admin), deactivating users who drop off it. */
export function replaceMembers(db: DB, emails: string[], keep: string, now: number) {
  const wanted = new Set([...emails.map(normalizeEmail), normalizeEmail(keep)]);
  return tx(db, () => {
    const current = all<{ email: string }>(db, 'SELECT email FROM members').map((r) => r.email);
    const removed = current.filter((e) => !wanted.has(e));
    let deactivated = 0;
    for (const email of removed) if (removeMemberInTx(db, email).deactivated) deactivated++;
    const added = [...wanted].filter(
      (email) => run(db, 'INSERT OR IGNORE INTO members (email, added_at) VALUES (?, ?)', email, now).changes === 1,
    );
    return { added, removed, deactivated, total: wanted.size };
  });
}

export function listMembers(db: DB) {
  return all<{ email: string; added_at: number; user_id: number | null; display_name: string | null; active: number | null }>(
    db,
    `SELECT m.email, m.added_at, u.id AS user_id, u.display_name, u.active
       FROM members m LEFT JOIN users u ON u.email = m.email
      ORDER BY m.email`,
  );
}

// ── users ───────────────────────────────────────────────────────────────────

export function getUserById(db: DB, id: number): User | undefined {
  return one<User>(db, 'SELECT * FROM users WHERE id = ?', id);
}

export function getUserByEmail(db: DB, email: string): User | undefined {
  return one<User>(db, 'SELECT * FROM users WHERE email = ?', normalizeEmail(email));
}

export function createUser(db: DB, email: string, now: number): User {
  const { id } = run(db, 'INSERT INTO users (email, active, created_at) VALUES (?, 1, ?)', email, now);
  return getUserById(db, id)!;
}

/** Returns false if another user already has the name (case-insensitive). */
export function setDisplayName(db: DB, userId: number, name: string): boolean {
  const taken = one(db, 'SELECT 1 AS x FROM users WHERE display_name = ? COLLATE NOCASE AND id != ?', name, userId);
  if (taken) return false;
  run(db, 'UPDATE users SET display_name = ? WHERE id = ?', name, userId);
  return true;
}

export function setUserActive(db: DB, userId: number, active: boolean): void {
  tx(db, () => {
    run(db, 'UPDATE users SET active = ? WHERE id = ?', active ? 1 : 0, userId);
    if (!active) run(db, 'DELETE FROM sessions WHERE user_id = ?', userId);
  });
}

export function listUsers(db: DB) {
  return all<User & { member: number; cans: number; sessions: number; avatar_at: number | null }>(
    db,
    `SELECT u.*,
            EXISTS (SELECT 1 FROM members m WHERE m.email = u.email) AS member,
            (SELECT COUNT(*) FROM cans c WHERE c.user_id = u.id AND c.deleted_at IS NULL) AS cans,
            (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id) AS sessions,
            (SELECT updated_at FROM avatars a WHERE a.user_id = u.id) AS avatar_at
       FROM users u
      ORDER BY u.active DESC, u.display_name COLLATE NOCASE, u.email`,
  );
}

// ── login codes ─────────────────────────────────────────────────────────────

export function createLoginCode(
  db: DB,
  c: { email: string; codeHash: string; ip: string; now: number; expiresAt: number },
): number {
  return run(
    db,
    'INSERT INTO login_codes (email, code_hash, ip, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
    c.email, c.codeHash, c.ip, c.now, c.expiresAt,
  ).id;
}

/** The newest code for this email that hasn't been used. Older codes are superseded. */
export function latestUnusedCode(db: DB, email: string): LoginCode | undefined {
  return one<LoginCode>(db, 'SELECT * FROM login_codes WHERE email = ? AND used_at IS NULL ORDER BY id DESC LIMIT 1', email);
}

export function addCodeAttempt(db: DB, id: number): void {
  run(db, 'UPDATE login_codes SET attempts = attempts + 1 WHERE id = ?', id);
}

export function markCodeUsed(db: DB, id: number, now: number): void {
  run(db, 'UPDATE login_codes SET used_at = ? WHERE id = ?', now, id);
}

/** Every send attempt, including refused ones: protects the shared Resend quota. */
export function countCodesSince(db: DB, since: number): number {
  return one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM login_codes WHERE created_at > ?', since)!.n;
}

/** Codes that actually went out to this email. A refused send never reached the inbox. */
export function countSentCodesSince(db: DB, email: string, since: number): number {
  return one<{ n: number }>(
    db,
    'SELECT COUNT(*) AS n FROM login_codes WHERE email = ? AND created_at > ? AND send_failed = 0',
    email, since,
  )!.n;
}

/** Resend refused it: the code is unusable and doesn't count towards the per-email limit. */
export function markSendFailed(db: DB, id: number, now: number): void {
  run(db, 'UPDATE login_codes SET used_at = ?, send_failed = 1 WHERE id = ?', now, id);
}

export function codeTimesSince(db: DB, since: number): number[] {
  return all<{ created_at: number }>(db, 'SELECT created_at FROM login_codes WHERE created_at > ?', since).map((r) => r.created_at);
}

// ── sessions ────────────────────────────────────────────────────────────────

export function createSession(db: DB, tokenHash: string, userId: number, now: number, userAgent: string | undefined): void {
  run(
    db,
    'INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, user_agent) VALUES (?, ?, ?, ?, ?)',
    tokenHash, userId, now, now, userAgent?.slice(0, 300) ?? null,
  );
}

export function sessionUser(db: DB, tokenHash: string): SessionUser | undefined {
  return one<SessionUser>(
    db,
    `SELECT u.*, s.token_hash, s.last_seen_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?`,
    tokenHash,
  );
}

export function touchSession(db: DB, tokenHash: string, now: number): void {
  run(db, 'UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?', now, tokenHash);
}

export function deleteSession(db: DB, tokenHash: string): void {
  run(db, 'DELETE FROM sessions WHERE token_hash = ?', tokenHash);
}

export function deleteUserSessions(db: DB, userId: number): number {
  return run(db, 'DELETE FROM sessions WHERE user_id = ?', userId).changes;
}

// ── cans ────────────────────────────────────────────────────────────────────

export function insertCan(
  db: DB,
  c: { userId: number; createdAt: number; month: string; priceOre: number; byAdmin?: boolean; idemKey?: string | null },
): number {
  return run(
    db,
    'INSERT INTO cans (user_id, created_at, month, price_ore, created_by_admin, idem_key) VALUES (?, ?, ?, ?, ?, ?)',
    c.userId, c.createdAt, c.month, c.priceOre, c.byAdmin ? 1 : 0, c.idemKey ?? null,
  ).id;
}

export function getCan(db: DB, id: number): Can | undefined {
  return one<Can>(db, 'SELECT * FROM cans WHERE id = ?', id);
}

export function canByIdemKey(db: DB, userId: number, key: string): Can | undefined {
  return one<Can>(db, 'SELECT * FROM cans WHERE user_id = ? AND idem_key = ?', userId, key);
}

/** Times of the user's own (not admin-added), not-deleted cans since `since`, oldest first. */
export function ownCanTimesSince(db: DB, userId: number, since: number): number[] {
  return all<{ created_at: number }>(
    db,
    `SELECT created_at FROM cans
      WHERE user_id = ? AND created_at > ? AND deleted_at IS NULL AND created_by_admin = 0
      ORDER BY created_at`,
    userId, since,
  ).map((r) => r.created_at);
}

export function softDeleteCan(db: DB, id: number, by: number, now: number): boolean {
  return run(db, 'UPDATE cans SET deleted_at = ?, deleted_by = ? WHERE id = ? AND deleted_at IS NULL', now, by, id).changes === 1;
}

export function restoreCan(db: DB, id: number): boolean {
  return run(db, 'UPDATE cans SET deleted_at = NULL, deleted_by = NULL WHERE id = ? AND deleted_at IS NOT NULL', id).changes === 1;
}

export function monthTotals(db: DB, userId: number, month: string): { count: number; ore: number } {
  return one<{ count: number; ore: number }>(
    db,
    `SELECT COUNT(*) AS count, COALESCE(SUM(price_ore), 0) AS ore
       FROM cans WHERE user_id = ? AND month = ? AND deleted_at IS NULL`,
    userId, month,
  )!;
}

/** Competition rank (1 + people with more cans) among active users this month. */
export function monthRank(db: DB, userId: number, month: string): number | null {
  const { count } = monthTotals(db, userId, month);
  if (count === 0) return null;
  const { ahead } = one<{ ahead: number }>(
    db,
    `SELECT COUNT(*) AS ahead FROM (
       SELECT c.user_id FROM cans c JOIN users u ON u.id = c.user_id
        WHERE c.month = ? AND c.deleted_at IS NULL AND u.active = 1
        GROUP BY c.user_id HAVING COUNT(*) > ?)`,
    month, count,
  )!;
  return ahead + 1;
}

export function userMonthCans(db: DB, userId: number, month: string): Can[] {
  return all<Can>(
    db,
    'SELECT * FROM cans WHERE user_id = ? AND month = ? AND deleted_at IS NULL ORDER BY created_at DESC',
    userId, month,
  );
}

/** Public ranking: active, named users only; `month` null means all time. */
export type BoardRow = { id: number; name: string; count: number; avatar_at: number | null };

export function leaderboard(db: DB, month: string | null): BoardRow[] {
  return all<BoardRow>(
    db,
    `SELECT u.id, u.display_name AS name, COUNT(*) AS count,
            (SELECT updated_at FROM avatars a WHERE a.user_id = u.id) AS avatar_at
       FROM cans c JOIN users u ON u.id = c.user_id
      WHERE c.deleted_at IS NULL AND u.active = 1 AND u.display_name IS NOT NULL
        AND (?1 IS NULL OR c.month = ?1)
      GROUP BY u.id
      ORDER BY count DESC, u.display_name COLLATE NOCASE`,
    month,
  );
}

export function officeCount(db: DB, month: string): number {
  return one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM cans WHERE month = ? AND deleted_at IS NULL', month)!.n;
}

/** What each person owes for a month, including deactivated users. */
export function monthOverview(db: DB, month: string) {
  return all<{ user_id: number; name: string | null; email: string; active: number; count: number; ore: number }>(
    db,
    `SELECT u.id AS user_id, u.display_name AS name, u.email, u.active, COUNT(*) AS count, SUM(c.price_ore) AS ore
       FROM cans c JOIN users u ON u.id = c.user_id
      WHERE c.month = ? AND c.deleted_at IS NULL
      GROUP BY u.id
      ORDER BY u.display_name COLLATE NOCASE, u.email`,
    month,
  );
}

export function monthsWithCans(db: DB): string[] {
  return all<{ month: string }>(db, 'SELECT DISTINCT month FROM cans ORDER BY month DESC').map((r) => r.month);
}

export type CanFilter = { month?: string; userId?: number; status: 'all' | 'active' | 'deleted'; limit: number; offset: number };

export function listCans(db: DB, f: CanFilter) {
  return all<Can & { name: string | null; email: string }>(
    db,
    `SELECT c.*, u.display_name AS name, u.email
       FROM cans c JOIN users u ON u.id = c.user_id
      WHERE (?1 IS NULL OR c.month = ?1)
        AND (?2 IS NULL OR c.user_id = ?2)
        AND (?3 = 'all' OR (?3 = 'active' AND c.deleted_at IS NULL) OR (?3 = 'deleted' AND c.deleted_at IS NOT NULL))
      ORDER BY c.created_at DESC, c.id DESC
      LIMIT ?4 OFFSET ?5`,
    f.month ?? null, f.userId ?? null, f.status, f.limit, f.offset,
  );
}

// ── debt and "Jeg har betalt" ───────────────────────────────────────────────

const UNSETTLED = 'deleted_at IS NULL AND settlement_id IS NULL';

/** What the user owes: every live can not yet covered by a clearing. */
export function outstanding(db: DB, userId: number): { count: number; ore: number } {
  return one<{ count: number; ore: number }>(
    db,
    `SELECT COUNT(*) AS count, COALESCE(SUM(price_ore), 0) AS ore FROM cans WHERE user_id = ? AND ${UNSETTLED}`,
    userId,
  )!;
}

export function outstandingByMonth(db: DB, userId: number) {
  return all<{ month: string; count: number; ore: number }>(
    db,
    `SELECT month, COUNT(*) AS count, SUM(price_ore) AS ore FROM cans
      WHERE user_id = ? AND ${UNSETTLED} GROUP BY month ORDER BY month DESC`,
    userId,
  );
}

/** Newest unsettled can id, so a clear covers exactly what the confirm page showed. */
export function lastUnsettledCanId(db: DB, userId: number): number {
  return one<{ id: number | null }>(db, `SELECT MAX(id) AS id FROM cans WHERE user_id = ? AND ${UNSETTLED}`, userId)!.id ?? 0;
}

export type Settlement = {
  id: number;
  user_id: number;
  at: number;
  amount_ore: number;
  cans: number;
  reversed_at: number | null;
  reversed_by: number | null;
};

/**
 * Clears every unsettled can up to `throughId`, but only if they still add up to `expectedOre`
 * (the amount the user confirmed). Returns null if there's nothing to clear or the amount changed.
 */
export function settle(db: DB, userId: number, throughId: number, expectedOre: number, now: number): Settlement | null {
  return tx(db, () => {
    const due = one<{ count: number; ore: number }>(
      db,
      `SELECT COUNT(*) AS count, COALESCE(SUM(price_ore), 0) AS ore FROM cans WHERE user_id = ? AND id <= ? AND ${UNSETTLED}`,
      userId, throughId,
    )!;
    if (due.count === 0 || due.ore !== expectedOre) return null;
    const { id } = run(db, 'INSERT INTO settlements (user_id, at, amount_ore, cans) VALUES (?, ?, ?, ?)', userId, now, due.ore, due.count);
    run(db, `UPDATE cans SET settlement_id = ? WHERE user_id = ? AND id <= ? AND ${UNSETTLED}`, id, userId, throughId);
    return getSettlement(db, id)!;
  });
}

export function getSettlement(db: DB, id: number): Settlement | undefined {
  return one<Settlement>(db, 'SELECT * FROM settlements WHERE id = ?', id);
}

export function lastSettlement(db: DB, userId: number): Settlement | undefined {
  return one<Settlement>(db, 'SELECT * FROM settlements WHERE user_id = ? AND reversed_at IS NULL ORDER BY at DESC, id DESC LIMIT 1', userId);
}

/** Admin undo: the covered cans count as owed again. */
export function reverseSettlement(db: DB, id: number, by: number, now: number): boolean {
  return tx(db, () => {
    if (run(db, 'UPDATE settlements SET reversed_at = ?, reversed_by = ? WHERE id = ? AND reversed_at IS NULL', now, by, id).changes !== 1) {
      return false;
    }
    run(db, 'UPDATE cans SET settlement_id = NULL WHERE settlement_id = ?', id);
    return true;
  });
}

export function listSettlements(db: DB, limit: number) {
  return all<Settlement & { name: string | null; email: string }>(
    db,
    `SELECT s.*, u.display_name AS name, u.email FROM settlements s JOIN users u ON u.id = s.user_id
      ORDER BY s.at DESC, s.id DESC LIMIT ?`,
    limit,
  );
}

/** Per person: bought in total, cleared via "Jeg har betalt", and still owed. */
export function debtSummary(db: DB) {
  return all<{ user_id: number; name: string | null; email: string; active: number; bought_count: number; bought_ore: number; cleared_ore: number; owed_ore: number }>(
    db,
    `SELECT u.id AS user_id, u.display_name AS name, u.email, u.active,
            (SELECT COUNT(*) FROM cans c WHERE c.user_id = u.id AND c.deleted_at IS NULL) AS bought_count,
            (SELECT COALESCE(SUM(price_ore), 0) FROM cans c WHERE c.user_id = u.id AND c.deleted_at IS NULL) AS bought_ore,
            (SELECT COALESCE(SUM(amount_ore), 0) FROM settlements s WHERE s.user_id = u.id AND s.reversed_at IS NULL) AS cleared_ore,
            (SELECT COALESCE(SUM(price_ore), 0) FROM cans c WHERE c.user_id = u.id AND c.deleted_at IS NULL AND c.settlement_id IS NULL) AS owed_ore
       FROM users u
      WHERE EXISTS (SELECT 1 FROM cans c WHERE c.user_id = u.id)
      ORDER BY u.display_name COLLATE NOCASE, u.email`,
  );
}

// ── avatars ─────────────────────────────────────────────────────────────────

export function setAvatar(db: DB, userId: number, mime: string, data: Uint8Array, now: number): void {
  run(
    db,
    `INSERT INTO avatars (user_id, mime, data, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET mime = excluded.mime, data = excluded.data, updated_at = excluded.updated_at`,
    userId, mime, data, now,
  );
}

/** Only for active users: a deactivated user's picture disappears with them. */
export function getAvatar(db: DB, userId: number): { mime: string; data: Uint8Array; updated_at: number } | undefined {
  return one(
    db,
    'SELECT a.mime, a.data, a.updated_at FROM avatars a JOIN users u ON u.id = a.user_id WHERE a.user_id = ? AND u.active = 1',
    userId,
  );
}

export function avatarVersion(db: DB, userId: number): number | null {
  return one<{ updated_at: number }>(db, 'SELECT updated_at FROM avatars WHERE user_id = ?', userId)?.updated_at ?? null;
}

export function deleteAvatar(db: DB, userId: number): boolean {
  return run(db, 'DELETE FROM avatars WHERE user_id = ?', userId).changes === 1;
}

// ── admin log ───────────────────────────────────────────────────────────────

export function logAdmin(db: DB, now: number, action: string, details: Record<string, unknown>): void {
  run(db, 'INSERT INTO admin_log (at, action, details_json) VALUES (?, ?, ?)', now, action, JSON.stringify(details));
}

export function adminLog(db: DB, limit: number) {
  return all<{ id: number; at: number; action: string; details_json: string }>(
    db,
    'SELECT * FROM admin_log ORDER BY id DESC LIMIT ?',
    limit,
  );
}
