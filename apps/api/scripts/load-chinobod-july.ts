/**
 * Chinobod ETK, XAQULOBOD FIDERI - IYUL 2026: registr va oylik hisobot.
 *
 * QAMROV: tizim BITTA 10 kV fider ustida ishlaydi - Chinobod nimstansiyasining
 * «Xaqulobod» fideri va uning 51 ta TP si (`0013_feeder_level.sql` dagi qaror).
 *
 * Manba hisobotlar butun ETK ni qamraydi, biz esa undan FAQAT shu fiderning
 * qatorlarini olamiz. Jamlashtirish YO'Q: nimstansiyaning boshqa 10 ta 10 kV
 * yo'nalishi (ЧПЗ, Бўзчи, Камолий, Ташлама va h.k.) boshqa fiderlarga tegishli
 * va bu yerga qo'shilmaydi - aks holda fider iste'moli 1.05 mln o'rniga
 * 4.32 mln kWh bo'lib, hisoblagich ko'rsatkichi bilan mos kelmay qolardi.
 *
 * Ikkita manba fayl:
 *   • `data/umumiy_hisobot.xlsx` - «Хақулобод» qatori: hisoblagich
 *     19 850 → 20 112, koeffitsient 4 000, ya'ni 1 048 000 kWh.
 *   • `data/toliq_hisobot.xlsx` (`0108` varaq) - TP KESIMI. 143 qatordan
 *     4-ustuni «Xaqulobod» bo'lgan 51 tasi olinadi: hisoblagich,
 *     koeffitsient, 01.07/01.08 ko'rsatkichlari, oylik iste'mol, iste'molchi.
 *
 * `8-1-2026.xlsx` bu yerda O'QILMAYDI - u kunlik hisobot, `load-chinobod-
 * august.ts` ning ishi. (Uning `Sheet0` varag'i 355 ta TP ni sanaydi, lekin
 * ular butun ETK niki; Xaqulobodniki - aynan shu 51 ta.)
 *
 *   node --experimental-strip-types apps/api/scripts/load-chinobod-july.ts
 *
 * NIMA QILADI: barcha eski fakt ma'lumotini va registrni o'chiradi, o'rniga
 * Xaqulobod fiderining haqiqiy ma'lumotini yozadi. Idempotent - qayta ishga
 * tushirsa natija bir xil.
 *
 * NIMA HISOBLANMAYDI: TP quvvati (kVA), masofasi, kuchlanish, qarzdorlik,
 * ishlar, buzilishlar - bu ma'lumotlar manba hisobotlarda YO'Q. Ularni
 * alohida `fill-derived-data.ts` o'lchangan raqamlardan keltirib chiqaradi.
 */
import { join } from 'node:path';

import ExcelJS from 'exceljs';
import pg from 'pg';

import { num } from '@beap/shared';

import { config, REPO_ROOT } from '../src/config.ts';
import { tpCodeOf } from './chinobod-common.ts';

const PERIOD = '2026-07';
const P_START = `${PERIOD}-01`;
const DAYS = 31;

/** Yagona hisob birligi - `ref.mfy` ning bitta qatori. */
export const FEEDER = {
  code: 'FIDER-XAQULOBOD',
  nameUz: 'Xaqulobod fideri',
  nameCyr: 'Хақулобод фидери',
  shortName: 'Xaqulobod',
  /** «Умумий ҳисобот» dagi yozilishi (kirill) - fider balansi shu qatordan. */
  summaryLabel: 'Хақулобод',
  /** «Тўлиқ ҳисобот» dagi yozilishi (lotin) - TP lar shu ustun bo'yicha filtrlanadi. */
  detailLabel: 'Xaqulobod',
} as const;

const ELEKTROSET_CODE = 'CHINOBOD';
const SUBSTATION_FALLBACK = 'НИМ станция Чинобод 110/35/10';

