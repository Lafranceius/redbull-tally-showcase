import { describe, expect, it } from 'vitest';
import * as store from '../src/store';
import { ADMIN_EMAIL, HOUR, MINUTE, sessionCookie, setup } from './helpers';

const GENERIC = 'Hvis du står på lista, har du fått en kode på mail.';
const SEND_FAILED = 'Klarte ikke sende kode akkurat nå, prøv igjen senere.';

/** Strips the parts of a page that legitimately differ between two requests. */
const comparable = (html: string, email: string) =>
  html.replaceAll(email, 'EMAIL').replace(/nonce="[^"]+"/g, 'nonce=""');

describe('requesting a code', () => {
  it('emails a 6-digit code to a member and stores only its hash', async () => {
    const t = setup();
    t.addMember('ola@example.com');
    const res = await t.requestCode('  Ola@Example.COM ');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain(GENERIC);
    expect(t.mailer.sent).toHaveLength(1);
    const { to, code } = t.mailer.sent[0]!;
    expect(to).toBe('ola@example.com');
    expect(code).toMatch(/^\d{6}$/);
    const row = t.db.prepare('SELECT * FROM login_codes').get() as Record<string, unknown>;
    expect(row.email).toBe('ola@example.com');
    expect(String(row.code_hash)).not.toContain(code);
    expect(Number(row.expires_at) - Number(row.created_at)).toBe(10 * MINUTE);
  });

  it('gives a non-member the identical response and sends nothing', async () => {
    const t = setup();
    t.addMember('ola@example.com');
    const member = await t.requestCode('ola@example.com');
    const stranger = await t.requestCode('kari@example.com');
    expect(stranger.status).toBe(member.status);
    expect(comparable(await stranger.text(), 'kari@example.com')).toBe(
      comparable(await member.text(), 'ola@example.com'),
    );
    expect(t.mailer.calls).toBe(1);
    expect(t.mailer.sent.map((s) => s.to)).toEqual(['ola@example.com']);
  });

  it('sends at most 5 codes per email per hour', async () => {
    const t = setup();
    t.addMember('ola@example.com');
    for (let i = 0; i < 6; i++) {
      const res = await t.requestCode('ola@example.com');
      expect(await res.text()).toContain(GENERIC);
    }
    expect(t.mailer.calls).toBe(5);
    t.advance(HOUR + 1);
    await t.requestCode('ola@example.com');
    expect(t.mailer.calls).toBe(6);
  });

  it('accepts at most 10 code requests per IP per hour', async () => {
    const t = setup();
    t.addMember('ola@example.com');
    const ip = '192.0.2.50';
    for (let i = 0; i < 10; i++) await t.requestCode(`stranger${i}@example.com`, { ip });
    const blocked = await t.requestCode('ola@example.com', { ip });
    expect(blocked.status).toBe(429);
    expect(t.mailer.calls).toBe(0);
    await t.requestCode('ola@example.com', { ip: '192.0.2.51' });
    expect(t.mailer.calls).toBe(1);
    t.advance(HOUR + 1);
    await t.requestCode('ola@example.com', { ip });
    expect(t.mailer.calls).toBe(2);
  });

  it('caps sending at 80 emails in any 24 hours', async () => {
    const t = setup();
    const members = Array.from({ length: 30 }, (_, i) => `m${i}@example.com`);
    t.addMember(...members);
    for (let i = 0; i < 80; i++) await t.requestCode(members[i % 27]!);
    expect(t.mailer.calls).toBe(80);

    const over = await t.requestCode(members[29]!);
    expect(await over.text()).toContain(SEND_FAILED);
    expect(t.mailer.calls).toBe(80);
    // Same answer for a non-member, so the cap doesn't reveal who is on the list.
    expect(await (await t.requestCode('nobody@example.com')).text()).toContain(SEND_FAILED);

    t.advance(24 * HOUR + 1);
    await t.requestCode(members[29]!);
    expect(t.mailer.calls).toBe(81);
  });

  it('reports a refused send once, without retrying', async () => {
    const t = setup();
    t.addMember('ola@example.com');
    t.mailer.failWith = '429 daily_quota_exceeded';
    const res = await t.requestCode('ola@example.com');
    expect(await res.text()).toContain(SEND_FAILED);
    expect(t.mailer.calls).toBe(1);
  });

  it('never sends to a deactivated user', async () => {
    const t = setup();
    await t.login('ola@example.com', 'Ola');
    store.setUserActive(t.db, t.userId('ola@example.com'), false);
    const calls = t.mailer.calls;
    await t.requestCode('ola@example.com');
    expect(t.mailer.calls).toBe(calls);
  });
});

