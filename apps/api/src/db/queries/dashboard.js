import { query, queryOne } from '../pool.ts';
// ═══════════════════════════════════════════════════════════════════════════
// Davr yordamchilari
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Dashboard uchun standart davr.
 *
 * DIQQAT: bu shunchaki `max(period_month)` EMAS. Joriy oy odatda qisman
 * to'ldirilgan bo'ladi (bir-ikki MFY bir necha kun kiritgan) — uni ko'rsatish
 * hokimga "abonentlar 0 ta, yo'qotish 6%" degan YOLG'ON manzara beradi.
 *
 * Shuning uchun MFY larning kamida yarmida ma'lumot bo'lgan eng so'nggi oy
 * tanlanadi. To'liq bo'lmagan joriy oyni davr tanlagich orqali qo'lda
 * ko'rish mumkin.
 */
export async function latestPeriod(ctx) {
    const row = await queryOne(`SELECT to_char(a.period_month, 'YYYY-MM') AS p
     FROM agg.mfy_monthly a
     WHERE a.days_filled > 0
     GROUP BY a.period_month
     HAVING count(*) >= GREATEST(1,
       (SELECT count(*) FROM ref.mfy WHERE valid_to IS NULL) / 2)
     ORDER BY a.period_month DESC
     LIMIT 1`, [], ctx);
    if (row?.p)
        return row.p;
    // Zaxira: hech qanday oy mezonga javob bermasa — mavjud eng so'nggisi.
    const fallback = await queryOne(`SELECT to_char(max(period_month), 'YYYY-MM') AS p FROM agg.mfy_monthly WHERE days_filled > 0`, [], ctx);
    return fallback?.p ?? null;
}
/**
 * Berilgan oydagi ma'lumot mavjud eng so'nggi kun.
 * Reyting paneli shu kunni "bugun" deb oladi — qisman to'ldirilgan joriy
 * oyning tasodifiy kuni emas.
 */
export async function latestDateInPeriod(ctx, period) {
    const row = await queryOne(`SELECT max(biz_date)::text AS d
     FROM agg.mfy_daily
     WHERE biz_date >= ($1 || '-01')::date
       AND biz_date <  (($1 || '-01')::date + INTERVAL '1 month')`, [period], ctx);
    return row?.d ?? null;
}
export async function dataRange(ctx) {
    const row = await queryOne(`SELECT min(biz_date)::text AS min_date, max(biz_date)::text AS max_date FROM agg.mfy_daily`, [], ctx);
    return { minDate: row?.min_date ?? null, maxDate: row?.max_date ?? null };
}
/** `scope` filtri uchun WHERE bo'lagi va parametrlari. */
function scopeFilter(mfyId, elektrosetId) {
    if (mfyId !== null)
        return { clause: 'AND a.mfy_id = $2', params: [mfyId] };
    if (elektrosetId !== null)
        return { clause: 'AND a.elektroset_id = $2', params: [elektrosetId] };
    return { clause: '', params: [] };
}
const TOTALS_SELECT = `
  coalesce(sum(a.kwh_in), 0)              AS kwh_in,
  coalesce(sum(a.kwh_sold), 0)            AS kwh_sold,
  coalesce(sum(a.kwh_loss_total), 0)      AS kwh_loss_total,
  CASE WHEN sum(a.kwh_in) > 0 THEN round(100 * sum(a.kwh_loss_total)     / sum(a.kwh_in), 2) END AS loss_pct,
  CASE WHEN sum(a.kwh_in) > 0 THEN round(100 * sum(a.kwh_loss_natural)   / sum(a.kwh_in), 2) END AS natural_pct,
  CASE WHEN sum(a.kwh_in) > 0 THEN round(100 * sum(a.kwh_loss_technical) / sum(a.kwh_in), 2) END AS technical_pct,
  CASE WHEN sum(a.kwh_in) > 0 THEN round(100 * sum(a.kwh_loss_illegal)   / sum(a.kwh_in), 2) END AS illegal_pct,
  coalesce(sum(a.consumers_total), 0)        AS consumers_total,
  coalesce(sum(a.consumers_active), 0)       AS consumers_active,
  coalesce(sum(a.consumers_disconnected), 0) AS consumers_disconnected,
  coalesce(sum(a.consumers_new), 0)          AS consumers_new,
  coalesce(sum(a.consumers_population), 0)   AS consumers_population,
  coalesce(sum(a.consumers_legal), 0)        AS consumers_legal,
  coalesce(sum(a.debt_total_mln), 0)         AS debt_total_mln,
  coalesce(sum(a.debt_population_mln), 0)    AS debt_population_mln,
  coalesce(sum(a.debt_legal_mln), 0)         AS debt_legal_mln,
  coalesce(sum(a.debt_budget_mln), 0)        AS debt_budget_mln,
  coalesce(sum(a.tp_total), 0)               AS tp_total,
  coalesce(sum(a.tp_overloaded), 0)          AS tp_overloaded,
  coalesce(sum(a.meters_offline_cnt), 0)     AS meters_offline_cnt,
  coalesce(sum(a.capacity_kva), 0)           AS capacity_kva,
  coalesce(sum(a.used_kva), 0)               AS used_kva,
  max(a.natural_norm_pct)                    AS natural_norm_pct,
  max(a.technical_std_pct)                   AS technical_std_pct
`;
async function periodTotals(ctx, period, mfyId, elektrosetId) {
    const { clause, params } = scopeFilter(mfyId, elektrosetId);
    return queryOne(`SELECT ${TOTALS_SELECT}
     FROM agg.mfy_monthly a
     WHERE a.period_month = ($1 || '-01')::date ${clause}`, [period, ...params], ctx);
}
/**
 * KPI kartalaridagi mikro-diagrammalar.
 *
 * IKKI XIL DAVR, chunki manbalar ham har xil:
 *   • energiya ko'rsatkichlari KUNLIK yoziladi  → oxirgi 30 kun
 *   • abonent / qarzdorlik / TP soni OYLIK      → oxirgi 12 oy
 *
 * Har bir kartada sparkline BO'LISHI shart: aks holda ba'zi kartalarning
 * pastida bo'sh joy qolib, qator notekis ko'rinadi.
 */
