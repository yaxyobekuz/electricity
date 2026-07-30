/**
 * Migratsiya runneri.
 *
 * Qoidalar:
 *  1. `pg_advisory_lock(4242)` ostida ishlaydi — ikkita jarayon bir vaqtda
 *     migratsiya qila olmaydi.
 *  2. Har bir faylning sha256 xeshi yoziladi. Allaqachon qo'llangan faylning
 *     mazmuni o'zgargan bo'lsa — RUNNER TO'XTAYDI. Bu "jimgina buzilish" ni
 *     oldini oladi.
 *  3. Har bir fayl o'z tranzaksiyasida bajariladi.
 *
 * Ishlatish:
 *   npm run migrate            -- qo'llanmagan migratsiyalarni qo'llaydi
 *   npm run migrate:reset      -- HAMMASINI o'chirib qayta quradi (faqat dev)
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import { config } from '../src/config.ts';
const ADVISORY_LOCK_KEY = 4242;
function sha256(text) {
    return createHash('sha256').update(text, 'utf8').digest('hex');
}
function readMigrations() {
    return readdirSync(config.paths.migrations)
        .filter((f) => f.endsWith('.sql'))
        .sort()
        .map((filename) => {
        // Windows CRLF xeshni buzmasligi uchun normallashtiramiz.
        const sql = readFileSync(resolve(config.paths.migrations, filename), 'utf8').replace(/\r\n/g, '\n');
        return { filename, sql, hash: sha256(sql) };
    });
}
async function ensureMigrationTable(client) {
    await client.query(`
    CREATE SCHEMA IF NOT EXISTS sec;
    CREATE TABLE IF NOT EXISTS sec.schema_migration (
      filename    text PRIMARY KEY,
      sha256      text NOT NULL,
      applied_at  timestamptz NOT NULL DEFAULT now(),
      duration_ms int
    );
  `);
}
async function resetDatabase(client) {
    process.stdout.write('⚠  Barcha sxemalar o‘chirilmoqda (reset)…\n');
    await client.query(`
    DROP SCHEMA IF EXISTS agg  CASCADE;
    DROP SCHEMA IF EXISTS fact CASCADE;
    DROP SCHEMA IF EXISTS ref  CASCADE;
    DROP SCHEMA IF EXISTS stg  CASCADE;
    DROP SCHEMA IF EXISTS sec  CASCADE;
  `);
}
async function main() {
    const reset = process.argv.includes('--reset');
    const pool = new pg.Pool({ ...config.db, max: 2 });
    const client = await pool.connect();
    try {
        process.stdout.write(`→ Ulanish: ${config.db.user}@${config.db.host}:${config.db.port}/${config.db.database}\n`);
        const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS locked', [ADVISORY_LOCK_KEY]);
        if (!rows[0]?.locked) {
            throw new Error('Boshqa migratsiya jarayoni ishlamoqda (advisory lock band)');
        }
        if (reset) {
            if (config.isProd)
                throw new Error('--reset ishlab chiqarishda taqiqlanadi');
            await resetDatabase(client);
        }
        await ensureMigrationTable(client);
        const applied = new Map();
        const res = await client.query('SELECT filename, sha256 FROM sec.schema_migration');
        for (const r of res.rows)
            applied.set(r.filename, r.sha256);
        const files = readMigrations();
        if (files.length === 0) {
            process.stdout.write('Migratsiya fayllari topilmadi.\n');
            return;
        }
        let count = 0;
        for (const file of files) {
            const prev = applied.get(file.filename);
            if (prev !== undefined) {
                if (prev !== file.hash) {
                    throw new Error(`MIGRATSIYA O'ZGARTIRILGAN: ${file.filename}\n` +
                        `  yozilgan xesh: ${prev}\n` +
                        `  hozirgi xesh:  ${file.hash}\n` +
                        `  Qo'llangan migratsiyani tahrirlash mumkin emas — yangi fayl qo'shing.`);
                }
                continue;
            }
            const t0 = Date.now();
            process.stdout.write(`  ▸ ${file.filename} …`);
            try {
                await client.query('BEGIN');
                await client.query(file.sql);
                const ms = Date.now() - t0;
                await client.query('INSERT INTO sec.schema_migration (filename, sha256, duration_ms) VALUES ($1, $2, $3)', [file.filename, file.hash, ms]);
                await client.query('COMMIT');
                process.stdout.write(` ✓ ${ms} ms\n`);
                count += 1;
            }
            catch (err) {
                await client.query('ROLLBACK');
                process.stdout.write(' ✗\n');
                throw err;
            }
        }
        process.stdout.write(count === 0
            ? '✓ Ma’lumotlar bazasi allaqachon dolzarb.\n'
            : `✓ ${count} ta migratsiya qo‘llandi.\n`);
    }
    finally {
        await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]).catch(() => { });
        client.release();
        await pool.end();
    }
}
main().catch((err) => {
    process.stderr.write(`\n✗ Migratsiya xatosi:\n${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
});
