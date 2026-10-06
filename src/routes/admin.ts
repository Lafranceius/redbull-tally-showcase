import { Hono } from 'hono';
import { cleanDisplayName } from '../auth';
import { isEmail, LIMITS, normalizeEmail } from '../config';
import { formOf, type AppEnv, type C, type Ctx } from '../http';
import * as store from '../store';
import { isDay, isMonth, osloDay, osloMonth, parseKr } from '../time';
import { entriesPage, logPage, membersPage, monthPage, overviewPage, paymentsPage, usersPage } from '../views/admin';
import { notFoundPage } from '../views/layout';

const DAY = 24 * 60 * 60_000;
const ENTRIES_PER_PAGE = 40;

function flash(c: C): string | undefined {
  const q = (k: string) => c.req.query(k);
  const n = Number(q('n') ?? 0);
  const bad = Number(q('bad') ?? 0);
  switch (q('ok')) {
    case 'price': return 'Prisen er lagret. Den gjelder nye bokser.';
    case 'badprice': return 'Ugyldig pris. Skriv for eksempel 10 eller 12,50.';
    case 'added': return `La til ${n} ny${n === 1 ? '' : 'e'} e-post${n === 1 ? '' : 'er'}.${bad ? ` ${bad} var ikke gyldige e-postadresser.` : ''}`;
    case 'removed': return 'E-posten er fjernet. Brukeren er deaktivert og logget ut.';
    case 'keepadmin': return 'Admin-e-posten kan ikke fjernes eller deaktiveres.';
    case 'renamed': return 'Navnet er endret.';
    case 'taken': return 'Navnet er tatt av en annen bruker.';
    case 'badname': return 'Navnet må være 2–20 tegn.';
    case 'activated': return 'Brukeren er aktivert igjen.';
    case 'deactivated': return 'Brukeren er deaktivert og logget ut.';
    case 'loggedout': return `Logget ut ${n} økt${n === 1 ? '' : 'er'}.`;
    case 'cans': return `La til ${n} boks${n === 1 ? '' : 'er'}.`;
    case 'badcan': return 'Velg en bruker, et antall fra 1 til 20 og eventuelt en gyldig dato.';
    case 'deleted': return `Slettet ${n} boks${n === 1 ? '' : 'er'}.`;
    case 'reversed': return 'Nullstillingen er angret. Beløpet er utestående igjen.';
    case 'avatar': return 'Profilbildet er fjernet.';
    default: return undefined;
  }
}

