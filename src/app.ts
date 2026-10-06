import { randomBytes } from 'node:crypto';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { getCookie } from 'hono/cookie';
import { LIMITS, type Config } from './config';
import type { DB } from './db';
import { clearSessionCookie, SESSION_COOKIE, setSessionCookie, type AppEnv, type Ctx } from './http';
import type { Mailer } from './mailer';
import { adminRoutes } from './routes/admin';
import { authRoutes } from './routes/auth';
import { PUBLIC_PATHS, publicRoutes } from './routes/public';
import { userRoutes } from './routes/user';
import { RateLimiter, sha256 } from './security';
import * as store from './store';
import { errorPage, notFoundPage } from './views/layout';

export type Deps = { db: DB; mailer: Mailer; config: Config; now?: () => number };

export function createApp(deps: Deps): Hono<AppEnv> {
  const ctx: Ctx = {
    ...deps,
    now: deps.now ?? Date.now,
    codeRequestsPerIp: new RateLimiter(LIMITS.codeRequestsPerIp.max, LIMITS.codeRequestsPerIp.windowMs),
  };
  const { db, config } = ctx;
  const app = new Hono<AppEnv>();

  // Security headers on everything; per-response nonce for the inline scripts.
  app.use(async (c, next) => {
    const nonce = randomBytes(16).toString('base64');
    c.set('nonce', nonce);
    c.set('user', null);
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    // `same-origin` (not `no-referrer`) so browsers still send a real Origin on form posts.
    c.header('Referrer-Policy', 'same-origin');
    c.header('X-Frame-Options', 'DENY');
    c.header('X-Robots-Tag', 'noindex, nofollow');
    c.header(
      'Content-Security-Policy',
      `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; manifest-src 'self'`,
    );
    if (!c.res.headers.has('Cache-Control')) c.header('Cache-Control', 'no-store');
  });

  // CSRF: every write must come from our own pages.
  app.use(async (c, next) => {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && c.req.header('origin') !== config.publicUrl) {
      return c.text('Forbidden', 403);
    }
    await next();
  });

  app.use(bodyLimit({ maxSize: 256 * 1024, onError: (c) => c.text('Payload too large', 413) }));

  // Session: look up the cookie, renew it, and expose the user as c.get('user').
  app.use(async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token && !PUBLIC_PATHS.has(c.req.path) && !c.req.path.startsWith('/avatar/')) {
      const hash = sha256(token);
      const user = store.sessionUser(db, hash);
      const now = ctx.now();
      if (user && user.active && now - user.last_seen_at < LIMITS.sessionMaxAgeSec * 1000) {
        if (now - user.last_seen_at > 60_000) store.touchSession(db, hash, now);
        setSessionCookie(c, token);
        c.set('user', user);
      } else {
        if (user) store.deleteSession(db, hash);
        clearSessionCookie(c);
      }
    }
    await next();
  });

  publicRoutes(app, ctx);
  authRoutes(app, ctx);
  userRoutes(app, ctx);
  app.route('/admin', adminRoutes(ctx));

  app.notFound((c) => c.html(notFoundPage(c.get('nonce') ?? ''), 404));
  app.onError((err, c) => {
    console.error(err);
    return c.html(errorPage(c.get('nonce') ?? ''), 500);
  });

  return app;
}
