import { fileURLToPath } from 'node:url';

export type Config = {
  /** Origin the app is served from, without a trailing slash. Also the only accepted `Origin` on writes. */
  publicUrl: string;
  adminEmail: string;
  mailFrom: string;
  dbPath: string;
  defaultPriceOre: number;
  /** `console` prints codes to stdout instead of emailing them. Only allowed against localhost. */
  mailMode: 'resend' | 'console';
  resendApiKey: string | undefined;
};

/** The server only ever listens here; Cloudflare Tunnel forwards to it. */
export const HOST = '127.0.0.1';
export const PORT = 8095;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const LIMITS = {
  codeTtlMs: 10 * MINUTE,
  codeMaxAttempts: 5,
  codesPerEmail: { max: 5, windowMs: HOUR },
  codeRequestsPerIp: { max: 10, windowMs: HOUR },
  emailsGlobal: { max: 80, windowMs: 24 * HOUR },
  recentScanMs: 60_000,
  cansPerUser: { max: 5, windowMs: 10 * MINUTE },
  sessionMaxAgeSec: 34_560_000, // 400 days, the most browsers accept
  leaderboardCacheMs: 30_000,
  avatarMaxBytes: 200 * 1024,
  resendFree: { perDay: 100, perMonth: 3000 },
} as const;

export function normalizeEmail(s: string): string {
  return s.trim().toLowerCase();
}

export function isEmail(s: string): boolean {
  return s.length <= 254 && /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/.test(s);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    publicUrl: (env.PUBLIC_URL ?? 'https://tally.example.com').replace(/\/+$/, ''),
    adminEmail: normalizeEmail(env.ADMIN_EMAIL ?? 'admin@example.com'),
    mailFrom: env.MAIL_FROM ?? 'Red Bull <redbull@mail.example.com>',
    // dist/server.js → ../data/tally.db, i.e. ~/redbull-tally/data/tally.db on the Pi.
    dbPath: env.DB_PATH ?? fileURLToPath(new URL('../data/tally.db', import.meta.url)),
    defaultPriceOre: 1000,
    mailMode: env.MAIL_MODE === 'console' ? 'console' : 'resend',
    resendApiKey: env.RESEND_API_KEY || undefined,
  };
}