describe('verifying a code', () => {
  it('sets a 400-day HttpOnly session cookie and stores only the token hash', async () => {
    const t = setup();
    t.addMember('ola@example.com');
    await t.requestCode('ola@example.com');
    const res = await t.verify('ola@example.com', t.mailer.lastCodeFor('ola@example.com'));
    expect(res.status).toBe(303);
    const raw = res.headers.getSetCookie().find((c) => c.startsWith('rb_session='))!;
    expect(raw).toMatch(/HttpOnly/);
    expect(raw).toMatch(/Secure/);
    expect(raw).toMatch(/SameSite=Lax/);
    expect(raw).toMatch(/Path=\//);
    expect(raw).toMatch(/Max-Age=34560000/);
    const token = sessionCookie(res).split('=')[1]!;
    const hashes = t.db.prepare('SELECT token_hash FROM sessions').all().map((r) => r.token_hash);
    expect(hashes).toHaveLength(1);
    expect(hashes[0]).not.toBe(token);
  });

  it('rejects a code older than 10 minutes', async () => {
    const t = setup();
    t.addMember('ola@example.com');
    await t.requestCode('ola@example.com');
    t.advance(10 * MINUTE + 1);
    const res = await t.verify('ola@example.com', t.mailer.lastCodeFor('ola@example.com'));
    expect(res.status).toBe(400);
    expect(res.headers.getSetCookie().some((c) => c.startsWith('rb_session=') && !c.startsWith('rb_session=;'))).toBe(false);
  });

  it('accepts a code only once', async () => {
    const t = setup();
    t.addMember('ola@example.com');
    await t.requestCode('ola@example.com');
    const code = t.mailer.lastCodeFor('ola@example.com');
    expect((await t.verify('ola@example.com', code)).status).toBe(303);
    expect((await t.verify('ola@example.com', code)).status).toBe(400);
  });

  it('invalidates the code after 5 wrong attempts', async () => {
    const t = setup();
    t.addMember('ola@example.com');
    await t.requestCode('ola@example.com');
    const code = t.mailer.lastCodeFor('ola@example.com');
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) expect((await t.verify('ola@example.com', wrong)).status).toBe(400);
    expect((await t.verify('ola@example.com', code)).status).toBe(400);
  });

  it('asks a first-time user for a display name, then continues to next', async () => {
    const t = setup();
    t.addMember('ola@example.com');
    await t.requestCode('ola@example.com');
    const res = await t.verify('ola@example.com', t.mailer.lastCodeFor('ola@example.com'), '/scan');
    expect(res.headers.get('location')).toBe('/login/name?next=%2Fscan');
    const cookie = sessionCookie(res);

    const scan = await t.get('/scan', { cookie });
    expect(scan.status).toBe(302);
    expect(scan.headers.get('location')).toMatch(/^\/login\/name/);

    const named = await t.post('/login/name', { cookie, form: { name: '  Ola  ', next: '/scan' } });
    expect(named.status).toBe(303);
    expect(named.headers.get('location')).toBe('/scan');
    expect(store.getUserByEmail(t.db, 'ola@example.com')!.display_name).toBe('Ola');
  });

  it('requires a unique display name, ignoring case', async () => {
    const t = setup();
    await t.login('ola@example.com', 'Ola');
    t.addMember('kari@example.com');
    await t.requestCode('kari@example.com');
    const cookie = sessionCookie(await t.verify('kari@example.com', t.mailer.lastCodeFor('kari@example.com')));
    const taken = await t.post('/login/name', { cookie, form: { name: 'OLA', next: '/me' } });
    expect(taken.status).toBe(400);
    expect(await taken.text()).toContain('Navnet er tatt');
  });

  it('requires a display name of 2 to 20 characters', async () => {
    const t = setup();
    t.addMember('ola@example.com');
    await t.requestCode('ola@example.com');
    const cookie = sessionCookie(await t.verify('ola@example.com', t.mailer.lastCodeFor('ola@example.com')));
    for (const name of ['O', 'x'.repeat(21)]) {
      expect((await t.post('/login/name', { cookie, form: { name, next: '/me' } })).status).toBe(400);
    }
    expect((await t.post('/login/name', { cookie, form: { name: 'Øy', next: '/me' } })).status).toBe(303);
  });

  it('logs a returning email (new phone) into the same account', async () => {
    const t = setup();
    const phone1 = await t.login('ola@example.com', 'Ola');
    await t.requestCode('ola@example.com');
    const res = await t.verify('ola@example.com', t.mailer.lastCodeFor('ola@example.com'));
    expect(res.headers.get('location')).toBe('/me');
    const phone2 = sessionCookie(res);
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM users').get()!.n).toBe(1);
    expect((await t.get('/me', { cookie: phone1 })).status).toBe(200);
    expect((await t.get('/me', { cookie: phone2 })).status).toBe(200);
  });

  it('only redirects to local paths', async () => {
    const t = setup();
    t.addMember('ola@example.com');
    await t.login('ola@example.com', 'Ola');
    await t.requestCode('ola@example.com');
    const res = await t.verify('ola@example.com', t.mailer.lastCodeFor('ola@example.com'), '//evil.example/x');
    expect(res.headers.get('location')).toBe('/me');
  });

  it('lets the admin log in the same way', async () => {
    const t = setup();
    const cookie = await t.login(ADMIN_EMAIL, 'Sjefen');
    expect((await t.get('/admin', { cookie })).status).toBe(200);
  });
});

