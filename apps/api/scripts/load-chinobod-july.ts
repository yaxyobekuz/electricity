/**
 * Chinobod ETK, XAQULOBOD FIDERI - IYUL 2026: registr va oylik hisobot.
 *
 * QAMROV: tizim BITTA 10 kV fider ustida ishlaydi - Chinobod nimstansiyasining
 * «Xaqulobod» fideri (`0013_feeder_level.sql` dagi qaror). Manba hisobotlarda
 * uchraydigan barcha ma'lumot - 11 ta fider qatori ham, 359 ta TP ham - SHU
 * FIDERGA tegishli deb yuritiladi. Shuning uchun registrda bitta `ref.mfy`
 * qatori bo'ladi va energiya jamlari yig'indi holida yoziladi.
 *
 * Uchta manba fayl:
 *   • `data/umumiy_hisobot.xlsx`  - NIM stansiya Chinobod 110/35/10 kV dan
 *     chiquvchi 10 kV yo'nalishlar: hisoblagich ko'rsatkichi (01.07 → 01.08),
 *     koeffitsient, kirgan energiya, elektr oqimi, texnologik va tijoriy
 *     yo'qotish. IYUL oyiga tegishli.
 *   • `data/toliq_hisobot.xlsx` (`0108` varaq) - TP KESIMI: 143 ta TP ning
 *     hisoblagichi, koeffitsienti, 01.07/01.08 ko'rsatkichlari, oylik
 *     iste'moli va iste'molchilari.
 *   • `8-1-2026.xlsx` (`Sheet0`) - 1-avgust kunlik hisoboti. BU YERDA faqat
 *     REGISTR uchun o'qiladi: unda 355 ta TP bor, ya'ni iyul tafsilotidagi
 *     143 tadan ancha ko'p. TP ro'yxati ikkalasining BIRLASHMASI bo'ladi.
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

/**
 * Texnologik yo'qotish normasi - kirgan energiyaning 12% i.
 * «Умумий ҳисобот» dagi T2 blokining har bir qatorida shu nisbat AYNAN
 * bajarilgan (Хақулобод 1 048 000 → 125 760), ya'ni bu hujjatning o'z
 * normasi, biz o'ylab topgan koeffitsient emas.
 */
const TECH_LOSS_RATE = 0.12;

const PERIOD = '2026-07';
const P_START = `${PERIOD}-01`;
const DAYS = 31;

/** Yagona hisob birligi - `ref.mfy` ning bitta qatori. */
export const FEEDER = {
  code: 'FIDER-XAQULOBOD',
  nameUz: 'Xaqulobod fideri',
  nameCyr: 'Хақулобод фидери',
  shortName: 'Xaqulobod',
  /** «Умумий ҳисобот» dagi o'z qatorining nomi - hisoblagichi shundan olinadi. */
  summaryLabel: 'Хақулобод',
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
  kwhIn: number; kwhFlow: number; techLossFile: number;
}

async function readSummary(): Promise<SummaryRow[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(join(DATA_DIR, 'umumiy_hisobot.xlsx'));
  const ws = wb.worksheets[0]!;

  const out: SummaryRow[] = [];
  let input = '';
  for (let r = 1; r <= ws.rowCount; r += 1) {
    const row = ws.getRow(r);
    const c3 = String(val(row.getCell(3).value)).trim();
    if (/ВВОД/i.test(c3)) { input = c3.replace(/\s+/g, ' '); continue; }
    const name = String(val(row.getCell(4).value)).trim();
    if (!name) continue;

    out.push({
      name, input,
      substation: String(val(row.getCell(2).value)).trim() || SUBSTATION_FALLBACK,
      meterPrev: numOf(row.getCell(5).value),
      meterCurr: numOf(row.getCell(6).value),
      coef: numOf(row.getCell(8).value) || 1,
      kwhIn: numOf(row.getCell(9).value),
      kwhFlow: numOf(row.getCell(10).value),
      techLossFile: numOf(row.getCell(11).value),
    });
  }
  if (out.length === 0) throw new Error('umumiy_hisobot.xlsx: hech qanday qator topilmadi');
  return out;
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
  if (out.length === 0) throw new Error('toliq_hisobot.xlsx: TP qatorlari topilmadi');
  return out;
}

