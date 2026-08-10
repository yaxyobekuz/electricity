/**
 * Hisobot yo'llari - Excel va PDF.
 *
 * Fayl serverda hosil bo'ladi va oqim sifatida qaytadi. Kengaytma yo'lning
 * bir qismi (`/period/monthly.xlsx`), chunki brauzer `Content-Disposition`
 * dagi nomni emas, ba'zan yo'l oxirini ham hisobga oladi.
 */
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';

import { queryOne } from '../db/pool.ts';
import * as q from '../db/queries/dashboard.ts';
import * as p from '../db/queries/passport.ts';
import * as charts from '../services/charts.ts';
import * as rep from '../services/reports.ts';

const periodQ = z.object({ period: z.string().regex(/^\d{4}-\d{2}$/).optional() });
const extParam = z.enum(['xlsx', 'pdf']);

const chartKindParam = z.enum(['energy_trend', 'tp_ranking', 'loss_breakdown', 'loss_forecast']);
/** `/chart/:kind.:ext` uchun so'rov satri - davr + har bir diagrammaga xos ixtiyoriy parametrlar. */
const chartQ = periodQ.extend({
  sort_by: z.enum(['kwh', 'disconnected', 'off_share', 'consumers']).optional(),
  limit: z.coerce.number().int().min(1).max(20).optional(),
  months_ahead: z.coerce.number().int().min(1).max(12).optional(),
});

const KIND_LABEL: Record<string, string> = {
  daily: 'Kunlik',
  weekly: 'Haftalik',
  monthly: 'Oylik',
  quarterly: 'Choraklik',
  yearly: 'Yillik',
};

const MIME = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
  png: 'image/png',
} as const;

/**
 * Fayl nomi ikki marta beriladi: ASCII zaxira nusxa va RFC 5987 bo'yicha
 * UTF-8 nusxa - aks holda o'zbekcha nomlar Windows'da buziladi.
 *
 * `disposition` standart holda 'attachment' - Excel/PDF hisobotlar doim
 * kompyuterga yuklanadi. Diagramma marshruti buni 'inline'ga o'zgartiradi:
 * PNG chatda/Telegram fotosuratida to'g'ridan-to'g'ri ko'rsatiladi, fayl
 * sifatida saqlanmaydi.
 */
function send(
  reply: FastifyReply, buf: Buffer, name: string, ext: 'xlsx' | 'pdf' | 'png',
  disposition: 'attachment' | 'inline' = 'attachment',
): FastifyReply {
  const ascii = name.replace(/[^\w.-]/g, '_');
  return reply
    .header('Content-Type', MIME[ext])
    .header(
      'Content-Disposition',
      `${disposition}; filename="${ascii}.${ext}"; filename*=UTF-8''${encodeURIComponent(name)}.${ext}`,
    )
    .header('Content-Length', String(buf.length))
    .send(buf);
}

