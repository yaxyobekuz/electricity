/**
 * TP darajasidagi kunlik chiziqli yo'qotish - `fact.tp_loss_daily`.
 *
 * Submission oqimiga o'ralmagan: to'g'ridan-to'g'ri UPSERT (`(tp_id, biz_date)`
 * yagona). Sabab va sxema - `apps/api/migrations/0016_tp_loss_daily.sql`.
 */
import type { TpLossDailyRow } from '@beap/shared';

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
