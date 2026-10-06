import { mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { backup } from 'node:sqlite';
import { isEmail, loadConfig, normalizeEmail } from './config';
import { openDb, seed } from './db';
import * as store from './store';

const USAGE = `Usage:
  node dist/cli.js members <file>   Replace the allowlist with the emails in <file> (one per line).
                                    Users no longer on it are deactivated and logged out.
  node dist/cli.js backup [dir]     Online backup of the database; keeps 30 days.`;

const BACKUP_KEEP_MS = 30 * 24 * 60 * 60_000;

function members(file: string) {
  const config = loadConfig();
  const lines = readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.replace(/#.*/, '').trim())
    .filter(Boolean);
  const emails = lines.map(normalizeEmail);
  const invalid = emails.filter((e) => !isEmail(e));
  if (invalid.length) {
    console.error(`Not valid email addresses, nothing changed:\n  ${invalid.join('\n  ')}`);
    process.exit(1);
  }
  const db = openDb(config.dbPath);
  seed(db, config, Date.now());
  const result = store.replaceMembers(db, emails, config.adminEmail, Date.now());
  store.logAdmin(db, Date.now(), 'members.replace', { by: 'cli', file, ...result });
  const inactive = store.listUsers(db).filter((u) => !u.active && u.member);
  db.close();

  console.log(`Members now: ${result.total} (the admin email is always kept)`);
  console.log(`  added:   ${result.added.length}${result.added.length ? `  ${result.added.join(', ')}` : ''}`);
  console.log(`  removed: ${result.removed.length}${result.removed.length ? `  ${result.removed.join(', ')}` : ''}`);
  console.log(`  users deactivated: ${result.deactivated}`);
  if (inactive.length) {
    console.log(`Note: on the list but deactivated (reactivate in /admin/users): ${inactive.map((u) => u.email).join(', ')}`);
  }
}

async function runBackup(dirArg: string | undefined) {
  const config = loadConfig();
  const dir = dirArg ?? fileURLToPath(new URL('../backups/', import.meta.url));
  mkdirSync(dir, { recursive: true });
  const db = openDb(config.dbPath);
  const stamp = new Date().toISOString().slice(0, 10);
  const target = join(dir, `tally-${stamp}.db`);
  const tmp = `${target}.tmp`;
  const pages = await backup(db, tmp);
  db.close();
  renameSync(tmp, target);
  console.log(`backup: ${target} (${pages} pages)`);

  const cutoff = Date.now() - BACKUP_KEEP_MS;
  for (const name of readdirSync(dir)) {
    if (!/^tally-\d{4}-\d{2}-\d{2}\.db$/.test(name)) continue;
    const path = join(dir, name);
    if (statSync(path).mtimeMs < cutoff) {
      unlinkSync(path);
      console.log(`backup: removed old ${name}`);
    }
  }
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === 'members' && arg) members(arg);
else if (cmd === 'backup') await runBackup(arg);
else {
  console.error(USAGE);
  process.exit(cmd ? 1 : 0);
}
