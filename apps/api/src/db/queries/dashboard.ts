/**
 * Dashboard o'qish modellari.
 *
 * Qoida: bitta HTTP so'rov = bitta panel GURUHI. Panel boshiga so'rov EMAS.
 * Barcha SQL qo'lda yozilgan va shu yerda - grep qilinadi, EXPLAIN qilinadi.
 */
import type {
  CapacityInfo, ConsumerBreakdown, DebtBreakdown, EfficiencyBreakdown,
  EnergyBalanceNode, FeederMonthly, KpiTile, LossMapCell, LossStructure,
  OperationalMetrics, RagStatus, ResultsSummary, TechnicalLossRow, TimeSeriesPoint,
  TpMonitorRow, TpMonthlyRow, ViolationActRow, ViolationSummary, Work, WorkDetail,
  WorkRow, WorkStatus,
} from '@beap/shared';
import { VIOLATION_CASE_LABEL_UZ, VIOLATION_CASE_TYPES } from '@beap/shared';

import { type AppContext, isPgError, query, queryOne, withTransaction } from '../pool.ts';

// ═══════════════════════════════════════════════════════════════════════════
// Davr yordamchilari
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Dashboard uchun standart davr.
 *
 * DIQQAT: bu shunchaki `max(period_month)` EMAS. Joriy oy odatda qisman
 * to'ldirilgan bo'ladi (bir-ikki MFY bir necha kun kiritgan) - uni ko'rsatish
 * hokimga "abonentlar 0 ta, yo'qotish 6%" degan YOLG'ON manzara beradi.
 *
 * Shuning uchun MFY larning kamida yarmida ma'lumot bo'lgan eng so'nggi oy
 * tanlanadi. To'liq bo'lmagan joriy oyni davr tanlagich orqali qo'lda
 * ko'rish mumkin.
 */
export async function latestPeriod(ctx: AppContext): Promise<string | null> {
  const row = await queryOne<{ p: string }>(
    `SELECT to_char(a.period_month, 'YYYY-MM') AS p
     FROM agg.mfy_monthly a
     WHERE a.days_filled > 0
     GROUP BY a.period_month
     HAVING count(*) >= GREATEST(1,
       (SELECT count(*) FROM ref.mfy WHERE valid_to IS NULL) / 2)
     ORDER BY a.period_month DESC
     LIMIT 1`,
    [], ctx,
  );
  if (row?.p) return row.p;

  // Zaxira: hech qanday oy mezonga javob bermasa - mavjud eng so'nggisi.
  const fallback = await queryOne<{ p: string }>(
    `SELECT to_char(max(period_month), 'YYYY-MM') AS p FROM agg.mfy_monthly WHERE days_filled > 0`,
    [], ctx,
  );
  return fallback?.p ?? null;
}

/**
 * Berilgan oydagi ma'lumot mavjud eng so'nggi kun.
 * Reyting paneli shu kunni "bugun" deb oladi - qisman to'ldirilgan joriy
 * oyning tasodifiy kuni emas.
 */
export async function latestDateInPeriod(ctx: AppContext, period: string): Promise<string | null> {
  const row = await queryOne<{ d: string | null }>(
    `SELECT max(biz_date)::text AS d
     FROM agg.mfy_daily
     WHERE biz_date >= ($1 || '-01')::date
       AND biz_date <  (($1 || '-01')::date + INTERVAL '1 month')`,
    [period], ctx,
  );
  return row?.d ?? null;
}

export async function dataRange(ctx: AppContext): Promise<{ minDate: string | null; maxDate: string | null }> {
  const row = await queryOne<{ min_date: string | null; max_date: string | null }>(
    `SELECT min(biz_date)::text AS min_date, max(biz_date)::text AS max_date FROM agg.mfy_daily`,
    [], ctx,
  );
  return { minDate: row?.min_date ?? null, maxDate: row?.max_date ?? null };
}

/** `scope` filtri uchun WHERE bo'lagi va parametrlari. */
function scopeFilter(mfyId: number | null, elektrosetId: number | null): { clause: string; params: unknown[] } {
  if (mfyId !== null) return { clause: 'AND a.mfy_id = $2', params: [mfyId] };
  if (elektrosetId !== null) return { clause: 'AND a.elektroset_id = $2', params: [elektrosetId] };
  return { clause: '', params: [] };
}

// ═══════════════════════════════════════════════════════════════════════════
// KPI kartalari
// ═══════════════════════════════════════════════════════════════════════════

interface PeriodTotals {
  kwh_in: number; kwh_sold: number; kwh_loss_total: number;
  kwh_loss_natural: number; kwh_loss_technical: number; kwh_loss_illegal: number;
  loss_pct: number | null;
  natural_pct: number | null; technical_pct: number | null; illegal_pct: number | null;
  consumers_total: number; consumers_active: number; consumers_disconnected: number;
  consumers_new: number; consumers_population: number; consumers_legal: number;
  debt_total_mln: number; debt_population_mln: number; debt_legal_mln: number; debt_budget_mln: number;
  tp_total: number; tp_overloaded: number; meters_offline_cnt: number;
  capacity_kva: number; used_kva: number;
  natural_norm_pct: number | null; technical_std_pct: number | null;
  /** Shu davrda kunlik ma'lumot kiritilgan kunlar soni - oy hali tugamagan bo'lishi mumkin. */
  days_filled: number;
}

const TOTALS_SELECT = `
  coalesce(sum(a.kwh_in), 0)              AS kwh_in,
  coalesce(sum(a.kwh_sold), 0)            AS kwh_sold,
  coalesce(sum(a.kwh_loss_total), 0)      AS kwh_loss_total,
  coalesce(sum(a.kwh_loss_natural), 0)    AS kwh_loss_natural,
  coalesce(sum(a.kwh_loss_technical), 0)  AS kwh_loss_technical,
  coalesce(sum(a.kwh_loss_illegal), 0)    AS kwh_loss_illegal,
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
  max(a.technical_std_pct)                   AS technical_std_pct,
  max(a.days_filled)::int                    AS days_filled
`;

async function periodTotals(
  ctx: AppContext, period: string, mfyId: number | null, elektrosetId: number | null,
): Promise<PeriodTotals | null> {
  const { clause, params } = scopeFilter(mfyId, elektrosetId);
  const totals = await queryOne<PeriodTotals>(
    `SELECT ${TOTALS_SELECT}
     FROM agg.mfy_monthly a
     WHERE a.period_month = ($1 || '-01')::date ${clause}`,
    [period, ...params], ctx,
  );
  if (!totals) return null;

  /*
   * TP soni va quvvati REGISTRDAN olinadi, oylik holat hisobotidan emas.
   *
   * `agg.mfy_monthly` dagi `tp_total` - o'sha oyda HOLATI KIRITILGAN TP lar
   * soni. Holat hisoboti hali kelmagan bo'lsa u 0 chiqadi va hokim "tumanda
   * transformator yo'q" degan manzarani ko'radi. Nechta TP borligi esa
   * registrda aniq turadi - savol "qancha bor?", "qanchasi hisobot berdi?"
   * emas. Quvvat ham shu yerdan: u TP pasportining xossasi.
   */
  const reg = await queryOne<{ tp_cnt: number; kva: number | null }>(
    `SELECT count(*)::int AS tp_cnt, sum(t.rated_kva) AS kva
       FROM ref.tp t
       JOIN ref.mfy m ON m.id = t.mfy_id
      WHERE t.decommissioned_on IS NULL
        AND ($1::int IS NULL OR m.id = $1)
        AND ($2::int IS NULL OR m.elektroset_id = $2)`,
    [mfyId, elektrosetId], ctx,
  );

  return {
    ...totals,
    tp_total: reg?.tp_cnt ?? 0,
    capacity_kva: reg?.kva === null || reg?.kva === undefined ? 0 : Number(reg.kva),
  };
}

