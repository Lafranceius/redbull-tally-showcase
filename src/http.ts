import type { Context } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import { LIMITS, type Config } from './config';
import type { DB } from './db';
import type { Mailer } from './mailer';
import type { RateLimiter } from './security';
import type { SessionUser } from './store';

export type AppEnv = { Variables: { user: SessionUser | null; nonce: string } };
export type C = Context<AppEnv>;

/** Everything a route needs; built once in createApp. */
export type Ctx = {
  db: DB;
  mailer: Mailer;
  config: Config;
  now: () => number;
  codeRequestsPerIp: RateLimiter;
};

export const SESSION_COOKIE = 'rb_session';

export function setSessionCookie(c: C, token: string): void {
  // Set by the server, never document.cookie: Safari caps script-set cookies at 7 days.
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: LIMITS.sessionMaxAgeSec,
  });
}

export function clearSessionCookie(c: C): void {
  deleteCookie(c, SESSION_COOKIE, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/' });
}

/** Only cloudflared can reach 127.0.0.1:8095, so this header is trustworthy. */
export function clientIp(c: C): string {
  return c.req.header('cf-connecting-ip') ?? 'local';
}

export async function formOf(c: C): Promise<Record<string, string>> {
  const body = await c.req.parseBody();
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(body)) if (typeof v === 'string') out[k] = v;
  return out;
}

/** Pages: the signed-in user with a display name, or a redirect to finish logging in. */
export function pageUser(c: C, path: string): SessionUser | Response {
  const user = c.get('user');
  if (!user) return c.redirect(`/login?next=${encodeURIComponent(path)}`, 302);
  if (!user.display_name) return c.redirect(`/login/name?next=${encodeURIComponent(path)}`, 302);
  return user;
}
