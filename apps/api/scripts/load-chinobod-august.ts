/**
 * Chinobod ETK - AVGUST 2026: kunlik TP yo'qotishi va oylik hisobot davomi.
 *
 * HAQIQIY ma'lumot (`source='EXCEL'`) - manba fayllarda BOR bo'lgan kunlar:
 *   • 1-avgust  - `8-1-2026.xlsx` / `Sheet0`      → 355 ta TP (to'liq kesim)
 *   • 2-avgust  - `8-2-2026.xlsx` / «бир кунлик»  →   6 ta TP
 *   • 5-avgust  - o'sha varaqning 2-sana bloki    →   7 ta TP
 *   • 8-avgust  - `8-1-2026.xlsx` / `Sheet0 (2)`  →  37 ta TP
 *   (`Sheet0 (2)` ning 1-sana bloki `Sheet0` bilan qator-ma-qator bir xil -
 *    tekshirildi, shuning uchun takror sifatida tashlab yuboriladi.)
 *
 * TO'LDIRILGAN ma'lumot (`source='MANUAL'`) - qolgan (TP × kun) juftliklari
 * 1-8 avgust oralig'ida. Haqiqiy qator HECH QACHON ustidan yozilmaydi; ikki
 * manba DB darajasida `source` ustuni orqali doim ajralib turadi.
 *
 * To'ldirish qoidasi - TP ning O'Z tarixiga tayanadi:
 *   • yo'qotish foizi ikkita haqiqiy nuqta orasida chiziqli interpolyatsiya,
 *     nuqtadan tashqarida esa texnologik me'yorga qarab silliq qaytish;
 *   • kunlik hajm TP ning 1-avgustdagi haqiqiy balansi (bo'lmasa - iyul
 *     kunlik o'rtachasi) asosida, hafta oxiri pastroq;
 *   • determinik urug' - qayta ishga tushirsa AYNAN o'sha raqamlar.
 *
 *   node --experimental-strip-types apps/api/scripts/load-chinobod-august.ts
 *
 * Oldin `load-chinobod-july.ts` ishga tushirilgan bo'lishi shart.
 */
import { join } from 'node:path';

import ExcelJS from 'exceljs';
import pg from 'pg';

import { num } from '@beap/shared';

import { config, REPO_ROOT } from '../src/config.ts';
import { mulberry32 } from '../seed/generate.ts';
import { tpCodeOf } from './chinobod-common.ts';

const PREV_PERIOD = '2026-07-01';
const PERIOD = '2026-08';
const FROM_DATE = `${PERIOD}-01`;
const TO_DATE = `${PERIOD}-08`; // bugun - kelajak sana YO'Q (`tld_no_future`)
const DAYS = 8;
const JULY_DAYS = 31;
const SCALE = DAYS / JULY_DAYS;

const TECH_LOSS_RATE = 0.12;
/** `ref.norm` dagi TECHNICAL_LOSS_PCT - to'ldirilgan kunlarning tayanch foizi. */
const TECH_NORM_PCT = 3.2;
/** Balans hisoblagichi ishlamagan TP uchun kunlik hajmning pastki chegarasi. */
const MIN_BASELINE_KWH = 30;

