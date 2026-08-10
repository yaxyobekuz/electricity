/**
 * So'rov konteksti - DEMO REJIMI (login yo'q).
 *
 * Tizim ataylab TO'LIQ OCHIQ ishlaydi: parol, JWT, refresh token va rol
 * tekshiruvi olib tashlangan. Har bir so'rov ADMINISTRATOR huquqi bilan
 * bajariladi, shuning uchun istalgan amal (kiritish, tasdiqlash, muzlatish)
 * hech qanday kirish ekranisiz mumkin.
 *
 * AUDIT VA RLS O'ZGARISHSIZ QOLADI. `withTransaction` har bir tranzaksiyada
 * `SET LOCAL app.*` qiladi, `sec.audit_log` esa kim/qachon/nimani
 * o'zgartirganini yozaveradi. Farqi bitta: aktor doim bir xil - bazadagi
 * birinchi `admin` hisobi.
 *
 * NEGA aynan haqiqiy admin qatori kerak: `fact.submission.created_by`,
 * `fact.passport_snapshot.frozen_by` kabi ustunlar `sec.app_user` ga NOT NULL
 * chet kalit bilan bog'langan. `userId: null` bilan yozib bo'lmaydi -
 * Postgres rad etadi. Shu sababli hisob ID si bir marta o'qib olinadi va
 * keshlanadi.
 *
 * Auth qaytarilganda: shu plagin `req.ctx` ni tokendan quradigan bo'ladi,
 * qolgan marshrutlarga tegilmaydi - ular allaqachon `req.ctx` bilan ishlaydi.
 */
import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

import { type AppContext, queryOne } from '../db/pool.ts';

declare module 'fastify' {
  interface FastifyRequest {
    ctx: AppContext;
  }
}

/**
 * Demo aktori - bazadagi birinchi `admin`.
 *
 * Bir marta o'qiladi: hisob ish vaqtida o'zgarmaydi, har so'rovda so'rash esa
 * bekorga urinish bo'lardi. Topilmasa `null` qaytadi - o'qish baribir ishlaydi,
 * faqat `created_by` NOT NULL bo'lgan yozuvlar rad etiladi (seed yurgizilmagan
 * baza belgisi).
 */
let cachedActorId: number | null = null;
let actorLookupDone = false;

async function demoActorId(): Promise<number | null> {
  if (actorLookupDone) return cachedActorId;
  // `ctx` berilmaydi - standart `SYSTEM_CONTEXT` `sec.app_user` ni o'qiy oladi.
  const row = await queryOne<{ id: number }>(
    `SELECT id FROM sec.app_user WHERE role = 'admin' AND is_active ORDER BY id LIMIT 1`,
  );
  cachedActorId = row?.id ?? null;
  actorLookupDone = true;
  return cachedActorId;
}

const contextPlugin: FastifyPluginAsync = async (app) => {
  // `onRequest` ilgagi har so'rovda haqiqiy qiymatni o'rnatadi; bu yerda
  // faqat maydonni e'lon qilamiz (Fastify uni oldindan bilishi kerak).
  app.decorateRequest('ctx', undefined as unknown as AppContext);

  app.addHook('onRequest', async (req) => {
    const userId = await demoActorId();
    if (userId === null) {
      req.log.warn(
        'sec.app_user da faol admin hisobi yo‘q - o‘qish ishlaydi, '
        + 'lekin yozish amallari rad etiladi. `npm run seed` ni yurgizing.',
      );
    }
    req.ctx = { userId, role: 'admin', mfyIds: [], requestId: req.id };
  });
};

export default fp(contextPlugin, { name: 'context' });
