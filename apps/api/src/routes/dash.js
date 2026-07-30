import { z } from 'zod';
import * as q from '../db/queries/dashboard.ts';
import { getMfy } from '../db/queries/ref.ts';
const periodQ = z.object({ period: z.string().regex(/^\d{4}-\d{2}$/).optional() });
const dateQ = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });
const idParam = z.object({ id: z.coerce.number().int().positive() });
const dashRoutes = async (app) => {
    /** Davrni aniqlash: so'ralgan yoki eng so'nggi mavjud. */
    const resolvePeriod = async (ctx, requested) => requested ?? (await q.latestPeriod(ctx));
    // ═══════════════════════════════════════════════════════════════════════
    // TUMAN
    // ═══════════════════════════════════════════════════════════════════════
    app.get('/district/overview', async (req, reply) => {
        const { period } = periodQ.parse(req.query);
        const p = await resolvePeriod(req.ctx, period);
        if (!p)
            return reply.code(404).send({ error: 'no_data', message: 'Ma’lumot topilmadi' });
        const result = await q.districtOverview(req.ctx, p);
        if (!result)
            return reply.code(404).send({ error: 'no_data', message: 'Ma’lumot topilmadi' });
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
    app.get('/district/tp-monitoring', async (req) => {
        const { period } = periodQ.parse(req.query);
        const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(1000).default(60) })
            .parse(req.query);
        const p = await resolvePeriod(req.ctx, period);
        return p ? q.tpMonitoring(req.ctx, p, null, limit) : [];
    });
    app.get('/district/mfy-ranking', async (req) => {
        const { date } = dateQ.parse(req.query);
        const { period } = periodQ.parse(req.query);
        let d = date;
        if (!d) {
            // Qisman to'ldirilgan joriy oyning tasodifiy kuni emas — vakillik
            // qiladigan davrning oxirgi kuni.
            const p = await resolvePeriod(req.ctx, period);
            d = (p ? await q.latestDateInPeriod(req.ctx, p) : null) ?? undefined;
        }
        return d ? q.mfyRanking(req.ctx, d) : [];
    });
    app.get('/district/ranking-history', async (req) => {
        const { period } = periodQ.parse(req.query);
        const { months } = z.object({ months: z.coerce.number().int().min(3).max(36).default(12) })
            .parse(req.query);
        const p = await resolvePeriod(req.ctx, period);
        return p ? q.rankingHistory(req.ctx, p, months) : [];
    });
    app.get('/district/technical-loss', async (req) => {
        const { period } = periodQ.parse(req.query);
        const p = await resolvePeriod(req.ctx, period);
        return p ? q.technicalLoss(req.ctx, p) : [];
    });
    app.get('/district/distance', async (req) => {
        const { period } = periodQ.parse(req.query);
        const p = await resolvePeriod(req.ctx, period);
        return p ? q.distanceAnalytics(req.ctx, p) : [];
    });
    app.get('/district/debt', async (req) => {
        const { period } = periodQ.parse(req.query);
        const p = await resolvePeriod(req.ctx, period);
        return p ? q.debtBreakdown(req.ctx, p) : null;
    });
    /** Xarita O'RNIGA: MFY plitkalari — maydon = energiya, rang = normadan farq. */
    app.get('/district/loss-map', async (req) => {
        const { period } = periodQ.parse(req.query);
        const p = await resolvePeriod(req.ctx, period);
        return p ? q.lossMap(req.ctx, p) : [];
    });
    app.get('/district/works', async (req) => {
        const { status } = z.object({ status: z.string().optional() }).parse(req.query);
        return q.works(req.ctx, null, status ?? null, 60);
    });
    /** Deterministik qoidalar asosidagi ogohlantirishlar. LLM ishlatilmaydi. */
    app.get('/district/alerts', async (req) => {
        const { period } = periodQ.parse(req.query);
        const p = await resolvePeriod(req.ctx, period);
        return p ? q.alerts(req.ctx, p) : [];
    });
    app.get('/district/results', async (req) => {
        const { period } = periodQ.parse(req.query);
        const { months } = z.object({ months: z.coerce.number().int().min(2).max(36).default(12) })
            .parse(req.query);
        const p = await resolvePeriod(req.ctx, period);
        return p ? q.results(req.ctx, null, p, months) : null;
    });
    app.get('/district/series', async (req) => {
        const { from, to, bucket } = z.object({
            from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
            to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
            bucket: z.enum(['day', 'week', 'month']).default('day'),
        }).parse(req.query);
        // Oyni vakillik qiladigan davr bo'yicha tugatamiz — aks holda qisman
        // to'ldirilgan joriy oy grafikda "qulash" bo'lib ko'rinadi.
        const p = await q.latestPeriod(req.ctx);
        const end = to ?? (p ? await q.latestDateInPeriod(req.ctx, p) : null);
        if (!end)
            return [];
        const startDefault = new Date(`${end}T00:00:00Z`);
        startDefault.setUTCDate(startDefault.getUTCDate() - 89);
        const start = from ?? startDefault.toISOString().slice(0, 10);
        return q.timeSeries(req.ctx, start, end, bucket);
    });
    app.get('/district/loss-structure', async (req) => {
        const { period } = periodQ.parse(req.query);
        const p = await resolvePeriod(req.ctx, period);
        return p ? q.lossStructure(req.ctx, p) : null;
    });
    // ═══════════════════════════════════════════════════════════════════════
    // MFY
    // ═══════════════════════════════════════════════════════════════════════
    app.get('/mfy/:id/overview', async (req, reply) => {
        const { id } = idParam.parse(req.params);
        const { period } = periodQ.parse(req.query);
        const p = await resolvePeriod(req.ctx, period);
        if (!p)
            return reply.code(404).send({ error: 'no_data', message: 'Ma’lumot topilmadi' });
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
        const { from, to, bucket } = z.object({
            from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
            to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
            bucket: z.enum(['day', 'week', 'month']).default('day'),
        }).parse(req.query);
        const p = await q.latestPeriod(req.ctx);
        const end = to ?? (p ? await q.latestDateInPeriod(req.ctx, p) : null);
        if (!end)
            return [];
        const startDefault = new Date(`${end}T00:00:00Z`);
        startDefault.setUTCDate(startDefault.getUTCDate() - 89);
        return q.timeSeries(req.ctx, from ?? startDefault.toISOString().slice(0, 10), end, bucket, id);
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
    app.get('/mfy/:id/works', async (req) => {
        const { id } = idParam.parse(req.params);
        const { status } = z.object({ status: z.string().optional() }).parse(req.query);
        return q.works(req.ctx, id, status ?? null, 60);
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
