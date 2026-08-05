/**
 * Agregatlarni yangilash.
 *
 * `pg_try_advisory_lock` ostida ishlaydi - bir nechta instans bir vaqtda
 * yangilamaydi. Lock band bo'lsa darhol qaytadi (kutmaydi).
 */
import type { FastifyBaseLogger } from 'fastify';

import { queryOne, withAdvisoryLock } from '../db/pool.ts';

const REFRESH_LOCK_KEY = 9001;

export async function refreshAggregates(log?: FastifyBaseLogger): Promise<boolean> {
  const result = await withAdvisoryLock(REFRESH_LOCK_KEY, async (client) => {
    const t0 = Date.now();
    await client.query('SELECT agg.refresh_all(true)');
    log?.info({ ms: Date.now() - t0 }, 'Agregatlar yangilandi');
    return true;
  });

  if (result === null) {
    log?.debug('Agregatlarni yangilash o‘tkazib yuborildi (boshqa jarayon bajarmoqda)');
    return false;
  }
  return true;
}

export async function lastRefreshAt(): Promise<string | null> {
  const row = await queryOne<{ at: string | null }>(
    `SELECT max(finished_at)::text AS at FROM agg.refresh_log WHERE ok`);
  return row?.at ?? null;
}
