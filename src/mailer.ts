export type SendResult = { ok: true; id?: string } | { ok: false; error: string };

export interface Mailer {
  sendLoginCode(to: string, code: string): Promise<SendResult>;
}

export function loginCodeEmail(code: string) {
  return {
    subject: `Red Bull-koden din: ${code}`,
    text: [
      `Koden din er ${code}.`,
      '',
      'Skriv den inn på siden der du ba om den. Den gjelder i 10 minutter og kan brukes én gang.',
      '',
      'Ba du ikke om en kode? Da kan du se bort fra denne e-posten.',
    ].join('\n'),
  };
}

/** Sends through the Resend REST API. One attempt per call, never a retry loop. */
export function resendMailer(opts: { apiKey: string | undefined; from: string; fetch?: typeof fetch }): Mailer {
  const doFetch = opts.fetch ?? fetch;
  return {
    async sendLoginCode(to, code) {
      if (!opts.apiKey) return { ok: false, error: 'RESEND_API_KEY is not set' };
      try {
        const res = await doFetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { authorization: `Bearer ${opts.apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({ from: opts.from, to: [to], ...loginCodeEmail(code) }),
          signal: AbortSignal.timeout(10_000),
        });
        const body = await res.text();
        if (!res.ok) return { ok: false, error: `${res.status} ${body.slice(0, 500)}` };
        let id: string | undefined;
        try {
          id = JSON.parse(body).id;
        } catch {
          // A 2xx without a JSON id still means Resend accepted it.
        }
        return { ok: true, id };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}

/** For local development only: prints the code instead of sending it. */
export const consoleMailer: Mailer = {
  async sendLoginCode(to, code) {
    console.log(`[dev] login code for ${to}: ${code}`);
    return { ok: true };
  },
};
