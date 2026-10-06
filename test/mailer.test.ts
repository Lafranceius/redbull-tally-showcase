import { describe, expect, it } from 'vitest';
import { resendMailer } from '../src/mailer';

function stubFetch(status: number, body: unknown) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init! });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  return { calls, fetch: fetch as typeof globalThis.fetch };
}

describe('Resend mailer', () => {
  it('sends the code in the subject from MAIL_FROM', async () => {
    const { calls, fetch } = stubFetch(200, { id: 'abc' });
    const mailer = resendMailer({ apiKey: 're_test', from: 'Red Bull <redbull@example.com>', fetch });
    expect(await mailer.sendLoginCode('ola@example.com', '123456')).toEqual({ ok: true, id: 'abc' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.resend.com/emails');
    expect(new Headers(calls[0]!.init.headers).get('authorization')).toBe('Bearer re_test');
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body).toMatchObject({
      from: 'Red Bull <redbull@example.com>',
      to: ['ola@example.com'],
      subject: 'Red Bull-koden din: 123456',
    });
    expect(body.text).toContain('123456');
  });

  it('reports a refusal with Resend’s error and does not retry', async () => {
    const { calls, fetch } = stubFetch(429, { name: 'daily_quota_exceeded', message: 'You have reached your daily email sending quota.' });
    const mailer = resendMailer({ apiKey: 're_test', from: 'x <x@example.com>', fetch });
    const res = await mailer.sendLoginCode('ola@example.com', '123456');
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error).toContain('daily_quota_exceeded');
    expect(calls).toHaveLength(1);
  });

  it('fails cleanly without an API key', async () => {
    const { calls, fetch } = stubFetch(200, {});
    const mailer = resendMailer({ apiKey: undefined, from: 'x <x@example.com>', fetch });
    expect((await mailer.sendLoginCode('ola@example.com', '123456')).ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});
