import { queryOne, withAdvisoryLock } from '../db/pool.ts';
const REFRESH_LOCK_KEY = 9001;
export async function refreshAggregates(log) {
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
export async function lastRefreshAt() {
    const row = await queryOne(`SELECT max(finished_at)::text AS at FROM agg.refresh_log WHERE ok`);
    return row?.at ?? null;
}
