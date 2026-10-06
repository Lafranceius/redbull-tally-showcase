import { describe, expect, it } from 'vitest';
import * as store from '../src/store';
import { ADMIN_EMAIL, MINUTE, PUBLIC_URL, json, setup, type T } from './helpers';

/** Smallest thing that looks like a JPEG to the server: SOI marker, filler, EOI marker. */
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(64).fill(7), 0xff, 0xd9]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(32).fill(1)]);

function upload(t: T, cookie: string | undefined, body: Uint8Array | string, type = 'image/jpeg', origin = PUBLIC_URL) {
  const headers: Record<string, string> = { 'content-type': type, origin, 'cf-connecting-ip': '203.0.113.9' };
  if (cookie) headers.cookie = cookie;
  return t.app.request('/api/avatar', { method: 'POST', headers, body });
}

describe('profile pictures', () => {
  it('stores an uploaded picture and serves it back', async () => {
    const t = setup();
    const ola = await t.login('ola@example.com', 'Ola');
    const res = await upload(t, ola, JPEG);
    expect(res.status).toBe(200);
    const { url } = await json(res);
    expect(url).toMatch(new RegExp(`^/avatar/${t.userId('ola@example.com')}\\?v=\\d+$`));

    const img = await t.get(url);
    expect(img.status).toBe(200);
    expect(img.headers.get('content-type')).toBe('image/jpeg');
    expect(img.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await img.arrayBuffer())).toEqual(JPEG);
  });

  it('accepts PNG too, and replaces the old picture', async () => {
    const t = setup();
    const ola = await t.login('ola@example.com', 'Ola');
    await upload(t, ola, JPEG);
    t.advance(MINUTE);
    expect((await upload(t, ola, PNG, 'image/png')).status).toBe(200);
    const img = await t.get(`/avatar/${t.userId('ola@example.com')}`);
    expect(img.headers.get('content-type')).toBe('image/png');
  });

  it('rejects anything that is not a JPEG, PNG or WebP image', async () => {
    const t = setup();
    const ola = await t.login('ola@example.com', 'Ola');
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
    expect((await upload(t, ola, svg, 'image/svg+xml')).status).toBe(415);
    expect((await upload(t, ola, '<html>hi</html>', 'image/jpeg')).status).toBe(415);
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM avatars').get()!.n).toBe(0);
  });

  it('rejects pictures over 200 KB', async () => {
    const t = setup();
    const ola = await t.login('ola@example.com', 'Ola');
    const big = new Uint8Array(201 * 1024);
    big.set([0xff, 0xd8, 0xff]);
    expect((await upload(t, ola, big)).status).toBe(413);
  });

  it('requires a session and a same-origin request', async () => {
    const t = setup();
    expect((await upload(t, undefined, JPEG)).status).toBe(401);
    const ola = await t.login('ola@example.com', 'Ola');
    expect((await upload(t, ola, JPEG, 'image/jpeg', 'https://evil.example')).status).toBe(403);
  });

  it('lets you remove your own picture', async () => {
    const t = setup();
    const ola = await t.login('ola@example.com', 'Ola');
    await upload(t, ola, JPEG);
    expect((await t.del('/api/avatar', { cookie: ola })).status).toBe(200);
    expect((await t.get(`/avatar/${t.userId('ola@example.com')}`)).status).toBe(404);
  });

  it('shows pictures on the leaderboard, and initials for people without one', async () => {
    const t = setup();
    const ola = await t.login('ola@example.com', 'Ola');
    const kari = await t.login('kari@example.com', 'Kari Nordmann');
    await upload(t, ola, JPEG);
    await t.logCan(ola);
    await t.logCan(kari);
    const page = await (await t.get('/leaderboard')).text();
    expect(page).toMatch(new RegExp(`<img[^>]+src="/avatar/${t.userId('ola@example.com')}\\?v=\\d+"`));
    expect(page).toContain('>KN<');
  });

  it('shows your picture on /me', async () => {
    const t = setup();
    const ola = await t.login('ola@example.com', 'Ola');
    await upload(t, ola, JPEG);
    const page = await (await t.get('/me', { cookie: ola })).text();
    expect(page).toContain(`/avatar/${t.userId('ola@example.com')}?v=`);
  });

  it('lets the admin remove a picture', async () => {
    const t = setup();
    const ola = await t.login('ola@example.com', 'Ola');
    await upload(t, ola, JPEG);
    const admin = await t.login(ADMIN_EMAIL, 'Sjefen');
    const id = t.userId('ola@example.com');
    expect((await t.post(`/admin/users/${id}/avatar/delete`, { cookie: admin })).status).toBe(303);
    expect((await t.get(`/avatar/${id}`)).status).toBe(404);
    const actions = t.db.prepare('SELECT action FROM admin_log').all().map((r) => r.action);
    expect(actions).toContain('user.avatar.remove');
  });

  it('does not serve the picture of a deactivated user', async () => {
    const t = setup();
    const ola = await t.login('ola@example.com', 'Ola');
    await upload(t, ola, JPEG);
    store.setUserActive(t.db, t.userId('ola@example.com'), false);
    expect((await t.get(`/avatar/${t.userId('ola@example.com')}`)).status).toBe(404);
  });
});

describe('admin bulk delete', () => {
  it('soft-deletes several selected cans at once', async () => {
    const t = setup();
    const ola = await t.login('ola@example.com', 'Ola');
    const admin = await t.login(ADMIN_EMAIL, 'Sjefen');
    const ids: number[] = [];
    for (let i = 0; i < 3; i++) {
      ids.push((await json(await t.logCan(ola, { confirm: true }))).id);
      t.advance(MINUTE);
    }
    const body = new URLSearchParams();
    body.append('ids', String(ids[0]));
    body.append('ids', String(ids[1]));
    const res = await t.app.request('/admin/cans/delete', {
      method: 'POST',
      headers: { cookie: admin, origin: PUBLIC_URL, 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    expect(res.status).toBe(303);
    const live = t.db.prepare('SELECT id FROM cans WHERE deleted_at IS NULL').all().map((r) => r.id);
    expect(live).toEqual([ids[2]]);
    const actions = t.db.prepare('SELECT action FROM admin_log').all().map((r) => r.action);
    expect(actions).toContain('can.delete');
  });

  it('is admin only', async () => {
    const t = setup();
    const ola = await t.login('ola@example.com', 'Ola');
    const { id } = await json(await t.logCan(ola));
    const res = await t.post('/admin/cans/delete', { cookie: ola, form: { ids: String(id) } });
    expect(res.status).toBe(404);
    expect(t.db.prepare('SELECT deleted_at FROM cans').get()!.deleted_at).toBe(null);
  });
});
