import { LIMITS } from './config';
import type { DB } from './db';
import * as store from './store';
import { formatKr, osloMonth } from './time';

/** This month's count and amount, plus the running debt since the user last cleared it. */
export type CanStats = {
  month: string;
  count: number;
  ore: number;
  kr: string;
  rank: number | null;
  oweOre: number;
  owe: string;
};

export function statsFor(db: DB, userId: number, now: number): CanStats {
  const month = osloMonth(now);
  const { count, ore } = store.monthTotals(db, userId, month);
  const owed = store.outstanding(db, userId).ore;
  return { month, count, ore, kr: formatKr(ore), rank: store.monthRank(db, userId, month), oweOre: owed, owe: formatKr(owed) };
}

export type LogResult =
  | { kind: 'created' | 'replayed'; id: number; stats: CanStats }
  | { kind: 'recent'; secondsAgo: number }
  | { kind: 'limited'; retryAfter: number };

export function logCan(db: DB, userId: number, opts: { confirm: boolean; idemKey: string | null }, now: number): LogResult {
  if (opts.idemKey) {
    const earlier = store.canByIdemKey(db, userId, opts.idemKey);
    if (earlier) return { kind: 'replayed', id: earlier.id, stats: statsFor(db, userId, now) };
  }

  const { max, windowMs } = LIMITS.cansPerUser;
  const recent = store.ownCanTimesSince(db, userId, now - windowMs);
  if (recent.length >= max) {
    return { kind: 'limited', retryAfter: Math.max(1, Math.ceil((recent[0]! + windowMs - now) / 1000)) };
  }

  const last = recent.at(-1);
  if (last !== undefined && now - last < LIMITS.recentScanMs && !opts.confirm) {
    return { kind: 'recent', secondsAgo: Math.max(1, Math.floor((now - last) / 1000)) };
  }

  const id = store.insertCan(db, {
    userId,
    createdAt: now,
    month: osloMonth(now),
    priceOre: store.getPriceOre(db),
    idemKey: opts.idemKey,
  });
  return { kind: 'created', id, stats: statsFor(db, userId, now) };
}

/** Users may only undo their own unpaid cans, and only in the current Oslo month. */
export function undoCan(db: DB, userId: number, canId: number, now: number): CanStats | null {
  const can = store.getCan(db, canId);
  if (!can || can.user_id !== userId || can.deleted_at !== null || can.settlement_id !== null || can.month !== osloMonth(now)) {
    return null;
  }
  store.softDeleteCan(db, canId, userId, now);
  return statsFor(db, userId, now);
}
