import { describe, expect, it } from 'vitest';
import * as store from '../src/store';
import { ADMIN_EMAIL, PUBLIC_URL, setup, json } from './helpers';

describe('CSRF', () => {
  it('rejects a cross-origin POST', async () => {
    const t = setup();
    const cookie = await t.login('ola@example.com', 'Ola');
    const res = await t.post('/api/cans', { cookie, json: {}, origin: 'https://evil.example' });
    expect(res.status).toBe(403);
    expect(Number(t.db.prepare('SELECT COUNT(*) AS n FROM cans').get()!.n)).toBe(0);
  });

  it('rejects a POST without an Origin header', async () => {
    const t = setup();
    const cookie = await t.login('ola@example.com', 'Ola');
    expect((await t.post('/api/cans', { cookie, json: {}, origin: null })).status).toBe(403);
  });

  it('rejects a cross-origin DELETE', async () => {
    const t = setup();
    const cookie = await t.login('ola@example.com', 'Ola');
    const { id } = await json(await t.logCan(cookie));
    expect((await t.del(`/api/cans/${id}`, { cookie, origin: 'https://evil.example' })).status).toBe(403);
  });

  it('rejects a cross-origin login request without sending mail', async () => {
    const t = setup();
    t.addMember('ola@example.com');
    const res = await t.post('/login', { form: { email: 'ola@example.com' }, origin: 'https://evil.example' });
    expect(res.status).toBe(403);
    expect(t.mailer.calls).toBe(0);
  });

  it('rejects a cross-origin admin action', async () => {
    const t = setup();
    const admin = await t.login(ADMIN_EMAIL, 'Sjefen');
    await t.post('/admin/price', { cookie: admin, form: { kr: '99' }, origin: 'http://tally.example' });
    expect(store.getPriceOre(t.db)).toBe(1000);
    await t.post('/admin/price', { cookie: admin, form: { kr: '99' }, origin: PUBLIC_URL });
    expect(store.getPriceOre(t.db)).toBe(9900);
  });
});

describe('deactivated users', () => {
  it('cannot scan', async () => {
    const t = setup();
    const cookie = await t.login('ola@example.com', 'Ola');
    store.setUserActive(t.db, t.userId('ola@example.com'), false);
    expect((await t.get('/scan', { cookie })).status).toBe(302);
    expect((await t.logCan(cookie)).status).toBe(401);
  });

  it('cannot log in, even with a code issued before deactivation', async () => {
    const t = setup();
    await t.login('ola@example.com', 'Ola');
    await t.requestCode('ola@example.com');
    const code = t.mailer.lastCodeFor('ola@example.com');
    store.setUserActive(t.db, t.userId('ola@example.com'), false);
    const res = await t.verify('ola@example.com', code);
    expect(res.status).toBe(400);
    expect(res.headers.getSetCookie().some((c) => c.startsWith('rb_session=') && !c.startsWith('rb_session=;'))).toBe(false);
  });
});

describe('headers and pages', () => {
  it('serves health, robots and icons', async () => {
    const t = setup();
    expect((await t.get('/healthz')).status).toBe(200);
    const icon = await t.get('/icon-192.png');
    expect(icon.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await icon.arrayBuffer()).slice(1, 4)).toEqual(new TextEncoder().encode('PNG'));
  });

  it('keeps every page under 30 KB and sends a CSP', async () => {
    const t = setup();
    const ola = await t.login('ola@example.com', 'Ola');
    const admin = await t.login(ADMIN_EMAIL, 'Sjefen');
    for (let i = 0; i < 5; i++) await t.logCan(ola, { confirm: true });
    const pages: Array<[string, string | undefined]> = [
      ['/login', undefined],
      ['/scan', ola],
      ['/me', ola],
      ['/leaderboard', undefined],
      ['/admin', admin],
      ['/admin/month', admin],
      ['/admin/members', admin],
      ['/admin/users', admin],
      ['/admin/entries', admin],
      ['/admin/payments', admin],
      ['/admin/log', admin],
      ['/me/betal', ola],
    ];
    for (const [path, cookie] of pages) {
      const res = await t.get(path, { cookie });
      expect(res.status, path).toBe(200);
      expect(res.headers.get('content-security-policy'), path).toContain("default-src 'none'");
      const bytes = (await res.arrayBuffer()).byteLength;
      expect(bytes, path).toBeLessThan(30 * 1024);
    }
  });

  it('marks authenticated pages no-store', async () => {
    const t = setup();
    const cookie = await t.login('ola@example.com', 'Ola');
    expect((await t.get('/me', { cookie })).headers.get('cache-control')).toBe('no-store');
  });
});
