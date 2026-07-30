/**
 * Fastify ilovasi.
 *
 * OFFLINE KAFOLATI: CSP `connect-src 'self'` — brauzer boshqa hostga
 * so'rov yubora olmaydi. Bu "ma'lumot tashqariga chiqmasin" talabining
 * MASHINA TOMONIDAN majburlanishi.
 */
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';

import { config } from './config.ts';
import authPlugin from './plugins/auth.ts';
import errorsPlugin from './plugins/errors.ts';
import authRoutes from './routes/auth.ts';
import dashRoutes from './routes/dash.ts';
import entryRoutes from './routes/entry.ts';
import passportRoutes from './routes/passport.ts';
import refRoutes from './routes/ref.ts';
import { lastRefreshAt } from './services/aggregates.ts';
import { queryOne } from './db/pool.ts';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.isProd
      ? { level: config.api.logLevel }
      : {
          level: config.api.logLevel,
          transport: {
            target: 'pino-pretty',
            options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname', colorize: true },
          },
        },
    trustProxy: true,
    bodyLimit: 8 * 1024 * 1024,
    genReqId: () => Math.random().toString(36).slice(2, 12),
  });

  await app.register(errorsPlugin);

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // Tashqi so'rovlar TAQIQLANADI — offline talabining majburlanishi.
        connectSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'", 'data:'],
        // Vite dev rejimida inline style kerak; prod bilanda ham HeroUI
        // CSS o'zgaruvchilarni inline style orqali beradi.
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: config.isProd ? ["'self'"] : ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        baseUri: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  });

  await app.register(cookie, { secret: config.auth.jwtSecret });

  // Dev rejimida Vite (5173) API ga murojaat qiladi. Prod da bir xil origin.
  if (!config.isProd) {
    await app.register(cors, {
      origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
      credentials: true,
    });
  }

  await app.register(rateLimit, {
    global: false,
    max: 100,
    timeWindow: '1 minute',
  });

  await app.register(authPlugin);

  // ── Sog'liq ────────────────────────────────────────────────────────────
  app.get('/api/health', async () => ({ ok: true, ts: new Date().toISOString() }));

  app.get('/api/health/db', async () => {
    const row = await queryOne<{ v: string }>('SELECT version() AS v');
    return { ok: true, version: row?.v ?? null, lastRefreshAt: await lastRefreshAt() };
  });

  app.get('/api/version', async () => ({
    name: 'BEAP',
    version: '1.0.0',
    description: 'Baliqchi tumani Elektr energiya Analitik Platformasi',
  }));

  // ── Marshrutlar ────────────────────────────────────────────────────────
  // Login urinishlari marshrut darajasida cheklanadi (auth.ts ichida) —
  // `register` opsiyalari `config` maydonini qabul qilmaydi.
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(refRoutes, { prefix: '/api/ref' });
  await app.register(dashRoutes, { prefix: '/api/dash' });
  await app.register(passportRoutes, { prefix: '/api/passport' });
  await app.register(entryRoutes, { prefix: '/api/entry' });

  return app;
}
