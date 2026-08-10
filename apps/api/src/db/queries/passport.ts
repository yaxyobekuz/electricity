/**
 * Pasport - hisoblanadi, keyin muzlatiladi.
 *
 * Pasport HECH QACHON pasport sifatida kiritilmaydi. Har bir qator o'z
 * manbasidan hisoblanadi. Tuman pasporti - sof SUM(MFY).
 */
import { createHash } from 'node:crypto';

import type { Passport, PassportReconcileRow, PassportRow } from '@beap/shared';

import { type AppContext, query, queryOne, withTransaction } from '../pool.ts';

/** Pasport qatorlarining ta'rifi - DB ustunlari bilan bog'lanish. */
interface RowSpec {
  no: number;
  labelUz: string;
  labelUzCyr: string;
  unit: string;
  column: string;
  source: 'input' | 'derived';
  children?: { labelUz: string; labelUzCyr: string; column: string }[];
  /** Faqat tuman darajasida ko'rsatiladi. */
  districtOnly?: boolean;
}

export const PASSPORT_ROWS: RowSpec[] = [
  {
    no: 1, labelUz: 'Jami iste’molchilar soni', labelUzCyr: 'Жами истеъмолчилар сони',
    unit: 'ta', column: 'consumers_total', source: 'derived',
    children: [
      { labelUz: 'Aholi', labelUzCyr: 'Аҳоли', column: 'consumers_population' },
      { labelUz: 'Yuridik', labelUzCyr: 'Юридик', column: 'consumers_legal' },
    ],
  },
  {
    no: 2, labelUz: 'Nimstansiyalar soni', labelUzCyr: 'Нимстанциялар сони',
    unit: 'ta', column: 'substation_cnt', source: 'derived', districtOnly: true,
  },
  {
    no: 3, labelUz: 'Transformator punktlari', labelUzCyr: 'Трансформатор пунктлари',
    unit: 'ta', column: 'transformer_cnt', source: 'derived',
    children: [
      { labelUz: 'Yuklama bilan ishlayotgan TP lar', labelUzCyr: 'Юклама билан ишлаётган ТП лар', column: 'tp_under_load' },
    ],
  },
  {
    no: 4, labelUz: 'Jami havo tarmoqlari', labelUzCyr: 'Жами ҳаво тармоқлари',
    unit: 'km', column: 'line_km_total', source: 'derived',
    children: [
      { labelUz: '0,4 kV tarmoq', labelUzCyr: '0,4 кВ тармоқ', column: 'line_km_04' },
      { labelUz: '10 kV tarmoq', labelUzCyr: '10 кВ тармоқ', column: 'line_km_10' },
    ],
  },
  {
    no: 5, labelUz: 'Jami debitor qarzdorlik', labelUzCyr: 'Жами дебитор қарздорлик',
    unit: 'mln so‘m', column: 'debt_total_mln', source: 'derived',
    children: [
      { labelUz: 'Aholi', labelUzCyr: 'Аҳоли', column: 'debt_population_mln' },
      { labelUz: 'Yuridik', labelUzCyr: 'Юридик', column: 'debt_legal_mln' },
      { labelUz: 'Budjet tashkilotlari', labelUzCyr: 'Бюджет ташкилотлари', column: 'debt_budget_mln' },
    ],
  },
  {
    no: 6, labelUz: 'Aloqadan chiqib ketgan hisoblagichlar soni',
    labelUzCyr: 'Алоқадан чиқиб кетган ҳисоблагичлар сони',
    unit: 'ta', column: 'meters_offline_cnt', source: 'input',
  },
  {
    no: 7, labelUz: '0 va 50 kWt/s kam iste’mol qilayotgan iste’molchilar soni',
    labelUzCyr: '0 ва 50 кВт/с кам истеъмол қилаётган истеъмолчилар сони',
    unit: 'ta', column: 'low_consumption_cnt', source: 'input',
  },
  {
    no: 8, labelUz: 'Oqib o‘tgan o‘rtacha elektr miqdori',
    labelUzCyr: 'Оқиб ўтган ўртача электр миқдори',
    unit: 'ming kWh', column: 'monthly_thsd_kwh', source: 'derived',
  },
  {
    no: 9, labelUz: 'Tarmoqlarni daraxtlardan tozalash',
    labelUzCyr: 'Тармоқларни дарахтлардан тозалаш',
    unit: 'km', column: 'tree_clearing_km', source: 'derived',
  },
  {
    no: 10, labelUz: 'Yo‘qotishlar', labelUzCyr: 'Йўқотишлар',
    unit: 'ming kWh', column: 'loss_thsd_kwh', source: 'derived',
    children: [
      { labelUz: 'shundan yo‘qotishlar aniqlandi', labelUzCyr: 'шундан йўқотишлар аниқланди', column: 'identified_loss_thsd_kwh' },
    ],
  },
  {
    no: 11, labelUz: 'Ta’mirlanishi zarur bo‘lgan TP lar',
    labelUzCyr: 'Таъмирланиши зарур бўлган ТПлар',
    unit: 'ta', column: 'tp_repair_needed', source: 'input',
  },
  {
    no: 12, labelUz: 'Ta’mirlanishi zarur bo‘lgan tarmoqlar',
    labelUzCyr: 'Таъмирланиши зарур бўлган тармоқлар',
    unit: 'km', column: 'repair_km_total', source: 'derived',
    children: [
      { labelUz: '0,4 kV tarmoq', labelUzCyr: '0,4 кВ тармоқ', column: 'repair_km_04' },
      { labelUz: '10 kV tarmoq', labelUzCyr: '10 кВ тармоқ', column: 'repair_km_10' },
    ],
  },
  {
    no: 13, labelUz: 'Almashtirilishi zarur bo‘lgan hisoblagichlar',
    labelUzCyr: 'Алмаштирилиши зарур бўлган ҳисоблагичлар',
    unit: 'ta', column: 'meters_replace_need_cnt', source: 'input',
    children: [
      { labelUz: 'shundan almashtirilgan', labelUzCyr: 'шундан алмаштирилган', column: 'meters_replaced_cnt' },
    ],
  },
];