/**
 * Fider bo'yicha mas'ul shaxs. Manba hujjatlarda F.I.Sh. yo'q, shuning uchun
 * `sec.app_user` dagi bilan bir xil uslubda - LAVOZIM bo'yicha yoziladi.
 * Haqiqiy ism-sharif sozlamalar sahifasidan kiritiladi.
 *
 * `position` ATAYLAB bo'sh: panelda ismdan keyin darhol telefon raqami
 * turishi kerak, oraliqdagi lavozim satri esa keraksiz.
 */
const RESPONSIBLE = {
  fullName: 'Chinobod ETK - Xaqulobod fideri mas’uli',
  position: null,
  phone: '+998 74 000 00 00',
} as const;

/** Kunlik ritm - hafta oxiri pastroq. Tasodif yo'q, natija takrorlanadi. */
const DAY_WEIGHTS = Array.from({ length: DAYS }, (_, i) => {
  const dow = (i + 3) % 7; // 2026-07-01 - chorshanba
  return dow === 5 || dow === 6 ? 0.92 : 1.03;
});

const DATA_DIR = join(REPO_ROOT, 'data');

// ═══════════════════════════════════════════════════════════════════════════
// Excel yordamchilari
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

const numOf = (x: ExcelJS.CellValue): number => {
  const v = val(x);
  if (typeof v === 'number') return v;
  const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

// ═══════════════════════════════════════════════════════════════════════════
// Manbalarni o'qish
// ═══════════════════════════════════════════════════════════════════════════

interface SummaryRow {
  name: string; substation: string; input: string;
  meterPrev: number; meterCurr: number; coef: number;
  kwhIn: number; kwhFlow: number;
}

/** «Умумий ҳисобот» - FAQAT «Хақулобод» qatori. */
async function readSummary(): Promise<SummaryRow> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(join(DATA_DIR, 'umumiy_hisobot.xlsx'));
  const ws = wb.worksheets[0]!;

  let input = '';
  for (let r = 1; r <= ws.rowCount; r += 1) {
    const row = ws.getRow(r);
    // 3-ustunda «ВВОД Т1/Т2 …» - undan keyingi fiderlar shu vvodga tegishli.
    const c3 = String(val(row.getCell(3).value)).trim();
    if (/ВВОД/i.test(c3)) { input = c3.replace(/\s+/g, ' '); continue; }
    if (String(val(row.getCell(4).value)).trim() !== FEEDER.summaryLabel) continue;

    return {
      name: FEEDER.summaryLabel, input,
      substation: String(val(row.getCell(2).value)).trim() || SUBSTATION_FALLBACK,
      meterPrev: numOf(row.getCell(5).value),
      meterCurr: numOf(row.getCell(6).value),
      coef: numOf(row.getCell(8).value) || 1,
      kwhIn: numOf(row.getCell(9).value),
      kwhFlow: numOf(row.getCell(10).value),
    };
  }
  throw new Error(`umumiy_hisobot.xlsx: «${FEEDER.summaryLabel}» fideri topilmadi`);
}

interface TpRow {
  code: string;
  total: number; active: number; disconnected: number;
  meterNo: string; coef: number; prev: number; curr: number; kwh: number;
}

