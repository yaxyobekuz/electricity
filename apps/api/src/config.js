/** Muhit sozlamalari — bitta joyda o'qiladi va tekshiriladi. */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
export const API_ROOT = resolve(here, '..');
export const REPO_ROOT = resolve(API_ROOT, '../..');
/**
 * Oddiy .env yuklagich — tashqi bog'liqliksiz.
 * `dotenv` qo'shishning hojati yo'q: bizga faqat KEY=VALUE kerak.
 */
function loadEnvFile(path) {
    let text;
    try {
        text = readFileSync(path, 'utf8');
    }
    catch {
        return;
    }
    for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#'))
            continue;
        const eq = trimmed.indexOf('=');
        if (eq < 0)
            continue;
        const key = trimmed.slice(0, eq).trim();
        let value = trimmed.slice(eq + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        if (process.env[key] === undefined)
            process.env[key] = value;
    }
}
loadEnvFile(resolve(REPO_ROOT, '.env'));
loadEnvFile(resolve(REPO_ROOT, '.env.example')); // zaxira — dev uchun
const str = (key, fallback) => {
    const v = process.env[key] ?? fallback;
    if (v === undefined)
        throw new Error(`Muhit o'zgaruvchisi topilmadi: ${key}`);
    return v;
};
const int = (key, fallback) => {
    const v = process.env[key];
    return v === undefined || v === '' ? fallback : Number.parseInt(v, 10);
};
const bool = (key, fallback) => {
    const v = process.env[key];
    return v === undefined || v === '' ? fallback : v === 'true' || v === '1';
};
export const config = {
    env: str('NODE_ENV', 'development'),
    isProd: str('NODE_ENV', 'development') === 'production',
    db: {
        host: str('PGHOST', 'localhost'),
        port: int('PGPORT', 5432),
        database: str('PGDATABASE', 'elektr_dev'),
        user: str('PGUSER', 'postgres'),
        password: str('PGPASSWORD', 'postgres'),
        max: int('PG_POOL_MAX', 10),
    },
    api: {
        host: str('API_HOST', '127.0.0.1'),
        port: int('API_PORT', 3001),
        logLevel: str('LOG_LEVEL', 'info'),
    },
    auth: {
        jwtSecret: str('JWT_SECRET', 'dev-only-secret-change-me-in-production-0123456789abcdef'),
        accessTtl: str('ACCESS_TOKEN_TTL', '15m'),
        refreshTtlDays: int('REFRESH_TOKEN_TTL_DAYS', 30),
        cookieSecure: bool('COOKIE_SECURE', false),
    },
    paths: {
        migrations: resolve(API_ROOT, 'migrations'),
        sql: resolve(API_ROOT, 'src/db/sql'),
        seed: resolve(API_ROOT, 'seed'),
        assets: resolve(API_ROOT, 'assets'),
        artifacts: resolve(REPO_ROOT, 'artifacts'),
        webDist: resolve(REPO_ROOT, 'apps/web/dist'),
    },
};
export function assertProductionSecrets() {
    if (!config.isProd)
        return;
    if (config.auth.jwtSecret.startsWith('dev-only-')) {
        throw new Error('JWT_SECRET ishlab chiqarishda almashtirilishi SHART');
    }
    if (config.auth.jwtSecret.length < 32) {
        throw new Error('JWT_SECRET kamida 32 belgidan iborat bo‘lishi kerak');
    }
}
