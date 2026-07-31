/**
 * `data/` papkasidagi Excel fayllardan MFY ma'lumotlarini yuklash.
 *
 * NIMA QILADI:
 *   1. BARCHA eski fakt ma'lumotini o'chiradi (energiya, abonent, TP holati,
 *      ishlar, dalolatnomalar, konvertlar) va faqat fayllar tegishli
 *      MFY larni qoldiradi — qolgan mahallalar registrdan ham chiqariladi.
 *   2. Har bir fayldagi 17 ko'rsatkichni tizim jadvallariga yozadi.
 *   3. Agregatlarni qayta quradi.
 *
 *   node --experimental-strip-types apps/api/scripts/load-mfy-data.ts
 *
 * BIRLIKLAR — fayldagi raqamlar o'zaro tekshirib aniqlangan:
 *   «Jami iste'mol» − «Sotilgan» = «Jami yo'qotish»  (182.3 − 167.3 = 15.0)
 *   «Texnologik» + «Tijoriy»     = «Jami yo'qotish»  (8.4 + 6.6 = 15.0)
 *   Demak energiya ustunlari MING kWh da va OYLIK jamlar. Qarzdorlik — mln so'm.
 *
 * NIMA HISOBLANADI (faylda yo'q, lekin panel talab qiladi):
 *   • kunlik taqsimot — oylik jam 30 kunga haftalik ritm bilan bo'linadi,
 *     yig'indi AYNAN fayldagi songa teng bo'lib qoladi;
 *   • tabiiy/texnik ajratmasi — «texnologik» me'yorlar nisbatida bo'linadi
 *     (NATURAL_LOSS_PCT : TECHNICAL_LOSS_PCT);
 *   • TP yuklamasi va kunlik o'lchovlari — mahalla energiyasi va TP quvvatidan.
 *     Bular TAXMIN, chunki fayl TP kesimida ma'lumot bermaydi.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import ExcelJS from 'exceljs';
import pg from 'pg';

import { config } from '../src/config.ts';

/** Fayl nomidagi kalit so'z → MFY kodi. Fayl nomi noaniq bo'lsa shu yerda tuzatiladi. */
const FILE_TO_MFY: { match: RegExp; mfyCode: string }[] = [
  { match: /^Баликчи/i, mfyCode: 'MFY-GORAVON' },
  { match: /SARNAUL/i, mfyCode: 'MFY-SARNAUL' },
];

/** Yuklanadigan davr — joriy oy. */
const PERIOD = '2026-07';
const DAYS = 30;

/** Kunlik ritm: hafta oxiri biroz pastroq. Tasodif YO'Q — natija takrorlanadi. */
const DAY_WEIGHTS = Array.from({ length: DAYS }, (_, i) => {
  const dow = (i + 3) % 7; // 2026-07-01 — chorshanba
  return dow === 5 || dow === 6 ? 0.92 : 1.03;
});

interface SheetData {
  activeConsumers: number;
  disconnected: number;
  newConnected: number;
  disconnectedNew: number;
  legal: number;
  technologicalMwh: number;
  totalInMwh: number;
  soldMwh: number;
  totalLossMwh: number;
  debtMln: number;
  commercialMwh: number;
  tpCount: number;
}

function cellNum(ws: ExcelJS.Worksheet, col: number): number {
  const v = ws.getRow(2).getCell(col).value;
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'object' && 'result' in v) return Number(v.result ?? 0);
  return Number(String(v).replace(/\s/g, '').replace(',', '.')) || 0;
}

async function readSheet(path: string): Promise<SheetData> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error(`${path}: varaq topilmadi`);

  // Ustunlar tartibi fayllarda bir xil (17 ta ko'rsatkich).
  return {
    activeConsumers: cellNum(ws, 1),
    disconnected: cellNum(ws, 2),
    newConnected: cellNum(ws, 3),
    disconnectedNew: cellNum(ws, 4),
    legal: cellNum(ws, 5),
    technologicalMwh: cellNum(ws, 8),
    totalInMwh: cellNum(ws, 9),
    soldMwh: cellNum(ws, 10),
    totalLossMwh: cellNum(ws, 11),
    debtMln: cellNum(ws, 13),
    commercialMwh: cellNum(ws, 16),
    tpCount: cellNum(ws, 17),
  };
}

