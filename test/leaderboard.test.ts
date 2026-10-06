import { describe, expect, it } from 'vitest';
import * as store from '../src/store';
import { MINUTE, setup } from './helpers';

async function seeded() {
  const t = setup();
  const ola = await t.login('ola@example.com', 'Ola');
  const kari = await t.login('kari@example.com', 'Kari');
  const per = await t.login('per@example.com', 'Per');
  for (let i = 0; i < 3; i++) {
    await t.logCan(kari, { confirm: true });
    t.advance(MINUTE);
  }
  await t.logCan(ola);
  await t.logCan(per);
  return { t, ola, kari, per };
}

describe('leaderboard', () => {
  it('is public, ranks by cans, and never shows money', async () => {
    const { t } = await seeded();
    const res = await t.get('/leaderboard');
    expect(res.status).toBe(200);
    const page = await res.text();
    expect(page).toMatch(/Kari[\s\S]*Ola/);
    expect(page).not.toMatch(/\bkr\b/i);
    expect(page).not.toContain('øre');
    expect(page).toContain('http-equiv="refresh" content="60"');
  });

  it('shows the office total for the month', async () => {
    const { t } = await seeded();
    const page = await (await t.get('/leaderboard')).text();
    expect(page).toMatch(/>5<\/span>\s*bokser/);
  });

  it('has an all-time tab', async () => {
    const { t, ola } = await seeded();
    t.advance(30 * 24 * 60 * MINUTE);
    await t.logCan(ola);
    const month = await (await t.get('/leaderboard')).text();
    const total = await (await t.get('/leaderboard?tab=total')).text();
    expect(month).not.toContain('Kari');
    expect(total).toContain('Kari');
  });

  it('is marked noindex, and robots.txt disallows everything', async () => {
    const { t } = await seeded();
    expect((await t.get('/leaderboard')).headers.get('x-robots-tag')).toContain('noindex');
    const robots = await (await t.get('/robots.txt')).text();
    expect(robots).toMatch(/User-agent: \*\s+Disallow: \//);
  });

  it('hides deactivated users', async () => {
    const { t } = await seeded();
    store.setUserActive(t.db, t.userId('kari@example.com'), false);
    const page = await (await t.get('/leaderboard')).text();
    expect(page).not.toContain('Kari');
    expect(page).toContain('Ola');
  });

  it('serves the cached page for about 30 seconds', async () => {
    const { t, per } = await seeded();
    const before = await (await t.get('/leaderboard')).text();
    t.advance(5_000);
    await t.logCan(per, { confirm: true });
    expect(await (await t.get('/leaderboard')).text()).toBe(before);
    t.advance(26_000);
    expect(await (await t.get('/leaderboard')).text()).not.toBe(before);
  });
});
