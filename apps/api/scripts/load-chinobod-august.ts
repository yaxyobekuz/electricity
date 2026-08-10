/**
 * Chinobod ETK, XAQULOBOD FIDERI - AVGUST 2026: kunlik TP yo'qotishi.
 *
 * AVVAL avgust (2026-08-01 … 2026-08-08) BUTUNLAY tozalanadi, so'ng manba
 * fayllardagi HAQIQIY qatorlar yoziladi. Iyulga TEGILMAYDI.
 *
 * Ikkita manba fayl - ikkalasi ham TP kesimidagi KUNLIK hisobot:
 *   • `1-8.xlsx`
 *       - `Sheet0`      → 1-avgust, butun ETK (329 qator)
 *       - `Sheet0 (2)`  → 1-avgust (37 qator) va 8-avgust (33 qator),
 *                         13-ustunda «Аниқланган камчиликлар» izohi
 *   • `2-5.xlsx`
 *       - «бир кунлик»  → 2-avgust (6 qator) va 5-avgust (7 qator),
 *                         8-ustunda «Хатловдан кейин» belgisi
 *
 * `Sheet0` va `Sheet0 (2)` ning 1-avgust bloklari qator-ma-qator BIR XIL
 * (tekshirildi: 0 ta ziddiyat), shuning uchun takror sifatida birlashtiriladi.
 *
 * SUN'IY MA'LUMOT YOZILMAYDI. Manbada bo'lmagan (TP × kun) juftligi bo'sh
 * qoladi - avval bu yerda `source='MANUAL'` qatorlari generatsiya qilinardi,
 * endi yo'q: dashboard faqat o'lchangan raqamni ko'rsatishi kerak.
 *
 * ENERGIYA BALANSI ham SHU fayllardan chiqadi: kunlik «kirgan» - balans
 * hisoblagichlarining, «sotilgan» - biriktirilgan iste'molchilarning
 * yig'indisi. Fider kirish hisoblagichi bu fayllarda YO'Q (iyulda u
 * `data/umumiy_hisobot.xlsx` dan - 19 850 → 20 112, ×4 000 - olingan edi),
 * shuning uchun avgust TP kesimidagi o'lchovga tayanadi.
 *
 * BALANSGA FAQAT SOZ HISOBLAGICHLI TP LAR KIRADI. Balans hisoblagichi o'z
 * iste'molchilaridan kam ko'rsatgan TP (1-avgustda 51 tadan 25 tasi) -
 * yaroqsiz o'lchov, manbada sababi ham yozilgan: «Баланс хисоблагич тока
 * трансформатори носоз». Ular qo'shilsa fider bo'yicha "sotilgan" kirgandan
 * 152.8% chiqib, yo'qotish −52.8% bo'lardi. Chiqarilgan TP lar
 * `fact.tp_loss_daily` da to'liq turadi - TP panellari ularni ko'rsatadi.
 *
 *   node --experimental-strip-types apps/api/scripts/load-chinobod-august.ts
 *
 * Oldin `load-chinobod-july.ts` ishga tushirilgan bo'lishi shart.
 * Idempotent - qayta ishga tushirsa natija AYNAN o'sha.
 */
import { join } from 'node:path';

import ExcelJS from 'exceljs';
import pg from 'pg';

import { num } from '@beap/shared';

import { config, REPO_ROOT } from '../src/config.ts';
import { tpCodeOf } from './chinobod-common.ts';

const PERIOD = '2026-08';
const FROM_DATE = `${PERIOD}-01`;
const TO_DATE = `${PERIOD}-08`; // kelajak sana YO'Q (`tld_no_future`)
const PREV_PERIOD = '2026-07-01';

/**
 * Texnologik yo'qotish normasi - kirgan energiyaning 12% i.
 * `data/umumiy_hisobot.xlsx` ning har bir qatorida shu nisbat AYNAN
 * bajarilgan (Хақулобод 1 048 000 → 125 760), ya'ni hujjatning o'z normasi.
 */
