/**
 * Xaqulobod fideri ma'lumotini yuklash.
 *
 * Ikkita manba fayl bir-birini to'ldiradi:
 *   • `data/umumiy_hisobot.xlsx` - fider BOSHIDAGI balans: hisoblagich
 *     ko'rsatkichi, koeffitsienti, kirgan energiya va TP lar o'lchagani;
 *   • `data/toliq_hisobot.xlsx` (`0108` varaq) - TP KESIMI: har bir TP ning
 *     hisoblagichi, koeffitsienti, ko'rsatkichlari, oylik iste'moli va
 *     iste'molchilari.
 *
 * Ikkalasi bitta oyga tegishli: 01.07.2026 → 01.08.2026, ya'ni IYUL oyi.
 *
 *   node --experimental-strip-types apps/api/scripts/load-feeder-data.ts
 *
 * NIMA QILADI: eski fakt ma'lumotini to'liq o'chiradi, registrda faqat shu
 * fiderni qoldiradi va fayllardagi raqamlarni yozadi. Qayta ishga tushirsa
 * natija bir xil (idempotent).
 *
 * NIMA HISOBLANMAYDI: TP quvvati (kVA), masofasi, yuklama foizi, kuchlanish,
 * qarzdorlik, ishlar - bu ma'lumotlar hisobotlarda YO'Q va o'ylab topilmaydi.
 * Interfeys ularni «-» yoki «ma'lumot yo'q» deb ko'rsatadi.
 */
import { join } from 'node:path';

import ExcelJS from 'exceljs';
import pg from 'pg';

import { num } from '@beap/shared';

import { config } from '../src/config.ts';

/** Yuklanadigan fider - nomi ikkala faylda ham shu ko'rinishda. */
const FEEDER = {
  code: 'FIDER-XAQULOBOD',
  nameUz: 'Xaqulobod fideri',
  nameCyr: 'Хақулобод фидери',
  shortName: 'Xaqulobod',
  elektrosetCode: 'CHINOBOD',
  /** «Умумий ҳисобот» dagi yozilishi (kirill). */
  summaryLabel: 'Хақулобод',
  /** «Тўлиқ ҳисобот» dagi yozilishi (lotin). */
  detailLabel: 'Xaqulobod',
} as const;

const PERIOD = '2026-07';
const DAYS = 31;

/** Kunlik ritm - hafta oxiri pastroq. Tasodif yo'q, natija takrorlanadi. */
const DAY_WEIGHTS = Array.from({ length: DAYS }, (_, i) => {
  const dow = (i + 3) % 7; // 2026-07-01 - chorshanba
  return dow === 5 || dow === 6 ? 0.92 : 1.03;
});

const DATA_DIR = join(config.paths.uploads, '..', '..', 'data');

const val = (x: ExcelJS.CellValue): string | number => {
  if (x === null || x === undefined) return '';
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

interface FeederBalance {
  substation: string;
  input: string;
  meterPrev: number;
  meterCurr: number;
  coef: number;
  kwhIn: number;
  kwhTpSum: number;
}

/** «Умумий ҳисобот» - fider qatorini topadi va ustunlarni o'qiydi. */
async function readSummary(): Promise<FeederBalance> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(join(DATA_DIR, 'umumiy_hisobot.xlsx'));
  const ws = wb.worksheets[0]!;

  let input = '';
  for (let r = 1; r <= ws.rowCount; r += 1) {
    const row = ws.getRow(r);
    // 3-ustunda «ВВОД Т1/Т2 …» - undan keyingi fiderlar shu vvodga tegishli.
    const c3 = String(val(row.getCell(3).value)).trim();
    if (/ВВОД/i.test(c3)) input = c3;

    if (String(val(row.getCell(4).value)).trim() !== FEEDER.summaryLabel) continue;

    return {
      substation: String(val(row.getCell(2).value)).trim(),
      input,
      meterPrev: numOf(row.getCell(5).value),
      meterCurr: numOf(row.getCell(6).value),
      coef: numOf(row.getCell(8).value),
      kwhIn: numOf(row.getCell(9).value),
      kwhTpSum: numOf(row.getCell(10).value),
    };
  }
  throw new Error(`umumiy_hisobot.xlsx: «${FEEDER.summaryLabel}» fideri topilmadi`);
}