async function sparklines(ctx, period, mfyId, elektrosetId) {
    const { clause, params } = scopeFilter(mfyId, elektrosetId);
    const [daily, monthly] = await Promise.all([
        query(`SELECT a.biz_date,
              sum(a.kwh_in)   AS kwh_in,
              sum(a.kwh_sold) AS kwh_sold,
              CASE WHEN sum(a.kwh_in) > 0
                   THEN round(100 * sum(a.kwh_loss_total) / sum(a.kwh_in), 2) END AS loss_pct,
              CASE WHEN sum(a.kwh_in) > 0
                   THEN round(100 * sum(a.kwh_loss_natural) / sum(a.kwh_in), 2) END AS natural_pct
       FROM agg.mfy_daily a
       WHERE a.biz_date <= (($1 || '-01')::date + INTERVAL '1 month' - INTERVAL '1 day')::date
         AND a.biz_date >  (($1 || '-01')::date + INTERVAL '1 month' - INTERVAL '31 days')::date
         ${clause}
       GROUP BY a.biz_date ORDER BY a.biz_date`, [period, ...params], ctx),
        query(`SELECT a.period_month,
              sum(a.debt_total_mln)         AS debt_total_mln,
              sum(a.consumers_active)       AS consumers_active,
              sum(a.consumers_disconnected) AS consumers_disconnected,
              sum(a.tp_total)               AS tp_total
       FROM agg.mfy_monthly a
       WHERE a.period_month <= ($1 || '-01')::date
         AND a.period_month >  (($1 || '-01')::date - INTERVAL '12 months')::date
         ${clause}
       GROUP BY a.period_month ORDER BY a.period_month`, [period, ...params], ctx),
    ]);
    return {
        kwhIn: daily.map((r) => Number(r.kwh_in)),
        kwhSold: daily.map((r) => Number(r.kwh_sold)),
        lossPct: daily.map((r) => Number(r.loss_pct ?? 0)),
        naturalPct: daily.map((r) => Number(r.natural_pct ?? 0)),
        debt: monthly.map((r) => Number(r.debt_total_mln ?? 0)),
        consumersActive: monthly.map((r) => Number(r.consumers_active ?? 0)),
        consumersDisconnected: monthly.map((r) => Number(r.consumers_disconnected ?? 0)),
        tpCount: monthly.map((r) => Number(r.tp_total ?? 0)),
    };
}
const pctDelta = (cur, prev) => prev === 0 || !Number.isFinite(prev) ? null : Number((((cur - prev) / prev) * 100).toFixed(2));
export async function districtOverview(ctx, period, mfyId = null, elektrosetId = null) {
    const prevPeriod = shiftMonth(period, -1);
    const [cur, prev, spark] = await Promise.all([
        periodTotals(ctx, period, mfyId, elektrosetId),
        periodTotals(ctx, prevPeriod, mfyId, elektrosetId),
        sparklines(ctx, period, mfyId, elektrosetId),
    ]);
    if (!cur)
        return null;
    const p = prev ?? cur;
    /**
     * Kartani bir joyda quramiz — `prevValue` va `deltaPct` DOIM bitta
     * manbadan chiqadi. Ilgari har biri alohida yozilgani uchun solishtirish
     * qiymatini qo'shishni unutish oson edi.
     */
    const tile = (t) => ({
        key: t.key,
        metric: t.metric,
        labelUz: t.labelUz,
        unit: t.unit,
        value: t.value,
        prevValue: t.prev,
        prevPeriod,
        deltaPct: pctDelta(t.value ?? 0, t.prev ?? 0),
        goodDirection: t.goodDirection,
        spark: t.spark,
        sparkBucket: t.sparkBucket,
    });
    const tiles = [
        tile({
            key: 'kwhIn', metric: 'kwhIn', labelUz: 'Jami iste’mol', unit: 'kWh',
            value: cur.kwh_in, prev: p.kwh_in,
            goodDirection: 'down', spark: spark.kwhIn, sparkBucket: 'day',
        }),
        tile({
            key: 'kwhSold', metric: 'kwhSold', labelUz: 'Sotilgan elektr energiyasi', unit: 'kWh',
            value: cur.kwh_sold, prev: p.kwh_sold,
            goodDirection: 'up', spark: spark.kwhSold, sparkBucket: 'day',
        }),
        tile({
            key: 'lossPct', metric: 'lossPct', labelUz: 'Jami yo’qotish', unit: '%',
            value: cur.loss_pct, prev: p.loss_pct,
            goodDirection: 'down', spark: spark.lossPct, sparkBucket: 'day',
        }),
        tile({
            key: 'naturalPct', metric: 'naturalLossPct', labelUz: 'Texnologik yo‘qotish', unit: '%',
            value: cur.natural_pct, prev: p.natural_pct,
            goodDirection: 'down', spark: spark.naturalPct, sparkBucket: 'day',
        }),
        tile({
            key: 'debt', metric: 'debtTotalMln', labelUz: 'Qarzdorlik', unit: 'mln so‘m',
            value: cur.debt_total_mln, prev: p.debt_total_mln,
            goodDirection: 'down', spark: spark.debt, sparkBucket: 'month',
        }),
        tile({
            key: 'consumersActive', metric: 'consumersActive', labelUz: 'Aloqaga chiqayotgan istemolchilar', unit: 'ta',
            value: cur.consumers_active, prev: p.consumers_active,
            goodDirection: 'up', spark: spark.consumersActive, sparkBucket: 'month',
        }),
        tile({
            key: 'consumersDisconnected', metric: 'consumersDisconnected',
            labelUz: 'Aloqaga chiqmayotgan istemolchilar', unit: 'ta',
            value: cur.consumers_disconnected, prev: p.consumers_disconnected,
            goodDirection: 'down', spark: spark.consumersDisconnected, sparkBucket: 'month',
        }),
        tile({
            key: 'tpCount', metric: 'tpCount', labelUz: 'Transformatorlar', unit: 'ta',
            value: cur.tp_total, prev: p.tp_total,
            goodDirection: 'up', spark: spark.tpCount, sparkBucket: 'month',
        }),
    ];
    return { period, prevPeriod, tiles, totals: cur };
}
function shiftMonth(period, delta) {
    const [y, m] = period.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
// ═══════════════════════════════════════════════════════════════════════════
// Energiya balansi (sankey)
// ═══════════════════════════════════════════════════════════════════════════
export async function energyBalance(ctx, period, mfyId = null) {
    const t = await periodTotals(ctx, period, mfyId, null);
    if (!t || t.kwh_in <= 0)
        return [];
    const pct = (v) => Number(((v / t.kwh_in) * 100).toFixed(2));
    const natural = t.kwh_loss_total * ((t.natural_pct ?? 0) / (t.loss_pct || 1));
    const technical = t.kwh_loss_total * ((t.technical_pct ?? 0) / (t.loss_pct || 1));
    const illegal = Math.max(0, t.kwh_loss_total - natural - technical);
    return [
        { key: 'in', labelUz: 'Tarmoqqa kirgan energiya', kwh: t.kwh_in, pct: 100 },
        { key: 'sold', labelUz: 'Sotilgan energiya', kwh: t.kwh_sold, pct: pct(t.kwh_sold) },
        { key: 'natural', labelUz: 'Tabiiy yo‘qotish', kwh: natural, pct: pct(natural) },
        { key: 'technical', labelUz: 'Texnik yo‘qotish', kwh: technical, pct: pct(technical) },
        { key: 'illegal', labelUz: 'Noqonuniy foydalanish', kwh: illegal, pct: pct(illegal) },
    ];
}
// ═══════════════════════════════════════════════════════════════════════════
// Samaradorlik indeksi
// ═══════════════════════════════════════════════════════════════════════════
const COMPONENT_LABELS = {
    c_loss: { labelUz: 'Yo‘qotish darajasi', weight: 0.35 },
    c_debt: { labelUz: 'Qarzdorlik holati', weight: 0.2 },
    c_meter: { labelUz: 'Hisoblagichlar aloqasi', weight: 0.15 },
    c_tp: { labelUz: 'TP yuklamasi', weight: 0.15 },
    c_distance: { labelUz: 'TP → iste’molchi masofasi', weight: 0.15 },
};
export async function efficiency(ctx, period, mfyId = null) {
    const scope = mfyId !== null ? 'MFY' : 'TUMAN';
    const row = await queryOne(`SELECT * FROM agg.efficiency_index($1, $2, ($3 || '-01')::date)`, [scope, mfyId, period], ctx);
    if (!row)
        return null;
    const components = Object.entries(COMPONENT_LABELS).map(([key, meta]) => ({
        key: key.replace('c_', ''),
        labelUz: meta.labelUz,
        weight: meta.weight,
        score: Number(row[key] ?? 0),
    }));
    // Statistik prognoz: oxirgi 12 oylik yo'qotish trendi bo'yicha chiziqli ekstrapolyatsiya.
    const hist = await query(`SELECT to_char(a.period_month, 'YYYY-MM') AS p,
            round(100 * sum(a.kwh_loss_total) / nullif(sum(a.kwh_in), 0), 2) AS loss_pct
     FROM agg.mfy_monthly a
     WHERE a.period_month <= ($1 || '-01')::date
       AND a.period_month >  ($1 || '-01')::date - INTERVAL '12 months'
       AND ($2::int IS NULL OR a.mfy_id = $2)
     GROUP BY 1 ORDER BY 1`, [period, mfyId], ctx);
    const forecast = linearForecast(hist.map((h) => Number(h.loss_pct)), period, 6);
    return { score: Number(row['score'] ?? 0), components, forecast };
}
/** Eng kichik kvadratlar usuli bilan chiziqli trend ekstrapolyatsiyasi. */
function linearForecast(values, fromPeriod, steps) {
    if (values.length < 4)
        return null;
    const n = values.length;
    const meanX = (n - 1) / 2;
    const meanY = values.reduce((a, b) => a + b, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i += 1) {
        num += (i - meanX) * (values[i] - meanY);
        den += (i - meanX) ** 2;
    }
    const slope = den === 0 ? 0 : num / den;
    const intercept = meanY - slope * meanX;
    return Array.from({ length: steps }, (_, k) => ({
        period: shiftMonth(fromPeriod, k + 1),
        lossPct: Number(Math.max(0, intercept + slope * (n + k)).toFixed(2)),
    }));
}
// ═══════════════════════════════════════════════════════════════════════════
// MFY reytingi
// ═══════════════════════════════════════════════════════════════════════════
export async function mfyRanking(ctx, date) {
    const rows = await query(`SELECT * FROM agg.mfy_loss_rank($1::date)`, [date], ctx);
    return rows.map((r) => ({
        mfyId: r.mfy_id, nameUz: r.name_uz,
        lossPct: Number(r.loss_pct), prevLossPct: r.prev_loss_pct === null ? null : Number(r.prev_loss_pct),
        deltaPp: r.delta_pp === null ? null : Number(r.delta_pp),
        rank: r.rnk, prevRank: r.prev_rnk, rankDelta: r.rank_delta,
        trend: r.trend,
    }));
}
/** Reyting poygasi (bump chart) — oylar bo'yicha o'rin o'zgarishi. */
export async function rankingHistory(ctx, period, months = 12) {
    const rows = await query(`SELECT a.mfy_id, m.name_uz, to_char(a.period_month, 'YYYY-MM') AS p,
            rank() OVER (PARTITION BY a.period_month ORDER BY
              100 * a.kwh_loss_total / nullif(a.kwh_in, 0) DESC)::int AS rnk,
            round(100 * a.kwh_loss_total / nullif(a.kwh_in, 0), 2) AS loss_pct
     FROM agg.mfy_monthly a
     JOIN ref.mfy m ON m.id = a.mfy_id
     WHERE a.kwh_in > 0
       AND a.period_month <= ($1 || '-01')::date
       AND a.period_month >  ($1 || '-01')::date - ($2 || ' months')::interval
     ORDER BY a.period_month, rnk`, [period, months], ctx);
    const byMfy = new Map();
    for (const r of rows) {
        let entry = byMfy.get(r.mfy_id);
        if (!entry) {
            entry = { mfyId: r.mfy_id, nameUz: r.name_uz, points: [] };
            byMfy.set(r.mfy_id, entry);
        }
        entry.points.push({ period: r.p, rank: r.rnk, lossPct: Number(r.loss_pct) });
    }
    return [...byMfy.values()];
}
// ═══════════════════════════════════════════════════════════════════════════
// Texnik yo'qotish: standart vs amaldagi
// ═══════════════════════════════════════════════════════════════════════════
export async function technicalLoss(ctx, period) {
    const rows = await query(`SELECT mfy_id, name_uz, actual_pct, standard_pct, gap_pp, status
      FROM agg.v_technical_loss_gap
      WHERE period_month = ($1 || '-01')::date
      ORDER BY gap_pp DESC`, [period], ctx);
    return rows.map((r) => ({
        mfyId: r.mfy_id, nameUz: r.name_uz,
        actualPct: Number(r.actual_pct), standardPct: Number(r.standard_pct),
        gapPp: Number(r.gap_pp), status: r.status,
    }));
}
// ═══════════════════════════════════════════════════════════════════════════
// Masofa analitikasi (TR → iste'molchi)
// ═══════════════════════════════════════════════════════════════════════════
export async function distanceAnalytics(ctx, period) {
    const rows = await query(`SELECT t.mfy_id, m.name_uz,
             round(avg(t.avg_distance_m), 0) AS avg_distance_m,
             max(ref.norm_value('TP_MAX_DISTANCE_M', t.mfy_id, ($1 || '-01')::date)) AS standard_m,
             count(*)::int AS tp_count,
             count(*) FILTER (
               WHERE t.avg_distance_m > ref.norm_value('TP_MAX_DISTANCE_M', t.mfy_id, ($1 || '-01')::date)
             )::int AS tp_over
      FROM ref.tp t
      JOIN ref.mfy m ON m.id = t.mfy_id
      WHERE t.decommissioned_on IS NULL AND t.avg_distance_m IS NOT NULL
      GROUP BY t.mfy_id, m.name_uz
      ORDER BY avg_distance_m DESC`, [period], ctx);
    return rows.map((r) => ({
        mfyId: r.mfy_id, nameUz: r.name_uz,
        avgDistanceM: Number(r.avg_distance_m), standardM: Number(r.standard_m),
        compliant: Number(r.avg_distance_m) <= Number(r.standard_m),
        tpCount: r.tp_count, tpOverStandard: r.tp_over,
    }));
}
// ═══════════════════════════════════════════════════════════════════════════
// Transformator monitoringi
// ═══════════════════════════════════════════════════════════════════════════
export async function tpMonitoring(ctx, period, mfyId = null, limit = 200) {
    const rows = await query(`SELECT tp_id, code, mfy_id, mfy_name, rated_kva, load_pct, optimal_pct,
             condition, avg_distance_m, distance_compliant
      FROM agg.tp_monthly
      WHERE period_month = ($1 || '-01')::date
        AND ($2::int IS NULL OR mfy_id = $2)
      ORDER BY load_pct DESC
      LIMIT $3`, [period, mfyId, limit], ctx);
    return rows.map((r) => ({
        tpId: r.tp_id, code: r.code, mfyId: r.mfy_id, mfyName: r.mfy_name,
        ratedKva: Number(r.rated_kva), loadPct: Number(r.load_pct),
        optimalPct: Number(r.optimal_pct ?? 70), condition: r.condition,
        avgDistanceM: r.avg_distance_m === null ? null : Number(r.avg_distance_m),
        distanceCompliant: r.distance_compliant,
    }));
}
// ═══════════════════════════════════════════════════════════════════════════
// Qarzdorlik
// ═══════════════════════════════════════════════════════════════════════════
export async function debtBreakdown(ctx, period, mfyId = null) {
    const t = await periodTotals(ctx, period, mfyId, null);
    const total = t?.debt_total_mln ?? 0;
    const share = (v) => (total > 0 ? Number(((v / total) * 100).toFixed(1)) : 0);
    const topDebtors = await query(`SELECT d.rank, d.debtor_name, d.category, d.amount_mln, m.name_uz AS mfy_name
      FROM fact.debt_top_entry d
      JOIN fact.submission s ON s.id = d.submission_id AND s.status = 'approved'
      JOIN ref.mfy m ON m.id = d.mfy_id
      WHERE d.period_month = ($1 || '-01')::date
        AND ($2::int IS NULL OR d.mfy_id = $2)
      ORDER BY d.amount_mln DESC
      LIMIT 5`, [period, mfyId], ctx);
    return {
        totalMln: total,
        byCategory: [
            { category: 'POPULATION', labelUz: 'Aholi', amountMln: t?.debt_population_mln ?? 0, pct: share(t?.debt_population_mln ?? 0) },
            { category: 'LEGAL', labelUz: 'Yuridik', amountMln: t?.debt_legal_mln ?? 0, pct: share(t?.debt_legal_mln ?? 0) },
            { category: 'BUDGET', labelUz: 'Budjet tashkilotlari', amountMln: t?.debt_budget_mln ?? 0, pct: share(t?.debt_budget_mln ?? 0) },
        ],
        topDebtors: topDebtors.map((d, i) => ({
            rank: i + 1, debtorName: d.debtor_name,
            category: d.category,
            amountMln: Number(d.amount_mln), mfyName: d.mfy_name,
        })),
    };
}
// ═══════════════════════════════════════════════════════════════════════════
// Yo'qotish xaritasi (treemap) — XARITA EMAS, geo ma'lumot ishlatilmaydi
// ═══════════════════════════════════════════════════════════════════════════
export async function lossMap(ctx, period) {
    const rows = await query(`SELECT a.mfy_id, m.name_uz, m.short_name, m.grid_row, m.grid_col,
             a.kwh_in, a.loss_pct,
             coalesce(a.total_loss_target_pct, 8.0) AS norm_pct
      FROM agg.mfy_monthly a
      JOIN ref.mfy m ON m.id = a.mfy_id
      WHERE a.period_month = ($1 || '-01')::date AND a.kwh_in > 0
      ORDER BY a.kwh_in DESC`, [period], ctx);
    return rows.map((r) => {
        const lossPct = Number(r.loss_pct ?? 0);
        const normPct = Number(r.norm_pct ?? 8);
        const gapPp = Number((lossPct - normPct).toFixed(2));
        const ratio = normPct > 0 ? lossPct / normPct : 1;
        const status = ratio <= 1 ? 'good' : ratio <= 1.25 ? 'warning' : ratio <= 1.6 ? 'serious' : 'critical';
        return {
            mfyId: r.mfy_id, nameUz: r.name_uz, shortName: r.short_name,
            kwhIn: Number(r.kwh_in), lossPct, normPct, gapPp, status,
            gridRow: r.grid_row, gridCol: r.grid_col,
        };
    });
}
// ═══════════════════════════════════════════════════════════════════════════
// Ishlar
// ═══════════════════════════════════════════════════════════════════════════
export async function works(ctx, mfyId = null, status = null, limit = 100) {
    const rows = await query(`SELECT w.id, w.mfy_id, m.name_uz AS mfy_name, t.code AS tp_code, w.work_type,
            w.title_uz, w.status, w.planned_start, w.planned_end, w.actual_end,
            w.progress_pct, w.quantity, w.unit, w.cost_mln,
            w.effect_loss_pct_before, w.effect_loss_pct_after, w.effect_saving_kwh_month
     FROM fact.work w
     JOIN ref.mfy m ON m.id = w.mfy_id
     LEFT JOIN ref.tp t ON t.id = w.tp_id
     WHERE ($1::int IS NULL OR w.mfy_id = $1)
       AND ($2::text IS NULL OR w.status = $2)
     ORDER BY
       CASE w.status WHEN 'IN_PROGRESS' THEN 1 WHEN 'PLANNED' THEN 2 ELSE 3 END,
       coalesce(w.actual_end, w.planned_end) DESC NULLS LAST
     LIMIT $3`, [mfyId, status, limit], ctx);
    return rows.map((r) => ({
        id: Number(r['id']), mfyId: Number(r['mfy_id']), mfyName: String(r['mfy_name']),
        tpCode: r['tp_code'] ?? null,
        workType: r['work_type'],
        titleUz: String(r['title_uz']), status: r['status'],
        plannedStart: r['planned_start'] ?? null,
        plannedEnd: r['planned_end'] ?? null,
        actualEnd: r['actual_end'] ?? null,
        progressPct: Number(r['progress_pct']), quantity: Number(r['quantity']),
        unit: String(r['unit']), costMln: Number(r['cost_mln']),
        effectLossPctBefore: r['effect_loss_pct_before'] === null ? null : Number(r['effect_loss_pct_before']),
        effectLossPctAfter: r['effect_loss_pct_after'] === null ? null : Number(r['effect_loss_pct_after']),
        effectSavingKwhMonth: Number(r['effect_saving_kwh_month']),
    }));
}
// ═══════════════════════════════════════════════════════════════════════════
// Ogohlantirishlar — DETERMINISTIK SQL QOIDALARI (AI emas, LLM yo'q)
// ═══════════════════════════════════════════════════════════════════════════
export async function alerts(ctx, period) {
    const out = [];
    // 1. Yo'qotishi normadan keskin oshgan MFY lar
    const lossRows = await query(`SELECT a.mfy_id, m.name_uz, a.loss_pct, coalesce(a.total_loss_target_pct, 8.0) AS norm
     FROM agg.mfy_monthly a JOIN ref.mfy m ON m.id = a.mfy_id
     WHERE a.period_month = ($1 || '-01')::date AND a.kwh_in > 0
       AND a.loss_pct > coalesce(a.total_loss_target_pct, 8.0) * 1.6
     ORDER BY a.loss_pct DESC LIMIT 5`, [period], ctx);
    for (const r of lossRows) {
        out.push({
            id: `loss-${r.mfy_id}`, severity: 'critical', rule: 'LOSS_ABOVE_TARGET',
            titleUz: `${r.name_uz}da yo‘qotish ${Number(r.loss_pct).toFixed(1)}%`,
            detailUz: `Maqsadli ko‘rsatkich ${Number(r.norm).toFixed(1)}% — ${(Number(r.loss_pct) / Number(r.norm)).toFixed(1)} barobar oshgan.`,
            href: `/dashboard/mfy/${r.mfy_id}`, mfyId: r.mfy_id,
        });
    }
    // 2. Ortiqcha yuklangan transformatorlar
    const tpRow = await queryOne(`SELECT count(*)::int AS n, string_agg(DISTINCT mfy_name, ', ') AS mfys
     FROM agg.tp_monthly
     WHERE period_month = ($1 || '-01')::date AND load_pct >= coalesce(overload_pct, 90)`, [period], ctx);
    if (tpRow && tpRow.n > 0) {
        out.push({
            id: 'tp-overload', severity: 'serious', rule: 'TP_OVERLOAD',
            titleUz: `${tpRow.n} ta transformator ortiqcha yuklangan`,
            detailUz: `90% dan yuqori yuklama qayd etildi: ${tpRow.mfys ?? '—'}`,
            href: '/dashboard#tp', mfyId: null,
        });
    }
    // 3. Masofa normasini buzgan MFY lar
    const distRows = await query(`SELECT t.mfy_id, m.name_uz, round(avg(t.avg_distance_m), 0) AS avg_m
     FROM ref.tp t JOIN ref.mfy m ON m.id = t.mfy_id
     WHERE t.decommissioned_on IS NULL AND t.avg_distance_m IS NOT NULL
     GROUP BY 1, 2
     HAVING avg(t.avg_distance_m) > ref.norm_value('TP_MAX_DISTANCE_M', t.mfy_id, ($1 || '-01')::date)
     ORDER BY avg_m DESC LIMIT 3`, [period], ctx);
    for (const r of distRows) {
        out.push({
            id: `dist-${r.mfy_id}`, severity: 'warning', rule: 'DISTANCE_OVER_NORM',
            titleUz: `${r.name_uz}da TP → iste’molchi masofasi ${Number(r.avg_m)} m`,
            detailUz: 'Standart 300 m. Uzoq masofa texnik yo‘qotishni oshiradi.',
            href: `/dashboard/mfy/${r.mfy_id}`, mfyId: r.mfy_id,
        });
    }
    // 4. Ma'lumot yubormagan MFY lar (joriy oy)
    const missing = await query(`SELECT m.id AS mfy_id, m.name_uz,
            (CURRENT_DATE - coalesce(max(s.period_end), CURRENT_DATE - 60))::int AS days
     FROM ref.mfy m
     LEFT JOIN fact.submission s
       ON s.scope_id = m.id AND s.scope_type = 'MFY'
      AND s.domain = 'ENERGY_BALANCE' AND s.status = 'approved'
     WHERE m.valid_to IS NULL
     GROUP BY m.id, m.name_uz
     HAVING (CURRENT_DATE - coalesce(max(s.period_end), CURRENT_DATE - 60))::int > 40
     ORDER BY days DESC LIMIT 5`, [], ctx);
    for (const r of missing) {
        out.push({
            id: `late-${r.mfy_id}`, severity: 'warning', rule: 'SUBMISSION_LATE',
            titleUz: `${r.name_uz} ${r.days} kundan beri ma’lumot yubormadi`,
            detailUz: 'Tasdiqlangan energiya balansi yo‘q. Korxona bilan bog‘laning.',
            href: '/entry', mfyId: r.mfy_id,
        });
    }
    // 5. Qarzdorligi keskin o'sgan MFY lar
    const debtRows = await query(`WITH cur AS (
       SELECT mfy_id, debt_total_mln FROM agg.mfy_monthly
       WHERE period_month = ($1 || '-01')::date),
     prv AS (
       SELECT mfy_id, debt_total_mln FROM agg.mfy_monthly
       WHERE period_month = ($1 || '-01')::date - INTERVAL '1 month')
     SELECT c.mfy_id, m.name_uz, c.debt_total_mln AS debt,
            round(100 * (c.debt_total_mln - p.debt_total_mln) / nullif(p.debt_total_mln, 0), 1) AS growth
     FROM cur c JOIN prv p ON p.mfy_id = c.mfy_id JOIN ref.mfy m ON m.id = c.mfy_id
     WHERE p.debt_total_mln > 0
       AND (c.debt_total_mln - p.debt_total_mln) / p.debt_total_mln > 0.10
     ORDER BY growth DESC LIMIT 3`, [period], ctx);
    for (const r of debtRows) {
        out.push({
            id: `debt-${r.mfy_id}`, severity: 'serious', rule: 'DEBT_GROWTH',
            titleUz: `${r.name_uz}da qarzdorlik ${Number(r.growth)}% o‘sdi`,
            detailUz: `Joriy qarzdorlik ${Number(r.debt).toFixed(1)} mln so‘m.`,
            href: `/dashboard/mfy/${r.mfy_id}`, mfyId: r.mfy_id,
        });
    }
    const order = { critical: 0, serious: 1, warning: 2, info: 3 };
    return out.sort((a, b) => order[a.severity] - order[b.severity]);
}
// ═══════════════════════════════════════════════════════════════════════════
// Vaqt qatorlari
// ═══════════════════════════════════════════════════════════════════════════
export async function timeSeries(ctx, from, to, bucket, mfyId = null) {
    const trunc = bucket === 'day' ? 'day' : bucket === 'week' ? 'week' : 'month';
    const rows = await query(`SELECT date_trunc($3, a.biz_date)::date::text AS d,
             sum(a.kwh_in) AS kwh_in, sum(a.kwh_sold) AS kwh_sold,
             sum(a.kwh_loss_total) AS kwh_loss,
             CASE WHEN sum(a.kwh_in) > 0
                  THEN round(100 * sum(a.kwh_loss_total) / sum(a.kwh_in), 2) END AS loss_pct
      FROM agg.mfy_daily a
      WHERE a.biz_date BETWEEN $1::date AND $2::date
        AND ($4::int IS NULL OR a.mfy_id = $4)
      GROUP BY 1 ORDER BY 1`, [from, to, trunc, mfyId], ctx);
    return rows.map((r) => ({
        date: r.d, kwhIn: Number(r.kwh_in), kwhSold: Number(r.kwh_sold),
        kwhLoss: Number(r.kwh_loss), lossPct: Number(r.loss_pct ?? 0),
    }));
}
// ═══════════════════════════════════════════════════════════════════════════
// MFY paneli uchun maxsus so'rovlar
// ═══════════════════════════════════════════════════════════════════════════
export async function capacity(ctx, mfyId, period) {
    const t = await periodTotals(ctx, period, mfyId, null);
    const cap = t?.capacity_kva ?? 0;
    const used = t?.used_kva ?? 0;
    return {
        capacityKva: cap, currentKva: used, reserveKva: Math.max(0, cap - used),
        loadPct: cap > 0 ? Number(((used / cap) * 100).toFixed(1)) : 0,
    };
}
export async function consumers(ctx, mfyId, period) {
    const t = await periodTotals(ctx, period, mfyId, null);
    return {
        total: t?.consumers_total ?? 0, active: t?.consumers_active ?? 0,
        disconnected: t?.consumers_disconnected ?? 0, new: t?.consumers_new ?? 0,
        population: t?.consumers_population ?? 0, legal: t?.consumers_legal ?? 0,
    };
}
export async function lossStructure(ctx, period, mfyId = null) {
    const { clause, params } = scopeFilter(mfyId, null);
    const row = await queryOne(`SELECT coalesce(sum(a.kwh_loss_natural), 0)   AS nat,
            coalesce(sum(a.kwh_loss_technical), 0) AS tech,
            coalesce(sum(a.kwh_loss_illegal), 0)   AS ill,
            coalesce(sum(a.kwh_loss_total), 0)     AS total
     FROM agg.mfy_monthly a
     WHERE a.period_month = ($1 || '-01')::date ${clause}`, [period, ...params], ctx);
    const total = row?.total ?? 0;
    const pct = (v) => (total > 0 ? Number(((v / total) * 100).toFixed(1)) : 0);
    return {
        totalKwh: total,
        parts: [
            { key: 'natural', labelUz: 'Tabiiy yo‘qotish', kwh: row?.nat ?? 0, pct: pct(row?.nat ?? 0) },
            { key: 'technical', labelUz: 'Texnik yo‘qotish', kwh: row?.tech ?? 0, pct: pct(row?.tech ?? 0) },
            { key: 'illegal', labelUz: 'Noqonuniy foydalanish', kwh: row?.ill ?? 0, pct: pct(row?.ill ?? 0) },
        ],
    };
}
export async function operational(ctx, mfyId, period) {
    const row = await queryOne(`SELECT max(r.max_load_kw) AS max_kw, min(r.min_load_kw) AS min_kw,
             round(avg(r.avg_voltage_v), 1) AS avg_v,
             sum(r.outage_count)::int AS outages, sum(r.outage_minutes)::int AS minutes
      FROM fact.tp_reading_daily r
      JOIN ref.tp t ON t.id = r.tp_id
      WHERE t.mfy_id = $1
        AND r.biz_date >= ($2 || '-01')::date
        AND r.biz_date <  (($2 || '-01')::date + INTERVAL '1 month')`, [mfyId, period], ctx);
    const nominal = await queryOne(`SELECT ref.norm_value('VOLTAGE_NOMINAL_V', $1, ($2 || '-01')::date) AS v`, [mfyId, period], ctx);
    return {
        maxLoadKw: row?.max_kw === null || row?.max_kw === undefined ? null : Number(row.max_kw),
        minLoadKw: row?.min_kw === null || row?.min_kw === undefined ? null : Number(row.min_kw),
        avgVoltageV: row?.avg_v === null || row?.avg_v === undefined ? null : Number(row.avg_v),
        outageCount: row?.outages ?? null,
        outageMinutes: row?.minutes ?? null,
        nominalVoltageV: Number(nominal?.v ?? 220),
    };
}
export async function results(ctx, mfyId, period, months = 12) {
    const rows = await query(`SELECT to_char(a.period_month, 'YYYY-MM') AS p,
            round(100 * sum(a.kwh_loss_total) / nullif(sum(a.kwh_in), 0), 2) AS loss_pct
     FROM agg.mfy_monthly a
     WHERE a.period_month <= ($1 || '-01')::date
       AND a.period_month >  ($1 || '-01')::date - ($2 || ' months')::interval
       AND ($3::int IS NULL OR a.mfy_id = $3)
     GROUP BY 1 ORDER BY 1`, [period, months, mfyId], ctx);
    const saved = await queryOne(`SELECT coalesce(sum(effect_saving_kwh_month), 0) AS kwh
     FROM fact.work
     WHERE status = 'COMPLETED' AND ($1::int IS NULL OR mfy_id = $1)
       AND actual_end > ($2 || '-01')::date - ($3 || ' months')::interval`, [mfyId, period, months], ctx);
    const first = rows[0];
    const last = rows.at(-1);
    return {
        lossPctStart: first ? Number(first.loss_pct) : null,
        lossPctEnd: last ? Number(last.loss_pct) : null,
        improvementPp: first && last ? Number((Number(first.loss_pct) - Number(last.loss_pct)).toFixed(2)) : null,
        savedKwh: Number(saved?.kwh ?? 0),
        periodFrom: first?.p ?? period,
        periodTo: last?.p ?? period,
    };
}