/** Oxirgi 30 kunlik qiymatlar - sparkline uchun. */
interface Sparks {
  kwhIn: number[]; kwhSold: number[]; kwhLoss: number[]; kwhLossTechnical: number[];
  consumersTotal: number[]; consumersActive: number[];
  consumersDisconnected: number[]; tpCount: number[];
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
async function sparklines(
  ctx: AppContext, period: string, mfyId: number | null, elektrosetId: number | null,
): Promise<Sparks> {
  const { clause, params } = scopeFilter(mfyId, elektrosetId);

  const [daily, monthly] = await Promise.all([
    query<{
      kwh_in: number; kwh_sold: number; kwh_loss_total: number; kwh_loss_technical: number;
    }>(
      `SELECT a.biz_date,
              sum(a.kwh_in)             AS kwh_in,
              sum(a.kwh_sold)           AS kwh_sold,
              sum(a.kwh_loss_total)     AS kwh_loss_total,
              sum(a.kwh_loss_technical) AS kwh_loss_technical
       FROM agg.mfy_daily a
       WHERE a.biz_date <= (($1 || '-01')::date + INTERVAL '1 month' - INTERVAL '1 day')::date
         AND a.biz_date >  (($1 || '-01')::date + INTERVAL '1 month' - INTERVAL '31 days')::date
         ${clause}
       GROUP BY a.biz_date ORDER BY a.biz_date`,
      [period, ...params], ctx,
    ),
    query<{
      consumers_total: number; consumers_active: number;
      consumers_disconnected: number; tp_total: number;
    }>(
      `SELECT a.period_month,
              sum(a.consumers_total)        AS consumers_total,
              sum(a.consumers_active)       AS consumers_active,
              sum(a.consumers_disconnected) AS consumers_disconnected,
              sum(a.tp_total)               AS tp_total
       FROM agg.mfy_monthly a
       WHERE a.period_month <= ($1 || '-01')::date
         AND a.period_month >  (($1 || '-01')::date - INTERVAL '12 months')::date
         ${clause}
       GROUP BY a.period_month ORDER BY a.period_month`,
      [period, ...params], ctx,
    ),
  ]);

  return {
    kwhIn: daily.map((r) => Number(r.kwh_in)),
    kwhSold: daily.map((r) => Number(r.kwh_sold)),
    kwhLoss: daily.map((r) => Number(r.kwh_loss_total ?? 0)),
    kwhLossTechnical: daily.map((r) => Number(r.kwh_loss_technical ?? 0)),
    consumersTotal: monthly.map((r) => Number(r.consumers_total ?? 0)),
    consumersActive: monthly.map((r) => Number(r.consumers_active ?? 0)),
    consumersDisconnected: monthly.map((r) => Number(r.consumers_disconnected ?? 0)),
    tpCount: monthly.map((r) => Number(r.tp_total ?? 0)),
  };
}

const pctDelta = (cur: number, prev: number): number | null =>
  prev === 0 || !Number.isFinite(prev) ? null : Number((((cur - prev) / prev) * 100).toFixed(2));

/** Berilgan "YYYY-MM" davrida necha kun borligi. */
export function daysInMonth(period: string): number {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y!, m!, 0)).getUTCDate();
}

/**
 * Berilgan davrning boshidan `days` kunlik energiya yig'indisi.
 *
 * "O'tgan oyga nisbatan" solishtirish uchun: joriy oy hali tugamagan bo'lsa
 * (masalan, 5-kun), o'tgan oyning TO'LIQ jamini emas - xuddi shuncha kunlik
 * (1-kundan boshlab) qismini olish kerak, aks holda solishtirish adolatsiz
 * bo'ladi (31 kun vs 5 kun deyarli har doim "keskin kamaydi" ko'rsatadi).
 */
export async function dayAlignedEnergyTotals(
  ctx: AppContext, period: string, days: number, mfyId: number | null, elektrosetId: number | null,
): Promise<{ kwh_in: number; kwh_sold: number; kwh_loss_total: number; kwh_loss_technical: number }> {
  const scopeClause = mfyId !== null ? 'AND a.mfy_id = $3' : elektrosetId !== null ? 'AND a.elektroset_id = $3' : '';
  const params: unknown[] = [period, days];
  if (mfyId !== null) params.push(mfyId);
  else if (elektrosetId !== null) params.push(elektrosetId);

  const row = await queryOne<{
    kwh_in: number; kwh_sold: number; kwh_loss_total: number; kwh_loss_technical: number;
  }>(
    `SELECT coalesce(sum(a.kwh_in), 0)             AS kwh_in,
            coalesce(sum(a.kwh_sold), 0)           AS kwh_sold,
            coalesce(sum(a.kwh_loss_total), 0)     AS kwh_loss_total,
            coalesce(sum(a.kwh_loss_technical), 0) AS kwh_loss_technical
       FROM agg.mfy_daily a
      WHERE a.biz_date >= ($1 || '-01')::date
        AND a.biz_date <  ($1 || '-01')::date + make_interval(days => $2::int)
        ${scopeClause}`,
    params, ctx,
  );
  return {
    kwh_in: Number(row?.kwh_in ?? 0),
    kwh_sold: Number(row?.kwh_sold ?? 0),
    kwh_loss_total: Number(row?.kwh_loss_total ?? 0),
    kwh_loss_technical: Number(row?.kwh_loss_technical ?? 0),
  };
}

export interface OverviewResult {
  period: string;
  prevPeriod: string;
  tiles: KpiTile[];
  totals: PeriodTotals;
}

