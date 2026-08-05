/**
 * Dashboard marshrutlari.
 *
 * Qoida: bitta so'rov = bitta panel GURUHI. Tuman dashboardi 4–5 so'rovda yuklanadi.
 */
import type { Work } from '@beap/shared';
import { WORK_STATUSES, workSchema } from '@beap/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import * as q from '../db/queries/dashboard.ts';
import { getMfy } from '../db/queries/ref.ts';
import * as tq from '../db/queries/tpLoss.ts';
import * as analytics from '../services/analytics.ts';

const periodQ = z.object({ period: z.string().regex(/^\d{4}-\d{2}$/).optional() });

/**
 * Vaqt qatori so'rovi.
 *
 * `last` - oxirgi nechta NUQTA qaytsin. Diagrammada 7 kun ko'rsatilsa ham
 * 90 kunlik javob yuborish isrof; kesish serverda bo'ladi, chunki oxirgi
 * sana ma'lumotga bog'liq va mijoz uni oldindan bilmaydi.
 */
const seriesQ = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  bucket: z.enum(['day', 'week', 'month']).default('day'),
  last: z.coerce.number().int().min(2).max(365).optional(),
});
const dateQ = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });
const idParam = z.object({ id: z.coerce.number().int().positive() });

const dashRoutes: FastifyPluginAsync = async (app) => {
  /** Davrni aniqlash: so'ralgan yoki eng so'nggi mavjud. */
  const resolvePeriod = async (
    ctx: Parameters<typeof q.latestPeriod>[0], requested?: string,
  ): Promise<string | null> => requested ?? (await q.latestPeriod(ctx));

  // ═══════════════════════════════════════════════════════════════════════
  // TUMAN
  // ═══════════════════════════════════════════════════════════════════════

  app.get('/district/overview', async (req, reply) => {
    const { period } = periodQ.parse(req.query);
    const p = await resolvePeriod(req.ctx, period);
    if (!p) return reply.code(404).send({ error: 'no_data', message: 'Ma’lumot topilmadi' });

    const result = await q.districtOverview(req.ctx, p);
    if (!result) return reply.code(404).send({ error: 'no_data', message: 'Ma’lumot topilmadi' });

    return {
      period: { from: `${p}-01`, to: p },
      tiles: result.tiles,
      totals: {
        kwhIn: result.totals.kwh_in,
        kwhSold: result.totals.kwh_sold,
        kwhLossTotal: result.totals.kwh_loss_total,
        lossPct: result.totals.loss_pct,
        consumersTotal: result.totals.consumers_total,
        consumersActive: result.totals.consumers_active,
        consumersDisconnected: result.totals.consumers_disconnected,
        tpCount: result.totals.tp_total,
        debtTotalMln: result.totals.debt_total_mln,
      },
    };
  });

  app.get('/district/energy-balance', async (req) => {
    const { period } = periodQ.parse(req.query);
    const p = await resolvePeriod(req.ctx, period);
    return p ? q.energyBalance(req.ctx, p) : [];
  });

  app.get('/district/efficiency', async (req) => {
    const { period } = periodQ.parse(req.query);
    const p = await resolvePeriod(req.ctx, period);
    return p ? q.efficiency(req.ctx, p) : null;
  });

  /** Butun tizim bo'yicha TP kesimi (fider tanlanmaganda). */
  app.get('/district/tp-monthly', async (req) => {
    const { period } = periodQ.parse(req.query);
    const p = await resolvePeriod(req.ctx, period);
    return p ? q.tpMonthly(req.ctx, p) : [];
  });

  app.get('/district/tp-monitoring', async (req) => {
    const { period } = periodQ.parse(req.query);
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(1000).default(60) })
      .parse(req.query);
    const p = await resolvePeriod(req.ctx, period);
    return p ? q.tpMonitoring(req.ctx, p, null, limit) : [];
  });

  /*
   * MAHALLALARNI SOLISHTIRUVCHI marshrutlar olib tashlandi (reyting, reyting
   * tarixi, texnik yo'qotish farqi, masofa analitikasi, yo'qotish xaritasi,
   * ogohlantirishlar, tuman qarzdorligi va natijadorligi). Tizim qamrovi
   * bitta fider - solishtiradigan ikkinchi obyekt yo'q.
   */

  app.get('/district/works', async (req) => {
    const { status } = z.object({ status: z.string().optional() }).parse(req.query);
    return q.works(req.ctx, null, status ?? null, 60);
  });

  app.get('/district/series', async (req) => {
    const { from, to, bucket, last } = seriesQ.parse(req.query);

    // Oyni vakillik qiladigan davr bo'yicha tugatamiz - aks holda qisman
    // to'ldirilgan joriy oy grafikda "qulash" bo'lib ko'rinadi.
    const p = await q.latestPeriod(req.ctx);
    const end = to ?? (p ? await q.latestDateInPeriod(req.ctx, p) : null);
    if (!end) return [];
    const startDefault = new Date(`${end}T00:00:00Z`);
    startDefault.setUTCDate(startDefault.getUTCDate() - 89);
    const start = from ?? startDefault.toISOString().slice(0, 10);

    const rows = await q.timeSeries(req.ctx, start, end, bucket);
    return last ? rows.slice(-last) : rows;
  });

  app.get('/district/loss-structure', async (req) => {
    const { period } = periodQ.parse(req.query);
    const p = await resolvePeriod(req.ctx, period);
    return p ? q.lossStructure(req.ctx, p) : null;
  });

  app.get('/district/violations', async (req) => {
    const { period } = periodQ.parse(req.query);
    const p = await resolvePeriod(req.ctx, period);
    return p ? q.violations(req.ctx, p) : null;
  });

  /** Bitta ish - dalolatnoma oynasi va chop etish sahifasi uchun. */
  app.get('/work/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const row = await q.workDetail(req.ctx, id);
    if (!row) return reply.code(404).send({ error: 'not_found', message: 'Ish topilmadi' });
    return row;
  });

  /**
   * Yangi ish yozadi.
   *
   * Bugungacha `fact.work` uchun yozish yo'li umuman yo'q edi (faqat rasm
   * biriktirish, `routes/files.ts`) - bu marshrut AI asboblari ("ish tavsiya
   * qilish") va kelajakda qo'lda kiritish formasi uchun umumiy kirish nuqtasi.
   * Tekshiruv ikki qatlamli: `workSchema` (shu yerda) + Postgres CHECK/RLS.
   */
  app.post(
    '/work',
    { onRequest: [app.requireRole('mfy_operator', 'elektroset_manager', 'admin')] },
    async (req, reply) => {
      const parsed = workSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'validation',
          message: parsed.error.issues.map((i) => i.message).join('; '),
        });
      }
      if (!app.assertMfyWrite(req, parsed.data.mfyId)) {
        return reply.code(403).send({ error: 'forbidden', message: 'Bu fiderga yozish huquqingiz yo‘q' });
      }

      const row = await q.createWork(req.ctx, parsed.data as Work);
      return reply.code(201).send(row);
    },
  );

  /**
   * Ish holatini o'zgartiradi (Reja → Jarayonda → Bajarildi / Bekor qilindi).
   *
   * Berilmagan maydonlar MAVJUD qiymatdan olinadi va `workSchema` bilan QAYTA
   * to'liq tekshiriladi (`entry.ts`dagi `saveMonthlyReturn` bilan bir xil
   * "birlashtir, keyin tekshir" naqshi) - aks holda masalan faqat
   * `{status:'COMPLETED'}` yuborilsa, `actual_end`/`progress_pct` mosligi
   * tekshirilmay, xato Postgres CHECK darajasida (o'qib bo'lmas ko'rinishda)
   * chiqib ketardi.
   */
  app.patch(
    '/work/:id/status',
    { onRequest: [app.requireRole('mfy_operator', 'elektroset_manager', 'admin')] },
    async (req, reply) => {
      const { id } = idParam.parse(req.params);
      const current = await q.workDetail(req.ctx, id);
      if (!current) return reply.code(404).send({ error: 'not_found', message: 'Ish topilmadi' });
      if (!app.assertMfyWrite(req, current.mfyId)) {
        return reply.code(403).send({ error: 'forbidden', message: 'Yozish huquqingiz yo‘q' });
      }

      const patch = z.object({
        status: z.enum(WORK_STATUSES),
        progressPct: z.coerce.number().int().min(0).max(100).optional(),
        actualEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
      }).parse(req.body);

      const merged = workSchema.safeParse({
        mfyId: current.mfyId, tpId: null, workType: current.workType,
        titleUz: current.titleUz, description: current.description,
        status: patch.status,
        plannedStart: current.plannedStart, plannedEnd: current.plannedEnd,
        actualEnd: patch.actualEnd !== undefined ? patch.actualEnd : current.actualEnd,
        progressPct: patch.progressPct ?? current.progressPct,
        quantity: current.quantity, unit: current.unit, costMln: current.costMln,
        effectLossPctBefore: current.effectLossPctBefore,
        effectLossPctAfter: current.effectLossPctAfter,
        effectSavingKwhMonth: current.effectSavingKwhMonth,
      });
      if (!merged.success) {
        return reply.code(400).send({
          error: 'validation',
          message: merged.error.issues.map((i) => i.message).join('; '),
        });
      }

      const row = await q.updateWorkStatus(req.ctx, id, {
        status: merged.data.status,
        progressPct: merged.data.progressPct,
        actualEnd: merged.data.actualEnd ?? null,
      });
      if (!row) return reply.code(404).send({ error: 'not_found', message: 'Ish topilmadi' });
      return row;
    },
  );

  // ═══════════════════════════════════════════════════════════════════════
  // MFY
  // ═══════════════════════════════════════════════════════════════════════

  app.get('/mfy/:id/overview', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const { period } = periodQ.parse(req.query);
    const p = await resolvePeriod(req.ctx, period);
    if (!p) return reply.code(404).send({ error: 'no_data', message: 'Ma’lumot topilmadi' });

    const [mfy, result] = await Promise.all([
      getMfy(req.ctx, id),
      q.districtOverview(req.ctx, p, id),
    ]);
    if (!mfy || !result) {
      return reply.code(404).send({ error: 'no_data', message: 'MFY ma’lumoti topilmadi' });
    }

    return {
      mfy,
      period: { from: `${p}-01`, to: p },
      tiles: result.tiles,
      totals: {
        kwhIn: result.totals.kwh_in,
        kwhSold: result.totals.kwh_sold,
        kwhLossTotal: result.totals.kwh_loss_total,
        lossPct: result.totals.loss_pct,
        consumersTotal: result.totals.consumers_total,
        consumersActive: result.totals.consumers_active,
        consumersDisconnected: result.totals.consumers_disconnected,
        tpCount: result.totals.tp_total,
        debtTotalMln: result.totals.debt_total_mln,
      },
    };
  });

  app.get('/mfy/:id/dynamics', async (req) => {
    const { id } = idParam.parse(req.params);
    const { from, to, bucket, last } = seriesQ.parse(req.query);

    const p = await q.latestPeriod(req.ctx);
    const end = to ?? (p ? await q.latestDateInPeriod(req.ctx, p) : null);
    if (!end) return [];
    const startDefault = new Date(`${end}T00:00:00Z`);
    startDefault.setUTCDate(startDefault.getUTCDate() - 89);
    const rows = await q.timeSeries(
      req.ctx, from ?? startDefault.toISOString().slice(0, 10), end, bucket, id,
    );
    return last ? rows.slice(-last) : rows;
  });

  app.get('/mfy/:id/capacity', async (req) => {
    const { id } = idParam.parse(req.params);
    const { period } = periodQ.parse(req.query);
    const p = await resolvePeriod(req.ctx, period);
    return p ? q.capacity(req.ctx, id, p) : null;
  });

  app.get('/mfy/:id/consumers', async (req) => {
    const { id } = idParam.parse(req.params);
    const { period } = periodQ.parse(req.query);
    const p = await resolvePeriod(req.ctx, period);
    return p ? q.consumers(req.ctx, id, p) : null;
  });

  app.get('/mfy/:id/tp', async (req) => {
    const { id } = idParam.parse(req.params);
    const { period } = periodQ.parse(req.query);
    const p = await resolvePeriod(req.ctx, period);
    return p ? q.tpMonitoring(req.ctx, p, id, 500) : [];
  });

  app.get('/mfy/:id/loss-structure', async (req) => {
    const { id } = idParam.parse(req.params);
    const { period } = periodQ.parse(req.query);
    const p = await resolvePeriod(req.ctx, period);
    return p ? q.lossStructure(req.ctx, p, id) : null;
  });

  app.get('/mfy/:id/debt', async (req) => {
    const { id } = idParam.parse(req.params);
    const { period } = periodQ.parse(req.query);
    const p = await resolvePeriod(req.ctx, period);
    return p ? q.debtBreakdown(req.ctx, p, id) : null;
  });

  app.get('/mfy/:id/operational', async (req) => {
    const { id } = idParam.parse(req.params);
    const { period } = periodQ.parse(req.query);
    const p = await resolvePeriod(req.ctx, period);
    return p ? q.operational(req.ctx, id, p) : null;
  });

  /** Fider boshidagi oylik balans - hisoblagich ko'rsatkichlari bilan. */
  app.get('/mfy/:id/feeder-monthly', async (req) => {
    const { id } = idParam.parse(req.params);
    const { period } = periodQ.parse(req.query);
    const p = await resolvePeriod(req.ctx, period);
    return p ? q.feederMonthly(req.ctx, p, id) : null;
  });

  /** TP kesimi - transformatorlar sahifasi uchun. */
  app.get('/mfy/:id/tp-monthly', async (req) => {
    const { id } = idParam.parse(req.params);
    const { period } = periodQ.parse(req.query);
    const p = await resolvePeriod(req.ctx, period);
    return p ? q.tpMonthly(req.ctx, p, id) : [];
  });

  app.get('/mfy/:id/violations', async (req) => {
    const { id } = idParam.parse(req.params);
    const { period } = periodQ.parse(req.query);
    const p = await resolvePeriod(req.ctx, period);
    return p ? q.violations(req.ctx, p, id) : null;
  });

  app.get('/mfy/:id/works', async (req) => {
    const { id } = idParam.parse(req.params);
    const { status } = z.object({ status: z.string().optional() }).parse(req.query);
    return q.works(req.ctx, id, status ?? null, 60);
  });

  /**
   * TP darajasidagi kunlik chiziqli yo'qotish.
   *
   * `period` berilsa - shu OY uchun HAR BIR TP yig'indisi (global davr
   * tanlagich bilan birga o'zgaradi). Berilmasa - eng so'nggi o'qish
   * (AI/anomaliya aniqlagich shu holatni ishlatadi - davrga bog'liq emas).
   */
  app.get('/mfy/:id/tp-loss', async (req) => {
    const { id } = idParam.parse(req.params);
    const { limit, period } = z.object({
      limit: z.coerce.number().int().min(1).max(500).default(60),
      period: z.string().regex(/^\d{4}-\d{2}$/).optional(),
    }).parse(req.query);
    return period ? tq.tpLossByPeriod(req.ctx, id, period) : tq.tpLossLatestByTp(req.ctx, id, limit);
  });

  app.get('/mfy/:id/tp-loss-anomalies', async (req) => {
    const { id } = idParam.parse(req.params);
    return analytics.detectTpLossAnomalies(req.ctx, id);
  });

  /** Fider bo'ylab TP balans hisoblagichi trendi - kunlik/haftalik/oylik. */
  app.get('/mfy/:id/tp-loss-series', async (req) => {
    const { id } = idParam.parse(req.params);
    const { from, to, bucket, last } = seriesQ.parse(req.query);

    const end = to ?? new Date().toISOString().slice(0, 10);
    const startDefault = new Date(`${end}T00:00:00Z`);
    startDefault.setUTCDate(startDefault.getUTCDate() - 89);
    const rows = await tq.tpLossSeries(
      req.ctx, id, from ?? startDefault.toISOString().slice(0, 10), end, bucket,
    );
    return last ? rows.slice(-last) : rows;
  });

  app.get('/mfy/:id/results', async (req) => {
    const { id } = idParam.parse(req.params);
    const { period } = periodQ.parse(req.query);
    const { months } = z.object({ months: z.coerce.number().int().min(2).max(36).default(12) })
      .parse(req.query);
    const p = await resolvePeriod(req.ctx, period);
    return p ? q.results(req.ctx, id, p, months) : null;
  });

  app.get('/mfy/:id/efficiency', async (req) => {
    const { id } = idParam.parse(req.params);
    const { period } = periodQ.parse(req.query);
    const p = await resolvePeriod(req.ctx, period);
    return p ? q.efficiency(req.ctx, p, id) : null;
  });
};

export default dashRoutes;
