/**
 * Input panel marshrutlari - ma'lumot kiritish, tekshirish, tasdiqlash.
 *
 * Yozish huquqi ikki qatlamda tekshiriladi:
 *   1. Bu yerda (`assertMfyWrite`) - foydalanuvchiga tushunarli xato beradi
 *   2. Postgres RLS - API xatosi bo'lsa ham himoya qiladi
 */
import {
  DOMAINS, createSubmissionSchema, energyBalancePatchSchema,
  monthlyReturnSchema, networkDefectPatchSchema, reviewActionSchema,
  tpStatusPatchSchema,
} from '@beap/shared';
import type {
  Domain, TpLossConfirmResponse, TpLossPreviewResponse, TpLossPreviewRow,
} from '@beap/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import * as e from '../db/queries/entry.ts';
import * as tq from '../db/queries/tpLoss.ts';
import { refreshAggregates } from '../services/aggregates.ts';
import { parseTpLossWorkbook } from '../services/tpLossImport.ts';

const idParam = z.object({ id: z.coerce.number().int().positive() });

const entryRoutes: FastifyPluginAsync = async (app) => {
  // Barcha marshrutlar autentifikatsiya talab qiladi.
  app.addHook('onRequest', app.requireAuth);

  /** To'liqlik matritsasi - MFY × domen. */
  app.get('/periods', async (req) => {
    const { period } = z.object({ period: z.string().regex(/^\d{4}-\d{2}$/) }).parse(req.query);
    return e.completeness(req.ctx, period);
  });

  app.get('/review-queue', { onRequest: [app.requireRole('elektroset_manager', 'admin')] },
    async (req) => e.reviewQueue(req.ctx));

  /** Qoralama ochish (yoki tasdiqlangan hisobotga tuzatish revisiyasi). */
  app.post('/submission', async (req, reply) => {
    const body = createSubmissionSchema.parse(req.body);
    if (!app.assertMfyWrite(req, body.scopeId)) {
      return reply.code(403).send({
        error: 'forbidden',
        message: 'Bu MFY ga ma’lumot kiritish huquqingiz yo‘q',
      });
    }
    return e.openDraft(req.ctx, body.scopeId, body.domain, body.period);
  });

  app.get('/submission/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const sub = await e.getSubmission(req.ctx, id);
    if (!sub) return reply.code(404).send({ error: 'not_found', message: 'Konvert topilmadi' });

    const [validation, data] = await Promise.all([
      e.validateSubmission(req.ctx, id),
      sub.domain === 'ENERGY_BALANCE'
        ? e.energyBalanceRows(req.ctx, id)
        : sub.domain === 'MONTHLY_RETURN'
          ? e.monthlyReturnRow(req.ctx, id)
          : sub.domain === 'TP_STATUS'
            ? e.tpStatusRows(req.ctx, id)
            : sub.domain === 'NETWORK_DEFECT'
              ? e.networkDefectRows(req.ctx, id)
              : Promise.resolve(null),
    ]);

    return { submission: sub, validation, data };
  });

  app.get('/submission/:id/diff', async (req) => {
    const { id } = idParam.parse(req.params);
    return e.submissionDiff(req.ctx, id);
  });

  // ── Autosave ────────────────────────────────────────────────────────────

  app.patch('/submission/:id/energy-balance', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const body = energyBalancePatchSchema.parse(req.body);

    const sub = await e.getSubmission(req.ctx, id);
    if (!sub) return reply.code(404).send({ error: 'not_found', message: 'Konvert topilmadi' });
    if (!app.assertMfyWrite(req, sub.scopeId)) {
      return reply.code(403).send({ error: 'forbidden', message: 'Yozish huquqingiz yo‘q' });
    }

    const saved = await e.saveEnergyBalance(req.ctx, id, body.rows);
    const validation = await e.validateSubmission(req.ctx, id);
    return { saved, validation, savedAt: new Date().toISOString() };
  });

  app.patch('/submission/:id/monthly-return', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const body = monthlyReturnSchema.parse(req.body);

    const sub = await e.getSubmission(req.ctx, id);
    if (!sub) return reply.code(404).send({ error: 'not_found', message: 'Konvert topilmadi' });
    if (!app.assertMfyWrite(req, sub.scopeId)) {
      return reply.code(403).send({ error: 'forbidden', message: 'Yozish huquqingiz yo‘q' });
    }

    await e.saveMonthlyReturn(req.ctx, id, body);
    const validation = await e.validateSubmission(req.ctx, id);
    return { saved: 1, validation, savedAt: new Date().toISOString() };
  });

  app.patch('/submission/:id/tp-status', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const body = tpStatusPatchSchema.parse(req.body);

    const sub = await e.getSubmission(req.ctx, id);
    if (!sub) return reply.code(404).send({ error: 'not_found', message: 'Konvert topilmadi' });
    if (!app.assertMfyWrite(req, sub.scopeId)) {
      return reply.code(403).send({ error: 'forbidden', message: 'Yozish huquqingiz yo‘q' });
    }

    const saved = await e.saveTpStatus(req.ctx, id, body.rows);
    const validation = await e.validateSubmission(req.ctx, id);
    return { saved, validation, savedAt: new Date().toISOString() };
  });

  app.patch('/submission/:id/network-defect', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const body = networkDefectPatchSchema.parse(req.body);

    const sub = await e.getSubmission(req.ctx, id);
    if (!sub) return reply.code(404).send({ error: 'not_found', message: 'Konvert topilmadi' });
    if (!app.assertMfyWrite(req, sub.scopeId)) {
      return reply.code(403).send({ error: 'forbidden', message: 'Yozish huquqingiz yo‘q' });
    }

    const saved = await e.saveNetworkDefect(req.ctx, id, body.rows);
    const validation = await e.validateSubmission(req.ctx, id);
    return { saved, validation, savedAt: new Date().toISOString() };
  });

  // ── Tekshirish (dry-run) ────────────────────────────────────────────────

  app.post('/submission/:id/validate', async (req) => {
    const { id } = idParam.parse(req.params);
    return e.validateSubmission(req.ctx, id);
  });

  // ── Holat o'zgarishlari ─────────────────────────────────────────────────

  app.post('/submission/:id/submit', async (req, reply) => {
    const { id } = idParam.parse(req.params);

    const validation = await e.validateSubmission(req.ctx, id);
    if (!validation.ok) {
      return reply.code(422).send({
        error: 'validation_failed',
        message: 'Xatolar tuzatilmaguncha yuborib bo‘lmaydi',
        errors: Object.fromEntries(
          validation.issues.filter((i) => i.severity === 'error').map((i) => [i.path, i.message]),
        ),
      });
    }
    return e.changeStatus(req.ctx, id, 'submitted', null);
  });

  app.post('/submission/:id/approve',
    { onRequest: [app.requireRole('elektroset_manager', 'admin')] },
    async (req) => {
      const { id } = idParam.parse(req.params);
      const body = reviewActionSchema.parse(req.body ?? {});
      const sub = await e.changeStatus(req.ctx, id, 'approved', body.note ?? null);

      // Tasdiqlangan zahoti agregatlarni yangilaymiz - ko'ruvchi natijani
      // darhol dashboardda ko'radi.
      void refreshAggregates(req.log).catch(() => {});
      return sub;
    });

  app.post('/submission/:id/reject',
    { onRequest: [app.requireRole('elektroset_manager', 'admin')] },
    async (req, reply) => {
      const { id } = idParam.parse(req.params);
      const body = reviewActionSchema.parse(req.body ?? {});
      if (!body.note) {
        return reply.code(400).send({
          error: 'note_required',
          message: 'Rad etish sababi ko‘rsatilishi shart',
          errors: { note: 'Sababni yozing' },
        });
      }
      return e.changeStatus(req.ctx, id, 'rejected', body.note);
    });

  /** Tasdiqlangan hisobotga tuzatish - yangi revision ochadi. */
  app.post('/submission/:id/amend', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const sub = await e.getSubmission(req.ctx, id);
    if (!sub) return reply.code(404).send({ error: 'not_found', message: 'Konvert topilmadi' });
    if (!app.assertMfyWrite(req, sub.scopeId)) {
      return reply.code(403).send({ error: 'forbidden', message: 'Yozish huquqingiz yo‘q' });
    }
    return e.openDraft(req.ctx, sub.scopeId, sub.domain, sub.periodStart.slice(0, 7));
  });

  /** Mavjud domenlar ro'yxati (UI tab lari uchun). */
  app.get('/domains', async () => DOMAINS.map((d: Domain) => d));

  // ── TP kunlik chiziqli yo'qotish (Excel yuklash) ────────────────────────
  //
  // Ikki bosqichli: PREVIEW hech narsa yozmaydi (faylni ko'rsatish uchun
  // qayta o'qiydi), CONFIRM haqiqatan UPSERT qiladi. Sabab: bu moliyaviy/
  // o'g'irlik-sezgir ma'lumot - xodim noto'g'ri fayl yuklab, eski (to'g'ri)
  // o'qishlarni ustidan yozib yubormasligi kerak.

  const TP_LOSS_ROLES = ['mfy_operator', 'elektroset_manager', 'admin'] as const;

  app.post('/tp-daily-loss/preview',
    { onRequest: [app.requireRole(...TP_LOSS_ROLES)] },
    async (req, reply) => {
      const file = await req.file();
      if (!file) return reply.code(400).send({ error: 'no_file', message: 'Fayl yuborilmadi' });

      const buf = await file.toBuffer();
      const { rows, warnings } = await parseTpLossWorkbook(buf);

      const codes = [...new Set(rows.map((r) => r.tpCode))];
      const resolved = await tq.resolveTpCodes(req.ctx, codes);

      const previewRows: TpLossPreviewRow[] = rows.map((r) => {
        const tp = resolved.get(r.tpCode);
        const kwhLoss = Number((r.kwhBalanceMeter - r.kwhConsumersAttached).toFixed(2));
        const lossPct = r.kwhBalanceMeter !== 0
          ? Number(((100 * kwhLoss) / r.kwhBalanceMeter).toFixed(2))
          : null;
        return {
          tpCode: r.tpCode, tpId: tp?.id ?? null, mfyId: tp?.mfyId ?? null,
          bizDate: r.bizDate, kwhBalanceMeter: r.kwhBalanceMeter,
          kwhConsumersAttached: r.kwhConsumersAttached, kwhLoss, lossPct,
          inspectionNote: r.inspectionNote, willUpsert: tp !== undefined,
        };
      });
      const unresolvedCodes = [...new Set(previewRows.filter((r) => !r.willUpsert).map((r) => r.tpCode))];

      const response: TpLossPreviewResponse = {
        rows: previewRows,
        warnings,
        summary: {
          totalRows: previewRows.length,
          resolvedRows: previewRows.length - unresolvedCodes.length,
          unresolvedCodes,
        },
      };
      return response;
    });

  app.post('/tp-daily-loss/confirm',
    { onRequest: [app.requireRole(...TP_LOSS_ROLES)] },
    async (req, reply) => {
      const file = await req.file();
      if (!file) return reply.code(400).send({ error: 'no_file', message: 'Fayl yuborilmadi' });

      const buf = await file.toBuffer();
      const { rows } = await parseTpLossWorkbook(buf);

      const codes = [...new Set(rows.map((r) => r.tpCode))];
      const resolved = await tq.resolveTpCodes(req.ctx, codes);

      const distinctMfyIds = [...new Set([...resolved.values()].map((tp) => tp.mfyId))];
      for (const mfyId of distinctMfyIds) {
        if (!app.assertMfyWrite(req, mfyId)) {
          return reply.code(403).send({ error: 'forbidden', message: 'Bu fiderga yozish huquqingiz yo‘q' });
        }
      }

      const resolvedRows = rows.filter((r) => resolved.has(r.tpCode));
      const skippedUnresolved = [...new Set(
        rows.filter((r) => !resolved.has(r.tpCode)).map((r) => r.tpCode),
      )];

      const { inserted, updated } = await tq.upsertTpLossDaily(
        req.ctx,
        resolvedRows.map((r) => ({
          tpId: resolved.get(r.tpCode)!.id,
          bizDate: r.bizDate,
          kwhBalanceMeter: r.kwhBalanceMeter,
          kwhConsumersAttached: r.kwhConsumersAttached,
          inspectionNote: r.inspectionNote,
          source: 'EXCEL' as const,
          fileName: file.filename ?? null,
        })),
      );

      const response: TpLossConfirmResponse = { inserted, updated, skippedUnresolved };
      return response;
    });
};

export default entryRoutes;