/**
 * Jamini og'irliklar bo'yicha butun sonlarga bo'ladi.
 * Eng katta qoldiq usuli — yig'indi AYNAN jamiga teng chiqadi.
 */
function split(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  const raw = weights.map((w) => (total * w) / sum);
  const out = raw.map((v) => Math.floor(v));
  let rest = Math.round(total) - out.reduce((a, b) => a + b, 0);
  const order = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; rest > 0; k += 1, rest -= 1) {
    const idx = order[k % order.length]!.i;
    out[idx] = (out[idx] ?? 0) + 1;
  }
  return out;
}

async function main(): Promise<void> {
  // ── 1. Fayllarni o'qish ────────────────────────────────────────────────
  const dir = join(config.paths.uploads, '..', '..', 'data');
  const files = readdirSync(dir).filter((f) => f.endsWith('.xlsx') && !f.startsWith('~$'));
  if (files.length === 0) throw new Error(`data/ papkasida .xlsx fayl yo'q`);

  const loads: { file: string; mfyCode: string; data: SheetData }[] = [];
  for (const f of files) {
    const rule = FILE_TO_MFY.find((r) => r.match.test(f));
    if (!rule) {
      console.log(`  ⚠ ${f} — qaysi MFY ekani aniqlanmadi, o'tkazib yuborildi`);
      continue;
    }
    loads.push({ file: f, mfyCode: rule.mfyCode, data: await readSheet(join(dir, f)) });
  }

  console.log('\nFayl → MFY:');
  for (const l of loads) console.log(`  ${l.file}  →  ${l.mfyCode}`);

  const pool = new pg.Pool({ ...config.db, max: 2 });
  const c = await pool.connect();

  try {
    // Audit triggerlari ommaviy yozuvda o'chiriladi — seed ham shunday qiladi.
    const trg = await c.query<{ sch: string; tbl: string }>(`
      SELECT n.nspname AS sch, c.relname AS tbl
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE t.tgname = 'zz_audit' AND NOT t.tgisinternal`);
    for (const r of trg.rows) {
      await c.query(`ALTER TABLE ${r.sch}.${r.tbl} DISABLE TRIGGER zz_audit`);
    }

    await c.query('BEGIN');

    const codes = loads.map((l) => l.mfyCode);
    const keep = await c.query<{ id: number; code: string; name_uz: string }>(
      'SELECT id, code, name_uz FROM ref.mfy WHERE code = ANY($1::text[])', [codes],
    );
    if (keep.rowCount !== loads.length) {
      throw new Error(`MFY topilmadi: kutilgan ${loads.length}, topilgan ${keep.rowCount}`);
    }
    const idByCode = new Map(keep.rows.map((r) => [r.code, r.id]));
    const keepIds = keep.rows.map((r) => r.id);

    // ── 2. Eski ma'lumotni to'liq tozalash ───────────────────────────────
    console.log('\nEski ma’lumot o‘chirilmoqda…');
    await c.query(`
      TRUNCATE fact.tp_reading_daily, fact.energy_balance_daily, fact.mfy_monthly_return,
               fact.tp_status_monthly, fact.network_defect, fact.debt_top_entry,
               fact.violation_act, fact.work, fact.work_photo, fact.passport_snapshot,
               fact.report_job, fact.submission RESTART IDENTITY CASCADE`);

    await c.query(
      `DELETE FROM sec.user_scope WHERE scope_type = 'MFY' AND scope_id <> ALL($1::int[])`,
      [keepIds],
    );
    await c.query('DELETE FROM ref.network_segment WHERE mfy_id <> ALL($1::int[])', [keepIds]);
    await c.query('DELETE FROM ref.tp WHERE mfy_id <> ALL($1::int[])', [keepIds]);
    await c.query(
      `DELETE FROM ref.norm WHERE scope_type = 'MFY' AND scope_id <> ALL($1::int[])`, [keepIds],
    );
    const dropped = await c.query('DELETE FROM ref.mfy WHERE id <> ALL($1::int[])', [keepIds]);
    console.log(`  ${dropped.rowCount} ta mahalla registrdan chiqarildi`);

    // ── 3. Har bir MFY ni yuklash ────────────────────────────────────────
    const admin = await c.query<{ id: number }>(
      `SELECT id FROM sec.app_user WHERE role = 'admin' ORDER BY id LIMIT 1`,
    );
    const adminId = admin.rows[0]?.id;
    if (!adminId) throw new Error('admin foydalanuvchi topilmadi');

    // Me'yorlar: texnologik yo'qotishni tabiiy/texnik ga bo'lish nisbati.
    const norms = await c.query<{ nat: number; tech: number }>(
      `SELECT ref.norm_value('NATURAL_LOSS_PCT',   NULL, ($1 || '-01')::date) AS nat,
              ref.norm_value('TECHNICAL_LOSS_PCT', NULL, ($1 || '-01')::date) AS tech`,
      [PERIOD],
    );
    const natShare = Number(norms.rows[0]?.nat ?? 4.2)
      / (Number(norms.rows[0]?.nat ?? 4.2) + Number(norms.rows[0]?.tech ?? 3.2));

    const pStart = `${PERIOD}-01`;
    const pEnd = `${PERIOD}-${String(DAYS).padStart(2, '0')}`;

    for (const { mfyCode, data } of loads) {
      const mfyId = idByCode.get(mfyCode)!;
      console.log(`\n${mfyCode} (id ${mfyId}) yuklanmoqda…`);

      // ── TP registri fayldagi songa moslashtiriladi ────────────────────
      const tps = await c.query<{ id: number; rated_kva: number }>(
        'SELECT id, rated_kva FROM ref.tp WHERE mfy_id = $1 ORDER BY id', [mfyId],
      );
      let tpRows = tps.rows;
      if (tpRows.length > data.tpCount) {
        const extra = tpRows.slice(data.tpCount).map((t) => t.id);
        await c.query('DELETE FROM ref.tp WHERE id = ANY($1::int[])', [extra]);
        tpRows = tpRows.slice(0, data.tpCount);
      } else if (tpRows.length < data.tpCount) {
        const prefix = mfyCode === 'MFY-SARNAUL' ? 1 : 2;
        for (let k = tpRows.length; k < data.tpCount; k += 1) {
          const code = `TR-0${prefix}${String(k + 1).padStart(2, '0')}`;
          const ins = await c.query<{ id: number; rated_kva: number }>(
            `INSERT INTO ref.tp (mfy_id, code, rated_kva, voltage_class, avg_distance_m)
             VALUES ($1, $2, $3, '10/0.4', $4)
             ON CONFLICT (code) DO NOTHING
             RETURNING id, rated_kva`,
            [mfyId, code, [100, 160, 250, 400][k % 4], 180 + (k % 5) * 30],
          );
          if (ins.rows[0]) tpRows.push(ins.rows[0]);
        }
      }
      console.log(`  transformator: ${tpRows.length} ta (faylda ${data.tpCount})`);

      // ── Konvertlar (tasdiqlangan) ─────────────────────────────────────
      const subIds = new Map<string, number>();
      for (const domain of ['ENERGY_BALANCE', 'MONTHLY_RETURN', 'TP_STATUS', 'TP_READING']) {
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

      // ── Kunlik energiya balansi ───────────────────────────────────────
      const inDaily = split(data.totalInMwh * 1000, DAY_WEIGHTS);
      const soldDaily = split(data.soldMwh * 1000, DAY_WEIGHTS);
      const commercialShare =
        data.technologicalMwh + data.commercialMwh > 0
          ? data.commercialMwh / (data.technologicalMwh + data.commercialMwh)
          : 0;

      for (let d = 0; d < DAYS; d += 1) {
        const date = `${PERIOD}-${String(d + 1).padStart(2, '0')}`;
        const kwhIn = inDaily[d]!;
        const kwhSold = Math.min(soldDaily[d]!, kwhIn);
        const loss = kwhIn - kwhSold;
        const illegal = Math.round(loss * commercialShare);
        const rest = loss - illegal;
        const natural = Math.round(rest * natShare);
        const technical = rest - natural;

        await c.query(
          `INSERT INTO fact.energy_balance_daily
             (submission_id, mfy_id, biz_date, kwh_in, kwh_sold,
              kwh_loss_natural, kwh_loss_technical, kwh_loss_illegal)
           VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8)`,
          [subIds.get('ENERGY_BALANCE'), mfyId, date, kwhIn, kwhSold, natural, technical, illegal],
        );
      }

      // ── Oylik hisobot ─────────────────────────────────────────────────
      const total = data.activeConsumers + data.disconnected;
      const population = Math.max(0, total - data.legal);
      /*
       * Qarzdorlik faylda BITTA son. Toifalarga abonent nisbatida bo'linadi —
       * budjet tashkilotlari ajratilmagan (faylda bunday ustun yo'q).
       */
      const debtLegal = Number((data.debtMln * (data.legal / Math.max(1, total))).toFixed(2));
      const debtPopulation = Number((data.debtMln - debtLegal).toFixed(2));

      await c.query(
        `INSERT INTO fact.mfy_monthly_return
           (submission_id, mfy_id, period_month, consumers_population, consumers_legal,
            consumers_active, consumers_disconnected, consumers_new, consumers_disconnected_new,
            debt_population_mln, debt_legal_mln, debt_budget_mln,
            meters_offline_cnt, low_consumption_cnt, meters_replace_need_cnt, meters_replaced_cnt)
         VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8, $9, $10, $11, 0, 0, 0, 0, 0)`,
        [subIds.get('MONTHLY_RETURN'), mfyId, pStart, population, data.legal,
          data.activeConsumers, data.disconnected, data.newConnected, data.disconnectedNew,
          debtPopulation, debtLegal],
      );

      // ── TP holati va kunlik o'lchovlari (TAXMIN) ──────────────────────
      const totalKva = tpRows.reduce((a, t) => a + Number(t.rated_kva), 0);
      const avgKw = (data.totalInMwh * 1000) / (DAYS * 24);
      // Yuklama koeffitsienti — o'rtachadan cho'qqiga o'tish uchun.
      const peakKw = avgKw * 2.2;
      const loadPct = totalKva > 0 ? Math.min(200, (peakKw / totalKva) * 100) : 0;
      const condition = loadPct >= 90 ? 'OVERLOAD' : loadPct >= 78 ? 'ATTENTION' : 'GOOD';
      console.log(`  yuklama: ${loadPct.toFixed(1)}% (${Math.round(peakKw)} kW / ${totalKva} kVA)`);

      for (const t of tpRows) {
        await c.query(
          `INSERT INTO fact.tp_status_monthly
             (submission_id, tp_id, period_month, load_pct, peak_kva, condition, under_load)
           VALUES ($1, $2, $3::date, $4, $5, $6, $7)`,
          [subIds.get('TP_STATUS'), t.id, pStart, Number(loadPct.toFixed(2)),
            Number((Number(t.rated_kva) * loadPct / 100).toFixed(1)), condition, loadPct < 30],
        );

        for (let d = 0; d < DAYS; d += 1) {
          const date = `${PERIOD}-${String(d + 1).padStart(2, '0')}`;
          const share = totalKva > 0 ? Number(t.rated_kva) / totalKva : 0;
          const dayKwh = inDaily[d]! * share;
          const maxKw = Number(((dayKwh / 24) * 2.2).toFixed(2));
          await c.query(
            `INSERT INTO fact.tp_reading_daily
               (submission_id, tp_id, biz_date, max_load_kw, min_load_kw, avg_voltage_v,
                outage_count, outage_minutes)
             VALUES ($1, $2, $3::date, $4, $5, 220, 0, 0)`,
            [subIds.get('TP_READING'), t.id, date, maxKw, Number((maxKw * 0.35).toFixed(2))],
          );
        }
      }
    }

    await c.query('COMMIT');

    for (const r of trg.rows) {
      await c.query(`ALTER TABLE ${r.sch}.${r.tbl} ENABLE TRIGGER zz_audit`);
    }

    console.log('\nAgregatlar qayta qurilmoqda…');
    await c.query('SELECT agg.refresh_all(false)');

    const check = await c.query(`
      SELECT m.name_uz,
             round(a.kwh_in)::int kwh_in, round(a.kwh_sold)::int sold,
             round(a.kwh_loss_total)::int loss, a.loss_pct,
             a.consumers_total, a.consumers_active, a.consumers_disconnected,
             round(a.debt_total_mln, 1) debt, a.tp_total
        FROM agg.mfy_monthly a JOIN ref.mfy m ON m.id = a.mfy_id
       WHERE a.period_month = $1::date ORDER BY m.id`, [pStart]);
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
