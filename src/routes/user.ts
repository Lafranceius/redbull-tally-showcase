import type { Hono } from 'hono';
import { logCan, statsFor, undoCan } from '../cans';
import { LIMITS } from '../config';
import { formOf, pageUser, type AppEnv, type C, type Ctx } from '../http';
import { sniffImage } from '../security';
import * as store from '../store';
import { formatMonth, osloMonth } from '../time';
import { notFoundPage } from '../views/layout';
import { mePage, payPage, receiptPage, scanPage } from '../views/pages';

const RATE_LIMITED = 'Rolig nå! Maks 5 bokser på 10 minutter. Prøv igjen om litt.';

export function userRoutes(app: Hono<AppEnv>, ctx: Ctx): void {
  const { db } = ctx;

  // GET only renders. The page's script POSTs, so link previews and prefetchers never log a can.
  app.get('/scan', (c) => {
    const user = pageUser(c, '/scan');
    if (user instanceof Response) return user;
    return c.html(scanPage({ nonce: c.get('nonce') }));
  });

  app.get('/me', (c) => {
    const user = pageUser(c, '/me');
    if (user instanceof Response) return user;
    const now = ctx.now();
    const month = osloMonth(now);
    return c.html(
      mePage({
        nonce: c.get('nonce'),
        user,
        avatarAt: store.avatarVersion(db, user.id),
        isAdmin: user.email === ctx.config.adminEmail,
        monthLabel: formatMonth(month),
        stats: statsFor(db, user.id, now),
        cans: store.userMonthCans(db, user.id, month).slice(0, 50),
        owed: store.outstanding(db, user.id),
        owedMonths: store.outstandingByMonth(db, user.id),
        lastPaid: store.lastSettlement(db, user.id),
      }),
    );
  });

  // ── "Jeg har betalt": confirm, clear, receipt ─────────────────────────────

  const renderPay = (c: C, userId: number, error?: string) =>
    payPage({
      nonce: c.get('nonce'),
      owed: store.outstanding(db, userId),
      owedMonths: store.outstandingByMonth(db, userId),
      through: store.lastUnsettledCanId(db, userId),
      error,
    });

  app.get('/me/betal', (c) => {
    const user = pageUser(c, '/me/betal');
    if (user instanceof Response) return user;
    return c.html(renderPay(c, user.id));
  });

  app.post('/me/betal', async (c) => {
    const user = c.get('user');
    if (!user || !user.display_name) return c.redirect('/login?next=%2Fme%2Fbetal', 303);
    const form = await formOf(c);
    if (form.confirm !== 'ja') return c.html(renderPay(c, user.id, 'Kryss av for at du har betalt før du nullstiller.'), 400);
    const through = Number(form.through);
    const amount = Number(form.amount);
    const settled =
      Number.isSafeInteger(through) && Number.isSafeInteger(amount)
        ? store.settle(db, user.id, through, amount, ctx.now())
        : null;
    if (!settled) {
      const changed = store.outstanding(db, user.id).count > 0;
      return c.html(renderPay(c, user.id, changed ? 'Beløpet har endret seg. Sjekk det nye beløpet og bekreft igjen.' : undefined), 409);
    }
    return c.redirect(`/me/betal/ferdig?id=${settled.id}`, 303);
  });

  app.get('/me/betal/ferdig', (c) => {
    const user = pageUser(c, '/me');
    if (user instanceof Response) return user;
    const settlement = store.getSettlement(db, Number(c.req.query('id')) || 0);
    if (!settlement || settlement.user_id !== user.id) return c.html(notFoundPage(c.get('nonce')), 404);
    return c.html(receiptPage({ nonce: c.get('nonce'), settlement }));
  });

  // ── profile picture ──────────────────────────────────────────────────────

  // The browser crops and shrinks the photo before upload; the server only checks it's a real image.
  app.post('/api/avatar', async (c) => {
    const user = c.get('user');
    if (!user) return c.json({ error: 'login' }, 401);
    const data = new Uint8Array(await c.req.arrayBuffer());
    if (data.byteLength > LIMITS.avatarMaxBytes) {
      return c.json({ error: 'too_large', message: 'Bildet er for stort. Prøv et annet.' }, 413);
    }
    const mime = sniffImage(data);
    if (!mime) return c.json({ error: 'unsupported', message: 'Bruk et vanlig bilde (JPEG, PNG eller WebP).' }, 415);
    const now = ctx.now();
    store.setAvatar(db, user.id, mime, data, now);
    return c.json({ ok: true, url: `/avatar/${user.id}?v=${now}` });
  });

  app.delete('/api/avatar', (c) => {
    const user = c.get('user');
    if (!user) return c.json({ error: 'login' }, 401);
    store.deleteAvatar(db, user.id);
    return c.json({ ok: true });
  });

  app.post('/api/cans', async (c) => {
    const user = c.get('user');
    if (!user) return c.json({ error: 'login' }, 401);
    if (!user.display_name) return c.json({ error: 'name' }, 403);
    let body: unknown = {};
    try {
      body = await c.req.json();
    } catch {
      // An empty or non-JSON body is the same as {}.
    }
    const confirm = typeof body === 'object' && body !== null && (body as { confirm?: unknown }).confirm === true;
    const key = c.req.header('idempotency-key');
    const idemKey = key && /^[\w-]{8,100}$/.test(key) ? key : null;

    const result = logCan(db, user.id, { confirm, idemKey }, ctx.now());
    switch (result.kind) {
      case 'created':
        return c.json({ id: result.id, ...result.stats }, 201);
      case 'replayed':
        return c.json({ id: result.id, ...result.stats }, 200);
      case 'recent':
        return c.json({ recent: true, secondsAgo: result.secondsAgo }, 409);
      case 'limited':
        c.header('Retry-After', String(result.retryAfter));
        return c.json({ error: 'rate_limited', message: RATE_LIMITED, retryAfter: result.retryAfter }, 429);
    }
  });

  app.delete('/api/cans/:id', (c) => {
    const user = c.get('user');
    if (!user) return c.json({ error: 'login' }, 401);
    const id = Number(c.req.param('id'));
    const stats = Number.isSafeInteger(id) ? undoCan(db, user.id, id, ctx.now()) : null;
    if (!stats) return c.json({ error: 'not_found' }, 404);
    return c.json(stats);
  });
}
