/**
 * Postgres ulanish hovuzi va so'rov yordamchilari.
 *
 * Analitik so'rovlar QO'LDA yozilgan SQL bilan bajariladi — window funksiya,
 * FILTER, LATERAL va REFRESH MATERIALIZED VIEW ni ORM faqat yomonlashtiradi.
 */
import pg from 'pg';
import { config } from '../config.ts';
// numeric (OID 1700) ni string emas, number qilib qaytarish.
// Bizning barcha numeric qiymatlar JS number aniqligiga bemalol sig'adi
// (eng kattasi ~5×10^6 kWh, 2 kasr).
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number.parseFloat(v)));
// int8 (OID 20) — count(*) natijalari. Bizda hech qachon 2^53 dan oshmaydi.
pg.types.setTypeParser(20, (v) => (v === null ? null : Number.parseInt(v, 10)));
// date (OID 1082) — vaqt mintaqasi siljishisiz, YYYY-MM-DD holicha.
pg.types.setTypeParser(1082, (v) => v);
export const pool = new pg.Pool({
    host: config.db.host,
    port: config.db.port,
    database: config.db.database,
    user: config.db.user,
    password: config.db.password,
    max: config.db.max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: 'beap-api',
});
export const SYSTEM_CONTEXT = {
    userId: null,
    role: 'system',
    mfyIds: [],
    requestId: 'system',
};
/**
 * Tranzaksiya ichida ilova kontekstini o'rnatadi.
 * Bu BIR JOYDA bajariladi — audit triggeri ham, RLS siyosatlari ham shundan oziqlanadi.
 */
async function applyContext(client, ctx) {
    await client.query(`SELECT set_config('app.user_id',    $1, true),
            set_config('app.role',       $2, true),
            set_config('app.mfy_ids',    $3, true),
            set_config('app.request_id', $4, true)`, [
        ctx.userId === null ? '' : String(ctx.userId),
        ctx.role,
        ctx.mfyIds.join(','),
        ctx.requestId,
    ]);
}
/** Faqat o'qish uchun so'rov (tranzaksiyasiz, lekin kontekst bilan). */
export async function query(text, params = [], ctx = SYSTEM_CONTEXT) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN READ ONLY');
        await applyContext(client, ctx);
        const res = await client.query(text, params);
        await client.query('COMMIT');
        return res.rows;
    }
    catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        throw err;
    }
    finally {
        client.release();
    }
}
/** Bitta qator kutilganda. */
export async function queryOne(text, params = [], ctx = SYSTEM_CONTEXT) {
    const rows = await query(text, params, ctx);
    return rows[0] ?? null;
}
/** Yozish tranzaksiyasi. */
export async function withTransaction(ctx, fn) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await applyContext(client, ctx);
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    }
    catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        throw err;
    }
    finally {
        client.release();
    }
}
/**
 * Advisory lock ostida bajarish. Lock band bo'lsa `null` qaytaradi —
 * bir nechta instans matview ni ikki marta yangilamasligi uchun.
 */
export async function withAdvisoryLock(key, fn) {
    const client = await pool.connect();
    try {
        const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS locked', [key]);
        if (!rows[0]?.locked)
            return null;
        try {
            return await fn(client);
        }
        finally {
            await client.query('SELECT pg_advisory_unlock($1)', [key]).catch(() => { });
        }
    }
    finally {
        client.release();
    }
}
export async function closePool() {
    await pool.end();
}
/** Postgres xatosi ekanini aniqlash. */
export function isPgError(err) {
    return err instanceof Error && 'code' in err;
}