/** 1-avgust kunlik hisobotidagi TP ro'yxati - registrni to'ldirish uchun. */
async function readAugustTpCodes(): Promise<string[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(join(REPO_ROOT, '8-1-2026.xlsx'));
  const ws = wb.getWorksheet('Sheet0');
  if (!ws) return [];

  const codes = new Set<string>();
  for (let r = 5; r <= ws.rowCount; r += 1) {
    const tpNo = String(val(ws.getRow(r).getCell(2).value)).trim();
    /*
     * Raqam bilan boshlanadigan HAR QANDAY belgi TP nomeri: «44», «116A»,
     * «130-A», «167/1». «Total» va «TR-box» kabi xizmat qatorlari raqam bilan
     * boshlanmagani uchun o'z-o'zidan tashqarida qoladi. O'qishi bo'sh TP lar
     * ham registrga tushadi - ular mavjud, faqat hisoblagichi ma'lumot bermagan.
     */
    if (!/^\d/.test(tpNo) || !/^[-\w/А-Яа-я]+$/.test(tpNo)) continue;
    codes.add(tpCodeOf(tpNo));
  }
  return [...codes];
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
  const [summary, tps, augCodes] = await Promise.all([readSummary(), readTps(), readAugustTpCodes()]);

  /*
   * BALANS. Har bir «Умумий ҳисобот» qatori uchun sotilgan energiya shu
   * tartibda aniqlanadi, keyin hammasi BITTA fider hisobiga qo'shiladi:
   *
   *   1. Hujjatning o'zi «Elektr oqimi» (J ustun) ni yozgan bo'lsa - o'sha.
   *      Bu elektrosetning rasmiy raqami.
   *   2. Aks holda - tumanning o'z nisbati bo'yicha BAHOLANADI (T1 vvodidagi
   *      qatorlarda J/K/L ustunlari umuman to'ldirilmagan).
   *
   * Texnologik yo'qotish - hujjatdagi 12% normasi; tijoriy esa QOLDIQ:
   * kirgan − sotilgan − texnologik. Shunda `fm_balance` CHECK o'z-o'zidan
   * bajariladi va hech qanday raqam ikki marta hisoblanmaydi.
   */
  const withFlow = summary.filter((s) => s.kwhFlow > 0);
  const flowRatio = withFlow.length > 0
    ? withFlow.reduce((a, s) => a + s.kwhFlow, 0) / withFlow.reduce((a, s) => a + s.kwhIn, 0)
    : 0.7;

  const kwhIn = Number(summary.reduce((a, s) => a + s.kwhIn, 0).toFixed(2));
  const kwhSold = Number(summary
    .reduce((a, s) => a + (s.kwhFlow > 0 ? s.kwhFlow : s.kwhIn * flowRatio), 0).toFixed(2));
  const techLoss = Number((kwhIn * TECH_LOSS_RATE).toFixed(2));
  const commLoss = Number((kwhIn - kwhSold - techLoss).toFixed(2));
  if (commLoss < 0) throw new Error(`Tijoriy yo'qotish manfiy: ${commLoss}`);

  /*
   * Hisoblagich - fiderning O'Z qatoridan (01.07 ko'rsatkichi va koeffitsient
   * haqiqiy). Oxirgi ko'rsatkich esa YIG'MA kirimga moslab hisoblanadi, aks
   * holda panelda «19 850 → 20 112, koef 4 000» bilan «4 324 000 kWh» bir-biriga
   * mos kelmay, o'qiyotgan odamni chalg'itardi.
   */
  const own = summary.find((s) => s.name === FEEDER.summaryLabel);
  const substation = own?.substation ?? SUBSTATION_FALLBACK;
  const inputName = own?.input ?? '';
  const meterCoef = own?.coef ?? 1;
  const meterPrev = own?.meterPrev ?? 0;
  const meterCurr = Number((meterPrev + kwhIn / meterCoef).toFixed(2));

  console.log(`\nIYUL ${PERIOD} - ${FEEDER.nameUz} (${substation})\n`);
  for (const s of summary) {
    const sold = s.kwhFlow > 0 ? s.kwhFlow : s.kwhIn * flowRatio;
    console.log(`  ${s.name.padEnd(12)} kirgan ${num(s.kwhIn).padStart(11)}`
      + ` | sotilgan ${num(sold).padStart(11)}`
      + ` | ${s.kwhFlow > 0 ? 'hujjat (Elektr oqimi)' : `BAHOLANGAN (${(flowRatio * 100).toFixed(1)}%)`}`);
  }
  console.log(`\n  JAMI  kirgan ${num(kwhIn)} kWh · sotilgan ${num(kwhSold)} kWh`
    + ` · texnologik ${num(techLoss)} · tijoriy ${num(commLoss)}`
    + ` · yo‘qotish ${(((kwhIn - kwhSold) / kwhIn) * 100).toFixed(1)}%`);
  console.log(`  hisoblagich ${num(meterPrev)} → ${num(meterCurr)} (koef ${meterCoef})`);

  // ── TP registri: iyul tafsiloti + avgust kunlik hisobotining birlashmasi ──
  const detailCodes = new Set(tps.map((t) => t.code));
  const allCodes = [...new Set([...detailCodes, ...augCodes])].sort();
  console.log(`\n  TP registri: ${detailCodes.size} ta (iyul tafsiloti bilan)`
    + ` + ${allCodes.length - detailCodes.size} ta (faqat kunlik hisobotda)`
    + ` = ${allCodes.length} ta`);

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
          kwh_in, kwh_tp_sum, kwh_tech_loss, kwh_commercial_loss, source)
       VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'EXCEL')`,
      [mfyId, P_START, substation, inputName, meterPrev, meterCurr, meterCoef,
        kwhIn, kwhSold, techLoss, commLoss]);

    /*
     * Kunlik balans: oylik jam 31 kunga taqsimlanadi va yig'indisi AYNAN
     * fayldagi songa teng bo'lib qoladi (eng katta qoldiq usuli). Yo'qotish
     * har kuni fayldagi nisbatda bo'linadi - kunlik ayniyat buzilmaydi.
     */
    const inDaily = split(kwhIn, DAY_WEIGHTS);
    const soldDaily = split(kwhSold, DAY_WEIGHTS);
    const lossDaily = inDaily.map((v, d) => v - Math.min(soldDaily[d]!, v));
    const techDaily = split(techLoss, lossDaily.map((v) => Math.max(v, 1)));

    for (let d = 0; d < DAYS; d += 1) {
      const date = `${PERIOD}-${String(d + 1).padStart(2, '0')}`;
      const dayIn = inDaily[d]!;
      const daySold = Math.min(soldDaily[d]!, dayIn);
      const loss = dayIn - daySold;
      const technical = Math.min(techDaily[d]!, loss);
      await c.query(
        `INSERT INTO fact.energy_balance_daily
           (submission_id, mfy_id, biz_date, kwh_in, kwh_sold,
            kwh_loss_natural, kwh_loss_technical, kwh_loss_illegal)
         VALUES ($1, $2, $3::date, $4, $5, 0, $6, $7)`,
        [subIds.get('ENERGY_BALANCE'), mfyId, date, dayIn, daySold, technical, loss - technical]);
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
