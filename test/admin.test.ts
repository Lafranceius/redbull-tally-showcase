import { describe, expect, it } from 'vitest';
import * as store from '../src/store';
import { ADMIN_EMAIL, MINUTE, setup, json } from './helpers';

const ADMIN_PAGES = ['/admin', '/admin/month', '/admin/month.csv', '/admin/members', '/admin/users', '/admin/entries', '/admin/payments', '/admin/log'];

const logActions = (t: ReturnType<typeof setup>) =>
  t.db.prepare('SELECT action FROM admin_log ORDER BY id').all().map((r) => r.action);

describe('admin access', () => {
  it('returns 404 without a session', async () => {
    const t = setup();
    for (const path of ADMIN_PAGES) expect((await t.get(path)).status, path).toBe(404);
  });

  it('returns 404 to a non-admin, for pages and actions', async () => {
    const t = setup();
    const cookie = await t.login('ola@example.com', 'Ola');
    for (const path of ADMIN_PAGES) expect((await t.get(path, { cookie })).status, path).toBe(404);
    const res = await t.post('/admin/price', { cookie, form: { kr: '0,01' } });
    expect(res.status).toBe(404);
    expect(store.getPriceOre(t.db)).toBe(1000);
  });

  it('serves every admin page to the admin', async () => {
    const t = setup();
    const cookie = await t.login(ADMIN_EMAIL, 'Sjefen');
    for (const path of ADMIN_PAGES) expect((await t.get(path, { cookie })).status, path).toBe(200);
  });
});

describe('members', () => {
  it('seeds the allowlist with the admin email and the price with 1000 øre', () => {
    const t = setup();
    expect(store.isMember(t.db, ADMIN_EMAIL)).toBe(true);
    expect(store.getPriceOre(t.db)).toBe(1000);
  });

  it('adds a pasted list of emails, normalized', async () => {
    const t = setup();
    const admin = await t.login(ADMIN_EMAIL, 'Sjefen');
    const res = await t.post('/admin/members/add', {
      cookie: admin,
      form: { emails: ' Ola@Example.com\nkari@example.com, per@example.com;\nikke-en-epost' },
    });
    expect(res.status).toBe(303);
    for (const e of ['ola@example.com', 'kari@example.com', 'per@example.com']) expect(store.isMember(t.db, e)).toBe(true);
    expect(store.isMember(t.db, 'ikke-en-epost')).toBe(false);
    expect(logActions(t)).toContain('members.add');
  });

  it('deactivates the user and kills their sessions when an email is removed', async () => {
    const t = setup();
    const ola = await t.login('ola@example.com', 'Ola');
    const admin = await t.login(ADMIN_EMAIL, 'Sjefen');
    const res = await t.post('/admin/members/remove', { cookie: admin, form: { email: 'ola@example.com' } });
    expect(res.status).toBe(303);
    expect(store.isMember(t.db, 'ola@example.com')).toBe(false);
    expect(store.getUserByEmail(t.db, 'ola@example.com')!.active).toBe(0);
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').get(t.userId('ola@example.com'))!.n).toBe(0);
    expect((await t.get('/me', { cookie: ola })).status).toBe(302);
    expect(logActions(t)).toContain('members.remove');
  });

  it('never removes the admin email', async () => {
    const t = setup();
    const admin = await t.login(ADMIN_EMAIL, 'Sjefen');
    await t.post('/admin/members/remove', { cookie: admin, form: { email: ADMIN_EMAIL } });
    expect(store.isMember(t.db, ADMIN_EMAIL)).toBe(true);
  });

  it('replaces the whole allowlist from a file (CLI)', async () => {
    const t = setup();
    await t.login('ola@example.com', 'Ola');
    await t.login('kari@example.com', 'Kari');
    const result = store.replaceMembers(t.db, ['KARI@example.com', 'per@example.com'], ADMIN_EMAIL, t.clock.now);
    expect(result).toMatchObject({ added: ['per@example.com'], removed: ['ola@example.com'], deactivated: 1 });
    expect(store.isMember(t.db, ADMIN_EMAIL)).toBe(true);
    expect(store.getUserByEmail(t.db, 'ola@example.com')!.active).toBe(0);
    expect(store.getUserByEmail(t.db, 'kari@example.com')!.active).toBe(1);
  });
});