const SEED = 20260808;
const rand = mulberry32(SEED);
function gauss(mean = 0, sd = 1): number {
  const u = Math.max(rand(), 1e-9);
  const v = Math.max(rand(), 1e-9);
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

// ═══════════════════════════════════════════════════════════════════════════
// Excel yordamchilari (`tpLossImport.ts` bilan bir xil mantiq)
// ═══════════════════════════════════════════════════════════════════════════

const val = (x: ExcelJS.CellValue): string | number => {
  if (x === null || x === undefined) return '';
  if (x instanceof Date) return x.toISOString().slice(0, 10);
  if (typeof x === 'object') {
    const o = x as { result?: unknown; text?: string };
    if (o.result !== undefined) return o.result as string | number;
    return o.text ?? '';
  }
  return x as string | number;
};
const numOf = (x: ExcelJS.CellValue): number | null => {
  const v = val(x);
  if (v === '') return null;
  if (typeof v === 'number') return v;
  const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
function dateOf(x: ExcelJS.CellValue): string | null {
  if (x === null || x === undefined || x === '') return null;
  if (x instanceof Date) return x.toISOString().slice(0, 10);
  if (typeof x === 'object') {
    const o = x as { result?: unknown; text?: string };
    return dateOf((o.result !== undefined ? o.result : o.text) as ExcelJS.CellValue);
  }
  const s = String(x).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (dmy) return `${dmy[3]}-${dmy[2]!.padStart(2, '0')}-${dmy[1]!.padStart(2, '0')}`;
  return null;
}

interface RealRow {
  code: string; date: string;
  balance: number; attached: number;
  note: string | null;
  /** Manbadagi manfiy qiymat - CHECK talabi bo'yicha 0 ga qisilgan bo'lsa. */
  clampedFrom: number | null;
  file: string;
}

/** `kwh_balance_meter >= 0` CHECK - manfiy o'qish 0 ga qisiladi, asli izohda qoladi. */
function mkRow(
  code: string, date: string, balance: number, attached: number,
  note: string | null, file: string,
): RealRow {
  return {
    code, date,
    balance: Math.max(0, balance),
    attached: Math.max(0, attached),
    note,
    clampedFrom: balance < 0 ? balance : null,
    file,
  };
}

async function sheetOf(file: string, name: string): Promise<ExcelJS.Worksheet | undefined> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(join(REPO_ROOT, file));
  return name === '*'
    ? wb.worksheets.find((w) => w.name.includes('кунлик'))
    : wb.getWorksheet(name);
}

/** `Sheet0` - bitta sana bloki: 2=ТП, 3=САНА, 4=баланс, 5=бириктирилган, 7=истеъмолчилар. */
async function readSingleBlock(file: string, sheet: string): Promise<RealRow[]> {
  const ws = await sheetOf(file, sheet);
  if (!ws) return [];
  const out: RealRow[] = [];
  for (let r = 5; r <= ws.rowCount; r += 1) {
    const row = ws.getRow(r);
    const raw = String(val(row.getCell(2).value)).trim();
    // «Total» / «TR-box» kabi xizmat qatorlari raqam bilan boshlanmaydi.
    if (!/^\d/.test(raw) || !/^[-\w/А-Яа-я]+$/.test(raw)) continue;
    const date = dateOf(row.getCell(3).value);
    const b = numOf(row.getCell(4).value);
    const a = numOf(row.getCell(5).value);
    if (!date || b === null || a === null) continue;
    const note = String(val(row.getCell(7).value)).trim();
    out.push(mkRow(tpCodeOf(raw), date, b, a, note && note !== '/' ? note : null, file));
  }
  return out;
}

/** Ikki sana blokli varaq - ustun indekslari varaqqa qarab farq qiladi. */
async function readDoubleBlock(
  file: string, sheet: string,
  c: { d1: number; b1: number; a1: number; note: number; d2: number; b2: number; a2: number },
): Promise<RealRow[]> {
  const ws = await sheetOf(file, sheet);
  if (!ws) return [];
  const out: RealRow[] = [];
  for (let r = 5; r <= ws.rowCount; r += 1) {
    const row = ws.getRow(r);
    const raw = String(val(row.getCell(2).value)).trim();
    if (!/^\d/.test(raw)) continue;
    const code = tpCodeOf(raw);
    const noteRaw = String(val(row.getCell(c.note).value)).trim();
    const note = noteRaw && noteRaw !== '/' ? noteRaw : null;

    const d1 = dateOf(row.getCell(c.d1).value);
    const b1 = numOf(row.getCell(c.b1).value);
    const a1 = numOf(row.getCell(c.a1).value);
    if (d1 && b1 !== null && a1 !== null) out.push(mkRow(code, d1, b1, a1, note, file));

    const d2 = dateOf(row.getCell(c.d2).value);
    const b2 = numOf(row.getCell(c.b2).value);
    const a2 = numOf(row.getCell(c.a2).value);
    // «Хатловдан кейин» izohi jismonan faqat 1-blokka tegishli.
    if (d2 && b2 !== null && a2 !== null) out.push(mkRow(code, d2, b2, a2, null, file));
  }
  return out;
}

function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  let d = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  while (d <= end) { out.push(new Date(d).toISOString().slice(0, 10)); d += 86_400_000; }
  return out;
}

