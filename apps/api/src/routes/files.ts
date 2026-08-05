/**
 * Fayl marshrutlari - ish dalolatnomasi rasmlari.
 *
 * QOIDALAR:
 *   • Fayl LOKAL diskda (`var/uploads/work/<workId>/`), tashqi saqlagich yo'q.
 *   • Statik papka OCHILMAYDI: har bir yuklab olish shu marshrutdan o'tadi,
 *     ya'ni autentifikatsiya va (kelajakda) huquq tekshiruvi bir joyda.
 *   • Diskdagi nom SERVER tomonidan hosil qilinadi. Foydalanuvchi bergan
 *     nom faqat ko'rsatish uchun saqlanadi - "../../etc/passwd" kabi
 *     yo'l bilan hujum imkonsiz bo'lsin.
 */
import { createReadStream } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { config } from '../config.ts';
import { queryOne, withTransaction } from '../db/pool.ts';

const idParam = z.object({ id: z.coerce.number().int().positive() });
const uploadQ = z.object({
  kind: z.enum(['BEFORE', 'AFTER', 'DOC']).default('AFTER'),
  caption: z.string().max(300).optional(),
});

/** Ruxsat etilgan turlar - bajariladigan fayl yuklanmasligi uchun oq ro'yxat. */
const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const workDir = (workId: number): string => join(config.paths.uploads, 'work', String(workId));

const filesRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', app.requireAuth);

  /** Rasmni ko'rsatish / yuklab olish. */
  app.get('/work-photo/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);

    const row = await queryOne<{ work_id: number; file_name: string; mime: string }>(
      'SELECT work_id, file_name, mime FROM fact.work_photo WHERE id = $1', [id], req.ctx,
    );
    if (!row) return reply.code(404).send({ error: 'not_found', message: 'Rasm topilmadi' });

    /*
     * Yo'l ATAYLAB qaytadan quriladi va papka ichida ekani tekshiriladi:
     * bazadagi qiymat buzilgan bo'lsa ham fayl tizimidan chiqib ketmaydi.
     */
    const dir = workDir(row.work_id);
    const path = resolve(dir, row.file_name);
    if (!path.startsWith(resolve(dir))) {
      return reply.code(400).send({ error: 'bad_path', message: 'Fayl yo‘li noto‘g‘ri' });
    }

    return reply
      .header('Content-Type', row.mime)
      // Rasm o'zgarmaydi (nomi uuid) - brauzer bir marta yuklab, keshda saqlaydi.
      .header('Cache-Control', 'private, max-age=86400')
      .send(createReadStream(path));
  });

  /** Rasm yuklash - faqat ma'lumot kirituvchi rollar. */
  app.post(
    '/work-photo/:id',
    { onRequest: [app.requireRole('mfy_operator', 'elektroset_manager', 'admin')] },
    async (req, reply) => {
      const { id } = idParam.parse(req.params);
      const { kind, caption } = uploadQ.parse(req.query);

      const work = await queryOne<{ mfy_id: number }>(
        'SELECT mfy_id FROM fact.work WHERE id = $1', [id], req.ctx,
      );
      if (!work) return reply.code(404).send({ error: 'not_found', message: 'Ish topilmadi' });
      if (!app.assertMfyWrite(req, work.mfy_id)) {
        return reply.code(403).send({ error: 'forbidden', message: 'Yozish huquqingiz yo‘q' });
      }

      const file = await req.file();
      if (!file) return reply.code(400).send({ error: 'no_file', message: 'Fayl yuborilmadi' });

      const ext = MIME_EXT[file.mimetype];
      if (!ext) {
        return reply.code(415).send({
          error: 'bad_type',
          message: 'Faqat JPG, PNG yoki WebP rasm yuklash mumkin',
        });
      }

      const buf = await file.toBuffer();
      const dir = workDir(id);
      await mkdir(dir, { recursive: true });
      const fileName = `${randomUUID()}.${ext}`;
      await writeFile(join(dir, fileName), buf);

      /*
       * Yozish `withTransaction` orqali: `query`/`queryOne` - `BEGIN READ ONLY`,
       * ular ichida INSERT ishlamaydi.
       *
       * Yozuv qo'shilmasa fayl DISKDA QOLIB KETMASIN - bunday "yetim" fayllar
       * zaxira nusxani shishiradi va hech qachon ko'rinmaydi.
       */
      let savedId: number;
      try {
        savedId = await withTransaction(req.ctx, async (client) => {
          const res = await client.query<{ id: number }>(
            `INSERT INTO fact.work_photo
               (work_id, file_name, original_name, mime, size_bytes, kind, caption, uploaded_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING id`,
            [id, fileName, file.filename ?? null, file.mimetype, buf.length, kind,
              caption ?? null, req.ctx.userId],
          );
          return Number(res.rows[0]?.id);
        });
      } catch (err) {
        await unlink(join(dir, fileName)).catch(() => undefined);
        throw err;
      }

      return reply.code(201).send({
        id: savedId,
        url: `/api/files/work-photo/${String(savedId)}`,
      });
    },
  );

  /** Rasmni o'chirish - yozuv ham, fayl ham. */
  app.delete(
    '/work-photo/:id',
    { onRequest: [app.requireRole('mfy_operator', 'elektroset_manager', 'admin')] },
    async (req, reply) => {
      const { id } = idParam.parse(req.params);

      const row = await queryOne<{ work_id: number; file_name: string; mfy_id: number }>(
        `SELECT p.work_id, p.file_name, w.mfy_id
           FROM fact.work_photo p JOIN fact.work w ON w.id = p.work_id
          WHERE p.id = $1`, [id], req.ctx,
      );
      if (!row) return reply.code(404).send({ error: 'not_found', message: 'Rasm topilmadi' });
      if (!app.assertMfyWrite(req, row.mfy_id)) {
        return reply.code(403).send({ error: 'forbidden', message: 'O‘chirish huquqingiz yo‘q' });
      }

      await withTransaction(req.ctx, async (client) => {
        await client.query('DELETE FROM fact.work_photo WHERE id = $1', [id]);
      });
      // Fayl allaqachon yo'q bo'lsa ham yozuv o'chirilgani muhimroq.
      await unlink(join(workDir(row.work_id), row.file_name)).catch(() => undefined);

      return reply.code(204).send();
    },
  );
};

export default filesRoutes;