const TECH_LOSS_RATE = 0.12;

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
  /** «Бриктирилган истеъмолчилар» / «Хатловдан кейин» ustuni - 74/80 ko'rinishida. */
  inspection: string | null;
  /** «Аниқланган камчиликлар» - hisoblagich nosozligi izohi. */
  defect: string | null;
  /** Manbadagi manfiy qiymat - CHECK talabi bo'yicha 0 ga qisilgan bo'lsa. */
  clampedFrom: number | null;
  file: string;
}

/** `kwh_balance_meter >= 0` CHECK - manfiy o'qish 0 ga qisiladi, asli izohda qoladi. */
function mkRow(
  code: string, date: string, balance: number, attached: number,
  inspection: string | null, defect: string | null, file: string,
): RealRow {
  return {
    code, date,
    balance: Math.max(0, balance),
    attached: Math.max(0, attached),
    inspection,
    defect,
    clampedFrom: balance < 0 ? balance : null,
    file,
  };
}

async function sheetOf(file: string, name: string): Promise<ExcelJS.Worksheet | undefined> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(join(REPO_ROOT, file));
  const ws = name === '*'
    ? wb.worksheets.find((w) => w.name.includes('кунлик'))
    : wb.getWorksheet(name);
  if (!ws) {
    throw new Error(
      `${file} ichida «${name}» varag'i topilmadi - varaqlar: `
      + wb.worksheets.map((w) => w.name).join(', '),
    );
  }
  return ws;
}

/** Matnli katak - bo'sh va «/» kabi xizmat qiymatlari `null` ga aylanadi. */
function textOf(row: ExcelJS.Row, col: number | undefined): string | null {
  if (col === undefined) return null;
  const s = String(val(row.getCell(col).value)).trim();
  return s && s !== '/' ? s : null;
}

interface BlockMap {
  /** 1-sana bloki. */
  d1: number; b1: number; a1: number;
  /** 2-sana bloki - bitta sanali varaqda yo'q. */
  d2?: number; b2?: number; a2?: number;
  /** «Бриктирилган истеъмолчилар» / «Хатловдан кейин». */
  inspection?: number;
  /** «Аниқланган камчиликлар». */
  defect?: number;
}

/**
 * Varaqni o'qiydi. Ikkinchi sana bloki bo'lsa - o'sha qatordan ikkita
 * (TP, sana) qatori chiqadi.
 *
 * Izoh ustunlari jismonan qatorga tegishli, ya'ni IKKALA sanaga ham; lekin
 * «Хатловдан кейин» aynan 1-blokdagi holatni tavsiflaydi, shuning uchun u
 * faqat birinchi qatorga yoziladi. «Аниқланган камчиликлар» esa TP ning
 * umumiy holati - ikkalasiga ham tegishli.
 */