export async function districtOverview(
  ctx: AppContext, period: string, mfyId: number | null = null, elektrosetId: number | null = null,
): Promise<OverviewResult | null> {
  const prevPeriod = shiftMonth(period, -1);
  const [cur, prev, spark] = await Promise.all([
    periodTotals(ctx, period, mfyId, elektrosetId),
    periodTotals(ctx, prevPeriod, mfyId, elektrosetId),
    sparklines(ctx, period, mfyId, elektrosetId),
  ]);
  if (!cur) return null;
  const p = prev ?? cur;

  /*
   * Joriy davr hali TUGAMAGAN bo'lishi mumkin (masalan, oyning 5-kuni) -
   * bunday paytda o'tgan OYNING TO'LIQ jamini solishtirish adolatsiz (31 kun
   * vs 5 kun deyarli har doim "keskin kamaydi" ko'rsatadi). Shu sababli
   * KUNLIK yig'iladigan energiya ko'rsatkichlari uchun o'tgan davrdan ham
   * FAQAT shuncha kunlik (1-kundan boshlab) qism olinadi - ikkalasi bir xil
   * "oyna" bilan solishtiriladi. Abonent/qarz/TP kabi OYLIK suratlar bunga
   * muhtoj emas - ular kun sayin yig'ilmaydi, oy davomida bir xil qoladi.
   */
  const curDays = cur.days_filled || daysInMonth(period);
  const prevMonthLen = daysInMonth(prevPeriod);
  const alignDays = Math.min(curDays, prevMonthLen);
  const isPartial = prev !== null && alignDays < prevMonthLen;
  const alignedPrev = isPartial
    ? await dayAlignedEnergyTotals(ctx, prevPeriod, alignDays, mfyId, elektrosetId)
    : null;

  /**
   * Kartani bir joyda quramiz - `prevValue` va `deltaPct` DOIM bitta
   * manbadan chiqadi. Ilgari har biri alohida yozilgani uchun solishtirish
   * qiymatini qo'shishni unutish oson edi.
   */
  const tile = (
    t: Pick<KpiTile, 'key' | 'metric' | 'labelUz' | 'unit' | 'goodDirection'> & {
      value: number | null;
      prev: number | null;
      spark: number[];
      sparkBucket: 'day' | 'month';
      daysCompared?: number | null;
    },
  ): KpiTile => ({
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
    daysCompared: t.daysCompared ?? null,
  });

  const tiles: KpiTile[] = [
    tile({
      key: 'kwhIn', metric: 'kwhIn', labelUz: 'Jami iste’mol', unit: 'kWh',
      value: cur.kwh_in, prev: alignedPrev?.kwh_in ?? p.kwh_in,
      goodDirection: 'down', spark: spark.kwhIn, sparkBucket: 'day',
      daysCompared: isPartial ? alignDays : null,
    }),
    tile({
      key: 'kwhSold', metric: 'kwhSold', labelUz: 'Foydali oqim', unit: 'kWh',
      value: cur.kwh_sold, prev: alignedPrev?.kwh_sold ?? p.kwh_sold,
      goodDirection: 'up', spark: spark.kwhSold, sparkBucket: 'day',
      daysCompared: isPartial ? alignDays : null,
    }),
    /*
     * Yo'qotish MIQDORDA beriladi, foizda emas.
     *
     * "34.8%" degan plitka yonidagi "1.0 mln kWh" bilan bir o'lchovda emas -
     * hokim ikkalasini solishtira olmaydi. Foiz plitkaning izohida qoladi,
     * asosiy raqam esa kWh: yo'qolgan energiyani foydali oqim bilan
     * bevosita taqqoslash mumkin bo'lsin.
     */
    tile({
      key: 'kwhLossTotal', metric: 'kwhLossTotal', labelUz: 'Jami yo’qotish', unit: 'kWh',
      value: cur.kwh_loss_total, prev: alignedPrev?.kwh_loss_total ?? p.kwh_loss_total,
      goodDirection: 'down', spark: spark.kwhLoss, sparkBucket: 'day',
      daysCompared: isPartial ? alignDays : null,
    }),
    tile({
      key: 'kwhLossTechnical', metric: 'kwhLossTechnical', labelUz: 'Texnologik yo‘qotish', unit: 'kWh',
      value: cur.kwh_loss_technical, prev: alignedPrev?.kwh_loss_technical ?? p.kwh_loss_technical,
      goodDirection: 'down', spark: spark.kwhLossTechnical, sparkBucket: 'day',
      daysCompared: isPartial ? alignDays : null,
    }),
    /*
     * Qarzdorlik o'rniga UMUMIY ABONENTLAR.
     *
     * Qarzdorlik manbasi fider darajasidagi hisobotlarda yo'q - plitka doim
     * "0.0 mln so'm" ko'rsatib turardi, bu esa "qarz yo'q" degan noto'g'ri
     * xulosaga olib keladi. Abonentlarning umumiy soni esa hisobotda bor va
     * yonidagi faol/uzilgan plitkalari uchun MAXRAJ bo'lib xizmat qiladi:
     * 3 441 va 124 raqamlari nimadan olingani shu bilan ko'rinadi.
     */
    tile({
      key: 'consumersTotal', metric: 'consumersTotal', labelUz: 'Umumiy abonentlar', unit: 'ta',
      value: cur.consumers_total, prev: p.consumers_total,
      goodDirection: 'up', spark: spark.consumersTotal, sparkBucket: 'month',
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

function shiftMonth(period: string, delta: number): string {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Energiya balansi (sankey)
// ═══════════════════════════════════════════════════════════════════════════

export async function energyBalance(
  ctx: AppContext, period: string, mfyId: number | null = null,
): Promise<EnergyBalanceNode[]> {
  const t = await periodTotals(ctx, period, mfyId, null);
  if (!t || t.kwh_in <= 0) return [];
  const pct = (v: number): number => Number(((v / t.kwh_in) * 100).toFixed(2));

  const natural = t.kwh_loss_total * ((t.natural_pct ?? 0) / (t.loss_pct || 1));
  const technical = t.kwh_loss_total * ((t.technical_pct ?? 0) / (t.loss_pct || 1));
  const illegal = Math.max(0, t.kwh_loss_total - natural - technical);

  return [
    { key: 'in',        labelUz: 'Tarmoqqa kirgan energiya', kwh: t.kwh_in,   pct: 100 },
    { key: 'sold',      labelUz: 'Foydali oqim',             kwh: t.kwh_sold, pct: pct(t.kwh_sold) },
    { key: 'natural',   labelUz: 'Tabiiy yo‘qotish',         kwh: natural,    pct: pct(natural) },
    { key: 'technical', labelUz: 'Texnik yo‘qotish',         kwh: technical,  pct: pct(technical) },
    { key: 'illegal',   labelUz: 'Noqonuniy foydalanish',    kwh: illegal,    pct: pct(illegal) },
  ];
}

// ═══════════════════════════════════════════════════════════════════════════
// Samaradorlik indeksi
// ═══════════════════════════════════════════════════════════════════════════

const COMPONENT_LABELS: Record<string, { labelUz: string; weight: number }> = {
  c_loss: { labelUz: 'Yo‘qotish darajasi', weight: 0.35 },
  c_debt: { labelUz: 'Qarzdorlik holati', weight: 0.2 },
  c_meter: { labelUz: 'Hisoblagichlar aloqasi', weight: 0.15 },
  c_tp: { labelUz: 'TP yuklamasi', weight: 0.15 },
  c_distance: { labelUz: 'TP → iste’molchi masofasi', weight: 0.15 },
};

export async function efficiency(
  ctx: AppContext, period: string, mfyId: number | null = null,
): Promise<EfficiencyBreakdown | null> {
  const scope = mfyId !== null ? 'MFY' : 'TUMAN';
  const row = await queryOne<Record<string, number>>(
    `SELECT * FROM agg.efficiency_index($1, $2, ($3 || '-01')::date)`,
    [scope, mfyId, period], ctx,
  );
  if (!row) return null;

  const components = Object.entries(COMPONENT_LABELS).map(([key, meta]) => ({
    key: key.replace('c_', ''),
    labelUz: meta.labelUz,
    weight: meta.weight,
    score: Number(row[key] ?? 0),
  }));

  // Statistik prognoz: oxirgi 12 oylik yo'qotish trendi bo'yicha chiziqli ekstrapolyatsiya.
  const hist = await query<{ p: string; loss_pct: number }>(
    `SELECT to_char(a.period_month, 'YYYY-MM') AS p,
            round(100 * sum(a.kwh_loss_total) / nullif(sum(a.kwh_in), 0), 2) AS loss_pct
     FROM agg.mfy_monthly a
     WHERE a.period_month <= ($1 || '-01')::date
       AND a.period_month >  ($1 || '-01')::date - INTERVAL '12 months'
       AND ($2::int IS NULL OR a.mfy_id = $2)
     GROUP BY 1 ORDER BY 1`,
    [period, mfyId], ctx,
  );

  const forecast = linearForecast(hist.map((h) => Number(h.loss_pct)), period, 6);

  // O'tgan oyning bahosi - AYNAN shu funksiya, faqat bir oy orqada.
  const prev = await queryOne<{ score: number | null }>(
    `SELECT score FROM agg.efficiency_index($1, $2, (($3 || '-01')::date - INTERVAL '1 month')::date)`,
    [scope, mfyId, period], ctx,
  );

  /*
   * Tavsiya xulosasi: normadan oshgan mahallalar soni va yo'qotishning
   * NORMATIV darajasi (energiya bo'yicha o'rtachalangan). Bu qoida -
   * SQL, model emas: "qaysi mahalla normadan oshdi" savoli aniq javobga ega.
   */
  const adv = await queryOne<{ cnt: number; target_pct: number | null; cur_pct: number | null }>(
    `SELECT count(*) FILTER (
              WHERE a.loss_pct > coalesce(a.total_loss_target_pct, 8.0)
            )::int AS cnt,
            round(sum(a.kwh_in * coalesce(a.total_loss_target_pct, 8.0))
                  / nullif(sum(a.kwh_in), 0), 1) AS target_pct,
            round(100 * sum(a.kwh_loss_total) / nullif(sum(a.kwh_in), 0), 1) AS cur_pct
       FROM agg.mfy_monthly a
      WHERE a.period_month = ($1 || '-01')::date
        AND ($2::int IS NULL OR a.mfy_id = $2)`,
    [period, mfyId], ctx,
  );

  return {
    score: Number(row['score'] ?? 0),
    prevScore: prev?.score === null || prev?.score === undefined ? null : Number(prev.score),
    components,
    forecast,
    advice: adv?.target_pct == null ? null : {
      count: Number(adv.cnt ?? 0),
      targetLossPct: Number(adv.target_pct),
      currentLossPct: Number(adv.cur_pct ?? 0),
    },
  };
}

/** Eng kichik kvadratlar usuli bilan chiziqli trend ekstrapolyatsiyasi. */
function linearForecast(values: number[], fromPeriod: string, steps: number):
  { period: string; lossPct: number }[] | null {
  if (values.length < 4) return null;
  const n = values.length;
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i += 1) {
    num += (i - meanX) * (values[i]! - meanY);
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
// Texnik yo'qotish: standart vs amaldagi
// ═══════════════════════════════════════════════════════════════════════════

export async function technicalLoss(ctx: AppContext, period: string): Promise<TechnicalLossRow[]> {
  const rows = await query<{
    mfy_id: number; name_uz: string; actual_pct: number; standard_pct: number;
    gap_pp: number; status: string;
  }>(`SELECT mfy_id, name_uz, actual_pct, standard_pct, gap_pp, status
      FROM agg.v_technical_loss_gap
      WHERE period_month = ($1 || '-01')::date
      ORDER BY gap_pp DESC`, [period], ctx);

  return rows.map((r) => ({
    mfyId: r.mfy_id, nameUz: r.name_uz,
    actualPct: Number(r.actual_pct), standardPct: Number(r.standard_pct),
    gapPp: Number(r.gap_pp), status: r.status as RagStatus,
  }));
}

// ═══════════════════════════════════════════════════════════════════════════
// Transformator monitoringi
// ═══════════════════════════════════════════════════════════════════════════

export async function tpMonitoring(
  ctx: AppContext, period: string, mfyId: number | null = null, limit = 200,
): Promise<TpMonitorRow[]> {
  const rows = await query<{
    tp_id: number; code: string; mfy_id: number; mfy_name: string; rated_kva: number | null;
    load_pct: number | null; optimal_pct: number | null; condition: string | null;
    avg_distance_m: number | null; distance_compliant: boolean | null;
  }>(`/*
        REGISTRDAN boshlanadi, jamlanmadan emas.
        Oylik holat hisoboti kelmagan TP ham ro'yxatda KO'RINISHI kerak -
        yuklama va holat ustunlari bo'sh bo'ladi, lekin transformatorning
        o'zi yo'qolib qolmaydi. Ilgari so'rov jamlanmadan boshlanardi va
        holati kiritilmagan TP butunlay ko'rinmasdi.
      */
      SELECT t.id AS tp_id, t.code, t.mfy_id, m.name_uz AS mfy_name, t.rated_kva,
             a.load_pct, a.optimal_pct, a.condition, t.avg_distance_m,
             CASE WHEN t.avg_distance_m IS NULL THEN NULL
                  ELSE t.avg_distance_m <= ref.norm_value(
                         'TP_MAX_DISTANCE_M', t.mfy_id, ($1 || '-01')::date)
             END AS distance_compliant
      FROM ref.tp t
      JOIN ref.mfy m ON m.id = t.mfy_id
      LEFT JOIN agg.tp_monthly a
             ON a.tp_id = t.id AND a.period_month = ($1 || '-01')::date
      WHERE t.decommissioned_on IS NULL
        AND ($2::int IS NULL OR t.mfy_id = $2)
      /*
        HOLAT bo'yicha, keyin yuklama bo'yicha.

        Ilgari faqat "ORDER BY load_pct DESC" edi va bu panelni yolg'onchi
        qilardi: mahallada nosoz transformator bo'lsa-yu, uning yuklamasi
        past bo'lsa (masalan 65%), u ro'yxatning pastiga tushib, kartaning
        birinchi 5 qatoriga KIRMASDI - "Transformatorlar HOLATI" kartasi
        aynan buzilgan transformatorni yashirardi.

        Tartib UI dagi rang og'irligiga mos: ortiqcha yuklama (qizil) →
        nosozlik (to'q sariq) → diqqat (sariq) → yaxshi. Normadan uzoq
        TP lar teng holatda oldinroq turadi.
      */
      ORDER BY CASE a.condition
                 WHEN 'OVERLOAD'  THEN 0
                 WHEN 'FAULT'     THEN 1
                 WHEN 'ATTENTION' THEN 2
                 WHEN 'GOOD'      THEN 3
                 ELSE 4
               END,
               (t.avg_distance_m IS NOT NULL AND NOT (t.avg_distance_m <= ref.norm_value(
                  'TP_MAX_DISTANCE_M', t.mfy_id, ($1 || '-01')::date))) DESC,
               a.load_pct DESC NULLS LAST,
               t.code
      LIMIT $3`, [period, mfyId, limit], ctx);

  return rows.map((r) => ({
    tpId: r.tp_id, code: r.code, mfyId: r.mfy_id, mfyName: r.mfy_name,
    ratedKva: r.rated_kva === null ? null : Number(r.rated_kva),
    loadPct: r.load_pct === null ? null : Number(r.load_pct),
    optimalPct: r.optimal_pct === null ? null : Number(r.optimal_pct),
    condition: (r.condition ?? null) as TpMonitorRow['condition'],
    avgDistanceM: r.avg_distance_m === null ? null : Number(r.avg_distance_m),
    distanceCompliant: r.distance_compliant,
  }));
}

/**
 * Fider boshidagi oylik balans.
 *
 * Jadvalda hisoblagich ko'rsatkichlari va to'rt raqam turadi; o'rtacha
 * yuklama va qamrov ulushi shu yerda HISOBLANADI - ular saqlanmaydi, chunki
 * manba raqamlardan bir qatorda kelib chiqadi.
 */
export async function feederMonthly(
  ctx: AppContext, period: string, mfyId: number,
): Promise<FeederMonthly | null> {
  const row = await queryOne<{
    period_month: string; substation: string | null; input_name: string | null;
    meter_prev: number; meter_curr: number; meter_coef: number;
    kwh_in: number; kwh_tp_sum: number; kwh_tech_loss: number; kwh_commercial_loss: number;
    days: number;
  }>(
    `SELECT to_char(f.period_month, 'YYYY-MM') AS period_month, f.substation, f.input_name,
            f.meter_prev, f.meter_curr, f.meter_coef,
            f.kwh_in, f.kwh_tp_sum, f.kwh_tech_loss, f.kwh_commercial_loss,
            /*
             * O'rtacha yuklama qaysi songa BO'LINADI. Joriy oy hali tugamagan
             * bo'lsa (masalan 7 kunlik ma'lumot) taqvim kunlari bilan bo'lish
             * o'rtachani sun'iy ravishda 4 barobar pasaytirib yuborardi -
             * shuning uchun HAQIQATDA to'ldirilgan kunlar olinadi, ma'lumot
             * bo'lmasa taqvimga qaytadi.
             */
            coalesce(
              nullif(a.days_filled, 0),
              extract(day FROM (f.period_month + INTERVAL '1 month - 1 day'))::int
            )::int AS days
       FROM fact.feeder_monthly f
       LEFT JOIN agg.mfy_monthly a
              ON a.mfy_id = f.mfy_id AND a.period_month = f.period_month
      WHERE f.mfy_id = $1 AND f.period_month = ($2 || '-01')::date`,
    [mfyId, period], ctx,
  );
  if (!row) return null;

  const kwhIn = Number(row.kwh_in);
  const days = Number(row.days) || 30;

  return {
    periodMonth: row.period_month,
    substation: row.substation,
    inputName: row.input_name,
    meterPrev: Number(row.meter_prev),
    meterCurr: Number(row.meter_curr),
    meterCoef: Number(row.meter_coef),
    kwhIn,
    kwhTpSum: Number(row.kwh_tp_sum),
    kwhTechLoss: Number(row.kwh_tech_loss),
    kwhCommercialLoss: Number(row.kwh_commercial_loss),
    meteredPct: kwhIn > 0 ? Number(((Number(row.kwh_tp_sum) / kwhIn) * 100).toFixed(1)) : 0,
    avgDailyKwh: Number((kwhIn / days).toFixed(1)),
    avgLoadKw: Number((kwhIn / (days * 24)).toFixed(1)),
    days,
  };
}

/**
 * TP kesimidagi oylik hisobot - hisoblagich ko'rsatkichlari va iste'molchilar.
 *
 * Bu «Тўлиқ ҳисобот» varag'ining aynan o'zi: transformatorlar sahifasi shu
 * ma'lumotni ko'rsatadi, chunki fider darajasidagi tizimda asosiy tafsilot
 * shu yerda.
 */
export async function tpMonthly(
  ctx: AppContext, period: string, mfyId: number | null = null,
): Promise<TpMonthlyRow[]> {
  const rows = await query<{
    tp_id: number; code: string; consumers_total: number; consumers_active: number;
    consumers_disconnected: number; meter_no: string | null; meter_coef: number;
    reading_prev: number; reading_curr: number; kwh_month: number;
  }>(
    `SELECT t.id AS tp_id, t.code, m.consumers_total, m.consumers_active,
            m.consumers_disconnected, m.meter_no, m.meter_coef,
            m.reading_prev, m.reading_curr, m.kwh_month
       FROM fact.tp_monthly m
       JOIN ref.tp t ON t.id = m.tp_id
      WHERE m.period_month = ($1 || '-01')::date
        AND ($2::int IS NULL OR t.mfy_id = $2)
      ORDER BY m.kwh_month DESC, t.code`,
    [period, mfyId], ctx,
  );

  return rows.map((r) => ({
    tpId: r.tp_id, code: r.code,
    consumersTotal: r.consumers_total,
    consumersActive: r.consumers_active,
    consumersDisconnected: r.consumers_disconnected,
    meterNo: r.meter_no,
    meterCoef: Number(r.meter_coef),
    readingPrev: Number(r.reading_prev),
    readingCurr: Number(r.reading_curr),
    kwhMonth: Number(r.kwh_month),
  }));
}

// ═══════════════════════════════════════════════════════════════════════════
// Qarzdorlik
// ═══════════════════════════════════════════════════════════════════════════

export async function debtBreakdown(
  ctx: AppContext, period: string, mfyId: number | null = null,
): Promise<DebtBreakdown> {
  const t = await periodTotals(ctx, period, mfyId, null);
  const total = t?.debt_total_mln ?? 0;
  const share = (v: number): number => (total > 0 ? Number(((v / total) * 100).toFixed(1)) : 0);

  const topDebtors = await query<{
    rank: number; debtor_name: string; category: string; amount_mln: number; mfy_name: string;
  }>(`SELECT d.rank, d.debtor_name, d.category, d.amount_mln, m.name_uz AS mfy_name
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
      category: d.category as DebtBreakdown['topDebtors'][number]['category'],
      amountMln: Number(d.amount_mln), mfyName: d.mfy_name,
    })),
  };
}

/**
 * Qarzdorni ISM bo'yicha loyqa qidirish - AI yordamchining "TP kodi emas,
 * odam nomi" so'rovlari uchun.
 *
 * ILIKE va `similarity()` BIRGA ishlatiladi: foydalanuvchi ismning bir
 * qismini aniq yozgan bo'lsa ILIKE uni albatta topadi (masalan familiya
 * boshi), imlo xatosi yoki so'z tartibi boshqacha bo'lsa esa trigram
 * o'xshashligi yordam beradi. `dt_name_trgm` indeksi ikkalasini ham
 * tezlashtiradi - yangi indeks yaratilmaydi, mavjudi ishlatiladi.
 *
 * Davr bo'yicha CHEKLANMAYDI: qidiruv "bu odam qachondir qarzdorlar
 * ro'yxatida bo'lganmi" degan savolga javob beradi, faqat joriy oyga emas.
 */
export async function searchDebtor(
  ctx: AppContext, queryText: string, limit: number,
): Promise<DebtBreakdown['topDebtors']> {
  const rows = await query<{
    rank: number; debtor_name: string; category: string; amount_mln: number; mfy_name: string;
  }>(`SELECT d.rank, d.debtor_name, d.category, d.amount_mln, m.name_uz AS mfy_name
      FROM fact.debt_top_entry d
      JOIN ref.mfy m ON m.id = d.mfy_id
      WHERE d.debtor_name ILIKE '%' || $1 || '%' OR similarity(d.debtor_name, $1) > 0.25
      ORDER BY similarity(d.debtor_name, $1) DESC
      LIMIT $2`, [queryText, limit], ctx);

  return rows.map((d, i) => ({
    rank: i + 1, debtorName: d.debtor_name,
    category: d.category as DebtBreakdown['topDebtors'][number]['category'],
    amountMln: Number(d.amount_mln), mfyName: d.mfy_name,
  }));
}

// ═══════════════════════════════════════════════════════════════════════════
// Yo'qotish xaritasi (treemap) - XARITA EMAS, geo ma'lumot ishlatilmaydi
// ═══════════════════════════════════════════════════════════════════════════

export async function lossMap(ctx: AppContext, period: string): Promise<LossMapCell[]> {
  const rows = await query<{
    mfy_id: number; name_uz: string; short_name: string; grid_row: number | null; grid_col: number | null;
    kwh_in: number; loss_pct: number | null; norm_pct: number | null;
  }>(`SELECT a.mfy_id, m.name_uz, m.short_name, m.grid_row, m.grid_col,
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
    const status: RagStatus =
      ratio <= 1 ? 'good' : ratio <= 1.25 ? 'warning' : ratio <= 1.6 ? 'serious' : 'critical';
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

/** `works()`, `createWork()` va `updateWorkStatus()` bir xil qatorni bir xil shaklga keltiradi. */
function mapWorkRow(r: Record<string, unknown>): WorkRow {
  return {
    id: Number(r['id']), mfyId: Number(r['mfy_id']), mfyName: String(r['mfy_name']),
    tpCode: (r['tp_code'] as string | null) ?? null,
    workType: r['work_type'] as WorkRow['workType'],
    titleUz: String(r['title_uz']), status: r['status'] as WorkRow['status'],
    plannedStart: (r['planned_start'] as string | null) ?? null,
    plannedEnd: (r['planned_end'] as string | null) ?? null,
    actualEnd: (r['actual_end'] as string | null) ?? null,
    progressPct: Number(r['progress_pct']), quantity: Number(r['quantity']),
    unit: String(r['unit']), costMln: Number(r['cost_mln']),
    effectLossPctBefore: r['effect_loss_pct_before'] === null ? null : Number(r['effect_loss_pct_before']),
    effectLossPctAfter: r['effect_loss_pct_after'] === null ? null : Number(r['effect_loss_pct_after']),
    effectSavingKwhMonth: Number(r['effect_saving_kwh_month']),
  };
}

const WORK_SELECT = `
  SELECT w.id, w.mfy_id, m.name_uz AS mfy_name, t.code AS tp_code, w.work_type,
         w.title_uz, w.status, w.planned_start, w.planned_end, w.actual_end,
         w.progress_pct, w.quantity, w.unit, w.cost_mln,
         w.effect_loss_pct_before, w.effect_loss_pct_after, w.effect_saving_kwh_month
    FROM fact.work w
    JOIN ref.mfy m ON m.id = w.mfy_id
    LEFT JOIN ref.tp t ON t.id = w.tp_id
`;

export async function works(
  ctx: AppContext, mfyId: number | null = null, status: string | null = null, limit = 100,
): Promise<WorkRow[]> {
  const rows = await query<Record<string, unknown>>(
    `${WORK_SELECT}
     WHERE ($1::int IS NULL OR w.mfy_id = $1)
       AND ($2::text IS NULL OR w.status = $2)
     ORDER BY
       CASE w.status WHEN 'IN_PROGRESS' THEN 1 WHEN 'PLANNED' THEN 2 ELSE 3 END,
       coalesce(w.actual_end, w.planned_end) DESC NULLS LAST
     LIMIT $3`,
    [mfyId, status, limit], ctx,
  );

  return rows.map(mapWorkRow);
}

/**
 * Aniqlangan qoidabuzarliklar - toifa bo'yicha soni va summasi.
 *
 * DAVR: tanlangan oy bilan tugaydigan 12 oy. Bitta oy olinsa karta ko'pincha
 * bo'sh chiqadi (bir mahallada oyiga bitta dalolatnoma ham bo'lmasligi
 * mumkin), holbuki savol "qancha aniqlandi?" - bu yig'ma ko'rsatkich.
 *
 * Har bir toifa bilan birga DALOLATNOMALAR RO'YXATI qaytadi: foydalanuvchi
 * raqam ustiga bosganda "bu qayerdan chiqdi?" degan savolga javob shu yerda,
 * qo'shimcha so'rovsiz turadi.
 */
export async function violations(
  ctx: AppContext, period: string, mfyId: number | null = null, months = 12,
): Promise<ViolationSummary> {
  const rows = await query<{
    id: number; act_no: string; act_date: string; mfy_id: number; mfy_name: string;
    tp_code: string | null; consumer_ref: string | null; kwh_identified: number;
    fine_mln: number; status: string; case_type: string;
  }>(
    `SELECT v.id, v.act_no, v.act_date::text AS act_date, v.mfy_id, m.name_uz AS mfy_name,
            t.code AS tp_code, v.consumer_ref, v.kwh_identified, v.fine_mln,
            v.status, v.case_type
       FROM fact.violation_act v
       JOIN ref.mfy m ON m.id = v.mfy_id
       LEFT JOIN ref.tp t ON t.id = v.tp_id
      WHERE v.act_date <  (($1 || '-01')::date + INTERVAL '1 month')
        AND v.act_date >= (($1 || '-01')::date - (($2 - 1) || ' months')::interval)
        AND ($3::int IS NULL OR v.mfy_id = $3)
      ORDER BY v.act_date DESC`,
    [period, months, mfyId], ctx,
  );

  const acts = rows.map((r) => ({
    id: Number(r.id), actNo: r.act_no, actDate: r.act_date,
    mfyId: Number(r.mfy_id), mfyName: r.mfy_name, tpCode: r.tp_code,
    consumerRef: r.consumer_ref,
    kwhIdentified: Number(r.kwh_identified), fineMln: Number(r.fine_mln),
    status: r.status as ViolationActRow['status'],
    caseType: r.case_type as ViolationActRow['caseType'],
  }));

  // Toifalar DOIM uchtasi ham qaytadi - nol ham javob, bo'sh qator emas.
  const summary = VIOLATION_CASE_TYPES.map((caseType) => {
    const mine = acts.filter((a) => a.caseType === caseType);
    return {
      caseType,
      labelUz: VIOLATION_CASE_LABEL_UZ[caseType],
      count: mine.length,
      fineMln: Number(mine.reduce((s, a) => s + a.fineMln, 0).toFixed(2)),
      kwhIdentified: mine.reduce((s, a) => s + a.kwhIdentified, 0),
      acts: mine.slice(0, 30),
    };
  });

  const start = new Date(`${period}-01T00:00:00Z`);
  start.setUTCMonth(start.getUTCMonth() - (months - 1));

  return { from: start.toISOString().slice(0, 7), to: period, rows: summary };
}

/** Bitta ish - dalolatnoma ko'rinishi uchun to'liq, rasmlari bilan. */
export async function workDetail(ctx: AppContext, id: number): Promise<WorkDetail | null> {
  const row = await queryOne<Record<string, unknown>>(
    `SELECT w.id, w.mfy_id, m.name_uz AS mfy_name, m.code AS mfy_code, t.code AS tp_code,
            w.work_type, w.title_uz, w.description, w.status,
            w.planned_start, w.planned_end, w.actual_end,
            w.progress_pct, w.quantity, w.unit, w.cost_mln,
            w.effect_loss_pct_before, w.effect_loss_pct_after, w.effect_saving_kwh_month
       FROM fact.work w
       JOIN ref.mfy m ON m.id = w.mfy_id
       LEFT JOIN ref.tp t ON t.id = w.tp_id
      WHERE w.id = $1`,
    [id], ctx,
  );
  if (!row) return null;

  /*
   * Tartib: avval "ishgacha", keyin "keyin", oxirida hujjatlar - dalolatnoma
   * qog'ozda ham shu ketma-ketlikda o'qiladi.
   */
  const photos = await query<Record<string, unknown>>(
    `SELECT id, kind, caption, original_name, size_bytes, created_at
       FROM fact.work_photo
      WHERE work_id = $1
      ORDER BY CASE kind WHEN 'BEFORE' THEN 0 WHEN 'AFTER' THEN 1 ELSE 2 END, created_at`,
    [id], ctx,
  );

  return {
    id: Number(row['id']), mfyId: Number(row['mfy_id']), mfyName: String(row['mfy_name']),
    mfyCode: String(row['mfy_code']),
    tpCode: (row['tp_code'] as string | null) ?? null,
    workType: row['work_type'] as WorkDetail['workType'],
    titleUz: String(row['title_uz']),
    description: (row['description'] as string | null) ?? null,
    status: row['status'] as WorkDetail['status'],
    plannedStart: (row['planned_start'] as string | null) ?? null,
    plannedEnd: (row['planned_end'] as string | null) ?? null,
    actualEnd: (row['actual_end'] as string | null) ?? null,
    progressPct: Number(row['progress_pct']), quantity: Number(row['quantity']),
    unit: String(row['unit']), costMln: Number(row['cost_mln']),
    effectLossPctBefore: row['effect_loss_pct_before'] === null ? null : Number(row['effect_loss_pct_before']),
    effectLossPctAfter: row['effect_loss_pct_after'] === null ? null : Number(row['effect_loss_pct_after']),
    effectSavingKwhMonth: Number(row['effect_saving_kwh_month']),
    photos: photos.map((p) => ({
      id: Number(p['id']),
      url: `/api/files/work-photo/${String(p['id'])}`,
      kind: p['kind'] as 'BEFORE' | 'AFTER' | 'DOC',
      caption: (p['caption'] as string | null) ?? null,
      originalName: (p['original_name'] as string | null) ?? null,
      sizeBytes: Number(p['size_bytes']),
      createdAt: String(p['created_at']),
    })),
  };
}

/**
 * Yangi ish yozadi.
 *
 * Validatsiya BU YERDA emas - chaqiruvchi (marshrut yoki AI asbob) `workSchema`
 * bilan tekshirgan qiymatni beradi, xuddi `entry.saveMonthlyReturn`dagi
 * qatlamlanish kabi. Postgres RLS (`0004_security.sql`) ustidan ham turadi -
 * bu yerdagi tekshiruv ikkinchi qatlam, birinchisi emas.
 */
export async function createWork(ctx: AppContext, input: Work): Promise<WorkRow> {
  try {
    return await withTransaction(ctx, async (client) => {
      const ins = await client.query<{ id: number }>(
        `INSERT INTO fact.work
           (mfy_id, tp_id, work_type, title_uz, description, status,
            planned_start, planned_end, actual_end, progress_pct,
            quantity, unit, cost_mln,
            effect_loss_pct_before, effect_loss_pct_after, effect_saving_kwh_month)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         RETURNING id`,
        [
          input.mfyId, input.tpId ?? null, input.workType, input.titleUz,
          input.description ?? null, input.status, input.plannedStart ?? null,
          input.plannedEnd ?? null, input.actualEnd ?? null, input.progressPct,
          input.quantity, input.unit, input.costMln,
          input.effectLossPctBefore ?? null, input.effectLossPctAfter ?? null,
          input.effectSavingKwhMonth,
        ],
      );
      const row = await client.query<Record<string, unknown>>(
        `${WORK_SELECT} WHERE w.id = $1`, [ins.rows[0]!.id],
      );
      return mapWorkRow(row.rows[0]!);
    });
  } catch (err) {
    /*
     * `mfy_id`/`tp_id` chet kalit (FK) bilan tekshiriladi - bu yerda
     * ATAYLAB oldindan SELECT bilan tekshirilmaydi (qo'shimcha so'rov, va
     * baribir poyga sharoiti qoladi). Buning o'rniga Postgres xatosi
     * (23503) tushunarli xabarga aylantiriladi - aks holda AI asbobi xom
     * "violates foreign key constraint work_mfy_id_fkey" matnini
     * foydalanuvchiga aytib bera boshlaydi (sinovda aynan shu ko'rindi:
     * model buni o'zicha "fider raqami noto'g'ri" deb noaniq izohladi).
     */
    if (isPgError(err) && err.code === '23503') {
      const field = err.constraint?.includes('tp_id') ? 'TP (transformator)' : 'MFY (fider)';
      throw Object.assign(
        new Error(`${field} topilmadi - berilgan ID mavjud emas`), { statusCode: 400 },
      );
    }
    throw err;
  }
}

/**
 * Ish holatini (va unga bog'liq bajarilish maydonlarini) yangilaydi.
 *
 * `patch` TO'LIQ, chaqiruvchi tomonidan allaqachon tekshirilgan qiymatlarni
 * kutadi (status/progressPct/actualEnd birga mos kelishi - DB CHECK
 * `work_completed` shuni talab qiladi) - shuning uchun bu yerda `coalesce`
 * yo'q: qisman yangilash yolg'on-to'liq holatga olib kelishi mumkin edi.
 */
export async function updateWorkStatus(
  ctx: AppContext, id: number,
  patch: { status: WorkStatus; progressPct: number; actualEnd: string | null },
): Promise<WorkRow | null> {
  return withTransaction(ctx, async (client) => {
    const cur = await client.query<{ id: number }>(
      'SELECT id FROM fact.work WHERE id = $1 FOR UPDATE', [id],
    );
    if (!cur.rows[0]) return null;

    await client.query(
      `UPDATE fact.work
          SET status = $2, progress_pct = $3, actual_end = $4, updated_at = now()
        WHERE id = $1`,
      [id, patch.status, patch.progressPct, patch.actualEnd],
    );

    const row = await client.query<Record<string, unknown>>(`${WORK_SELECT} WHERE w.id = $1`, [id]);
    return mapWorkRow(row.rows[0]!);
  });
}

/**
 * Ta'mirlanmagan tarmoq uzunligi (km) - kuchlanish klassi bo'yicha.
 *
 * `fact.network_defect` hozirgacha ilova kodida HECH QAYERDA o'qilmagan
 * (faqat pasport qatori sifatida kiritiladi) - ish tavsiyasi uchun qimmatli,
 * ilgari ishlatilmagan signal: qaysi MFY/kuchlanish klassida ta'mirlash
 * "qarzi" ko'p to'planganini ko'rsatadi.
 */
export async function networkDefectBacklog(
  ctx: AppContext, period: string, mfyId: number | null = null,
): Promise<{
  mfyId: number; mfyName: string; voltageKv: number;
  repairNeededKm: number; repairedKm: number; backlogKm: number;
}[]> {
  const rows = await query<{
    mfy_id: number; mfy_name: string; voltage_kv: number;
    repair_needed_km: number; repaired_km: number;
  }>(
    `SELECT d.mfy_id, m.name_uz AS mfy_name, d.voltage_kv,
            d.repair_needed_km, d.repaired_km
       FROM fact.network_defect d
       JOIN ref.mfy m ON m.id = d.mfy_id
      WHERE d.period_month = ($1 || '-01')::date
        AND ($2::int IS NULL OR d.mfy_id = $2)
        AND d.repair_needed_km > d.repaired_km
      ORDER BY (d.repair_needed_km - d.repaired_km) DESC`,
    [period, mfyId], ctx,
  );
  return rows.map((r) => ({
    mfyId: r.mfy_id, mfyName: r.mfy_name, voltageKv: Number(r.voltage_kv),
    repairNeededKm: Number(r.repair_needed_km), repairedKm: Number(r.repaired_km),
    backlogKm: Number((r.repair_needed_km - r.repaired_km).toFixed(2)),
  }));
}

// ═══════════════════════════════════════════════════════════════════════════
// Vaqt qatorlari
// ═══════════════════════════════════════════════════════════════════════════

export async function timeSeries(
  ctx: AppContext, from: string, to: string, bucket: 'day' | 'week' | 'month',
  mfyId: number | null = null,
): Promise<TimeSeriesPoint[]> {
  const trunc = bucket === 'day' ? 'day' : bucket === 'week' ? 'week' : 'month';
  const rows = await query<{
    d: string; kwh_in: number; kwh_sold: number; kwh_loss: number; loss_pct: number | null;
  }>(`SELECT date_trunc($3, a.biz_date)::date::text AS d,
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

/**
 * Tarmoq quvvati.
 *
 * TP pasportlari (kVA) kiritilmagan bo'lsa `null` qaytadi - panel "ma'lumot
 * yo'q" holatini ko'rsatadi. Nolli gauge chizish YOLG'ON bo'lardi: "quvvat
 * 0 kVA" degan xulosa "quvvat noma'lum" dan butunlay boshqa narsa.
 */
export async function capacity(
  ctx: AppContext, mfyId: number, period: string,
): Promise<CapacityInfo | null> {
  const t = await periodTotals(ctx, period, mfyId, null);
  const cap = t?.capacity_kva ?? 0;
  if (cap <= 0) return null;

  const used = t?.used_kva ?? 0;
  return {
    capacityKva: cap, currentKva: used, reserveKva: Math.max(0, cap - used),
    loadPct: Number(((used / cap) * 100).toFixed(1)),
  };
}

export async function consumers(ctx: AppContext, mfyId: number, period: string): Promise<ConsumerBreakdown> {
  /*
   * `consumers_disconnected_new` ATAYLAB fakt jadvalidan olinadi.
   *
   * U `agg.mfy_monthly` matview'ida yo'q, matview'ni esa faqat DROP +
   * CREATE bilan o'zgartirish mumkin - bu unga bog'liq boshqa view'larni
   * ham qayta qurishni talab qiladi. Bitta ustun uchun bunday xavf
   * o'rinsiz: bu yerda so'rov bitta MFY va bitta oy bo'yicha, ya'ni
   * arzon.
   */
  const [t, flow] = await Promise.all([
    periodTotals(ctx, period, mfyId, null),
    queryOne<{ disconnected_new: number }>(
      `SELECT coalesce(sum(r.consumers_disconnected_new), 0)::int AS disconnected_new
       FROM fact.mfy_monthly_return r
       JOIN fact.submission s ON s.id = r.submission_id AND s.status = 'approved'
       WHERE r.mfy_id = $1 AND r.period_month = ($2 || '-01')::date`,
      [mfyId, period],
      ctx,
    ),
  ]);

  return {
    total: t?.consumers_total ?? 0, active: t?.consumers_active ?? 0,
    disconnected: t?.consumers_disconnected ?? 0, new: t?.consumers_new ?? 0,
    disconnectedNew: flow?.disconnected_new ?? 0,
    population: t?.consumers_population ?? 0, legal: t?.consumers_legal ?? 0,
  };
}

export async function lossStructure(
  ctx: AppContext, period: string, mfyId: number | null = null,
): Promise<LossStructure> {
  const { clause, params } = scopeFilter(mfyId, null);
  const row = await queryOne<{ nat: number; tech: number; ill: number; total: number }>(
    `SELECT coalesce(sum(a.kwh_loss_natural), 0)   AS nat,
            coalesce(sum(a.kwh_loss_technical), 0) AS tech,
            coalesce(sum(a.kwh_loss_illegal), 0)   AS ill,
            coalesce(sum(a.kwh_loss_total), 0)     AS total
     FROM agg.mfy_monthly a
     WHERE a.period_month = ($1 || '-01')::date ${clause}`,
    [period, ...params], ctx);

  const total = row?.total ?? 0;
  const pct = (v: number): number => (total > 0 ? Number(((v / total) * 100).toFixed(1)) : 0);

  /*
   * Tabiiy va texnik - ikkalasi ham TARMOQDAGI fizik yo'qotish, ular
   * bitta "texnologik" toifaga yig'iladi. Noqonuniy foydalanish esa
   * hisobga olinmagan iste'mol, ya'ni TIJORIY yo'qotish.
   *
   * Bazadagi uchta ustun o'z holicha qoladi - bu faqat ko'rsatish toifasi.
   */
  const technological = (row?.nat ?? 0) + (row?.tech ?? 0);
  const commercial = row?.ill ?? 0;

  return {
    totalKwh: total,
    parts: [
      { key: 'technological', labelUz: 'Texnologik yo‘qotish', kwh: technological, pct: pct(technological) },
      { key: 'commercial',    labelUz: 'Tijoriy yo‘qotish',    kwh: commercial,    pct: pct(commercial) },
    ],
  };
}

export async function operational(
  ctx: AppContext, mfyId: number, period: string,
): Promise<OperationalMetrics> {
  const row = await queryOne<{
    max_kw: number | null; min_kw: number | null; avg_v: number | null;
    outages: number | null; minutes: number | null;
  }>(`SELECT max(r.max_load_kw) AS max_kw, min(r.min_load_kw) AS min_kw,
             round(avg(r.avg_voltage_v), 1) AS avg_v,
             sum(r.outage_count)::int AS outages, sum(r.outage_minutes)::int AS minutes
      FROM fact.tp_reading_daily r
      JOIN ref.tp t ON t.id = r.tp_id
      WHERE t.mfy_id = $1
        AND r.biz_date >= ($2 || '-01')::date
        AND r.biz_date <  (($2 || '-01')::date + INTERVAL '1 month')`,
    [mfyId, period], ctx);

  const nominal = await queryOne<{ v: number }>(
    `SELECT ref.norm_value('VOLTAGE_NOMINAL_V', $1, ($2 || '-01')::date) AS v`,
    [mfyId, period], ctx);

  return {
    maxLoadKw: row?.max_kw === null || row?.max_kw === undefined ? null : Number(row.max_kw),
    minLoadKw: row?.min_kw === null || row?.min_kw === undefined ? null : Number(row.min_kw),
    avgVoltageV: row?.avg_v === null || row?.avg_v === undefined ? null : Number(row.avg_v),
    outageCount: row?.outages ?? null,
    outageMinutes: row?.minutes ?? null,
    nominalVoltageV: Number(nominal?.v ?? 220),
  };
}

export async function results(
  ctx: AppContext, mfyId: number | null, period: string, months = 12,
): Promise<ResultsSummary> {
  const rows = await query<{ p: string; loss_pct: number }>(
    `SELECT to_char(a.period_month, 'YYYY-MM') AS p,
            round(100 * sum(a.kwh_loss_total) / nullif(sum(a.kwh_in), 0), 2) AS loss_pct
     FROM agg.mfy_monthly a
     WHERE a.period_month <= ($1 || '-01')::date
       AND a.period_month >  ($1 || '-01')::date - ($2 || ' months')::interval
       AND ($3::int IS NULL OR a.mfy_id = $3)
     GROUP BY 1 ORDER BY 1`, [period, months, mfyId], ctx);

  /*
   * Oyna yuqoridan HAM yopiladi. Aks holda tanlangan davrdan KEYIN tugagan
   * ish ham qo'shilib ketardi - iyulni tanlaganda avgustdagi natija ko'rinib,
   * karta davr tanlagichga umuman javob bermay qolardi. Yuqori chegara
   * yo'qotish qatoridagi `period_month <= $1` bilan bir xil ma'noni beradi:
   * "tanlangan oy va undan oldingi 12 oy".
   */
  const saved = await queryOne<{ kwh: number }>(
    `SELECT coalesce(sum(effect_saving_kwh_month), 0) AS kwh
     FROM fact.work
     WHERE status = 'COMPLETED' AND ($1::int IS NULL OR mfy_id = $1)
       AND actual_end >  ($2 || '-01')::date - ($3 || ' months')::interval
       AND actual_end <  ($2 || '-01')::date + INTERVAL '1 month'`,
    [mfyId, period, months], ctx);

  const first = rows[0];
  const last = rows.at(-1);
  /*
   * Bitta oylik ma'lumot bo'lsa `first` va `last` AYNAN bir qator bo'ladi -
   * "30.9% → 30.9%, yaxshilanish 0.0 p.p." degan bo'sh taqqoslash chiqardi,
   * go'yo o'zgarish o'lchangandek. Taqqoslash uchun kamida IKKI oy kerak,
   * aks holda `improvementPp` NULL (interfeys belgini butunlay yashiradi).
   */
  const comparable = rows.length >= 2 && first && last;
  return {
    lossPctStart: first ? Number(first.loss_pct) : null,
    lossPctEnd: last ? Number(last.loss_pct) : null,
    improvementPp: comparable
      ? Number((Number(first.loss_pct) - Number(last.loss_pct)).toFixed(2))
      : null,
    savedKwh: Number(saved?.kwh ?? 0),
    periodFrom: first?.p ?? period,
    periodTo: last?.p ?? period,
  };
}
