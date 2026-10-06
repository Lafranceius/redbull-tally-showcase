import type { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { cleanDisplayName, requestLoginCode, safeNext, verifyLoginCode } from '../auth';
import { isEmail, normalizeEmail } from '../config';
import { clearSessionCookie, clientIp, formOf, SESSION_COOKIE, setSessionCookie, type AppEnv, type Ctx } from '../http';
import { newSessionToken, sha256 } from '../security';
import * as store from '../store';
import { loginCodePage, loginEmailPage, loginNamePage } from '../views/pages';

const SEND_FAILED = 'Klarte ikke sende kode akkurat nå, prøv igjen senere.';

export function authRoutes(app: Hono<AppEnv>, ctx: Ctx): void {
  const { db } = ctx;
  const afterLogin = (hasName: boolean, next: string) =>
    hasName ? next : `/login/name?next=${encodeURIComponent(next)}`;

  app.get('/login', (c) => {
    const next = safeNext(c.req.query('next'));
    const user = c.get('user');
    if (user) return c.redirect(afterLogin(!!user.display_name, next), 302);
    return c.html(loginEmailPage({ nonce: c.get('nonce'), next }));
  });

  app.post('/login', async (c) => {
    const form = await formOf(c);
    const email = normalizeEmail(form.email ?? '');
    const next = safeNext(form.next);
    const nonce = c.get('nonce');
    if (!isEmail(email)) {
      return c.html(loginEmailPage({ nonce, next, email, error: 'Skriv inn en gyldig e-postadresse.' }), 400);
    }
    if (!ctx.codeRequestsPerIp.hit(clientIp(c), ctx.now())) {
      const error = 'For mange forsøk fra dette nettverket. Prøv igjen om en time.';
      return c.html(loginEmailPage({ nonce, next, email, error }), 429);
    }
    const result = await requestLoginCode(db, ctx.mailer, email, clientIp(c), ctx.now());
    if (result === 'failed') return c.html(loginEmailPage({ nonce, next, email, error: SEND_FAILED }), 503);
    return c.html(loginCodePage({ nonce, email, next }));
  });

  app.post('/login/verify', async (c) => {
    const form = await formOf(c);
    const email = normalizeEmail(form.email ?? '');
    const next = safeNext(form.next);
    const code = (form.code ?? '').replace(/\s/g, '');
    const now = ctx.now();
    const result = verifyLoginCode(db, email, code, now);
    if (!result.ok) {
      const error =
        result.reason === 'deactivated'
          ? 'Kontoen din er deaktivert. Snakk med den som styrer kjøleskapet.'
          : result.reason === 'wrong' && result.attemptsLeft! > 0
            ? `Feil kode. ${result.attemptsLeft} forsøk igjen.`
            : result.reason === 'wrong'
              ? 'Feil kode for mange ganger. Be om en ny kode.'
              : 'Koden er utløpt eller allerede brukt. Be om en ny kode.';
      return c.html(loginCodePage({ nonce: c.get('nonce'), email, next, error }), 400);
    }
    const token = newSessionToken();
    store.createSession(db, sha256(token), result.user.id, now, c.req.header('user-agent'));
    setSessionCookie(c, token);
    return c.redirect(afterLogin(!!result.user.display_name, next), 303);
  });

  app.get('/login/name', (c) => {
    const next = safeNext(c.req.query('next'));
    const user = c.get('user');
    if (!user) return c.redirect(`/login?next=${encodeURIComponent(next)}`, 302);
    if (user.display_name) return c.redirect(next, 302);
    return c.html(loginNamePage({ nonce: c.get('nonce'), next }));
  });

  app.post('/login/name', async (c) => {
    const form = await formOf(c);
    const next = safeNext(form.next);
    const user = c.get('user');
    if (!user) return c.redirect(`/login?next=${encodeURIComponent(next)}`, 303);
    if (user.display_name) return c.redirect(next, 303);
    const name = cleanDisplayName(form.name ?? '');
    const nonce = c.get('nonce');
    if (!name) return c.html(loginNamePage({ nonce, next, value: form.name, error: 'Navnet må være 2–20 tegn.' }), 400);
    if (!store.setDisplayName(db, user.id, name)) {
      return c.html(loginNamePage({ nonce, next, value: name, error: 'Navnet er tatt. Velg et annet.' }), 400);
    }
    return c.redirect(next, 303);
  });

  app.post('/logout', (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) store.deleteSession(db, sha256(token));
    clearSessionCookie(c);
    return c.redirect('/login', 303);
  });
}
