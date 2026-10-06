import type { Hono } from 'hono';
import { LIMITS } from '../config';
import { one } from '../db';
import type { AppEnv, Ctx } from '../http';
import { iconPng } from '../icon';
import * as store from '../store';
import { formatMonth, osloMonth } from '../time';
import { leaderboardPage } from '../views/pages';

/** Paths that never need the session, so they skip the lookup and never set cookies. */
export const PUBLIC_PATHS = new Set(['/healthz', '/robots.txt', '/manifest.webmanifest', '/leaderboard', '/icon-180.png', '/icon-192.png', '/icon-512.png']);

const MANIFEST = JSON.stringify({
  name: 'Red Bull-tally',
  short_name: 'Red Bull',
  lang: 'nb',
  start_url: '/me', // not /scan: opening the home-screen app must not log a can
  scope: '/',
  display: 'standalone',
  background_color: '#0b0b0c',
  theme_color: '#0b0b0c',
  icons: [
    { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
  ],
});

export function publicRoutes(app: Hono<AppEnv>, ctx: Ctx): void {
  const { db } = ctx;

  app.get('/', (c) => c.redirect('/me', 302));

  app.get('/healthz', (c) => {
    one(db, 'SELECT 1 AS ok');
    return c.text('ok');
  });

  app.get('/robots.txt', (c) => {
    c.header('Cache-Control', 'public, max-age=86400');
    return c.text('User-agent: *\nDisallow: /\n');
  });

  app.get('/manifest.webmanifest', (c) =>
    c.body(MANIFEST, 200, { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'public, max-age=86400' }),
  );

  for (const size of [180, 192, 512]) {
    app.get(`/icon-${size}.png`, (c) =>
      c.body(new Uint8Array(iconPng(size)), 200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=604800' }),
    );
  }

  // Public because the leaderboard is. The ?v= in the URL changes on every upload.
  app.get('/avatar/:id', (c) => {
    const id = Number(c.req.param('id'));
    const avatar = Number.isSafeInteger(id) ? store.getAvatar(db, id) : undefined;
    if (!avatar) return c.notFound();
    const fresh = c.req.query('v') === String(avatar.updated_at);
    return c.body(new Uint8Array(avatar.data), 200, {
      'Content-Type': avatar.mime,
      'Cache-Control': fresh ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
    });
  });

  // Rendered at most once per 30 s per tab, so refreshing or spamming it never hits the database hard.
  const cache = new Map<string, { at: number; html: string }>();
  app.get('/leaderboard', (c) => {
    const tab = c.req.query('tab') === 'total' ? 'total' : 'month';
    const now = ctx.now();
    let hit = cache.get(tab);
    if (!hit || now - hit.at >= LIMITS.leaderboardCacheMs) {
      const month = osloMonth(now);
      hit = {
        at: now,
        html: leaderboardPage({
          nonce: '', // no script on this page
          tab,
          monthLabel: formatMonth(month),
          officeCount: store.officeCount(db, month),
          rows: store.leaderboard(db, tab === 'month' ? month : null),
        }),
      };
      cache.set(tab, hit);
    }
    c.header('Cache-Control', 'public, max-age=30');
    return c.html(hit.html);
  });
}