interface TpRow {
  code: string;
  total: number;
  active: number;
  disconnected: number;
  meterNo: string;
  coef: number;
  prev: number;
  curr: number;
  kwh: number;
}

/** «Тўлиқ ҳисобот» - shu fiderga tegishli TP qatorlari. */
async function readTps(): Promise<TpRow[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(join(DATA_DIR, 'toliq_hisobot.xlsx'));
  const ws = wb.getWorksheet('0108') ?? wb.worksheets[0]!;

  const out: TpRow[] = [];
  for (let r = 4; r <= ws.rowCount; r += 1) {
    const row = ws.getRow(r);
    if (String(val(row.getCell(4).value)).trim() !== FEEDER.detailLabel) continue;

    const coef = numOf(row.getCell(10).value) || 1;
    const prev = numOf(row.getCell(11).value);
    const curr = numOf(row.getCell(12).value);
    /*
     * Ba'zi kataklarda formula bor, lekin keshlangan qiymati yo'q - bunday
     * qatorda oylik iste'mol ko'rsatkichlar farqidan qayta hisoblanadi.
     */
    const kwh = numOf(row.getCell(14).value) || Math.abs(curr - prev) * coef;

    out.push({
      code: `TP-${String(val(row.getCell(3).value)).trim().padStart(3, '0')}`,
      total: numOf(row.getCell(5).value),
      active: numOf(row.getCell(6).value),
      disconnected: numOf(row.getCell(7).value),
      meterNo: String(val(row.getCell(9).value)).trim(),
      coef,
      prev,
      curr,
      kwh: Number(kwh.toFixed(2)),
    });
  }
  if (out.length === 0) throw new Error(`toliq_hisobot.xlsx: «${FEEDER.detailLabel}» TP lari topilmadi`);
  return out;
}

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
   * BALANS SHU YERDA QURILADI - ikki fayl ikki xil «sotilgan» beradi:
   *
   *   • «Умумий ҳисобот» dagi «Elektr oqimi» - yaxlitlangan xulosa raqam;
   *   • «Тўлиқ ҳисобот» dagi TP hisoblagichlari yig'indisi - HAR BIR TP
   *     ko'rsatkichidan chiqadigan, tekshirib bo'ladigan raqam.
   *
   * Ikkinchisi olinadi: u hujjat bilan qator-ma-qator solishtiriladi.
   * Yo'qotish - QOLDIQ: kirgan − sotilgan. Alohida saqlanmaydi, chunki
   * `fact.feeder_monthly.kwh_loss` shu ayirmadan hosil bo'ladigan
   * generated ustun.
   */
  const kwhIn = summary.kwhIn;
  const kwhSold = Number(tps.reduce((a, t) => a + t.kwh, 0).toFixed(2));
  const loss = Number((kwhIn - kwhSold).toFixed(2));

  const balance = { ...summary, kwhTpSum: kwhSold };

  console.log(`\nFider: ${FEEDER.nameUz} · ${balance.substation} · ${balance.input}`);
  console.log(`  hisoblagich: ${balance.meterPrev} → ${balance.meterCurr} (koef ${balance.coef})`);
  console.log(`  kirgan ${num(kwhIn)} kWh`);
  console.log(`  sotilgan ${num(kwhSold)} kWh - ${tps.length} ta TP hisoblagichi yig‘indisi`);
  console.log(`  yo‘qotish ${num(loss)} kWh - ${((loss / kwhIn) * 100).toFixed(1)}%`);

  if (loss < 0) {
    throw new Error('Yo‘qotish manfiy chiqdi - manba fayllarni tekshiring');
  }
  if (Math.abs(kwhSold - summary.kwhTpSum) > 1) {
    console.log(
      `\n  ℹ «Умумий ҳисобот» da «Elektr oqimi» ${num(summary.kwhTpSum)} kWh deb yozilgan,`
      + ` TP hisoblagichlari yig‘indisi esa ${num(kwhSold)} kWh (farq ${num(kwhSold - summary.kwhTpSum)}).`
      + ' Tafsilotli hisobot olindi.',
    );
  }

  const pool = new pg.Pool({ ...config.db, max: 2 });
  const c = await pool.connect();

  try {
    // Ommaviy yozuvda audit triggerlari o'chiriladi - seed ham shunday qiladi.
    const trg = await c.query<{ sch: string; tbl: string }>(`
      SELECT n.nspname AS sch, c.relname AS tbl
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE t.tgname = 'zz_audit' AND NOT t.tgisinternal`);
    for (const r of trg.rows) await c.query(`ALTER TABLE ${r.sch}.${r.tbl} DISABLE TRIGGER zz_audit`);

    await c.query('BEGIN');

    // ── 1. Tozalash ────────────────────────────────────────────────────
    console.log('\nEski ma’lumot o‘chirilmoqda…');
    await c.query(`
      TRUNCATE fact.tp_reading_daily, fact.energy_balance_daily, fact.mfy_monthly_return,
               fact.tp_status_monthly, fact.tp_monthly, fact.feeder_monthly,
               fact.network_defect, fact.debt_top_entry, fact.violation_act,
               fact.work, fact.work_photo, fact.daily_form, fact.passport_snapshot,
               fact.report_job, fact.submission RESTART IDENTITY CASCADE`);
    await c.query('DELETE FROM ref.network_segment');
    await c.query('DELETE FROM ref.tp');
    await c.query(`DELETE FROM sec.user_scope WHERE scope_type = 'MFY'`);
    await c.query(`DELETE FROM ref.norm WHERE scope_type = 'MFY'`);
    await c.query('DELETE FROM ref.mfy');

    // ── 2. Registr: fider + TP lar ─────────────────────────────────────
    const es = await c.query<{ id: number }>(
      'SELECT id FROM ref.elektroset WHERE code = $1', [FEEDER.elektrosetCode],
    );
    const esId = es.rows[0]?.id;
    if (!esId) throw new Error(`Elektroset topilmadi: ${FEEDER.elektrosetCode}`);

    const mfy = await c.query<{ id: number }>(
      `INSERT INTO ref.mfy (elektroset_id, code, name_uz, name_uz_cyr, short_name, sort_order)
       VALUES ($1, $2, $3, $4, $5, 1) RETURNING id`,
      [esId, FEEDER.code, FEEDER.nameUz, FEEDER.nameCyr, FEEDER.shortName],
    );
    const mfyId = mfy.rows[0]!.id;

    const tpIds = new Map<string, number>();
    for (const t of tps) {
      // rated_kva va avg_distance_m - NULL: hisobotlarda bu ma'lumot yo'q.
      const ins = await c.query<{ id: number }>(
        `INSERT INTO ref.tp (mfy_id, code, voltage_class) VALUES ($1, $2, '10/0.4') RETURNING id`,
        [mfyId, t.code],
      );
      tpIds.set(t.code, ins.rows[0]!.id);
    }
    console.log(`  fider va ${tpIds.size} ta TP registrga yozildi`);

    // ── 3. Konvertlar (tasdiqlangan) ───────────────────────────────────
    const admin = await c.query<{ id: number }>(
      `SELECT id FROM sec.app_user WHERE role = 'admin' ORDER BY id LIMIT 1`,
    );
    const adminId = admin.rows[0]?.id;
    if (!adminId) throw new Error('admin foydalanuvchi topilmadi');

    const pStart = `${PERIOD}-01`;
    const pEnd = `${PERIOD}-${String(DAYS).padStart(2, '0')}`;
    const subIds = new Map<string, number>();
    for (const domain of ['ENERGY_BALANCE', 'MONTHLY_RETURN']) {
      const s = await c.query<{ id: number }>(
        `INSERT INTO fact.submission
           (scope_type, scope_id, domain, period_type, period_start, period_end,
            status, created_by, submitted_at, reviewed_by, reviewed_at)
         VALUES ('MFY', $1, $2, 'MONTH', $3::date, $4::date, 'approved', $5,
                 $4::date + time '09:00', $5, $4::date + time '14:00')
         RETURNING id`,
        [mfyId, domain, pStart, pEnd, adminId],
      );
      subIds.set(domain, s.rows[0]!.id);
    }

    // ── 4. Fider balansi ───────────────────────────────────────────────
    await c.query(
      `INSERT INTO fact.feeder_monthly
         (mfy_id, period_month, substation, input_name, meter_prev, meter_curr, meter_coef,
          kwh_in, kwh_sold)
       VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, $9)`,
      [mfyId, pStart, balance.substation, balance.input, balance.meterPrev, balance.meterCurr,
        balance.coef, balance.kwhIn, balance.kwhTpSum],
    );

    /*
     * Kunlik balans: oylik jam 31 kunga taqsimlanadi, yig'indisi AYNAN
     * fayldagi songa teng bo'lib qoladi. Yo'qotish har kuni kirgan va
     * sotilgan ayirmasi sifatida o'z-o'zidan chiqadi.
     */
    const inDaily = split(balance.kwhIn, DAY_WEIGHTS);
    const soldDaily = split(balance.kwhTpSum, DAY_WEIGHTS);

    for (let d = 0; d < DAYS; d += 1) {
      const date = `${PERIOD}-${String(d + 1).padStart(2, '0')}`;
      const kwhIn = inDaily[d]!;
      const kwhSold = Math.min(soldDaily[d]!, kwhIn);

      await c.query(
        `INSERT INTO fact.energy_balance_daily
           (submission_id, mfy_id, biz_date, kwh_in, kwh_sold)
         VALUES ($1, $2, $3::date, $4, $5)`,
        [subIds.get('ENERGY_BALANCE'), mfyId, date, kwhIn, kwhSold],
      );
    }

    // ── 5. Iste'molchilar ──────────────────────────────────────────────
    const total = tps.reduce((a, t) => a + t.total, 0);
    const active = tps.reduce((a, t) => a + t.active, 0);
    const off = tps.reduce((a, t) => a + t.disconnected, 0);

    /*
     * Aholi / yuridik ajratmasi hisobotlarda YO'Q - hammasi ajratilmagan
     * holda «aholi» ustuniga yoziladi, yuridik 0. Qarzdorlik ham yo'q.
     */
    await c.query(
      `INSERT INTO fact.mfy_monthly_return
         (submission_id, mfy_id, period_month, consumers_population, consumers_legal,
          consumers_active, consumers_disconnected, consumers_new, consumers_disconnected_new,
          debt_population_mln, debt_legal_mln, debt_budget_mln,
          meters_offline_cnt, low_consumption_cnt, meters_replace_need_cnt, meters_replaced_cnt)
       VALUES ($1, $2, $3::date, $4, 0, $5, $6, 0, 0, 0, 0, 0, 0, 0, 0, 0)`,
      [subIds.get('MONTHLY_RETURN'), mfyId, pStart, total, active, off],
    );

    // ── 6. TP kesimi ───────────────────────────────────────────────────
    for (const t of tps) {
      await c.query(
        `INSERT INTO fact.tp_monthly
           (tp_id, period_month, consumers_total, consumers_active, consumers_disconnected,
            meter_no, meter_coef, reading_prev, reading_curr, kwh_month)
         VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [tpIds.get(t.code), pStart, t.total, t.active, t.disconnected,
          t.meterNo, t.coef, t.prev, t.curr, t.kwh],
      );
    }

    await c.query('COMMIT');
    for (const r of trg.rows) await c.query(`ALTER TABLE ${r.sch}.${r.tbl} ENABLE TRIGGER zz_audit`);

    console.log('\nAgregatlar qayta qurilmoqda…');
    await c.query('SELECT agg.refresh_all(false)');

    const check = await c.query(`
      SELECT round(a.kwh_in)::int kwh_in, round(a.kwh_sold)::int sotilgan,
             round(a.kwh_loss_total)::int yoqotish, a.loss_pct,
             a.consumers_total, a.consumers_active, a.consumers_disconnected, a.tp_total
        FROM agg.mfy_monthly a WHERE a.mfy_id = $1 AND a.period_month = $2::date`,
      [mfyId, pStart]);
    console.log('\nNatija:');
    console.table(check.rows);
  } catch (err) {
    await c.query('ROLLBACK');
    throw err;
  } finally {
    c.release();
    await pool.end();
  }
}

await main();
