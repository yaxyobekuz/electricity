import { z } from 'zod';
import * as q from '../db/queries/dashboard.ts';
import * as p from '../db/queries/passport.ts';
import * as rep from '../services/reports.ts';
const periodQ = z.object({ period: z.string().regex(/^\d{4}-\d{2}$/).optional() });
const extParam = z.enum(['xlsx', 'pdf']);
const KIND_LABEL = {
    daily: 'Kunlik',
    weekly: 'Haftalik',
    monthly: 'Oylik',
    quarterly: 'Choraklik',
    yearly: 'Yillik',
};
const MIME = {
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pdf: 'application/pdf',
};
/**
 * Fayl nomi ikki marta beriladi: ASCII zaxira nusxa va RFC 5987 bo'yicha
 * UTF-8 nusxa — aks holda o'zbekcha nomlar Windows'da buziladi.
 */
function send(reply, buf, name, ext) {
    const ascii = name.replace(/[^\w.-]/g, '_');
    return reply
        .header('Content-Type', MIME[ext])
        .header('Content-Disposition', `attachment; filename="${ascii}.${ext}"; filename*=UTF-8''${encodeURIComponent(name)}.${ext}`)
        .header('Content-Length', String(buf.length))
        .send(buf);
}
const reportRoutes = async (app) => {
    // ── Pasport: MFY ────────────────────────────────────────────────────────
    app.get('/passport/mfy/:id.:ext', async (req, reply) => {
        const { id, ext } = z
            .object({ id: z.coerce.number().int().positive(), ext: extParam })
            .parse(req.params);
        const { period } = periodQ.parse(req.query);
        const per = period ?? (await q.latestPeriod(req.ctx));
        if (!per)
            return reply.code(404).send({ error: 'no_data', message: 'Ma’lumot topilmadi' });
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
        if (!per)
            return reply.code(404).send({ error: 'no_data', message: 'Ma’lumot topilmadi' });
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
        if (!per)
            return reply.code(404).send({ error: 'no_data', message: 'Ma’lumot topilmadi' });
        const [overview, balance, cells, technical, debt] = await Promise.all([
            q.districtOverview(req.ctx, per),
            q.energyBalance(req.ctx, per),
            q.lossMap(req.ctx, per),
            q.technicalLoss(req.ctx, per),
            q.debtBreakdown(req.ctx, per),
        ]);
        if (!overview) {
            return reply.code(404).send({ error: 'no_data', message: 'Ma’lumot topilmadi' });
        }
        const normByMfy = new Map(technical.map((r) => [r.mfyId, r]));
        const tot = overview.totals;
        const input = {
            scopeName: 'Baliqchi tumani',
            period: per,
            kindLabel: KIND_LABEL[kind] ?? kind,
            // DB ustunlari snake_case — hisobot uchun bir marta camelCase'ga o'giriladi.
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
};
export default reportRoutes;
