/**
 * TP darajasidagi kunlik chiziqli yo'qotish - `fact.tp_loss_daily`.
 *
 * Submission oqimiga o'ralmagan: to'g'ridan-to'g'ri UPSERT (`(tp_id, biz_date)`
 * yagona). Sabab va sxema - `apps/api/migrations/0016_tp_loss_daily.sql`.
 */
import type { TimeSeriesPoint, TpLossDailyRow } from '@beap/shared';

import { type AppContext, query, queryOne, withTransaction } from '../pool.ts';

function mapRow(r: Record<string, unknown>): TpLossDailyRow {
  return {
    id: Number(r['id']), tpId: Number(r['tp_id']), code: String(r['code']),
    mfyId: Number(r['mfy_id']), mfyName: String(r['mfy_name']),
    bizDate: String(r['biz_date']),
    kwhBalanceMeter: Number(r['kwh_balance_meter']),
    kwhConsumersAttached: Number(r['kwh_consumers_attached']),
    kwhLoss: Number(r['kwh_loss']),
    lossPct: r['loss_pct'] === null ? null : Number(r['loss_pct']),
    inspectionNote: (r['inspection_note'] as string | null) ?? null,
    source: r['source'] as TpLossDailyRow['source'],
  };
}

/** Har bir TP uchun ENG SO'NGGI o'qish - anomaliya foizi bo'yicha saralangan. */
export async function tpLossLatestByTp(
  ctx: AppContext, mfyId: number | null, limit = 100,
): Promise<TpLossDailyRow[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM (
       SELECT DISTINCT ON (t.id)
              d.id, t.id AS tp_id, t.code, t.mfy_id, m.name_uz AS mfy_name,
              d.biz_date::text AS biz_date, d.kwh_balance_meter, d.kwh_consumers_attached,
              d.kwh_loss, d.loss_pct, d.inspection_note, d.source
         FROM fact.tp_loss_daily d
         JOIN ref.tp t ON t.id = d.tp_id
         JOIN ref.mfy m ON m.id = t.mfy_id
        WHERE ($1::int IS NULL OR t.mfy_id = $1)
        ORDER BY t.id, d.biz_date DESC
     ) latest
     ORDER BY loss_pct ASC NULLS LAST
     LIMIT $2`,
    [mfyId, limit], ctx,
  );
  return rows.map(mapRow);
}

/**
 * Berilgan OY uchun HAR BIR TP bo'yicha yig'indi - `tpLossLatestByTp()`ning
 * davr-bog'liq varianti. Dashboard jadvali global davr tanlagich bilan
 * birga o'zgarishi uchun shundan foydalanadi (`tpLossLatestByTp()` esa
 * har doim "joriy holat" - AI va anomaliya aniqlagich uchun o'zgarishsiz qoladi).
 *
 * `id` maydoni sintetik (TP ID qayta ishlatiladi) - bu qatorlar bitta
 * haqiqiy `fact.tp_loss_daily` yozuviga emas, ko'p kunlik yig'indiga mos
 * keladi; `id` React key sifatidan boshqa joyda ishlatilmaydi.
 */
export async function tpLossByPeriod(
  ctx: AppContext, mfyId: number, period: string,
): Promise<TpLossDailyRow[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT t.id, t.id AS tp_id, t.code, t.mfy_id, m.name_uz AS mfy_name,
            $2 AS biz_date,
            sum(d.kwh_balance_meter) AS kwh_balance_meter,
            sum(d.kwh_consumers_attached) AS kwh_consumers_attached,
            sum(d.kwh_balance_meter) - sum(d.kwh_consumers_attached) AS kwh_loss,
            CASE WHEN sum(d.kwh_balance_meter) > 0
                 THEN round(100 * (sum(d.kwh_balance_meter) - sum(d.kwh_consumers_attached))
                            / sum(d.kwh_balance_meter), 2)
            END AS loss_pct,
            NULL::text AS inspection_note,
            'MANUAL' AS source
       FROM fact.tp_loss_daily d
       JOIN ref.tp t ON t.id = d.tp_id
       JOIN ref.mfy m ON m.id = t.mfy_id
      WHERE t.mfy_id = $1
        AND d.biz_date >= ($2 || '-01')::date
        AND d.biz_date <  (($2 || '-01')::date + INTERVAL '1 month')
      GROUP BY t.id, t.code, t.mfy_id, m.name_uz
      ORDER BY loss_pct ASC NULLS LAST`,
    [mfyId, period], ctx,
  );
  return rows.map(mapRow);
}

/**
 * Fider bo'ylab kunlik/haftalik/oylik trend - `q.timeSeries()` (dashboard.ts)
 * bilan AYNAN bir xil naqsh, faqat `fact.tp_loss_daily` ustidan. Natija turi
 * `TimeSeriesPoint` - `kwhIn`=balans yig'indisi, `kwhSold`=iste'molchi
 * yig'indisi, shunda mavjud `TrendLine` komponenti to'g'ridan-to'g'ri ishlaydi.
 */