describe('sessions', () => {
  it('renews the cookie on every use', async () => {
    const t = setup();
    const cookie = await t.login('ola@example.com', 'Ola');
    t.advance(300 * 24 * HOUR);
    const res = await t.get('/me', { cookie });
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie().some((c) => c.startsWith('rb_session=') && /Max-Age=34560000/.test(c))).toBe(true);
  });

  it('logs out by deleting the session', async () => {
    const t = setup();
    const cookie = await t.login('ola@example.com', 'Ola');
    const res = await t.post('/logout', { cookie });
    expect(res.status).toBe(303);
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM sessions').get()!.n).toBe(0);
    expect((await t.get('/me', { cookie })).status).toBe(302);
  });
});

describe('refused sends and the per-email limit', () => {
  it('does not count a send Resend refused towards the 3-per-hour limit', async () => {
    const t = setup();
    t.addMember('ola@example.com');
    t.mailer.failWith = '403 domain not verified';
    for (let i = 0; i < 3; i++) await t.requestCode('ola@example.com');
    t.mailer.failWith = null;
    const res = await t.requestCode('ola@example.com');
    expect(await res.text()).toContain(GENERIC);
    expect(t.mailer.sent).toHaveLength(1);
  });

  it('still counts refused sends towards the global cap', async () => {
    const t = setup();
    const members = Array.from({ length: 30 }, (_, i) => `m${i}@example.com`);
    t.addMember(...members);
    t.mailer.failWith = 'quota';
    for (let i = 0; i < 80; i++) await t.requestCode(members[i % 30]!);
    t.mailer.failWith = null;
    const calls = t.mailer.calls;
    expect(await (await t.requestCode(members[0]!)).text()).toContain(SEND_FAILED);
    expect(t.mailer.calls).toBe(calls);
  });

  it('tells everyone what to do when no code arrives', async () => {
    const t = setup();
    t.addMember('ola@example.com');
    for (const email of ['ola@example.com', 'kari@example.com']) {
      const page = await (await t.requestCode(email)).text();
      expect(page).toContain('Ingen kode?');
      expect(page).toContain('maks 5 koder i timen');
    }
  });

  it('says a used code is used, not just expired', async () => {
    const t = setup();
    t.addMember('ola@example.com');
    await t.requestCode('ola@example.com');
    const code = t.mailer.lastCodeFor('ola@example.com');
    await t.verify('ola@example.com', code);
    const again = await t.verify('ola@example.com', code);
    expect(await again.text()).toContain('allerede brukt');
  });
});