function csvCell(v: string): string {
  // Leading = + - @ would run as a formula in Excel; display names are user input.
  const safe = /^[=+\-@]/.test(v) ? `'${v}` : v;
  return /[";\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function adminRoutes(ctx: Ctx): Hono<AppEnv> {
  const { db, config } = ctx;
  const admin = new Hono<AppEnv>();
  const me = (c: C) => c.get('user')!;
  const log = (c: C, action: string, details: Record<string, unknown>) =>
    store.logAdmin(db, ctx.now(), action, { by: me(c).email, ...details });
  const idParam = (c: C) => {
    const id = Number(c.req.param('id'));
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  };
  const back = (c: C, fallback: string) => {
    const ref = c.req.header('referer');
    const path = ref?.startsWith(`${config.publicUrl}/admin`) ? ref.slice(config.publicUrl.length) : null;
    return c.redirect(path ?? fallback, 303);
  };
  const monthChoices = (current: string) => [...new Set([current, ...store.monthsWithCans(db)])].sort().reverse();

  // Same 404 as any unknown page, so /admin doesn't reveal that it exists.
  admin.use('*', async (c, next) => {
    const user = c.get('user');
    if (!user || !user.active || user.email !== config.adminEmail) return c.html(notFoundPage(c.get('nonce')), 404);
    await next();
  });

  admin.get('/', (c) => {
    const now = ctx.now();
    const month = osloMonth(now);
    const rows = store.monthOverview(db, month);
    const sends = store.codeTimesSince(db, now - 32 * DAY);
    const today = osloDay(now);
    return c.html(
      overviewPage({
        nonce: c.get('nonce'),
        flash: flash(c),
        priceOre: store.getPriceOre(db),
        month,
        officeCount: rows.reduce((s, r) => s + r.count, 0),
        officeOre: rows.reduce((s, r) => s + r.ore, 0),
        drinkers: rows.length,
        email: {
          today: sends.filter((t) => osloDay(t) === today).length,
          month: sends.filter((t) => osloMonth(t) === month).length,
          last24h: sends.filter((t) => t > now - DAY).length,
          perDay: LIMITS.resendFree.perDay,
          perMonth: LIMITS.resendFree.perMonth,
          cap: LIMITS.emailsGlobal.max,
        },
      }),
    );
  });

  admin.post('/price', async (c) => {
    const ore = parseKr((await formOf(c)).kr ?? '');
    if (ore === null || ore < 1 || ore > 100_000) return c.redirect('/admin?ok=badprice', 303);
    const from = store.getPriceOre(db);
    store.setPriceOre(db, ore);
    log(c, 'price.set', { from, to: ore });
    return c.redirect('/admin?ok=price', 303);
  });

  // ── month ────────────────────────────────────────────────────────────────

  const selectedMonth = (c: C) => {
    const m = c.req.query('m');
    return isMonth(m) ? m : osloMonth(ctx.now());
  };

  admin.get('/month', (c) => {
    const month = selectedMonth(c);
    return c.html(
      monthPage({ nonce: c.get('nonce'), month, months: monthChoices(month), rows: store.monthOverview(db, month) }),
    );
  });

  admin.get('/month.csv', (c) => {
    const month = selectedMonth(c);
    const rows = store.monthOverview(db, month);
    const kr = (ore: number) => (ore / 100).toFixed(2).replace('.', ',');
    const lines = [
      'Navn;E-post;Bokser;Beløp (kr)',
      ...rows.map((r) => [r.name ?? '', r.email, String(r.count), kr(r.ore)].map(csvCell).join(';')),
    ];
    log(c, 'month.export', { month, rows: rows.length });
    return c.body(`﻿${lines.join('\r\n')}\r\n`, 200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="redbull-${month}.csv"`,
    });
  });

  // ── members ──────────────────────────────────────────────────────────────

  admin.get('/members', (c) =>
    c.html(
      membersPage({ nonce: c.get('nonce'), flash: flash(c), adminEmail: config.adminEmail, members: store.listMembers(db) }),
    ),
  );

  admin.post('/members/add', async (c) => {
    const tokens = ((await formOf(c)).emails ?? '').split(/[\s,;]+/).map(normalizeEmail).filter(Boolean);
    const valid = tokens.filter(isEmail);
    const added = store.addMembers(db, valid, ctx.now());
    log(c, 'members.add', { added, invalid: tokens.length - valid.length });
    return c.redirect(`/admin/members?ok=added&n=${added.length}&bad=${tokens.length - valid.length}`, 303);
  });

  admin.post('/members/remove', async (c) => {
    const email = normalizeEmail((await formOf(c)).email ?? '');
    if (email === config.adminEmail) return c.redirect('/admin/members?ok=keepadmin', 303);
    const result = store.removeMember(db, email);
    log(c, 'members.remove', { email, ...result });
    return c.redirect('/admin/members?ok=removed', 303);
  });

  // ── users ────────────────────────────────────────────────────────────────

  admin.get('/users', (c) =>
    c.html(usersPage({ nonce: c.get('nonce'), flash: flash(c), adminEmail: config.adminEmail, users: store.listUsers(db) })),
  );

  admin.post('/users/:id/rename', async (c) => {
    const user = store.getUserById(db, idParam(c) ?? 0);
    if (!user) return c.html(notFoundPage(c.get('nonce')), 404);
    const name = cleanDisplayName((await formOf(c)).name ?? '');
    if (!name) return c.redirect('/admin/users?ok=badname', 303);
    if (!store.setDisplayName(db, user.id, name)) return c.redirect('/admin/users?ok=taken', 303);
    log(c, 'user.rename', { userId: user.id, from: user.display_name, to: name });
    return c.redirect('/admin/users?ok=renamed', 303);
  });

  admin.post('/users/:id/active', async (c) => {
    const user = store.getUserById(db, idParam(c) ?? 0);
    if (!user) return c.html(notFoundPage(c.get('nonce')), 404);
    if (user.email === config.adminEmail) return c.redirect('/admin/users?ok=keepadmin', 303);
    const active = (await formOf(c)).active === '1';
    store.setUserActive(db, user.id, active);
    log(c, active ? 'user.activate' : 'user.deactivate', { userId: user.id, email: user.email });
    return c.redirect(`/admin/users?ok=${active ? 'activated' : 'deactivated'}`, 303);
  });

  admin.post('/users/:id/logout', (c) => {
    const user = store.getUserById(db, idParam(c) ?? 0);
    if (!user) return c.html(notFoundPage(c.get('nonce')), 404);
    const n = store.deleteUserSessions(db, user.id);
    log(c, 'user.logout', { userId: user.id, email: user.email, sessions: n });
    return c.redirect(`/admin/users?ok=loggedout&n=${n}`, 303);
  });

  // ── entries ──────────────────────────────────────────────────────────────

  admin.get('/entries', (c) => {
    const q = (k: string) => c.req.query(k);
    const month = isMonth(q('month')) ? q('month') : undefined;
    const userId = Number(q('user')) || undefined;
    const status = q('status') === 'deleted' || q('status') === 'all' ? (q('status') as 'deleted' | 'all') : 'active';
    const page = Math.max(0, Math.floor(Number(q('page')) || 0));
    const rows = store.listCans(db, { month, userId, status, limit: ENTRIES_PER_PAGE + 1, offset: page * ENTRIES_PER_PAGE });
    const query = (p: number) => {
      const params = new URLSearchParams({ status, page: String(p) });
      if (month) params.set('month', month);
      if (userId) params.set('user', String(userId));
      return `/admin/entries?${params}`;
    };
    return c.html(
      entriesPage({
        nonce: c.get('nonce'),
        flash: flash(c),
        months: monthChoices(osloMonth(ctx.now())),
        users: store.listUsers(db),
        filter: { month, userId, status, page },
        rows: rows.slice(0, ENTRIES_PER_PAGE),
        hasMore: rows.length > ENTRIES_PER_PAGE,
        query,
      }),
    );
  });

  admin.post('/cans/add', async (c) => {
    const form = await formOf(c);
    const user = store.getUserById(db, Number(form.user_id) || 0);
    const count = Number(form.count || '1');
    const date = form.date?.trim() || undefined;
    if (!user || !Number.isInteger(count) || count < 1 || count > 20 || (date !== undefined && !isDay(date))) {
      return c.redirect('/admin/entries?ok=badcan', 303);
    }
    // A forgotten can on a given day is placed at midday, which is that same day in Oslo.
    const createdAt = date ? Date.parse(`${date}T11:00:00Z`) : ctx.now();
    const priceOre = store.getPriceOre(db);
    for (let i = 0; i < count; i++) {
      store.insertCan(db, { userId: user.id, createdAt, month: osloMonth(createdAt), priceOre, byAdmin: true });
    }
    log(c, 'can.add', { userId: user.id, email: user.email, count, date: date ?? osloDay(createdAt), priceOre });
    return c.redirect(`/admin/entries?ok=cans&n=${count}&user=${user.id}`, 303);
  });

  admin.post('/cans/delete', async (c) => {
    const body = await c.req.parseBody({ all: true });
    const raw = Array.isArray(body.ids) ? body.ids : [body.ids];
    const ids = [...new Set(raw.filter((v): v is string => typeof v === 'string').map(Number))]
      .filter((id) => Number.isSafeInteger(id) && id > 0)
      .slice(0, 500);
    const by = me(c).id;
    const now = ctx.now();
    const deleted = ids.filter((id) => store.softDeleteCan(db, id, by, now));
    if (deleted.length) log(c, 'can.delete', { canIds: deleted });
    return c.redirect(`/admin/entries?ok=deleted&n=${deleted.length}`, 303);
  });

  admin.post('/cans/:id/delete', (c) => {
    const can = store.getCan(db, idParam(c) ?? 0);
    if (!can) return c.html(notFoundPage(c.get('nonce')), 404);
    if (store.softDeleteCan(db, can.id, me(c).id, ctx.now())) log(c, 'can.delete', { canId: can.id, userId: can.user_id });
    return back(c, '/admin/entries');
  });

  admin.post('/cans/:id/restore', (c) => {
    const can = store.getCan(db, idParam(c) ?? 0);
    if (!can) return c.html(notFoundPage(c.get('nonce')), 404);
    if (store.restoreCan(db, can.id)) log(c, 'can.restore', { canId: can.id, userId: can.user_id });
    return back(c, '/admin/entries?status=deleted');
  });

  // ── payments ─────────────────────────────────────────────────────────────

  admin.get('/payments', (c) =>
    c.html(
      paymentsPage({
        nonce: c.get('nonce'),
        flash: flash(c),
        summary: store.debtSummary(db),
        settlements: store.listSettlements(db, 200),
      }),
    ),
  );

  admin.post('/settlements/:id/reverse', (c) => {
    const settlement = store.getSettlement(db, idParam(c) ?? 0);
    if (!settlement) return c.html(notFoundPage(c.get('nonce')), 404);
    if (store.reverseSettlement(db, settlement.id, me(c).id, ctx.now())) {
      log(c, 'settlement.reverse', { settlementId: settlement.id, userId: settlement.user_id, amountOre: settlement.amount_ore });
    }
    return c.redirect('/admin/payments?ok=reversed', 303);
  });

  admin.post('/users/:id/avatar/delete', (c) => {
    const user = store.getUserById(db, idParam(c) ?? 0);
    if (!user) return c.html(notFoundPage(c.get('nonce')), 404);
    if (store.deleteAvatar(db, user.id)) log(c, 'user.avatar.remove', { userId: user.id, email: user.email });
    return c.redirect('/admin/users?ok=avatar', 303);
  });

  admin.get('/log', (c) => c.html(logPage({ nonce: c.get('nonce'), rows: store.adminLog(db, 100) })));

  return admin;
}
