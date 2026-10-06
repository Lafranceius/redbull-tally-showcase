import { describe, expect, it } from 'vitest';
import * as store from '../src/store';
import { osloMonth } from '../src/time';
import { ADMIN_EMAIL, MINUTE, setup, json } from './helpers';

const canCount = (t: ReturnType<typeof setup>) =>
  Number(t.db.prepare('SELECT COUNT(*) AS n FROM cans WHERE deleted_at IS NULL').get()!.n);

describe('scanning', () => {
  it('sends /scan to login when there is no session', async () => {
    const t = setup();
    const res = await t.get('/scan');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/login?next=%2Fscan');
  });

  it('never creates a can on GET', async () => {
    const t = setup();
    const cookie = await t.login('ola@example.com', 'Ola');
    for (const path of ['/scan', '/me', '/leaderboard', '/api/cans']) await t.get(path, { cookie });
    expect(canCount(t)).toBe(0);
    const page = await (await t.get('/scan', { cookie })).text();
    expect(page).toContain("fetch('/api/cans'");
  });

  it('logs a can on POST /api/cans and returns the month summary', async () => {
    const t = setup();
    const cookie = await t.login('ola@example.com', 'Ola');
    const res = await t.logCan(cookie);
    expect(res.status).toBe(201);
    expect(await json(res)).toMatchObject({ count: 1, ore: 1000, kr: '10 kr', rank: 1, month: '2026-10' });
    const can = t.db.prepare('SELECT * FROM cans').get()!;
    expect(can).toMatchObject({
      user_id: t.userId('ola@example.com'),
      created_at: t.clock.now,
      month: '2026-10',
      price_ore: 1000,
      created_by_admin: 0,
      deleted_at: null,
    });
  });

  it('logs only once per Idempotency-Key', async () => {
    const t = setup();
    const cookie = await t.login('ola@example.com', 'Ola');
    const key = crypto.randomUUID();
    const first = await t.logCan(cookie, { key });
    const again = await t.logCan(cookie, { key });
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect((await json(again)).id).toBe((await json(first)).id);
    expect(canCount(t)).toBe(1);
  });

  it('ranks people by cans this month', async () => {
    const t = setup();
    const ola = await t.login('ola@example.com', 'Ola');
    const kari = await t.login('kari@example.com', 'Kari');
    await t.logCan(ola);
    t.advance(2 * MINUTE);
    await t.logCan(ola);
    const res = await t.logCan(kari);
    expect(await json(res)).toMatchObject({ count: 1, rank: 2 });
  });

  it('refuses without a session', async () => {
    const t = setup();
    const res = await t.post('/api/cans', { json: {} });
    expect(res.status).toBe(401);
    expect(canCount(t)).toBe(0);
  });
});

describe('recent-scan guard', () => {
  it('asks before logging a second can within 60 seconds', async () => {
    const t = setup();
    const cookie = await t.login('ola@example.com', 'Ola');
    await t.logCan(cookie);
    t.advance(30_000);
    const res = await t.logCan(cookie);
    expect(res.status).toBe(409);
    expect(await json(res)).toEqual({ recent: true, secondsAgo: 30 });
    expect(canCount(t)).toBe(1);

    const confirmed = await t.logCan(cookie, { confirm: true });
    expect(confirmed.status).toBe(201);
    expect(canCount(t)).toBe(2);
  });

  it('does not ask after 60 seconds', async () => {
    const t = setup();
    const cookie = await t.login('ola@example.com', 'Ola');
    await t.logCan(cookie);
    t.advance(61_000);
    expect((await t.logCan(cookie)).status).toBe(201);
  });
});

describe('hard limit', () => {
  it('refuses the 6th can within 10 minutes', async () => {
    const t = setup();
    const cookie = await t.login('ola@example.com', 'Ola');
    for (let i = 0; i < 5; i++) {
      expect((await t.logCan(cookie, { confirm: true })).status).toBe(201);
      t.advance(MINUTE);
    }
    const sixth = await t.logCan(cookie, { confirm: true });
    expect(sixth.status).toBe(429);
    expect((await json(sixth)).message).toMatch(/\S/);
    expect(canCount(t)).toBe(5);

    t.advance(6 * MINUTE);
    expect((await t.logCan(cookie, { confirm: true })).status).toBe(201);
  });
});