const reportRoutes: FastifyPluginAsync = async (app) => {
  // ── Pasport: MFY ────────────────────────────────────────────────────────
  app.get('/passport/mfy/:id.:ext', async (req, reply) => {
    const { id, ext } = z
      .object({ id: z.coerce.number().int().positive(), ext: extParam })
      .parse(req.params);
    const { period } = periodQ.parse(req.query);

    const per = period ?? (await q.latestPeriod(req.ctx));
    if (!per) return reply.code(404).send({ error: 'no_data', message: 'Ma’lumot topilmadi' });

    const passport = await p.mfyPassport(req.ctx, id, per);
    if (!passport) {
      return reply
        .code(404)
        .send({ error: 'no_data', message: `${per} davri uchun pasport topilmadi` });
    }

    const buf = ext === 'xlsx' ? await rep.passportXlsx(passport) : await rep.passportPdf(passport);
    return send(reply, buf, `Pasport-${passport.scopeName}-${per}`, ext);
  });

  // ── Pasport: tuman ──────────────────────────────────────────────────────
  app.get('/passport/tuman.:ext', async (req, reply) => {
    const { ext } = z.object({ ext: extParam }).parse(req.params);
    const { period } = periodQ.parse(req.query);

    const per = period ?? (await q.latestPeriod(req.ctx));
    if (!per) return reply.code(404).send({ error: 'no_data', message: 'Ma’lumot topilmadi' });

    const passport = await p.tumanPassport(req.ctx, per);
    if (!passport) {
      return reply
        .code(404)
        .send({ error: 'no_data', message: `${per} davri uchun pasport topilmadi` });
    }

    const buf = ext === 'xlsx' ? await rep.passportXlsx(passport) : await rep.passportPdf(passport);
    return send(reply, buf, `Pasport-Baliqchi-tumani-${per}`, ext);
  });

  // ── Davriy hisobot ──────────────────────────────────────────────────────
  app.get('/period/:kind.:ext', async (req, reply) => {
    const { kind, ext } = z
      .object({
        kind: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly']),
        ext: extParam,
      })
      .parse(req.params);
    const { period } = periodQ.parse(req.query);

    const per = period ?? (await q.latestPeriod(req.ctx));
    if (!per) return reply.code(404).send({ error: 'no_data', message: 'Ma’lumot topilmadi' });

    const [overview, balance, cells, lossGaps, debt] = await Promise.all([
      q.districtOverview(req.ctx, per),
      q.energyBalance(req.ctx, per),
      q.lossMap(req.ctx, per),
      q.lossGap(req.ctx, per),
      q.debtBreakdown(req.ctx, per),
    ]);

    if (!overview) {
      return reply.code(404).send({ error: 'no_data', message: 'Ma’lumot topilmadi' });
    }

    const normByMfy = new Map(lossGaps.map((r) => [r.mfyId, r]));
    const tot = overview.totals;

    const input: rep.PeriodReportInput = {
      scopeName: 'Baliqchi tumani',
      period: per,
      kindLabel: KIND_LABEL[kind] ?? kind,
      // DB ustunlari snake_case - hisobot uchun bir marta camelCase'ga o'giriladi.
      totals: {
        kwhIn: tot.kwh_in,
        kwhSold: tot.kwh_sold,
        kwhLossTotal: tot.kwh_loss_total,
        lossPct: tot.loss_pct ?? 0,
        consumersTotal: tot.consumers_total,
        consumersActive: tot.consumers_active,
        consumersDisconnected: tot.consumers_disconnected,
        tpCount: tot.tp_total,
        debtTotalMln: tot.debt_total_mln,
      },
      balance: balance.map((b) => ({ labelUz: b.labelUz, kwh: b.kwh, pct: b.pct })),
      mfys: [...cells]
        .sort((a, b) => b.kwhIn - a.kwhIn)
        .map((c) => ({
          nameUz: c.nameUz,
          kwhIn: c.kwhIn,
          lossPct: c.lossPct,
          normPct: normByMfy.get(c.mfyId)?.standardPct ?? c.normPct,
          gapPp: c.gapPp,
          status: c.status,
        })),
      debt: debt.byCategory.map((d) => ({
        labelUz: d.labelUz, amountMln: d.amountMln, pct: d.pct,
      })),
      topDebtors: debt.topDebtors.map((d) => ({
        rank: d.rank, debtorName: d.debtorName, mfyName: d.mfyName, amountMln: d.amountMln,
      })),
    };

    const buf = ext === 'xlsx' ? await rep.periodXlsx(input) : await rep.periodPdf(input);
    return send(reply, buf, `${KIND_LABEL[kind]}-hisobot-Baliqchi-${per}`, ext);
  });

  // ── Diagramma (PNG) ─────────────────────────────────────────────────────
  app.get('/chart/:kind.:ext', async (req, reply) => {
    const { kind } = z.object({ kind: chartKindParam, ext: z.literal('png') }).parse(req.params);
    const { period, sort_by, limit, months_ahead } = chartQ.parse(req.query);

    const per = period ?? (await q.latestPeriod(req.ctx));
    if (!per) return reply.code(404).send({ error: 'no_data', message: 'Ma’lumot topilmadi' });

    /*
     * Yagona fider - `ai.ts` dagi `buildSnapshot` bilan BIR XIL qoida: eng
     * kichik `sort_order` (keyin `id`) bo'yicha birinchi amaldagi MFY. Bu
     * yerda alohida "joriy fider" jadvali yo'q, shuning uchun so'rov
     * o'sha yerdagi bilan bir xil holda takrorlanadi.
     */
    const feeder = await queryOne<{ id: number }>(
      `SELECT m.id
         FROM ref.mfy m
         JOIN ref.elektroset e ON e.id = m.elektroset_id
        WHERE m.valid_to IS NULL
        ORDER BY m.sort_order, m.id
        LIMIT 1`,
      [], req.ctx,
    );
    const feederId = feeder?.id ?? null;

    try {
      const { buffer, filename } = await charts.renderChart(req.ctx, kind, {
        period: per, sortBy: sort_by, limit, monthsAhead: months_ahead, feederId,
      });
      // `renderChart` nomi allaqachon ".png" bilan tugaydi - `send()` o'zi qo'shadi.
      return send(reply, buffer, filename.replace(/\.png$/, ''), 'png', 'inline');
    } catch (err) {
      req.log.error({ err }, 'Diagramma yaratib bo‘lmadi');
      return reply.code(404).send({ error: 'no_data', message: 'Diagramma uchun ma’lumot topilmadi' });
    }
  });
};

export default reportRoutes;
