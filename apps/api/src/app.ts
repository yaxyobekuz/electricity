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
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';

import { config } from './config.ts';
import authPlugin from './plugins/auth.ts';
import errorsPlugin from './plugins/errors.ts';
import aiRoutes from './routes/ai.ts';
import authRoutes from './routes/auth.ts';
import dashRoutes from './routes/dash.ts';
import entryRoutes from './routes/entry.ts';
import filesRoutes from './routes/files.ts';
import passportRoutes from './routes/passport.ts';
import refRoutes from './routes/ref.ts';
import reportRoutes from './routes/report.ts';
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
  //
  // LAN dan kirish: sahifa `http://192.168.1.132:5173` dan ochilganda origin
  // API origin'idan farq qiladi, shuning uchun faqat LOKAL TARMOQ manzillariga
  // ruxsat beramiz. Internet origin'lari (domenlar, publik IP) rad etiladi —
  // tizim LAN doirasidan chiqmaydi.
  if (!config.isProd) {
    const LOCAL_ORIGIN =
      /^https?:\/\/(?:localhost|\[::1\]|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(?::\d{1,5})?$/;

    await app.register(cors, {
      // `origin` yo'q — bu brauzer emas (curl, server-to-server) — ruxsat.
      origin: (origin, cb) => {
        cb(null, !origin || LOCAL_ORIGIN.test(origin));
      },
      // `@fastify/cors` standart holatda faqat GET,HEAD,POST ga ruxsat beradi —
      // PATCH/PUT/DELETE ishlatadigan barcha marshrutlar (autosave, o'chirish)
      // ochiq yozilishi shart, aks holda preflight ularni jimgina bloklaydi.
      methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'],
      credentials: true,
    });
  }

  await app.register(rateLimit, {
    global: false,
    max: 100,
    timeWindow: '1 minute',
  });

  // Dalolatnoma rasmlari — bitta so'rovda bitta fayl, 8 MB gacha.
  await app.register(multipart, {
    limits: { fileSize: 8 * 1024 * 1024, files: 1 },
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
  await app.register(reportRoutes, { prefix: '/api/report' });
  await app.register(filesRoutes, { prefix: '/api/files' });
  await app.register(aiRoutes, { prefix: '/api/ai' });

  return app;
}