describe('months and prices', () => {
  it('uses the Oslo calendar month', () => {
    expect(osloMonth(Date.parse('2026-10-31T23:30:00Z'))).toBe('2026-11');
    expect(osloMonth(Date.parse('2026-10-31T22:59:59Z'))).toBe('2026-10');
    expect(osloMonth(Date.parse('2026-03-31T21:59:59Z'))).toBe('2026-03');
    expect(osloMonth(Date.parse('2026-03-31T22:00:00Z'))).toBe('2026-04');
  });

  it('stores 2026-10-31T23:30:00Z as month 2026-11', async () => {
    const t = setup(Date.parse('2026-10-31T23:30:00Z'));
    const cookie = await t.login('ola@example.com', 'Ola');
    await t.logCan(cookie);
    expect(t.db.prepare('SELECT month FROM cans').get()!.month).toBe('2026-11');
  });

  it('keeps the old price on existing cans when the price changes', async () => {
    const t = setup();
    const ola = await t.login('ola@example.com', 'Ola');
    const admin = await t.login(ADMIN_EMAIL, 'Sjefen');
    await t.logCan(ola);
    expect((await t.post('/admin/price', { cookie: admin, form: { kr: '12,50' } })).status).toBe(303);
    t.advance(2 * MINUTE);
    const res = await t.logCan(ola);
    expect(await json(res)).toMatchObject({ count: 2, ore: 2250 });
    const prices = t.db.prepare('SELECT price_ore FROM cans ORDER BY id').all().map((r) => r.price_ore);
    expect(prices).toEqual([1000, 1250]);
  });
});

describe('undo', () => {
  it('soft-deletes your own can and drops it from totals', async () => {
    const t = setup();
    const cookie = await t.login('ola@example.com', 'Ola');
    const { id } = await json(await t.logCan(cookie));
    const res = await t.del(`/api/cans/${id}`, { cookie });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ count: 0, ore: 0 });
    const can = t.db.prepare('SELECT deleted_at, deleted_by FROM cans WHERE id = ?').get(id)!;
    expect(can).toEqual({ deleted_at: t.clock.now, deleted_by: t.userId('ola@example.com') });
  });

  it("refuses someone else's can", async () => {
    const t = setup();
    const ola = await t.login('ola@example.com', 'Ola');
    const kari = await t.login('kari@example.com', 'Kari');
    const { id } = await json(await t.logCan(ola));
    expect((await t.del(`/api/cans/${id}`, { cookie: kari })).status).toBe(404);
    expect(canCount(t)).toBe(1);
  });

  it('refuses a can from an earlier month', async () => {
    const t = setup(Date.parse('2026-10-31T22:00:00Z'));
    const cookie = await t.login('ola@example.com', 'Ola');
    const { id } = await json(await t.logCan(cookie));
    t.advance(2 * 60 * MINUTE); // now 2026-11-01 01:00 in Oslo
    expect((await t.del(`/api/cans/${id}`, { cookie })).status).toBe(404);
    expect(canCount(t)).toBe(1);
  });

  it('excludes deleted cans from the leaderboard and history', async () => {
    const t = setup();
    const cookie = await t.login('ola@example.com', 'Ola');
    const { id } = await json(await t.logCan(cookie));
    await t.del(`/api/cans/${id}`, { cookie });
    expect(store.monthTotals(t.db, t.userId('ola@example.com'), '2026-10')).toEqual({ count: 0, ore: 0 });
    expect(store.leaderboard(t.db, '2026-10')).toEqual([]);
  });
});

describe('/me', () => {
  it('requires a session', async () => {
    const t = setup();
    const res = await t.get('/me');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/login?next=%2Fme');
  });

  it('shows this month and earlier months', async () => {
    const t = setup(Date.parse('2026-09-20T10:00:00Z'));
    const cookie = await t.login('ola@example.com', 'Ola');
    await t.logCan(cookie);
    t.advance(30 * 24 * 60 * MINUTE);
    await t.logCan(cookie);
    const page = await (await t.get('/me', { cookie })).text();
    expect(page).toContain('2026-09');
    expect(page).toContain('+1 Red Bull');
  });

  it('links a web app manifest that starts at /me', async () => {
    const t = setup();
    const manifest = await json(await t.get('/manifest.webmanifest'));
    expect(manifest.start_url).toBe('/me');
  });
});