const numOrNull = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);

function buildRows(data: Record<string, unknown>, isDistrict: boolean): PassportRow[] {
  return PASSPORT_ROWS.filter((s) => isDistrict || !s.districtOnly).map((spec) => ({
    no: spec.no,
    labelUz: spec.labelUz,
    labelUzCyr: spec.labelUzCyr,
    unit: spec.unit,
    value: numOrNull(data[spec.column]),
    source: spec.source,
    ...(spec.children
      ? {
          children: spec.children.map((c) => ({
            labelUz: c.labelUz,
            labelUzCyr: c.labelUzCyr,
            value: numOrNull(data[c.column]),
          })),
        }
      : {}),
  }));
}

export async function mfyPassport(
  ctx: AppContext, mfyId: number, period: string,
): Promise<Passport | null> {
  const row = await queryOne<Record<string, unknown>>(
    `SELECT * FROM agg.v_mfy_passport WHERE mfy_id = $1 AND period_month = ($2 || '-01')::date`,
    [mfyId, period], ctx);
  if (!row) return null;

  const frozen = await getSnapshotMeta(ctx, 'MFY', mfyId, period);

  return {
    scopeType: 'MFY', scopeId: mfyId, scopeName: String(row['name_uz']),
    period, rows: buildRows(row, false), frozen,
  };
}

export async function tumanPassport(ctx: AppContext, period: string): Promise<Passport | null> {
  const row = await queryOne<Record<string, unknown>>(
    `SELECT * FROM agg.v_tuman_passport WHERE period_month = ($1 || '-01')::date`,
    [period], ctx);
  if (!row) return null;

  const frozen = await getSnapshotMeta(ctx, 'TUMAN', null, period);

  return {
    scopeType: 'TUMAN', scopeId: null, scopeName: 'Baliqchi tumani',
    period, rows: buildRows(row, true), frozen,
  };
}

async function getSnapshotMeta(
  ctx: AppContext, scopeType: 'MFY' | 'TUMAN', scopeId: number | null, period: string,
): Promise<Passport['frozen']> {
  const s = await queryOne<{ at: string; by: string; sha: string }>(
    `SELECT ps.frozen_at::text AS at, u.full_name AS by, ps.content_sha256 AS sha
     FROM fact.passport_snapshot ps
     JOIN sec.app_user u ON u.id = ps.frozen_by
     WHERE ps.scope_type = $1 AND ps.scope_id IS NOT DISTINCT FROM $2
       AND ps.period_month = ($3 || '-01')::date`,
    [scopeType, scopeId, period], ctx);
  return s ? { at: s.at, by: s.by, sha256: s.sha } : null;
}