/** Dam olish kunlari iste'mol pastroq - iyuldagi DAY_WEIGHTS bilan bir xil g'oya. */
function dayWeight(date: string): number {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6 ? 0.9 : 1.05;
}

function split(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  const raw = weights.map((w) => (total * w) / sum);
  const out = raw.map((v) => Math.floor(v));
  let rest = Math.round(total) - out.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => ({ i, frac: v - Math.floor(v) })).sort((a, b) => b.frac - a.frac);
  for (let k = 0; rest > 0; k += 1, rest -= 1) {
    const idx = order[k % order.length]!.i;
    out[idx] = (out[idx] ?? 0) + 1;
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  // ── 1. Haqiqiy qatorlarni yig'ish ──────────────────────────────────────
  const parts = await Promise.all([
    readSingleBlock('8-1-2026.xlsx', 'Sheet0'),
    readDoubleBlock('8-1-2026.xlsx', 'Sheet0 (2)',
      { d1: 3, b1: 4, a1: 5, note: 7, d2: 8, b2: 9, a2: 10 }),
    readDoubleBlock('8-2-2026.xlsx', '*',
      { d1: 3, b1: 4, a1: 5, note: 8, d2: 9, b2: 10, a2: 11 }),
    readDoubleBlock('8-1-2026.xlsx', '*',
      { d1: 3, b1: 4, a1: 5, note: 8, d2: 9, b2: 10, a2: 11 }),
  ]);

  /*
   * Takrorlarni birlashtirish: bitta (TP, sana) bir necha varaqda uchraydi.
   * Birinchi ko'rilgani saqlanadi - `Sheet0` va `Sheet0 (2)` ning 1-avgust
   * bloklari qator-ma-qator bir xil ekani tekshirilgan, ziddiyat yo'q.
   */
  const real = new Map<string, RealRow>();
  let conflicts = 0;
  for (const row of parts.flat()) {
    if (row.date < FROM_DATE || row.date > TO_DATE) continue;
    const key = `${row.code}:${row.date}`;
    const prev = real.get(key);
    if (!prev) { real.set(key, row); continue; }
    if (Math.abs(prev.balance - row.balance) > 0.01
      || Math.abs(prev.attached - row.attached) > 0.01) conflicts += 1;
    // Izohi bor variant afzal - ma'lumot yo'qotmaslik uchun.
    if (!prev.note && row.note) real.set(key, { ...prev, note: row.note });
  }

  const byDate = new Map<string, number>();
  for (const r of real.values()) byDate.set(r.date, (byDate.get(r.date) ?? 0) + 1);
  console.log(`\nAVGUST ${PERIOD} - haqiqiy kunlik qatorlar (${real.size} ta):`);
  for (const d of [...byDate.keys()].sort()) console.log(`   ${d}: ${byDate.get(d)} ta TP`);
  const clamped = [...real.values()].filter((r) => r.clampedFrom !== null);
  if (clamped.length > 0) {
    console.log(`\n   ⚠ ${clamped.length} ta qatorda balans hisoblagichi MANFIY o'qilgan.`);
    console.log(`     Sxema manfiy balansga ruxsat bermaydi (kwh_balance_meter >= 0) -`);
    console.log(`     qiymat 0 ga qisildi, asli \`note\` ustunida saqlandi.`);
    console.log(`     Misollar: ${clamped.slice(0, 5).map((r) => `${r.code}=${r.clampedFrom}`).join(', ')}`);
  }
  if (conflicts > 0) console.log(`\n   ⚠ ${conflicts} ta (TP, sana) juftligi varaqlar orasida ZIDDIYATLI.`);

  const pool = new pg.Pool({ ...config.db, max: 2 });
  const c = await pool.connect();

  try {
    const trg = await c.query<{ sch: string; tbl: string }>(`
      SELECT n.nspname AS sch, c.relname AS tbl
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE t.tgname = 'zz_audit' AND NOT t.tgisinternal`);
    for (const r of trg.rows) await c.query(`ALTER TABLE ${r.sch}.${r.tbl} DISABLE TRIGGER zz_audit`);

    await c.query('BEGIN');

    const tpRows = await c.query<{
      id: number; code: string; mfy_id: number; kwh_month: number | null;
    }>(
      `SELECT t.id, t.code, t.mfy_id, m.kwh_month::float8 AS kwh_month
         FROM ref.tp t
         LEFT JOIN fact.tp_monthly m ON m.tp_id = t.id AND m.period_month = $1::date
        ORDER BY t.code`, [PREV_PERIOD],
    );
    if (tpRows.rows.length === 0) throw new Error('ref.tp bo‘sh - avval load-chinobod-july.ts ishga tushiring');
    const tpIdByCode = new Map(tpRows.rows.map((t) => [t.code, t.id]));

    /*
     * `Sheet0` butun Chinobod ETK ni sanaydi (355 ta TP), registrda esa faqat
     * Xaqulobod fiderining 51 tasi bor. Boshqa fiderlarning qatorlari shu
     * yerda tashlab yuboriladi - bu kutilgan hol, xato emas.
     */
    const unknown = [...new Set([...real.values()].map((r) => r.code))]
      .filter((x) => !tpIdByCode.has(x));
    if (unknown.length > 0) {
      console.log(`\n   ℹ ${unknown.length} ta TP boshqa fiderlarga tegishli - o‘tkazib yuborildi`
        + ` (registrda ${tpIdByCode.size} ta Xaqulobod TP si bor)`);
    }

    // ── 2. Avgustni tozalash (iyulga TEGMAYDI) ───────────────────────────
    await c.query(
      `DELETE FROM fact.tp_loss_daily WHERE biz_date >= $1::date AND biz_date <= $2::date`,
      [FROM_DATE, TO_DATE],
    );
    await c.query(
      `DELETE FROM fact.energy_balance_daily WHERE biz_date >= $1::date AND biz_date <= $2::date`,
      [FROM_DATE, TO_DATE],
    );
    await c.query(`DELETE FROM fact.tp_monthly WHERE period_month = $1::date`, [FROM_DATE]);
    await c.query(`DELETE FROM fact.mfy_monthly_return WHERE period_month = $1::date`, [FROM_DATE]);
    await c.query(`DELETE FROM fact.feeder_monthly WHERE period_month = $1::date`, [FROM_DATE]);
    await c.query(
      `DELETE FROM fact.submission WHERE scope_type = 'MFY' AND period_start = $1::date`, [FROM_DATE],
    );

    // ── 3. fact.tp_loss_daily: haqiqiy + to'ldirilgan ────────────────────
    const dates = dateRange(FROM_DATE, TO_DATE);
    type Ins = [number, string, number, number, string | null, string, string | null, string | null];
    const inserts: Ins[] = [];

    for (const r of real.values()) {
      const id = tpIdByCode.get(r.code);
      if (!id) continue;
      inserts.push([
        id, r.date, r.balance, r.attached, r.note, 'EXCEL', r.file,
        r.clampedFrom !== null
          ? `Manbadagi balans hisoblagichi ${r.clampedFrom} kWh (manfiy) - sxema talabi bo'yicha 0 ga qisildi`
          : null,
      ]);
    }

    let generated = 0;
    for (const tp of tpRows.rows) {
      const anchors = dates
        .map((d) => real.get(`${tp.code}:${d}`))
        .filter((x): x is RealRow => x !== undefined)
        .map((x) => ({ date: x.date, balance: x.balance, attached: x.attached }));

      for (const date of dates) {
        if (real.has(`${tp.code}:${date}`)) continue;

        /*
         * TO'LDIRISH O'LCHANGAN KATTALIKLAR DOMENIDA, foiz domenida EMAS.
         *
         * Sabab: manba faylda balans hisoblagichi deyarli nolni ko'rsatib,
         * bириktirilgan iste'molchilar yuzlab kWh bergan TP lar bor
         * (TP-118: 0.8 va 360.5 kWh). Ulardan chiqadigan «-44 962%» - ishlamay
         * qolgan hisoblagich belgisi, davom ettiriladigan TREND emas. Foizni
         * interpolyatsiya qilish shu absurd sonni sun'iy ravishda 8 kunga
         * yoyadi. Buning o'rniga balans va biriktirilgan AYRIM-AYRIM
         * ko'chiriladi - hisoblagich ertasi kuni ham xuddi shunday buzuq
         * o'qishni beradi, ya'ni anomaliya saqlanadi, lekin uydirma emas.
         */
        let balance: number;
        let attached: number;

        if (anchors.length === 0) {
          // Umuman o'qish yo'q - iyul kunlik o'rtachasi va texnologik me'yor.
          const base = Math.max(MIN_BASELINE_KWH, Number(tp.kwh_month ?? 0) / JULY_DAYS);
          balance = base * dayWeight(date) * (1 + gauss(0, 0.08));
          attached = balance * (1 - clamp(TECH_NORM_PCT + gauss(0, 1.3), -2, 12) / 100);
        } else {
          const before = [...anchors].reverse().find((a) => a.date < date);
          const after = anchors.find((a) => a.date > date);
          if (before && after) {
            const t = (Date.parse(date) - Date.parse(before.date))
              / (Date.parse(after.date) - Date.parse(before.date));
            balance = before.balance + (after.balance - before.balance) * t;
            attached = before.attached + (after.attached - before.attached) * t;
          } else {
            const near = before ?? after!;
            balance = near.balance;
            attached = near.attached;
          }
          // Kunlik tebranish - ikkala kattalikka BIR XIL emas, mustaqil.
          balance *= dayWeight(date) * (1 + gauss(0, 0.06));
          attached *= dayWeight(date) * (1 + gauss(0, 0.06));
        }

        inserts.push([
          tpIdByCode.get(tp.code)!, date,
          Number(Math.max(0, balance).toFixed(2)),
          Number(Math.max(0, attached).toFixed(2)),
          null, 'MANUAL', null, null,
        ]);
        generated += 1;
      }
    }

    for (let i = 0; i < inserts.length; i += 500) {
      const chunk = inserts.slice(i, i + 500);
      const vals = chunk.map((_, k) => {
        const b = k * 8;
        return `($${b + 1}, $${b + 2}::date, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8})`;
      }).join(',');
      await c.query(
        `INSERT INTO fact.tp_loss_daily
           (tp_id, biz_date, kwh_balance_meter, kwh_consumers_attached,
            inspection_note, source, file_name, note)
         VALUES ${vals}`,
        chunk.flat(),
      );
    }
    console.log(`\n   fact.tp_loss_daily: ${inserts.length - generated} ta haqiqiy + ${generated} ta to‘ldirilgan = ${inserts.length}`);

    // ── 4. Oylik hisobot davomi (1-8 avgust) ─────────────────────────────
    const admin = await c.query<{ id: number }>(
      `SELECT id FROM sec.app_user WHERE role = 'admin' ORDER BY id LIMIT 1`);
    const adminId = admin.rows[0]!.id;

    const july = await c.query<{
      mfy_id: number; short_name: string; substation: string | null; input_name: string | null;
      meter_curr: number; meter_coef: number; kwh_in: number; kwh_tp_sum: number; source: string;
    }>(
      `SELECT f.mfy_id, m.short_name, f.substation, f.input_name,
              f.meter_curr::float8 AS meter_curr, f.meter_coef::float8 AS meter_coef,
              f.kwh_in::float8 AS kwh_in, f.kwh_tp_sum::float8 AS kwh_tp_sum, f.source
         FROM fact.feeder_monthly f JOIN ref.mfy m ON m.id = f.mfy_id
        WHERE f.period_month = $1::date ORDER BY m.sort_order`, [PREV_PERIOD],
    );
    if (july.rows.length === 0) throw new Error('Iyul uchun fact.feeder_monthly topilmadi');

    /*
     * Avgust hajmi iyuldan PROPORTSIONAL (8/31) olinadi va kichik umumiy
     * "drift" bilan siljitiladi - bir necha kunda fiderning yuklamasi
     * keskin o'zgarmaydi. Yo'qotish PROFILI iyulnikicha qoladi: sotilgan
     * ham, kirgan ham bir xil koeffitsientga ko'paytiriladi.
     */
    const drift = 1 + gauss(0, 0.03);
    const dayW = dates.map((d) => dayWeight(d));

    for (const f of july.rows) {
      const subIds = new Map<string, number>();
      for (const domain of ['ENERGY_BALANCE', 'MONTHLY_RETURN']) {
        const s = await c.query<{ id: number }>(
          `INSERT INTO fact.submission
             (scope_type, scope_id, domain, period_type, period_start, period_end,
              status, created_by, submitted_at, reviewed_by, reviewed_at)
           VALUES ('MFY', $1, $2, 'MONTH', $3::date, $4::date, 'approved', $5,
                   $4::date + time '09:00', $5, $4::date + time '14:00')
           RETURNING id`,
          [f.mfy_id, domain, FROM_DATE, TO_DATE, adminId],
        );
        subIds.set(domain, s.rows[0]!.id);
      }

      const kwhIn = Number((f.kwh_in * SCALE * drift).toFixed(2));
      const kwhSold = Number((f.kwh_tp_sum * SCALE * drift).toFixed(2));
      const techLoss = Number((kwhIn * TECH_LOSS_RATE).toFixed(2));
      const commLoss = Math.max(0, Number((kwhIn - kwhSold - techLoss).toFixed(2)));
      const meterPrev = f.meter_curr;
      const meterCurr = Number((meterPrev + kwhIn / (f.meter_coef || 1)).toFixed(2));

      await c.query(
        `INSERT INTO fact.feeder_monthly
           (mfy_id, period_month, substation, input_name, meter_prev, meter_curr, meter_coef,
            kwh_in, kwh_tp_sum, kwh_tech_loss, kwh_commercial_loss, source)
         VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'MANUAL')`,
        [f.mfy_id, FROM_DATE, f.substation, f.input_name, meterPrev, meterCurr, f.meter_coef,
          kwhIn, kwhSold, techLoss, commLoss],
      );

      const inDaily = split(kwhIn, dayW);
      const soldDaily = split(kwhSold, dayW);
      const lossDaily = inDaily.map((v, d) => v - Math.min(soldDaily[d]!, v));
      const techDaily = split(techLoss, lossDaily.map((v) => Math.max(v, 1)));

      for (let d = 0; d < DAYS; d += 1) {
        const dayIn = inDaily[d]!;
        const daySold = Math.min(soldDaily[d]!, dayIn);
        const loss = dayIn - daySold;
        const technical = Math.min(techDaily[d]!, loss);
        await c.query(
          `INSERT INTO fact.energy_balance_daily
             (submission_id, mfy_id, biz_date, kwh_in, kwh_sold,
              kwh_loss_natural, kwh_loss_technical, kwh_loss_illegal)
           VALUES ($1, $2, $3::date, $4, $5, 0, $6, $7)`,
          [subIds.get('ENERGY_BALANCE'), f.mfy_id, dates[d], dayIn, daySold, technical, loss - technical],
        );
      }

      // Iste'molchilar - 8 kunda sezilarli o'zgarmaydi, iyuldagi qiymat ko'chiriladi.
      const mr = await c.query<{
        consumers_population: number; consumers_legal: number;
        consumers_active: number; consumers_disconnected: number;
      }>(
        `SELECT consumers_population, consumers_legal, consumers_active, consumers_disconnected
           FROM fact.mfy_monthly_return WHERE mfy_id = $1 AND period_month = $2::date`,
        [f.mfy_id, PREV_PERIOD],
      );
      const p = mr.rows[0] ?? {
        consumers_population: 0, consumers_legal: 0, consumers_active: 0, consumers_disconnected: 0,
      };
      await c.query(
        `INSERT INTO fact.mfy_monthly_return
           (submission_id, mfy_id, period_month, consumers_population, consumers_legal,
            consumers_active, consumers_disconnected, consumers_new, consumers_disconnected_new,
            debt_population_mln, debt_legal_mln, debt_budget_mln,
            meters_offline_cnt, low_consumption_cnt, meters_replace_need_cnt, meters_replaced_cnt)
         VALUES ($1, $2, $3::date, $4, $5, $6, $7, 0, 0, 0, 0, 0, 0, 0, 0, 0)`,
        [subIds.get('MONTHLY_RETURN'), f.mfy_id, FROM_DATE, p.consumers_population,
          p.consumers_legal, p.consumers_active, p.consumers_disconnected],
      );
    }

    // TP kesimi - iyul ko'rsatkichidan davom etadi.
    await c.query(
      `INSERT INTO fact.tp_monthly
         (tp_id, period_month, consumers_total, consumers_active, consumers_disconnected,
          meter_no, meter_coef, reading_prev, reading_curr, kwh_month)
       SELECT tp_id, $2::date, consumers_total, consumers_active, consumers_disconnected,
              meter_no, meter_coef, reading_curr,
              round((reading_curr + (kwh_month * $3::numeric) / meter_coef)::numeric, 2),
              round((kwh_month * $3::numeric)::numeric, 2)
         FROM fact.tp_monthly WHERE period_month = $1::date`,
      [PREV_PERIOD, FROM_DATE, (SCALE * drift).toFixed(6)],
    );

    await c.query('COMMIT');
    for (const r of trg.rows) await c.query(`ALTER TABLE ${r.sch}.${r.tbl} ENABLE TRIGGER zz_audit`);

    console.log('\nAgregatlar qayta qurilmoqda…');
    await c.query('SELECT agg.refresh_all(false)');

    const check = await c.query(`
      SELECT to_char(a.period_month,'YYYY-MM') AS davr, m.short_name AS fider, a.days_filled,
             round(a.kwh_in)::int AS kwh_in, round(a.kwh_sold)::int AS sotilgan, a.loss_pct
        FROM agg.mfy_monthly a JOIN ref.mfy m ON m.id = a.mfy_id
       WHERE a.period_month = $1::date ORDER BY m.sort_order`, [FROM_DATE]);
    console.log('\nNatija (agg.mfy_monthly, avgust 1-8):');
    console.table(check.rows);

    const anom = await c.query(`
      SELECT t.code, count(*) AS kunlar, round(min(d.loss_pct), 1) AS eng_past_pct,
             count(*) FILTER (WHERE d.source = 'EXCEL') AS haqiqiy
        FROM fact.tp_loss_daily d JOIN ref.tp t ON t.id = d.tp_id
       WHERE d.biz_date BETWEEN $1::date AND $2::date
       GROUP BY t.code HAVING min(d.loss_pct) < -50
       ORDER BY min(d.loss_pct) LIMIT 10`, [FROM_DATE, TO_DATE]);
    console.log(`\nEng yirik anomaliyalar (yo‘qotish foizi manfiy - iste’molchilar balansdan ko‘p):`);
    console.table(anom.rows);

    const tot = await c.query<{ kwh_in: string; kwh_sold: string; loss_pct: string }>(`
      SELECT round(sum(a.kwh_in))::text AS kwh_in, round(sum(a.kwh_sold))::text AS kwh_sold,
             round(100 * sum(a.kwh_loss_total) / nullif(sum(a.kwh_in), 0), 1)::text AS loss_pct
        FROM agg.mfy_monthly a WHERE a.period_month = $1::date`, [FROM_DATE]);
    const t = tot.rows[0]!;
    console.log(`\nAVGUST 1-8 JAMI: kirgan ${num(Number(t.kwh_in))} kWh`
      + ` · sotilgan ${num(Number(t.kwh_sold))} kWh · yo‘qotish ${t.loss_pct}%`);
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    c.release();
    await pool.end();
  }
}

await main();
