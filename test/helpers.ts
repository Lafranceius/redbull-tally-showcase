import { expect } from 'vitest';
import { createApp } from '../src/app';
import type { Config } from '../src/config';
import { openDb, seed } from '../src/db';
import type { Mailer, SendResult } from '../src/mailer';
import * as store from '../src/store';

export const PUBLIC_URL = 'https://tally.example';
export const ADMIN_EMAIL = 'boss@example.com';
/** 2026-10-15 12:00 in Oslo. */
export const START = Date.parse('2026-10-15T10:00:00Z');
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

export function makeConfig(over: Partial<Config> = {}): Config {
  return {
    publicUrl: PUBLIC_URL,
    adminEmail: ADMIN_EMAIL,
    mailFrom: 'Red Bull <redbull@example.com>',
    dbPath: ':memory:',
    defaultPriceOre: 1000,
    mailMode: 'resend',
    resendApiKey: 'test-key',
    ...over,
  };
}

export class FakeMailer implements Mailer {
  sent: Array<{ to: string; code: string }> = [];
  calls = 0;
  failWith: string | null = null;

  async sendLoginCode(to: string, code: string): Promise<SendResult> {
    this.calls++;
    if (this.failWith) return { ok: false, error: this.failWith };
    this.sent.push({ to, code });
    return { ok: true, id: `fake-${this.calls}` };
  }

  lastCodeFor(to: string): string {
    const hit = this.sent.findLast((s) => s.to === to);
    if (!hit) throw new Error(`no code sent to ${to}`);
    return hit.code;
  }
}

type ReqOpts = {
  cookie?: string;
  form?: Record<string, string>;
  json?: unknown;
  headers?: Record<string, string>;
  ip?: string;
  /** Defaults to PUBLIC_URL on writes; `null` omits the header. */
  origin?: string | null;
};

let ipCounter = 0;
export const uniqueIp = () => {
  const n = ++ipCounter;
  return `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`;
};

export function sessionCookie(res: Response): string {
  const c = res.headers.getSetCookie().find((s) => s.startsWith('rb_session=') && !s.startsWith('rb_session=;'));
  if (!c) throw new Error(`no session cookie (status ${res.status})`);
  return c.split(';')[0]!;
}

export function setup(start = START) {
  const clock = { now: start };
  const config = makeConfig();
  const db = openDb(':memory:');
  seed(db, config, start);
  const mailer = new FakeMailer();
  const app = createApp({ db, mailer, config, now: () => clock.now });

  function request(method: string, path: string, o: ReqOpts = {}) {
    const headers = new Headers(o.headers);
    if (o.cookie) headers.set('cookie', o.cookie);
    headers.set('cf-connecting-ip', o.ip ?? '203.0.113.1');
    if (method !== 'GET' && o.origin !== null) headers.set('origin', o.origin ?? PUBLIC_URL);
    let body: string | URLSearchParams | undefined;
    if (o.form) {
      body = new URLSearchParams(o.form);
      headers.set('content-type', 'application/x-www-form-urlencoded');
    }
    if (o.json !== undefined) {
      body = JSON.stringify(o.json);
      headers.set('content-type', 'application/json');
    }
    return app.request(path, { method, headers, body });
  }
  const get = (path: string, o?: ReqOpts) => request('GET', path, o);
  const post = (path: string, o?: ReqOpts) => request('POST', path, o);
  const del = (path: string, o?: ReqOpts) => request('DELETE', path, o);

  const addMember = (...emails: string[]) => store.addMembers(db, emails, clock.now);
  const requestCode = (email: string, o: ReqOpts = {}) =>
    post('/login', { ip: uniqueIp(), ...o, form: { email, next: '/me' } });
  const verify = (email: string, code: string, next = '/me', o: ReqOpts = {}) =>
    post('/login/verify', { ...o, form: { email, code, next } });

  /** Runs the whole login flow and returns the `rb_session=…` cookie pair. */
  async function login(email: string, name?: string): Promise<string> {
    const normalized = email.trim().toLowerCase();
    if (!store.isMember(db, normalized)) addMember(normalized);
    await requestCode(email);
    const res = await verify(email, mailer.lastCodeFor(normalized));
    expect(res.status).toBe(303);
    const cookie = sessionCookie(res);
    if (res.headers.get('location')?.startsWith('/login/name')) {
      const named = await post('/login/name', {
        cookie,
        form: { name: name ?? normalized.split('@')[0]!, next: '/me' },
      });
      expect(named.status).toBe(303);
    }
    return cookie;
  }

  const logCan = (cookie: string, o: { confirm?: boolean; key?: string } = {}) =>
    post('/api/cans', {
      cookie,
      json: { confirm: o.confirm ?? false },
      headers: { 'idempotency-key': o.key ?? crypto.randomUUID() },
    });

  const userId = (email: string) => store.getUserByEmail(db, email)!.id;
  const advance = (ms: number) => {
    clock.now += ms;
  };

  return {
    app, db, config, clock, mailer,
    request, get, post, del,
    addMember, requestCode, verify, login, logCan, userId, advance,
  };
}

export type T = ReturnType<typeof setup>;

/** Response body as JSON, loosely typed for assertions. */
export const json = async (res: Response): Promise<any> => res.json();
