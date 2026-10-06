const TZ = 'Europe/Oslo';

const dateParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function parts(ms: number) {
  const p = Object.fromEntries(dateParts.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: p.year!, m: p.month!, d: p.day! };
}

/** Calendar month in Oslo, `YYYY-MM`. */
export function osloMonth(ms: number): string {
  const { y, m } = parts(ms);
  return `${y}-${m}`;
}

/** Calendar day in Oslo, `YYYY-MM-DD`. */
export function osloDay(ms: number): string {
  const { y, m, d } = parts(ms);
  return `${y}-${m}-${d}`;
}

export function isMonth(s: string | undefined): s is string {
  return !!s && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}

export function isDay(s: string | undefined): s is string {
  return !!s && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`));
}

const monthName = new Intl.DateTimeFormat('nb-NO', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** `2026-10` → `oktober 2026`. */
export function formatMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return monthName.format(Date.UTC(y!, m! - 1, 15));
}

const stamp = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** `15.10 · 12:03` in Oslo time. */
export function formatStamp(ms: number): string {
  const p = Object.fromEntries(stamp.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.day}.${p.month} · ${p.hour}:${p.minute}`;
}

const fullStamp = new Intl.DateTimeFormat('sv-SE', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

/** `2026-10-15 12:03` in Oslo time. */
export function formatDateTime(ms: number): string {
  return fullStamp.format(new Date(ms));
}

/** `20.10.2026` in Oslo time. */
export function formatDate(ms: number): string {
  const [date] = formatDateTime(ms).split(' ');
  const [y, m, d] = date!.split('-');
  return `${d}.${m}.${y}`;
}

const krFormat = new Intl.NumberFormat('nb-NO', { maximumFractionDigits: 2 });

/** 14000 → `140 kr`, 1250 → `12,5 kr`. */
export function formatKr(ore: number): string {
  const kr = ore / 100;
  return `${ore % 100 === 0 ? krFormat.format(kr) : kr.toFixed(2).replace('.', ',')} kr`;
}

/** Parses `10`, `12,50` or `12.5` kr into øre. */
export function parseKr(s: string): number | null {
  const m = s.trim().replace(/\s*kr$/i, '').match(/^(\d{1,4})(?:[.,](\d{1,2}))?$/);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '0').padEnd(2, '0'));
}
