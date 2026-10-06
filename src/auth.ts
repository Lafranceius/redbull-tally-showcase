import { LIMITS } from './config';
import type { DB } from './db';
import type { Mailer } from './mailer';
import { hashLoginCode, newLoginCode, sameHex } from './security';
import * as store from './store';

/**
 * `sent` and `silent` must look identical to the person asking, so the response never
 * reveals who is on the allowlist. `failed` covers both Resend refusing and our own global cap.
 */
export type CodeRequestResult = 'sent' | 'silent' | 'failed';

export async function requestLoginCode(
  db: DB,
  mailer: Mailer,
  email: string,
  ip: string,
  now: number,
): Promise<CodeRequestResult> {
  // Checked before membership so hitting the cap looks the same for everyone.
  const { max, windowMs } = LIMITS.emailsGlobal;
  if (store.countCodesSince(db, now - windowMs) >= max) {
    console.warn(`login: global email cap reached (${max} per 24 h), not sending`);
    return 'failed';
  }
  if (!store.isMember(db, email)) return 'silent';
  const user = store.getUserByEmail(db, email);
  if (user && !user.active) return 'silent';
  if (store.countSentCodesSince(db, email, now - LIMITS.codesPerEmail.windowMs) >= LIMITS.codesPerEmail.max) return 'silent';

  const code = newLoginCode();
  const id = store.createLoginCode(db, {
    email,
    codeHash: hashLoginCode(email, code),
    ip,
    now,
    expiresAt: now + LIMITS.codeTtlMs,
  });
  const result = await mailer.sendLoginCode(email, code);
  if (!result.ok) {
    // Keep the row so it still counts towards the global cap, but make the code unusable.
    store.markSendFailed(db, id, now);
    console.error(`login: Resend refused the send: ${result.error}`);
    return 'failed';
  }
  console.log(`login: code sent${result.id ? ` (resend id ${result.id})` : ''}`);
  return 'sent';
}

export type VerifyResult =
  | { ok: true; user: store.User }
  | { ok: false; reason: 'invalid' | 'wrong' | 'deactivated'; attemptsLeft?: number };

export function verifyLoginCode(db: DB, email: string, code: string, now: number): VerifyResult {
  const row = store.latestUnusedCode(db, email);
  if (!row || row.expires_at <= now || row.attempts >= LIMITS.codeMaxAttempts) return { ok: false, reason: 'invalid' };
  if (!/^\d{6}$/.test(code) || !sameHex(hashLoginCode(email, code), row.code_hash)) {
    store.addCodeAttempt(db, row.id);
    return { ok: false, reason: 'wrong', attemptsLeft: LIMITS.codeMaxAttempts - row.attempts - 1 };
  }
  store.markCodeUsed(db, row.id, now);
  if (!store.isMember(db, email)) return { ok: false, reason: 'invalid' };
  const existing = store.getUserByEmail(db, email);
  if (existing && !existing.active) return { ok: false, reason: 'deactivated' };
  return { ok: true, user: existing ?? store.createUser(db, email, now) };
}

/** Trims and collapses whitespace; returns null unless 2–20 characters without control characters. */
export function cleanDisplayName(raw: string): string | null {
  const name = raw.normalize('NFC').trim().replace(/\s+/g, ' ');
  const length = [...name].length;
  if (length < 2 || length > 20 || /[\p{Cc}\p{Cf}<>]/u.test(name)) return null;
  return name;
}

/** Only same-site absolute paths, so `next` can't send anyone elsewhere. */
export function safeNext(next: string | undefined | null): string {
  if (!next || !/^\/(?![/\\])[\w\-./?=&%]*$/.test(next) || next.startsWith('/login')) return '/me';
  return next;
}
