/**
 * Avgust oyi uchun QISMAN (oy boshidan BUGUNGACHA) rasmiy oylik hisobot demo
 * davomi - iyul ma'lumotlaridan PROPORTSIONAL hisoblanadi.
 *
 * SABAB: davr tanlagich (`PeriodPicker.tsx`) va standart davr (`q.latestPeriod()`,
 * `db/queries/dashboard.ts:22-53`) faqat `fact.submission` (status='approved')
 * orqali o'tgan RASMIY oylik hisobotni "ko'radi" - bu esa `fact.tp_loss_daily`
 * (TP kunlik yo'qotish, alohida ish) dan MUSTAQIL manba. Iyuldan boshqa oy hech
 * qachon yuklanmagani uchun tanlagichda avgust umuman chiqmasdi.
 *
 * Bitta MFY (fider) bo'lgani uchun `latestPeriod()`ning "yarim MFY to'ldirgan"
 * mezoni avtomatik 1 taga tushadi - shuning uchun BU YERDA faqat ma'lumot
 * qo'shish kifoya, `latestPeriod`/`dataRange`/`PeriodPicker` KODINING o'ziga
 * tegilmaydi.
 *
 *   node --experimental-strip-types apps/api/scripts/generate-august-partial.ts
 *
 * IDEMPOTENT: faqat avgustga tegishli qatorlarni oldindan o'chiradi (iyulga
 * TEGMAYDI). Qayta ishga tushirish xavfsiz.
 */
import pg from 'pg';

import { config } from '../src/config.ts';

const TECH_LOSS_RATE = 0.12; // load-feeder-data.ts bilan bir xil norma
const PREV_PERIOD = '2026-07-01';
const PREV_DAYS = 31; // iyul
const PERIOD = '2026-08';
const FROM_DATE = `${PERIOD}-01`;