export async function tpLossSeries(
  ctx: AppContext, mfyId: number | null, from: string, to: string, bucket: 'day' | 'week' | 'month',
): Promise<TimeSeriesPoint[]> {
  const rows = await query<{
    d: string; kwh_in: number; kwh_sold: number; kwh_loss: number; loss_pct: number | null;
  }>(
    `SELECT date_trunc($3, d.biz_date)::date::text AS d,
            sum(d.kwh_balance_meter) AS kwh_in,
            sum(d.kwh_consumers_attached) AS kwh_sold,
            sum(d.kwh_balance_meter) - sum(d.kwh_consumers_attached) AS kwh_loss,
            CASE WHEN sum(d.kwh_balance_meter) > 0
                 THEN round(100 * (sum(d.kwh_balance_meter) - sum(d.kwh_consumers_attached))
                            / sum(d.kwh_balance_meter), 2)
            END AS loss_pct
       FROM fact.tp_loss_daily d
       JOIN ref.tp t ON t.id = d.tp_id
      WHERE d.biz_date BETWEEN $1::date AND $2::date
        AND ($4::int IS NULL OR t.mfy_id = $4)
      GROUP BY 1 ORDER BY 1`,
    [from, to, bucket, mfyId], ctx,
  );
  return rows.map((r) => ({
    date: r.d, kwhIn: Number(r.kwh_in), kwhSold: Number(r.kwh_sold),
    kwhLoss: Number(r.kwh_loss), lossPct: Number(r.loss_pct ?? 0),
  }));
}

/** Fider uchun texnologik yo'qotish normasi (%) - anomaliya chegarasi shundan hisoblanadi. */
export async function tpLossNorm(ctx: AppContext, mfyId: number, asOfDate: string): Promise<number> {
  const row = await queryOne<{ v: number | null }>(
    `SELECT ref.norm_value('TECHNICAL_LOSS_PCT', $1, $2::date) AS v`,
    [mfyId, asOfDate], ctx,
  );
  return Number(row?.v ?? 3.2);
}

export interface ResolvedTp {
  id: number;
  mfyId: number;
}

/** TP kodlarini ichki ID/MFY'ga aylantiradi - yuklash marshrutlari (preview/confirm) shundan foydalanadi. */
export async function resolveTpCodes(
  ctx: AppContext, codes: string[],
): Promise<Map<string, ResolvedTp>> {
  if (codes.length === 0) return new Map();
  const rows = await query<{ id: number; code: string; mfy_id: number }>(
    'SELECT id, code, mfy_id FROM ref.tp WHERE code = ANY($1)', [codes], ctx,
  );
  return new Map(rows.map((r) => [r.code, { id: r.id, mfyId: r.mfy_id }]));
}

export interface UpsertTpLossInput {
  tpId: number;
  bizDate: string;
  kwhBalanceMeter: number;
  kwhConsumersAttached: number;
  inspectionNote: string | null;
  source: 'EXCEL' | 'MANUAL';
  fileName: string | null;
}

/**
 * Qatorlarni UPSERT qiladi. Qayta yuklash - masalan tuzatilgan raqamlar bilan
 * - eskisini SUKUT bo'yicha ustidan yozadi (`ON CONFLICT ... DO UPDATE`), shu
 * sababli marshrut qatlami (preview → confirm) foydalanuvchini oldindan
 * ogohlantiradi.
 */
export async function upsertTpLossDaily(
  ctx: AppContext, rows: UpsertTpLossInput[],
): Promise<{ inserted: number; updated: number }> {
  return withTransaction(ctx, async (client) => {
    let inserted = 0;
    let updated = 0;
    for (const r of rows) {
      const res = await client.query<{ inserted: boolean }>(
        `INSERT INTO fact.tp_loss_daily
           (tp_id, biz_date, kwh_balance_meter, kwh_consumers_attached, inspection_note,
            source, file_name, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)
         ON CONFLICT (tp_id, biz_date) DO UPDATE
           SET kwh_balance_meter = excluded.kwh_balance_meter,
               kwh_consumers_attached = excluded.kwh_consumers_attached,
               inspection_note = excluded.inspection_note,
               source = excluded.source, file_name = excluded.file_name,
               updated_by = excluded.updated_by, updated_at = now()
         RETURNING (xmax = 0) AS inserted`,
        [r.tpId, r.bizDate, r.kwhBalanceMeter, r.kwhConsumersAttached, r.inspectionNote,
          r.source, r.fileName, ctx.userId],
      );
      if (res.rows[0]?.inserted) inserted += 1; else updated += 1;
    }
    return { inserted, updated };
  });
}