describe('users', () => {
  it('renames, deactivates, reactivates and logs out a user', async () => {
    const t = setup();
    const ola = await t.login('ola@example.com', 'Ola');
    const admin = await t.login(ADMIN_EMAIL, 'Sjefen');
    const id = t.userId('ola@example.com');

    await t.post(`/admin/users/${id}/rename`, { cookie: admin, form: { name: 'Ola N' } });
    expect(store.getUserById(t.db, id)!.display_name).toBe('Ola N');

    await t.post(`/admin/users/${id}/active`, { cookie: admin, form: { active: '0' } });
    expect(store.getUserById(t.db, id)!.active).toBe(0);
    expect((await t.logCan(ola)).status).toBe(401);

    await t.post(`/admin/users/${id}/active`, { cookie: admin, form: { active: '1' } });
    expect(store.getUserById(t.db, id)!.active).toBe(1);

    const again = await t.login('ola@example.com');
    await t.post(`/admin/users/${id}/logout`, { cookie: admin });
    expect((await t.get('/me', { cookie: again })).status).toBe(302);
    expect(logActions(t)).toEqual(expect.arrayContaining(['user.rename', 'user.deactivate', 'user.activate', 'user.logout']));
  });
});

describe('entries', () => {
  it('adds a can for a user, flagged as created by admin', async () => {
    const t = setup();
    await t.login('ola@example.com', 'Ola');
    const admin = await t.login(ADMIN_EMAIL, 'Sjefen');
    const id = t.userId('ola@example.com');
    const res = await t.post('/admin/cans/add', { cookie: admin, form: { user_id: String(id), count: '2', date: '' } });
    expect(res.status).toBe(303);
    const rows = t.db.prepare('SELECT * FROM cans WHERE user_id = ?').all(id);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.created_by_admin === 1 && r.price_ore === 1000 && r.month === '2026-10')).toBe(true);
    expect(logActions(t)).toContain('can.add');
  });

  it('adds a forgotten can on an earlier date', async () => {
    const t = setup();
    await t.login('ola@example.com', 'Ola');
    const admin = await t.login(ADMIN_EMAIL, 'Sjefen');
    const id = t.userId('ola@example.com');
    await t.post('/admin/cans/add', { cookie: admin, form: { user_id: String(id), count: '1', date: '2026-09-30' } });
    expect(t.db.prepare('SELECT month FROM cans WHERE user_id = ?').get(id)!.month).toBe('2026-09');
  });

  it('soft-deletes and restores a can', async () => {
    const t = setup();
    const ola = await t.login('ola@example.com', 'Ola');
    const admin = await t.login(ADMIN_EMAIL, 'Sjefen');
    const { id } = await json(await t.logCan(ola));
    await t.post(`/admin/cans/${id}/delete`, { cookie: admin });
    expect(t.db.prepare('SELECT deleted_by FROM cans WHERE id = ?').get(id)!.deleted_by).toBe(t.userId(ADMIN_EMAIL));
    await t.post(`/admin/cans/${id}/restore`, { cookie: admin });
    expect(t.db.prepare('SELECT deleted_at FROM cans WHERE id = ?').get(id)!.deleted_at).toBe(null);
    expect(logActions(t)).toEqual(expect.arrayContaining(['can.delete', 'can.restore']));
  });

  it('filters the entry list by user', async () => {
    const t = setup();
    const ola = await t.login('ola@example.com', 'Ola');
    const kari = await t.login('kari@example.com', 'Kari');
    const admin = await t.login(ADMIN_EMAIL, 'Sjefen');
    await t.logCan(ola);
    await t.logCan(kari);
    const page = await (await t.get(`/admin/entries?user=${t.userId('kari@example.com')}`, { cookie: admin })).text();
    expect(page).toContain('Kari');
    expect(page).not.toContain('ola@example.com');
  });
});

describe('monthly overview', () => {
  it('exports each person’s count and amount as CSV', async () => {
    const t = setup();
    const ola = await t.login('ola@example.com', 'Ola');
    const admin = await t.login(ADMIN_EMAIL, 'Sjefen');
    await t.logCan(ola);
    t.advance(2 * MINUTE);
    await t.logCan(ola);
    const res = await t.get('/admin/month.csv?m=2026-10', { cookie: admin });
    expect(res.headers.get('content-type')).toMatch(/text\/csv/);
    expect(res.headers.get('content-disposition')).toContain('redbull-2026-10.csv');
    const csv = await res.text();
    expect(csv).toContain('Navn;E-post;Bokser;Beløp (kr)');
    expect(csv).toContain('Ola;ola@example.com;2;20,00');
    expect(logActions(t)).toContain('month.export');
  });

  it('shows email usage against the Resend limits', async () => {
    const t = setup();
    const admin = await t.login(ADMIN_EMAIL, 'Sjefen');
    const page = await (await t.get('/admin', { cookie: admin })).text();
    expect(page).toContain('/ 100');
    expect(page).toContain('/ 3000');
    expect(page).toContain('/ 80');
  });
});
