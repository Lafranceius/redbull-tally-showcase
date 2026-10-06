import { describe, expect, it } from 'vitest';
import * as store from '../src/store';
import { ADMIN_EMAIL, MINUTE, json, setup, type T } from './helpers';

const DAY = 24 * 60 * MINUTE;

/** Hidden fields of the confirm page, as the browser would submit them. */
async function confirmForm(t: T, cookie: string) {
  const page = await (await t.get('/me/betal', { cookie })).text();
  const field = (name: string) => page.match(new RegExp(`name="${name}" value="([^"]*)"`))?.[1];
  return { page, through: field('through'), amount: field('amount') };
}

async function payAll(t: T, cookie: string) {
  const { through, amount } = await confirmForm(t, cookie);
  return t.post('/me/betal', { cookie, form: { through: through!, amount: amount!, confirm: 'ja' } });
}

/** Ola logs one can in September and two in October (start: 2026-09-20). */
async function olaWithCans() {
  const t = setup(Date.parse('2026-09-20T10:00:00Z'));
  const ola = await t.login('ola@example.com', 'Ola');
  await t.logCan(ola);
  t.advance(30 * DAY); // 2026-10-20
  await t.logCan(ola);
  t.advance(2 * MINUTE);
  await t.logCan(ola);
  return { t, ola, id: t.userId('ola@example.com') };
}

describe('running debt on /me', () => {
  it('shows what you owe in total and per month since you last paid', async () => {
    const { t, ola } = await olaWithCans();
    const page = await (await t.get('/me', { cookie: ola })).text();
    expect(page).toContain('Utestående');
    expect(page).toContain('30 kr');
    expect(page).toMatch(/2026-10[\s\S]*2026-09/);
  });

  it('includes what you owe in the scan result', async () => {
    const { t, ola } = await olaWithCans();
    t.advance(2 * MINUTE);
    expect(await json(await t.logCan(ola))).toMatchObject({ count: 3, oweOre: 4000, owe: '40 kr' });
  });
});

describe('clearing debt ("Jeg har betalt")', () => {
  it('asks for confirmation with the amount before clearing', async () => {
    const { t, ola } = await olaWithCans();
    const { page, through, amount } = await confirmForm(t, ola);
    expect(page).toContain('Har du betalt?');
    expect(page).toContain('30 kr');
    expect(amount).toBe('3000');
    expect(through).toMatch(/^\d+$/);
  });

  it('refuses to clear without the confirmation tick', async () => {
    const { t, ola, id } = await olaWithCans();
    const { through, amount } = await confirmForm(t, ola);
    const res = await t.post('/me/betal', { cookie: ola, form: { through: through!, amount: amount! } });
    expect(res.status).toBe(400);
    expect(store.outstanding(t.db, id)).toEqual({ count: 3, ore: 3000 });
  });

  it('clears everything owed, shows a receipt, and hides the paid months', async () => {
    const { t, ola, id } = await olaWithCans();
    const res = await payAll(t, ola);
    expect(res.status).toBe(303);
    const receipt = await t.get(res.headers.get('location')!, { cookie: ola });
    expect(receipt.status).toBe(200);
    const text = await receipt.text();
    expect(text).toContain('Takk');
    expect(text).toContain('30 kr');

    expect(store.outstanding(t.db, id)).toEqual({ count: 0, ore: 0 });
    const me = await (await t.get('/me', { cookie: ola })).text();
    expect(me).not.toContain('2026-09');
    expect(me).toContain('Sist betalt');
  });

  it('starts a new running total after clearing', async () => {
    const { t, ola } = await olaWithCans();
    await payAll(t, ola);
    t.advance(2 * MINUTE);
    expect(await json(await t.logCan(ola))).toMatchObject({ oweOre: 1000, owe: '10 kr' });
  });

  it('does not clear a can logged after the confirm page was opened', async () => {
    const { t, ola, id } = await olaWithCans();
    const { through, amount } = await confirmForm(t, ola);
    t.advance(2 * MINUTE);
    await t.logCan(ola);
    const res = await t.post('/me/betal', { cookie: ola, form: { through: through!, amount: amount!, confirm: 'ja' } });
    expect(res.status).toBe(303);
    expect(store.outstanding(t.db, id)).toEqual({ count: 1, ore: 1000 });
  });

  it('refuses if the amount changed since the confirm page was opened', async () => {
    const { t, ola, id } = await olaWithCans();
    const { through } = await confirmForm(t, ola);
    const res = await t.post('/me/betal', { cookie: ola, form: { through: through!, amount: '999', confirm: 'ja' } });
    expect(res.status).toBe(409);
    expect(await res.text()).toContain('Beløpet har endret seg');
    expect(store.outstanding(t.db, id).ore).toBe(3000);
  });

  it('has nothing to clear when you owe nothing', async () => {
    const t = setup();
    const ola = await t.login('ola@example.com', 'Ola');
    expect(await (await t.get('/me/betal', { cookie: ola })).text()).toContain('ingen utestående');
    const res = await t.post('/me/betal', { cookie: ola, form: { through: '0', amount: '0', confirm: 'ja' } });
    expect(res.status).toBe(409);
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM settlements').get()!.n).toBe(0);
  });

  it('does not let you undo a can that is already paid', async () => {
    const t = setup();
    const ola = await t.login('ola@example.com', 'Ola');
    const { id } = await json(await t.logCan(ola));
    await payAll(t, ola);
    expect((await t.del(`/api/cans/${id}`, { cookie: ola })).status).toBe(404);
  });

  it("does not show someone else's receipt", async () => {
    const { t, ola } = await olaWithCans();
    const location = (await payAll(t, ola)).headers.get('location')!;
    const kari = await t.login('kari@example.com', 'Kari');
    expect((await t.get(location, { cookie: kari })).status).toBe(404);
  });

  it('requires a session', async () => {
    const t = setup();
    expect((await t.get('/me/betal')).status).toBe(302);
    expect((await t.post('/me/betal', { form: { through: '1', amount: '1000', confirm: 'ja' } })).status).toBe(303);
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM settlements').get()!.n).toBe(0);
  });

  it('rejects a cross-origin clear', async () => {
    const { t, ola, id } = await olaWithCans();
    const { through, amount } = await confirmForm(t, ola);
    const res = await t.post('/me/betal', {
      cookie: ola,
      form: { through: through!, amount: amount!, confirm: 'ja' },
      origin: 'https://evil.example',
    });
    expect(res.status).toBe(403);
    expect(store.outstanding(t.db, id).ore).toBe(3000);
  });
});