async function readSheet(file: string, sheet: string, c: BlockMap): Promise<RealRow[]> {
  const ws = await sheetOf(file, sheet);
  if (!ws) return [];
  const out: RealRow[] = [];
  for (let r = 5; r <= ws.rowCount; r += 1) {
    const row = ws.getRow(r);
    const raw = String(val(row.getCell(2).value)).trim();
    // «Жами» / «Total» / «TR-box» kabi xizmat qatorlari raqam bilan boshlanmaydi.
    if (!/^\d/.test(raw)) continue;
    const code = tpCodeOf(raw);
    const inspection = textOf(row, c.inspection);
    const defect = textOf(row, c.defect);

    const d1 = dateOf(row.getCell(c.d1).value);
    const b1 = numOf(row.getCell(c.b1).value);
    const a1 = numOf(row.getCell(c.a1).value);
    if (d1 && b1 !== null && a1 !== null) {
      out.push(mkRow(code, d1, b1, a1, inspection, defect, file));
    }

    if (c.d2 === undefined || c.b2 === undefined || c.a2 === undefined) continue;
    const d2 = dateOf(row.getCell(c.d2).value);
    const b2 = numOf(row.getCell(c.b2).value);
    const a2 = numOf(row.getCell(c.a2).value);
    if (d2 && b2 !== null && a2 !== null) {
      out.push(mkRow(code, d2, b2, a2, null, defect, file));
    }
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  // ── 1. Haqiqiy qatorlarni yig'ish ──────────────────────────────────────
  const parts = await Promise.all([
    readSheet('1-8.xlsx', 'Sheet0', { d1: 3, b1: 4, a1: 5, inspection: 7 }),
    readSheet('1-8.xlsx', 'Sheet0 (2)',
      { d1: 3, b1: 4, a1: 5, d2: 8, b2: 9, a2: 10, inspection: 7, defect: 13 }),
    readSheet('2-5.xlsx', '*',
      { d1: 3, b1: 4, a1: 5, d2: 9, b2: 10, a2: 11, inspection: 8 }),
  ]);

  /*
   * Takrorlarni birlashtirish: bitta (TP, sana) bir necha varaqda uchraydi.
   * Birinchi ko'rilgani saqlanadi, izohlar esa TO'PLANADI - `Sheet0` da
   * iste'molchilar nisbati bor, `Sheet0 (2)` da esa nosozlik matni.
   */
  const real = new Map<string, RealRow>();
  const conflicts: string[] = [];
  for (const row of parts.flat()) {
    if (row.date < FROM_DATE || row.date > TO_DATE) continue;
    const key = `${row.code}:${row.date}`;
    const prev = real.get(key);
    if (!prev) { real.set(key, row); continue; }
    if (Math.abs(prev.balance - row.balance) > 0.01
      || Math.abs(prev.attached - row.attached) > 0.01) {
      conflicts.push(`${key}: ${prev.balance}/${prev.attached} (${prev.file})`
        + ` ≠ ${row.balance}/${row.attached} (${row.file})`);
    }
    real.set(key, {
      ...prev,
      inspection: prev.inspection ?? row.inspection,
      defect: prev.defect ?? row.defect,
    });
  }

  const byDate = new Map<string, number>();
  for (const r of real.values()) byDate.set(r.date, (byDate.get(r.date) ?? 0) + 1);
  console.log(`\nAVGUST ${PERIOD} - manbadagi haqiqiy qatorlar (${real.size} ta):`);
  for (const d of [...byDate.keys()].sort()) console.log(`   ${d}: ${byDate.get(d)} ta TP`);
  if (conflicts.length > 0) {
    console.log(`\n   ⚠ ${conflicts.length} ta (TP, sana) juftligi varaqlar orasida ZIDDIYATLI:`);
    for (const x of conflicts.slice(0, 5)) console.log(`     ${x}`);
  }

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

    const tpRows = await c.query<{ id: number; code: string }>(
      `SELECT id, code FROM ref.tp ORDER BY code`);
    if (tpRows.rows.length === 0) {
      throw new Error('ref.tp bo‘sh - avval load-chinobod-july.ts ishga tushiring');
    }
    const tpIdByCode = new Map(tpRows.rows.map((t) => [t.code, t.id]));

    /*
     * `Sheet0` butun Chinobod ETK ni sanaydi, registrda esa faqat Xaqulobod
     * fiderining TP lari bor. Boshqa fiderlarning qatorlari tashlab
     * yuboriladi - bu kutilgan hol, xato emas.
     */
    const unknown = [...new Set([...real.values()].map((r) => r.code))]
      .filter((x) => !tpIdByCode.has(x));
    if (unknown.length > 0) {
      console.log(`\n   ℹ ${unknown.length} ta TP boshqa fiderlarga tegishli - o‘tkazib yuborildi`
        + ` (registrda ${tpIdByCode.size} ta Xaqulobod TP si bor)`);
    }

    // ── 2. AVGUSTNI BUTUNLAY TOZALASH (iyulga TEGMAYDI) ──────────────────
    const wiped: string[] = [];
    const wipe = async (label: string, sql: string, params: unknown[]): Promise<void> => {
      const r = await c.query(sql, params);
      if (r.rowCount) wiped.push(`${label}: ${r.rowCount}`);
    };
    await wipe('tp_loss_daily',
      `DELETE FROM fact.tp_loss_daily WHERE biz_date BETWEEN $1::date AND $2::date`,
      [FROM_DATE, TO_DATE]);
    await wipe('energy_balance_daily',
      `DELETE FROM fact.energy_balance_daily WHERE biz_date >= $1::date`, [FROM_DATE]);
    await wipe('tp_monthly',
      `DELETE FROM fact.tp_monthly WHERE period_month >= $1::date`, [FROM_DATE]);
    await wipe('tp_status_monthly',
      `DELETE FROM fact.tp_status_monthly WHERE period_month >= $1::date`, [FROM_DATE]);
    await wipe('mfy_monthly_return',
      `DELETE FROM fact.mfy_monthly_return WHERE period_month >= $1::date`, [FROM_DATE]);
    await wipe('feeder_monthly',
      `DELETE FROM fact.feeder_monthly WHERE period_month >= $1::date`, [FROM_DATE]);
    await wipe('network_defect',
      `DELETE FROM fact.network_defect WHERE period_month >= $1::date`, [FROM_DATE]);
    await wipe('debt_top_entry',
      `DELETE FROM fact.debt_top_entry WHERE period_month >= $1::date`, [FROM_DATE]);
    // Ishlar va dalolatnomalar sanaga bog'liq - avgustdagilari ham ketadi.
    await wipe('violation_act',
      `DELETE FROM fact.violation_act WHERE act_date >= $1::date`, [FROM_DATE]);
    await wipe('work',
      `DELETE FROM fact.work
        WHERE coalesce(actual_end, planned_end, planned_start) >= $1::date`,
      [FROM_DATE]);
    await wipe('submission',
      `DELETE FROM fact.submission WHERE period_start >= $1::date`, [FROM_DATE]);

    console.log(`\n   Avgust tozalandi → ${wiped.length > 0 ? wiped.join(', ') : 'bo‘sh edi'}`);

    // ── 3. fact.tp_loss_daily - FAQAT haqiqiy qatorlar ───────────────────
    type Ins = [number, string, number, number, string | null, string, string, string | null];
    const inserts: Ins[] = [];
    for (const r of real.values()) {
      const id = tpIdByCode.get(r.code);
      if (!id) continue;
      /*
       * Ikki izoh bitta ustunga sig'adi: nosozlik matni birinchi, iste'molchi
       * nisbati keyin - hokim kartani ochganda avval SABABNI ko'radi.
       */
      const notes = [
        r.defect,
        r.clampedFrom !== null
          ? `Manbadagi balans hisoblagichi ${r.clampedFrom} kWh (manfiy)`
            + ` - sxema talabi bo'yicha 0 ga qisildi`
          : null,
      ].filter((x): x is string => x !== null);
      inserts.push([
        id, r.date, r.balance, r.attached, r.inspection,
        'EXCEL', r.file, notes.length > 0 ? notes.join('; ') : null,
      ]);
    }

    for (let i = 0; i < inserts.length; i += 500) {
      const chunk = inserts.slice(i, i + 500);
      const vals = chunk.map((_, k) => {
        const b = k * 8;
        return `($${b + 1}, $${b + 2}::date, $${b + 3}, $${b + 4},`
          + ` $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8})`;
      }).join(',');
      await c.query(
        `INSERT INTO fact.tp_loss_daily
           (tp_id, biz_date, kwh_balance_meter, kwh_consumers_attached,
            inspection_note, source, file_name, note)
         VALUES ${vals}`,
        chunk.flat(),
      );
    }
    console.log(`   fact.tp_loss_daily: ${inserts.length} ta HAQIQIY qator`
      + ` (sun'iy to‘ldirish yo‘q)`);

    // ── 4. Energiya balansi - FAQAT SOZ hisoblagichli TP lardan ──────────
    /*
     * Kunlik balans TP qatorlarining yig'indisi: kirgan = balans
     * hisoblagichlari, sotilgan = biriktirilgan iste'molchilar. Fider kirish
     * hisoblagichining avgust ko'rsatkichi hujjatlarda YO'Q, shuning uchun
     * iyuldagi 19 850 → 20 112 usuli bu oyga qo'llanmaydi.
     *
     * NOSOZ HISOBLAGICHLAR BALANSDAN CHIQARILADI. Balans hisoblagichi o'z
     * iste'molchilaridan KAM ko'rsatgan TP - fizik jihatdan imkonsiz holat,
     * ya'ni o'lchov yaroqsiz; manbaning o'zi sababini yozgan («Баланс
     * хисоблагич тока трансформатори носоз»). 1-avgustda 51 TP dan 25 tasi
     * shunday. Ularni qo'shsak, fider bo'yicha "sotilgan" kirgandan 152.8%
     * chiqib, yo'qotish −52.8% bo'lardi - bu KPI emas, o'lchov xatosi.
     *
     * Chiqarilgan TP lar YO'QOLMAYDI: `fact.tp_loss_daily` da 51 tasi ham
     * turibdi, nosozlik izohi bilan - TP panellari ularni ko'rsatadi.
     * Qamrov quyida bosma ko'rinishda chiqadi.
     */
    const mfyRow = await c.query<{ id: number }>(
      `SELECT DISTINCT mfy_id AS id FROM ref.tp LIMIT 1`);
    const mfyId = mfyRow.rows[0]!.id;

    const admin = await c.query<{ id: number }>(
      `SELECT id FROM sec.app_user WHERE role = 'admin' ORDER BY id LIMIT 1`);
    const adminId = admin.rows[0]!.id;

    const subIds = new Map<string, number>();
    for (const domain of ['ENERGY_BALANCE', 'MONTHLY_RETURN']) {
      const s = await c.query<{ id: number }>(
        `INSERT INTO fact.submission
           (scope_type, scope_id, domain, period_type, period_start, period_end,
            status, created_by, submitted_at, reviewed_by, reviewed_at)
         VALUES ('MFY', $1, $2, 'MONTH', $3::date, $4::date, 'approved', $5,
                 $4::date + time '09:00', $5, $4::date + time '14:00')
         RETURNING id`,
        [mfyId, domain, FROM_DATE, TO_DATE, adminId],
      );
      subIds.set(domain, s.rows[0]!.id);
    }

    /**
     * Kunlik jam - registrdagi TP lar, o'lchangan sanalar, SOZ hisoblagich.
     * `skipped` - chiqarilgan TP lar, ular ham hisobda ko'rinsin uchun.
     */
    const perDay = new Map<string, {
      kwhIn: number; kwhSold: number; tp: number; skipTp: number; skipSold: number;
    }>();
    for (const ins of inserts) {
      const [, date, balance, attached] = ins;
      const d = perDay.get(date)
        ?? { kwhIn: 0, kwhSold: 0, tp: 0, skipTp: 0, skipSold: 0 };
      if (balance >= attached) {
        d.kwhIn += balance; d.kwhSold += attached; d.tp += 1;
      } else {
        d.skipTp += 1; d.skipSold += attached;
      }
      perDay.set(date, d);
    }

    let sumIn = 0; let sumSold = 0; let skipTp = 0; let skipSold = 0;
    for (const date of [...perDay.keys()].sort()) {
      const d = perDay.get(date)!;
      skipTp += d.skipTp; skipSold += d.skipSold;
      if (d.tp === 0) continue; // O'sha kuni bironta soz hisoblagich yo'q.
      const loss = d.kwhIn - d.kwhSold;
      /*
       * Yo'qotish taqsimoti - hujjatning o'z normasi bo'yicha 12% gacha
       * texnik, qolgani tijoriy. Yo'qotish 12% dan kichik bo'lsa hammasi
       * texnik, tijoriy qism 0 - "noqonuniy foydalanish manfiy" chiqmasin.
       */
      const technical = Math.min(loss, d.kwhIn * TECH_LOSS_RATE);
      const illegal = loss - technical;
      sumIn += d.kwhIn; sumSold += d.kwhSold;

      await c.query(
        `INSERT INTO fact.energy_balance_daily
           (submission_id, mfy_id, biz_date, kwh_in, kwh_sold,
            kwh_loss_natural, kwh_loss_technical, kwh_loss_illegal)
         VALUES ($1, $2, $3::date, $4, $5, 0, $6, $7)`,
        [subIds.get('ENERGY_BALANCE'), mfyId, date,
          d.kwhIn.toFixed(2), d.kwhSold.toFixed(2),
          technical.toFixed(2), illegal.toFixed(2)],
      );
    }

    /*
     * `fact.feeder_monthly` AVGUST UCHUN YOZILMAYDI.
     *
     * O'sha jadval FIDER KIRISH HISOBLAGICHINING ko'rsatkichini saqlaydi
     * (iyul: 19 850 → 20 112) va «Fider hisoblagichi» kartasi aynan shu ikki
     * raqamni ko'rsatadi. Avgust uchun bunday o'lchov hujjatlarda YO'Q -
     * TP yig'indisidan "joriy ko'rsatkich" yasash o'qilmagan hisoblagichni
     * o'qilgandek ko'rsatish bo'lardi. Karta ma'lumot yo'qligini aytadi.
     */

    /*
     * Iste'molchilar - manbadagi «Бриктирилган истеъмолчилар» ustunidan
     * (74/80 = faol/jami). 1-avgust to'liq kesim bergani uchun shu kun
     * olinadi. Aholi/yuridik bo'linishi manbada YO'Q - iyuldagi nisbat
     * bo'yicha taqsimlanadi, chunki 8 kunda tarkib o'zgarmaydi.
     */
    let active = 0; let total = 0;
    for (const r of real.values()) {
      if (r.date !== FROM_DATE || !tpIdByCode.has(r.code) || !r.inspection) continue;
      const m = /^(\d+)\s*\/\s*(\d+)$/.exec(r.inspection);
      if (!m) continue;
      active += Number(m[1]);
      total += Number(m[2]);
    }
    const jr = await c.query<{ pop: number; leg: number }>(
      `SELECT consumers_population AS pop, consumers_legal AS leg
         FROM fact.mfy_monthly_return WHERE mfy_id = $1 AND period_month = $2::date`,
      [mfyId, PREV_PERIOD],
    );
    const prev = jr.rows[0];
    const share = prev && prev.pop + prev.leg > 0 ? prev.pop / (prev.pop + prev.leg) : 1;
    const pop = Math.round(total * share);
    await c.query(
      `INSERT INTO fact.mfy_monthly_return
         (submission_id, mfy_id, period_month, consumers_population, consumers_legal,
          consumers_active, consumers_disconnected, consumers_new, consumers_disconnected_new,
          debt_population_mln, debt_legal_mln, debt_budget_mln,
          meters_offline_cnt, low_consumption_cnt, meters_replace_need_cnt, meters_replaced_cnt)
       VALUES ($1, $2, $3::date, $4, $5, $6, $7, 0, 0, 0, 0, 0, $8, 0, 0, 0)`,
      [subIds.get('MONTHLY_RETURN'), mfyId, FROM_DATE, pop, total - pop,
        active, Math.max(0, total - active),
        // Ishlamayotgan hisoblagich - manbada nomi bilan qayd etilgan TP lar.
        [...real.values()].filter((r) => r.date === FROM_DATE && r.defect).length],
    );

    console.log(`   fact.energy_balance_daily: ${perDay.size} ta o‘lchangan kun,`
      + ` kirgan ${num(Math.round(sumIn))} kWh · sotilgan ${num(Math.round(sumSold))} kWh`);
    console.log(`   balansdan chiqarilgan: ${skipTp} ta (TP × kun) nosoz hisoblagich`
      + ` - ularning iste’moli ${num(Math.round(skipSold))} kWh`);
    console.log(`   fact.mfy_monthly_return: ${active}/${total} faol iste’molchi`);
    console.log(`   fact.feeder_monthly: YOZILMADI - avgust uchun fider`
      + ` hisoblagichi ko‘rsatkichi hujjatlarda yo‘q`);

    await c.query('COMMIT');
    for (const r of trg.rows) await c.query(`ALTER TABLE ${r.sch}.${r.tbl} ENABLE TRIGGER zz_audit`);

    console.log('\nAgregatlar qayta qurilmoqda…');
    await c.query('SELECT agg.refresh_all(false)');

    // ── 4. Natijani ko'rsatish ───────────────────────────────────────────
    const daily = await c.query(`
      SELECT d.biz_date::text AS sana, count(*)::int AS tp,
             round(sum(d.kwh_balance_meter))::int      AS balans_kwh,
             round(sum(d.kwh_consumers_attached))::int AS biriktirilgan_kwh,
             round(sum(d.kwh_loss))::int               AS yoqotish_kwh,
             round(100 * sum(d.kwh_loss)
                   / nullif(sum(d.kwh_balance_meter), 0), 1)::float8 AS yoqotish_pct,
             count(*) FILTER (WHERE d.kwh_loss < 0)::int AS manfiy_tp
        FROM fact.tp_loss_daily d
       WHERE d.biz_date BETWEEN $1::date AND $2::date
       GROUP BY 1 ORDER BY 1`, [FROM_DATE, TO_DATE]);
    console.log('\nAVGUST 1-8 - kunlik TP kesimi (haqiqiy o‘lchov):');
    console.table(daily.rows);

    const tot = await c.query<{ b: string; a: string; l: string; pct: string; neg: string }>(`
      SELECT round(sum(kwh_balance_meter))::text      AS b,
             round(sum(kwh_consumers_attached))::text AS a,
             round(sum(kwh_loss))::text               AS l,
             round(100 * sum(kwh_loss) / nullif(sum(kwh_balance_meter), 0), 1)::text AS pct,
             count(*) FILTER (WHERE kwh_loss < 0)::text AS neg
        FROM fact.tp_loss_daily WHERE biz_date BETWEEN $1::date AND $2::date`,
      [FROM_DATE, TO_DATE]);
    const t = tot.rows[0]!;
    console.log(`\nJAMI: balans ${num(Number(t.b))} kWh · biriktirilgan ${num(Number(t.a))} kWh`
      + ` · yo‘qotish ${num(Number(t.l))} kWh (${t.pct}%)`);
    console.log(`   ${t.neg} ta qatorda yo‘qotish MANFIY - biriktirilgan iste’molchilar`
      + ` balans hisoblagichidan ko‘p o‘qigan.`);

    const defects = await c.query(`
      SELECT d.note, count(DISTINCT d.tp_id)::int AS tp_soni
        FROM fact.tp_loss_daily d
       WHERE d.biz_date BETWEEN $1::date AND $2::date AND d.note IS NOT NULL
       GROUP BY 1 ORDER BY 2 DESC LIMIT 5`, [FROM_DATE, TO_DATE]);
    if (defects.rows.length > 0) {
      console.log('\nManbada qayd etilgan nosozliklar:');
      console.table(defects.rows);
    }

    const agg = await c.query(`
      SELECT to_char(period_month,'YYYY-MM') AS oy, days_filled,
             round(kwh_in)::int AS kwh_in, round(kwh_sold)::int AS sotilgan,
             round(kwh_loss_total)::int AS yoqotish, loss_pct::float8 AS yoqotish_pct
        FROM agg.mfy_monthly ORDER BY 1`);
    console.log('\nIYUL ↔ AVGUST (agg.mfy_monthly - dashboard shu jadvaldan o‘qiydi):');
    console.table(agg.rows);
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    c.release();
    await pool.end();
  }
}

await main();