async function readTps(): Promise<TpRow[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(join(DATA_DIR, 'toliq_hisobot.xlsx'));
  const ws = wb.getWorksheet('0108') ?? wb.worksheets[0]!;

  const out: TpRow[] = [];
  for (let r = 4; r <= ws.rowCount; r += 1) {
    const row = ws.getRow(r);
    const tpNo = String(val(row.getCell(3).value)).trim();
    if (!tpNo) continue;
    // 4-ustun - TP qaysi 10 kV fiderga ulangani. Faqat o'zimizniki kerak.
    if (String(val(row.getCell(4).value)).trim() !== FEEDER.detailLabel) continue;

    const coef = numOf(row.getCell(10).value) || 1;
    const curr = numOf(row.getCell(11).value);
    const prev = numOf(row.getCell(12).value);
    /*
     * Ba'zi kataklarda formula bor, lekin keshlangan qiymati yo'q - bunday
     * qatorda oylik iste'mol ko'rsatkichlar farqidan qayta hisoblanadi.
     */
    const kwh = numOf(row.getCell(14).value) || Math.abs(curr - prev) * coef;

    const total = numOf(row.getCell(5).value);
    const active = numOf(row.getCell(6).value);

    out.push({
      code: tpCodeOf(tpNo),
      total,
      // `tm_active_le_total` CHECK - hujjatda faol > jami chiqib qolsa tenglashtiriladi.
      active: Math.min(active, total),
      disconnected: numOf(row.getCell(7).value),
      meterNo: String(val(row.getCell(9).value)).trim(),
      coef, prev, curr,
      kwh: Number(kwh.toFixed(2)),
    });
  }
  if (out.length === 0) {
    throw new Error(`toliq_hisobot.xlsx: «${FEEDER.detailLabel}» TP lari topilmadi`);
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════

/** Jamini og'irliklar bo'yicha butun sonlarga bo'ladi (eng katta qoldiq usuli). */
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

async function main(): Promise<void> {
  const [summary, tps] = await Promise.all([readSummary(), readTps()]);

  /*
   * BALANS.
   *
   *   kirgan     - fider hisoblagichidan: (20 112 − 19 850) × 4 000 = 1 048 000.
   *                Hujjatdagi «Бир ойлик оқиб ўтган» ustuni bilan aynan bir xil.
   *   sotilgan   - 51 ta TP hisoblagichi YIG'INDISI. Hujjatda «Elektr oqimi»
   *                683 812.3 deb ham yozilgan, lekin TP yig'indisi (724 165)
   *                afzal: u qator-ma-qator tekshiriladi.
   *   yo'qotish  - QOLDIQ: kirgan − sotilgan. Alohida saqlanmaydi, chunki
   *                `fact.feeder_monthly.kwh_loss` shu ayirmadan hosil
   *                bo'ladigan generated ustun.
   */
  const kwhIn = summary.kwhIn;
  const kwhSold = Number(tps.reduce((a, t) => a + t.kwh, 0).toFixed(2));
  const loss = Number((kwhIn - kwhSold).toFixed(2));
  if (loss < 0) {
    throw new Error(`Yo‘qotish manfiy (${loss}) - manba fayllarni tekshiring`);
  }

  const { substation, input: inputName, coef: meterCoef, meterPrev, meterCurr } = summary;
  const fromMeter = Number(((meterCurr - meterPrev) * meterCoef).toFixed(2));

  console.log(`\nIYUL ${PERIOD} - ${FEEDER.nameUz} · ${substation} · ${inputName}\n`);
  console.log(`  hisoblagich  ${num(meterPrev)} → ${num(meterCurr)} × koef ${meterCoef}`
    + ` = ${num(fromMeter)} kWh`);
  if (Math.abs(fromMeter - kwhIn) > 1) {
    console.log(`  ⚠ hujjatdagi «kirgan» ${num(kwhIn)} kWh - hisoblagichdan chiqqan`
      + ` ${num(fromMeter)} kWh bilan mos emas`);
  }
  console.log(`  kirgan       ${num(kwhIn)} kWh`);
  console.log(`  sotilgan     ${num(kwhSold)} kWh - ${tps.length} ta TP hisoblagichi yig‘indisi`);
  if (summary.kwhFlow > 0 && Math.abs(kwhSold - summary.kwhFlow) > 1) {
    console.log(`               (hujjatdagi «Elektr oqimi» ${num(summary.kwhFlow)} kWh,`
      + ` farq ${num(kwhSold - summary.kwhFlow)})`);
  }
  console.log(`  yo‘qotish    ${num(loss)} kWh`
    + ` - ${((loss / kwhIn) * 100).toFixed(1)}%`);
  console.log(`  iste’molchi  ${num(tps.reduce((a, t) => a + t.total, 0))} ta`);

  const allCodes = tps.map((t) => t.code).sort();

  // ── Yozish ─────────────────────────────────────────────────────────────
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

    console.log('\nEski ma’lumot o‘chirilmoqda…');
    await c.query(`
      TRUNCATE fact.tp_reading_daily, fact.energy_balance_daily, fact.mfy_monthly_return,
               fact.tp_status_monthly, fact.tp_monthly, fact.feeder_monthly, fact.tp_loss_daily,
               fact.network_defect, fact.debt_top_entry, fact.violation_act,
               fact.work, fact.work_photo, fact.daily_form, fact.passport_snapshot,
               fact.report_job, fact.submission RESTART IDENTITY CASCADE`);
    await c.query('DELETE FROM ref.network_segment');
    await c.query('DELETE FROM ref.tp');
    await c.query(`DELETE FROM sec.user_scope WHERE scope_type = 'MFY'`);
    await c.query(`DELETE FROM ref.norm WHERE scope_type = 'MFY'`);
    await c.query('DELETE FROM ref.mfy_responsible');
    await c.query('DELETE FROM ref.mfy');

    const es = await c.query<{ id: number }>(
      'SELECT id FROM ref.elektroset WHERE code = $1', [ELEKTROSET_CODE]);
    const esId = es.rows[0]?.id;
    if (!esId) throw new Error(`Elektroset topilmadi: ${ELEKTROSET_CODE}`);

    const mfy = await c.query<{ id: number }>(
      `INSERT INTO ref.mfy (elektroset_id, code, name_uz, name_uz_cyr, short_name,
                            sort_order, grid_row, grid_col)
       VALUES ($1, $2, $3, $4, $5, 1, 1, 1) RETURNING id`,
      [esId, FEEDER.code, FEEDER.nameUz, FEEDER.nameCyr, FEEDER.shortName]);
    const mfyId = mfy.rows[0]!.id;

    const admin = await c.query<{ id: number }>(
      `SELECT id FROM sec.app_user WHERE role = 'admin' ORDER BY id LIMIT 1`);
    const adminId = admin.rows[0]?.id;
    if (!adminId) throw new Error('admin foydalanuvchi topilmadi');

    await c.query(
      `INSERT INTO ref.mfy_responsible (mfy_id, full_name, position, phone, updated_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [mfyId, RESPONSIBLE.fullName, RESPONSIBLE.position, RESPONSIBLE.phone, adminId]);

    const tpIds = new Map<string, number>();
    for (const code of allCodes) {
      // rated_kva va avg_distance_m - NULL: `fill-derived-data.ts` to'ldiradi.
      const ins = await c.query<{ id: number }>(
        `INSERT INTO ref.tp (mfy_id, code, voltage_class) VALUES ($1, $2, '10/0.4') RETURNING id`,
        [mfyId, code]);
      tpIds.set(code, ins.rows[0]!.id);
    }
    console.log(`  ${FEEDER.nameUz} va ${tpIds.size} ta TP registrga yozildi`);

    // ── Konvertlar ────────────────────────────────────────────────────────
    const pEnd = `${PERIOD}-${DAYS}`;
    const subIds = new Map<string, number>();
    for (const domain of ['ENERGY_BALANCE', 'MONTHLY_RETURN']) {
      const s = await c.query<{ id: number }>(
        `INSERT INTO fact.submission
           (scope_type, scope_id, domain, period_type, period_start, period_end,
            status, created_by, submitted_at, reviewed_by, reviewed_at)
         VALUES ('MFY', $1, $2, 'MONTH', $3::date, $4::date, 'approved', $5,
                 $4::date + time '09:00', $5, $4::date + time '14:00')
         RETURNING id`,
        [mfyId, domain, P_START, pEnd, adminId]);
      subIds.set(domain, s.rows[0]!.id);
    }

    await c.query(
      `INSERT INTO fact.feeder_monthly
         (mfy_id, period_month, substation, input_name, meter_prev, meter_curr, meter_coef,
          kwh_in, kwh_sold, source)
       VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, $9, 'EXCEL')`,
      [mfyId, P_START, substation, inputName, meterPrev, meterCurr, meterCoef,
        kwhIn, kwhSold]);

    /*
     * Kunlik balans: oylik jam 31 kunga taqsimlanadi va yig'indisi AYNAN
     * fayldagi songa teng bo'lib qoladi (eng katta qoldiq usuli). Yo'qotish
     * har kuni fayldagi nisbatda bo'linadi - kunlik ayniyat buzilmaydi.
     */
    const inDaily = split(kwhIn, DAY_WEIGHTS);
    const soldDaily = split(kwhSold, DAY_WEIGHTS);

    for (let d = 0; d < DAYS; d += 1) {
      const date = `${PERIOD}-${String(d + 1).padStart(2, '0')}`;
      const dayIn = inDaily[d]!;
      const daySold = Math.min(soldDaily[d]!, dayIn);
      await c.query(
        `INSERT INTO fact.energy_balance_daily
           (submission_id, mfy_id, biz_date, kwh_in, kwh_sold)
         VALUES ($1, $2, $3::date, $4, $5)`,
        [subIds.get('ENERGY_BALANCE'), mfyId, date, dayIn, daySold]);
    }

    /*
     * Iste'molchilar - TP tafsilotidan yig'iladi. Aholi / yuridik ajratmasi
     * hisobotlarda YO'Q: hammasi ajratilmagan holda «aholi» ustuniga
     * yoziladi (`fill-derived-data.ts` keyin standart nisbatda bo'ladi).
     */
    const total = tps.reduce((a, t) => a + t.total, 0);
    const active = tps.reduce((a, t) => a + t.active, 0);
    const off = tps.reduce((a, t) => a + t.disconnected, 0);

    await c.query(
      `INSERT INTO fact.mfy_monthly_return
         (submission_id, mfy_id, period_month, consumers_population, consumers_legal,
          consumers_active, consumers_disconnected, consumers_new, consumers_disconnected_new,
          debt_population_mln, debt_legal_mln, debt_budget_mln,
          meters_offline_cnt, low_consumption_cnt, meters_replace_need_cnt, meters_replaced_cnt)
       VALUES ($1, $2, $3::date, $4, 0, $5, $6, 0, 0, 0, 0, 0, 0, 0, 0, 0)`,
      [subIds.get('MONTHLY_RETURN'), mfyId, P_START, total, active, off]);

    for (const t of tps) {
      await c.query(
        `INSERT INTO fact.tp_monthly
           (tp_id, period_month, consumers_total, consumers_active, consumers_disconnected,
            meter_no, meter_coef, reading_prev, reading_curr, kwh_month)
         VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [tpIds.get(t.code), P_START, t.total, t.active, t.disconnected,
          t.meterNo, t.coef, t.prev, t.curr, t.kwh]);
    }

    // ── Foydalanuvchi hududlari - demo hisoblari ishlashi uchun ───────────
    for (const login of ['manager.baliqchi', 'manager.chinobod', 'operator1']) {
      const u = await c.query<{ id: number }>(
        'SELECT id FROM sec.app_user WHERE login = $1', [login]);
      const uid = u.rows[0]?.id;
      if (!uid) continue;
      await c.query(
        `INSERT INTO sec.user_scope (user_id, scope_type, scope_id) VALUES ($1, 'MFY', $2)
         ON CONFLICT DO NOTHING`, [uid, mfyId]);
    }

    await c.query('COMMIT');
    for (const r of trg.rows) await c.query(`ALTER TABLE ${r.sch}.${r.tbl} ENABLE TRIGGER zz_audit`);

    console.log('\nAgregatlar qayta qurilmoqda…');
    await c.query('SELECT agg.refresh_all(false)');

    const check = await c.query(`
      SELECT m.short_name AS fider, a.days_filled,
             round(a.kwh_in)::int AS kwh_in, round(a.kwh_sold)::int AS sotilgan,
             round(a.kwh_loss_total)::int AS yoqotish, a.loss_pct,
             a.consumers_total
        FROM agg.mfy_monthly a JOIN ref.mfy m ON m.id = a.mfy_id
       WHERE a.period_month = $1::date`, [P_START]);
    console.log('\nNatija (agg.mfy_monthly, iyul):');
    console.table(check.rows);
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    c.release();
    await pool.end();
  }
}

await main();