describe('admin view of payments', () => {
  it('still sees every can in the month overview after a user clears', async () => {
    const { t, ola } = await olaWithCans();
    await payAll(t, ola);
    const admin = await t.login(ADMIN_EMAIL, 'Sjefen');
    const csv = await (await t.get('/admin/month.csv?m=2026-10', { cookie: admin })).text();
    expect(csv).toContain('Ola;ola@example.com;2;20,00');
  });

  it('lists clearings and what each person bought, cleared and still owes', async () => {
    const { t, ola } = await olaWithCans();
    await payAll(t, ola);
    t.advance(2 * MINUTE);
    await t.logCan(ola);
    const admin = await t.login(ADMIN_EMAIL, 'Sjefen');
    const page = await (await t.get('/admin/payments', { cookie: admin })).text();
    expect(page).toContain('Ola');
    expect(page).toMatch(/Kjøpt[\s\S]*Nullstilt[\s\S]*Utestående/);
    expect(page).toContain('40 kr'); // bought in total
    expect(page).toContain('30 kr'); // cleared
    expect(page).toContain('10 kr'); // still owed
  });

  it('can undo a clearing someone pressed by mistake', async () => {
    const { t, ola, id } = await olaWithCans();
    await payAll(t, ola);
    const settlement = t.db.prepare('SELECT id FROM settlements').get()!.id;
    const admin = await t.login(ADMIN_EMAIL, 'Sjefen');
    const res = await t.post(`/admin/settlements/${settlement}/reverse`, { cookie: admin });
    expect(res.status).toBe(303);
    expect(store.outstanding(t.db, id)).toEqual({ count: 3, ore: 3000 });
    const actions = t.db.prepare('SELECT action FROM admin_log').all().map((r) => r.action);
    expect(actions).toContain('settlement.reverse');
  });

  it('hides the payments page from non-admins', async () => {
    const { t, ola } = await olaWithCans();
    expect((await t.get('/admin/payments', { cookie: ola })).status).toBe(404);
  });
});