/**
 * Qatorlarni tuman pasporti bilan solishtirish.
 * "Tuman pasportini qo'lda kiritish mumkin emas" da'vosining tekshiruvi.
 */
export async function reconcile(ctx: AppContext, period: string): Promise<PassportReconcileRow[]> {
  const columns = PASSPORT_ROWS.map((s) => s.column);
  const selects = columns
    .map((c) => `round(sum(p.${c})::numeric, 2) AS s_${c}, round(max(t.${c})::numeric, 2) AS t_${c}`)
    .join(', ');

  const row = await queryOne<Record<string, unknown>>(
    `SELECT ${selects}
     FROM agg.v_mfy_passport p
     JOIN agg.v_tuman_passport t ON t.period_month = p.period_month
     WHERE p.period_month = ($1 || '-01')::date`,
    [period], ctx);
  if (!row) return [];

  return PASSPORT_ROWS.map((spec) => {
    const sum = numOrNull(row[`s_${spec.column}`]);
    const tuman = numOrNull(row[`t_${spec.column}`]);
    const diff = sum !== null && tuman !== null ? Number((sum - tuman).toFixed(2)) : null;
    return {
      no: spec.no, labelUz: spec.labelUz,
      sumOfMfy: sum, frozenValue: tuman, diff,
      ok: diff === null || Math.abs(diff) < 0.05,
    };
  });
}

/** Kanonik JSON (kalitlar tartiblangan) - xesh barqaror bo'lishi uchun. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

export interface FreezeResult {
  id: number;
  sha256: string;
  alreadyFrozen: boolean;
}

/** Pasportni muzlatish - imzolanadigan rasmiy hujjat. Append-only. */
export async function freeze(
  ctx: AppContext, scopeType: 'MFY' | 'TUMAN', scopeId: number | null, period: string,
): Promise<FreezeResult> {
  const passport =
    scopeType === 'TUMAN'
      ? await tumanPassport(ctx, period)
      : await mfyPassport(ctx, scopeId!, period);
  if (!passport) throw new Error(`${period} davri uchun pasport ma'lumoti topilmadi`);

  if (passport.frozen) {
    const existing = await queryOne<{ id: number }>(
      `SELECT id FROM fact.passport_snapshot
       WHERE scope_type = $1 AND scope_id IS NOT DISTINCT FROM $2
         AND period_month = ($3 || '-01')::date`,
      [scopeType, scopeId, period], ctx);
    return { id: existing?.id ?? 0, sha256: passport.frozen.sha256, alreadyFrozen: true };
  }

  const payload = { scopeType, scopeId, period, rows: passport.rows, scopeName: passport.scopeName };
  const sha256 = createHash('sha256').update(canonicalJson(payload), 'utf8').digest('hex');

  return withTransaction(ctx, async (client) => {
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO fact.passport_snapshot
         (scope_type, scope_id, period_month, payload, content_sha256, frozen_by)
       VALUES ($1, $2, ($3 || '-01')::date, $4, $5, $6)
       RETURNING id`,
      [scopeType, scopeId, period, JSON.stringify(payload), sha256, ctx.userId],
    );
    return { id: rows[0]!.id, sha256, alreadyFrozen: false };
  });
}

export async function listSnapshots(
  ctx: AppContext, scopeType: 'MFY' | 'TUMAN' | null,
): Promise<{ id: number; scopeType: string; scopeId: number | null; period: string; frozenAt: string; sha256: string; frozenBy: string }[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT ps.id, ps.scope_type, ps.scope_id,
            to_char(ps.period_month, 'YYYY-MM') AS period,
            ps.frozen_at::text AS frozen_at, ps.content_sha256, u.full_name
     FROM fact.passport_snapshot ps
     JOIN sec.app_user u ON u.id = ps.frozen_by
     WHERE ($1::text IS NULL OR ps.scope_type = $1)
     ORDER BY ps.frozen_at DESC LIMIT 100`, [scopeType], ctx);

  return rows.map((r) => ({
    id: Number(r['id']), scopeType: String(r['scope_type']),
    scopeId: r['scope_id'] === null ? null : Number(r['scope_id']),
    period: String(r['period']), frozenAt: String(r['frozen_at']),
    sha256: String(r['content_sha256']), frozenBy: String(r['full_name']),
  }));
}