const SEED = 20260806;
function mulberry32(a: number): () => number {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
function gauss(mean = 0, sd = 1): number {
  const u = Math.max(rand(), 1e-9);
  const v = Math.max(rand(), 1e-9);
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Jamini og'irliklar bo'yicha butun sonlarga bo'ladi (eng katta qoldiq usuli) - load-feeder-data.ts bilan bir xil. */
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
  const pool = new pg.Pool({ ...config.db, max: 2 });
  const c = await pool.connect();

  try {
    /*
     * Oyning necha kuni bosib o'tildi - BUGUNGI sana ma'lumotlar bazasidan
     * olinadi (`new Date()` emas): kunlik jadvallardagi "kelajak sana yo'q"
     * cheklovlari ham xuddi shu `CURRENT_DATE` ga qaraydi, ikkalasi bir xil
     * soatdan o'qisin. Oy tugagan bo'lsa - to'liq oy.
     */
    const today = await c.query<{ d: string; day: number; dim: number }>(
      `SELECT CURRENT_DATE::text AS d,
              extract(day FROM CURRENT_DATE)::int AS day,
              extract(day FROM (date_trunc('month', $1::date) + interval '1 month - 1 day'))::int AS dim`,
      [FROM_DATE],
    );
    const cur = today.rows[0]!;
    const inPeriod = cur.d.slice(0, 7) === PERIOD;
    const DAYS = inPeriod ? cur.day : cur.d > FROM_DATE ? cur.dim : 0;
    if (DAYS === 0) throw new Error(`${PERIOD} hali boshlanmagan - generatsiya qilinmaydi`);
    const TO_DATE = `${PERIOD}-${String(DAYS).padStart(2, '0')}`;
    const SCALE = DAYS / PREV_DAYS; // iyulning necha qismi bosib o'tildi

    console.log(`Davr: ${FROM_DATE} … ${TO_DATE} (${DAYS} kun, iyulning ${(SCALE * 100).toFixed(0)}% i)`);

    /** Kunlik ritm - qisqa oynada kichik tasodifiy tebranish. */
    const DAY_WEIGHTS = Array.from({ length: DAYS }, () => 0.95 + rand() * 0.15);

    const trg = await c.query<{ sch: string; tbl: string }>(`
      SELECT n.nspname AS sch, c.relname AS tbl
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE t.tgname = 'zz_audit' AND NOT t.tgisinternal`);
    for (const r of trg.rows) await c.query(`ALTER TABLE ${r.sch}.${r.tbl} DISABLE TRIGGER zz_audit`);

    await c.query('BEGIN');

    const mfy = await c.query<{ id: number }>(
      `SELECT id FROM ref.mfy WHERE code = 'FIDER-XAQULOBOD'`,
    );
    const mfyId = mfy.rows[0]?.id;
    if (!mfyId) throw new Error('Fider (FIDER-XAQULOBOD) registrda topilmadi');

    const admin = await c.query<{ id: number }>(
      `SELECT id FROM sec.app_user WHERE role = 'admin' ORDER BY id LIMIT 1`,
    );
    const adminId = admin.rows[0]?.id;
    if (!adminId) throw new Error('admin foydalanuvchi topilmadi');

    // ── 0. Iyul ma'lumotini o'qish - avgust shundan proportsional hisoblanadi ──
    const julyFeeder = await c.query<{
      substation: string | null; input_name: string | null;
      meter_prev: number; meter_curr: number; meter_coef: number;
      kwh_in: number; kwh_tech_loss: number;
    }>(
      `SELECT substation, input_name, meter_prev::float8 AS meter_prev, meter_curr::float8 AS meter_curr,
              meter_coef::float8 AS meter_coef, kwh_in::float8 AS kwh_in, kwh_tech_loss::float8 AS kwh_tech_loss
         FROM fact.feeder_monthly WHERE mfy_id = $1 AND period_month = $2::date`,
      [mfyId, PREV_PERIOD],
    );
    const july = julyFeeder.rows[0];
    if (!july) throw new Error(`Iyul (${PREV_PERIOD}) uchun fact.feeder_monthly topilmadi - avval load-feeder-data.ts ishga tushirilganmi?`);

    const julyTps = await c.query<{
      tp_id: number; code: string; consumers_total: number; consumers_active: number;
      consumers_disconnected: number; meter_no: string | null; meter_coef: number;
      reading_curr: number; kwh_month: number;
    }>(
      `SELECT t.id AS tp_id, t.code, m.consumers_total, m.consumers_active, m.consumers_disconnected,
              m.meter_no, m.meter_coef::float8 AS meter_coef, m.reading_curr::float8 AS reading_curr,
              m.kwh_month::float8 AS kwh_month
         FROM fact.tp_monthly m JOIN ref.tp t ON t.id = m.tp_id
        WHERE m.period_month = $1::date`,
      [PREV_PERIOD],
    );
    if (julyTps.rows.length === 0) throw new Error(`Iyul uchun fact.tp_monthly topilmadi`);

    const julyReturn = await c.query<{
      consumers_population: number; consumers_legal: number;
      debt_population_mln: number; debt_legal_mln: number; debt_budget_mln: number;
      meters_offline_cnt: number; low_consumption_cnt: number;
      meters_replace_need_cnt: number; meters_replaced_cnt: number;
    }>(
      `SELECT consumers_population, consumers_legal,
              debt_population_mln::float8 AS debt_population_mln,
              debt_legal_mln::float8 AS debt_legal_mln, debt_budget_mln::float8 AS debt_budget_mln,
              meters_offline_cnt, low_consumption_cnt,
              meters_replace_need_cnt, meters_replaced_cnt
         FROM fact.mfy_monthly_return WHERE mfy_id = $1 AND period_month = $2::date`,
      [mfyId, PREV_PERIOD],
    );
    const mr = julyReturn.rows[0];
    if (!mr) throw new Error(`Iyul uchun fact.mfy_monthly_return topilmadi`);

    // ── 1. Tozalash - FAQAT avgust, iyulga tegmaydi ─────────────────────
    console.log(`${PERIOD} uchun eski qatorlar (bo'lsa) o'chirilmoqda…`);
    await c.query(
      `DELETE FROM fact.energy_balance_daily WHERE mfy_id = $1
         AND biz_date >= $2::date AND biz_date <= $3::date`,
      [mfyId, FROM_DATE, TO_DATE],
    );
    await c.query(`DELETE FROM fact.tp_monthly WHERE period_month = $1::date`, [FROM_DATE]);
    await c.query(`DELETE FROM fact.mfy_monthly_return WHERE mfy_id = $1 AND period_month = $2::date`, [mfyId, FROM_DATE]);
    await c.query(`DELETE FROM fact.feeder_monthly WHERE mfy_id = $1 AND period_month = $2::date`, [mfyId, FROM_DATE]);
    await c.query(
      `DELETE FROM fact.submission WHERE scope_type = 'MFY' AND scope_id = $1 AND period_start = $2::date`,
      [mfyId, FROM_DATE],
    );

    // ── 2. Konvertlar (tasdiqlangan, davr = 08-01..08-05) ────────────────
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

    // ── 3. TP kesimi (proportsional davom) ───────────────────────────────
    const globalDrift = 1 + gauss(0, 0.03);
    const augTps = julyTps.rows.map((t) => {
      const kwh = Number((t.kwh_month * SCALE * globalDrift * (1 + gauss(0, 0.05))).toFixed(2));
      const readingPrev = t.reading_curr; // iyul oxiri = avgust boshi
      const readingCurr = Number((readingPrev + kwh / (t.meter_coef || 1)).toFixed(2));
      return { ...t, augKwh: Math.max(0, kwh), readingPrev, readingCurr };
    });

    for (const t of augTps) {
      await c.query(
        `INSERT INTO fact.tp_monthly
           (tp_id, period_month, consumers_total, consumers_active, consumers_disconnected,
            meter_no, meter_coef, reading_prev, reading_curr, kwh_month)
         VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [t.tp_id, FROM_DATE, t.consumers_total, t.consumers_active, t.consumers_disconnected,
          t.meter_no, t.meter_coef, t.readingPrev, t.readingCurr, t.augKwh],
      );
    }

    /*
     * Fider balansi - `kwhIn` iyuldan TO'G'RIDAN-TO'G'RI (5/31 ulush) hisoblanadi,
     * TP yig'indisidan EMAS - aks holda tijoriy yo'qotish sun'iy deyarli
     * nolga tushib qolardi (avvalgi urinishda shunday bo'lgan: 30.9% o'rniga
     * 14% chiqqan). Shu tarzda iyulning yo'qotish profili (≈31%) avgustda ham
     * taxminan saqlanadi - "muammo davom etyapti" degan izchil manzara.
     */
    const kwhTpSum = Number(augTps.reduce((a, t) => a + t.augKwh, 0).toFixed(2));
    const kwhIn = Number((july.kwh_in * SCALE * globalDrift).toFixed(2));
    const techLoss = Number((kwhIn * TECH_LOSS_RATE).toFixed(2));
    const commercialLoss = Math.max(0, Number((kwhIn - kwhTpSum - techLoss).toFixed(2)));
    const meterCoef = july.meter_coef;
    const meterPrev = july.meter_curr;
    const meterCurr = Number((meterPrev + kwhIn / (meterCoef || 1)).toFixed(2));

    await c.query(
      `INSERT INTO fact.feeder_monthly
         (mfy_id, period_month, substation, input_name, meter_prev, meter_curr, meter_coef,
          kwh_in, kwh_tp_sum, kwh_tech_loss, kwh_commercial_loss)
       VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [mfyId, FROM_DATE, july.substation, july.input_name, meterPrev, meterCurr, meterCoef,
        kwhIn, kwhTpSum, techLoss, commercialLoss],
    );

    // ── 5. Kunlik taqsimot (5 kun) ────────────────────────────────────────
    const inDaily = split(kwhIn, DAY_WEIGHTS);
    const soldDaily = split(kwhTpSum, DAY_WEIGHTS);
    const lossDaily = inDaily.map((v, d) => v - Math.min(soldDaily[d]!, v));
    const techDaily = split(techLoss, lossDaily.map((v) => Math.max(v, 1)));

    for (let d = 0; d < DAYS; d += 1) {
      const date = `${PERIOD}-${String(d + 1).padStart(2, '0')}`;
      const dayIn = inDaily[d]!;
      const daySold = Math.min(soldDaily[d]!, dayIn);
      const loss = dayIn - daySold;
      const technical = Math.min(techDaily[d]!, loss);
      const illegal = loss - technical;

      await c.query(
        `INSERT INTO fact.energy_balance_daily
           (submission_id, mfy_id, biz_date, kwh_in, kwh_sold,
            kwh_loss_natural, kwh_loss_technical, kwh_loss_illegal)
         VALUES ($1, $2, $3::date, $4, $5, 0, $6, $7)`,
        [subIds.get('ENERGY_BALANCE'), mfyId, date, dayIn, daySold, technical, illegal],
      );
    }

    // ── 6. Iste'molchilar - iyuldagi bilan bir xil (bir necha kunda sezilarli o'zgarmaydi) ──
    const active = augTps.reduce((a, t) => a + t.consumers_active, 0);
    const off = augTps.reduce((a, t) => a + t.consumers_disconnected, 0);

    await c.query(
      `INSERT INTO fact.mfy_monthly_return
         (submission_id, mfy_id, period_month, consumers_population, consumers_legal,
          consumers_active, consumers_disconnected, consumers_new, consumers_disconnected_new,
          debt_population_mln, debt_legal_mln, debt_budget_mln,
          meters_offline_cnt, low_consumption_cnt, meters_replace_need_cnt, meters_replaced_cnt)
       VALUES ($1, $2, $3::date, $4, $5, $6, $7, 0, 0, $8, $9, $10, $11, $12, $13, $14)`,
      [subIds.get('MONTHLY_RETURN'), mfyId, FROM_DATE, mr.consumers_population, mr.consumers_legal,
        active, off, mr.debt_population_mln, mr.debt_legal_mln, mr.debt_budget_mln,
        mr.meters_offline_cnt, mr.low_consumption_cnt, mr.meters_replace_need_cnt, mr.meters_replaced_cnt],
    );

    await c.query('COMMIT');
    for (const r of trg.rows) await c.query(`ALTER TABLE ${r.sch}.${r.tbl} ENABLE TRIGGER zz_audit`);

    console.log('\nAgregatlar qayta qurilmoqda…');
    await c.query('SELECT agg.refresh_all(false)');

    const check = await c.query(`
      SELECT to_char(a.period_month,'YYYY-MM') AS period, a.days_filled,
             round(a.kwh_in)::int kwh_in, round(a.kwh_sold)::int sotilgan,
             round(a.kwh_loss_total)::int yoqotish, a.loss_pct
        FROM agg.mfy_monthly a WHERE a.mfy_id = $1 ORDER BY a.period_month`,
      [mfyId]);
    console.log('\nNatija (barcha davrlar):');
    console.table(check.rows);
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    c.release();
    await pool.end();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`\n✗ Xato:\n${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exitCode = 1;
});
