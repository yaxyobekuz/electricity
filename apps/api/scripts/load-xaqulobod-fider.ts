/**
 * `xaqulobod_fider.xlsx` - Xaqulobod fiderining 51 ta TP si bo'yicha iyul va
 * avgust o'lchovlarini yuklaydi.
 *
 *   node --experimental-strip-types apps/api/scripts/load-xaqulobod-fider.ts
 *
 * MANBA - faqat ikkita varaq:
 *   • «Iyul»   - 2026-07-01 … 2026-07-31 (31 kun), 51 qator;
 *   • «Avgust» - 2026-08-01 … 2026-08-10 (10 kun), 51 qator;
 *   • «Muammolar» - TP bo'yicha nosozlik izohi (matn sifatida saqlanadi).
 * Har qatorda uch son: «Hisoblangan» (balans hisoblagichi), «Foydali oqim»
 * (biriktirilgan iste'molchilar) va ularning ayirmasi - «Yo'qotish».
 *
 * FAYLDAGI «бир кунлик» VA «Sheet0» VARAQLARI ISHLATILMAYDI: ular butun
 * Chinobod ETK bo'yicha bir kunlik (01.08.2026) hisobot, ya'ni BOSHQA
 * fiderlarning TP lari ham bor. Bu tizim faqat Xaqulobod fiderini qamraydi,
 * qo'shilsa 51 TP dan tashqari ma'lumot va avgust oynasi bilan ikki marta
 * hisoblash paydo bo'lardi.
 *
 * KUNLARGA TAQSIMLASH: faylda davr bo'yicha BITTA son bor. U kunlarga TENG
 * bo'linadi, oxirgi kunga yaxlitlash qoldig'i qo'shiladi - shuning uchun
 * kunlik qiymatlar yig'indisi fayldagi songa AYNAN teng bo'lib qoladi.
 * Kunlik tebranish manbada yo'q va O'YLAB TOPILMAYDI.
 *
 * NIMA YUKLANMAYDI: iste'molchilar soni, qarzdorlik, TP pasporti (kVA,
 * masofa, yuklama), ishlar, dalolatnomalar va fider bosh hisoblagichining
 * ko'rsatkichi - bu ma'lumotlar faylda YO'Q. Tegishli panellar «ma'lumot
 * yo'q» deb ko'rsatadi.
 *
 * IDEMPOTENT: har ishga tushirilganda fakt jadvallari tozalanadi va
 * fayldan qayta yoziladi.
 */
import { join } from 'node:path';

import ExcelJS from 'exceljs';
import pg from 'pg';

import { config, REPO_ROOT } from '../src/config.ts';

const FILE = join(REPO_ROOT, 'xaqulobod_fider.xlsx');
const FEEDER_CODE = 'FIDER-XAQULOBOD';

/**
 * Varaq → davr. `days` fayl sarlavhasidagi oraliqdan olingan.
 *
 * `officialIn` - oy uchun BIRIKTIRILGAN rasmiy kirim, ya'ni fider boshidagi
 * kirish hisoblagichi. U `xaqulobod_fider.xlsx` da YO'Q: iyul qiymati
 * «Умумий ҳисобот» hujjatidan olingan (19 850 → 20 112, koeffitsient 4 000
 * = 1 048 000 kWh). Avgust uchun bunday o'lchov hali kelmagan - `null`,
 * demak karta TP yig'indisidan hisoblangan raqamni ko'rsatadi.
 */
const PERIODS = [
  { sheet: 'Iyul', period: '2026-07', start: '2026-07-01', end: '2026-07-31', days: 31, officialIn: 1_048_000 },
  { sheet: 'Avgust', period: '2026-08', start: '2026-08-01', end: '2026-08-10', days: 10, officialIn: null },
] as const;

// ─── Excel yordamchilari ─────────────────────────────────────────────────────

const val = (c: ExcelJS.Cell): string | number | null => {
  const v = c.value;
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') {
    const o = v as { result?: unknown; text?: string };
    if (o.result !== undefined) return o.result as string | number;
    return o.text ?? null;
  }
  return v as string | number;
};

const numOf = (c: ExcelJS.Cell): number => {
  const v = val(c);
  if (typeof v === 'number') return v;
  const n = Number(String(v ?? '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

const r2 = (x: number): number => Math.round(x * 100) / 100;

/**
 * TP kodini registr ko'rinishiga keltiradi.
 *
 * Faylda «10», «122A», registrda esa «TP-010», «TP-122A». Bundan tashqari
 * registrda uchta kod KIRILL «А» (U+0410) bilan yozilgan (TP-166А, TP-44А,
 * TP-47А), faylda esa lotin «A». Shuning uchun taqqoslashda ikkala tomon ham
 * kirilldan lotinga normallashtiriladi.
 */
const normalize = (s: string): string => s.trim().toUpperCase().replace(/А/g, 'A');

function tpKey(raw: string): string {
  const c = normalize(raw);
  return `TP-${/^\d+$/.test(c) ? c.padStart(3, '0') : c}`;
}

/**
 * Davr jamini `n` kunga teng taqsimlaydi.
 * Oxirgi kun qoldiqni oladi - yig'indi manba songa AYNAN teng bo'ladi.
 * Manfiy qiymatlar bilan ham to'g'ri ishlaydi.
 */
function spread(total: number, n: number): number[] {
  const per = r2(total / n);
  const out = Array.from({ length: n }, () => per);
  out[n - 1] = r2(total - per * (n - 1));
  return out;
}

function datesOf(start: string, n: number): string[] {
  const d0 = new Date(`${start}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(d0);
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

interface TpReading {
  tp: string;
  balance: number;
  consumers: number;
}

async function readSheet(wb: ExcelJS.Workbook, sheet: string): Promise<TpReading[]> {
  const ws = wb.getWorksheet(sheet);
  if (!ws) throw new Error(`«${sheet}» varag'i topilmadi`);

  const out: TpReading[] = [];
  // 1-qator sarlavha, 2-qator ustun nomlari, ma'lumot 3-qatordan boshlanadi.
  for (let r = 3; r <= ws.rowCount; r += 1) {
    const row = ws.getRow(r);
    const tp = String(val(row.getCell(2)) ?? '').trim();
    if (tp === '') continue;
    out.push({ tp, balance: numOf(row.getCell(5)), consumers: numOf(row.getCell(6)) });
  }
  return out;
}

async function readProblems(wb: ExcelJS.Workbook): Promise<Map<string, string>> {
  const ws = wb.getWorksheet('Muammolar');
  const map = new Map<string, string>();
  if (!ws) return map;
  for (let r = 3; r <= ws.rowCount; r += 1) {
    const row = ws.getRow(r);
    const tp = String(val(row.getCell(2)) ?? '').trim();
    const note = String(val(row.getCell(3)) ?? '').trim();
    if (tp !== '' && note !== '') map.set(tpKey(tp), note);
  }
  return map;
}

const num = (x: number): string => x.toLocaleString('en-US', { maximumFractionDigits: 1 });

async function main(): Promise<void> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(FILE);

  const problems = await readProblems(wb);
  const sheets = await Promise.all(PERIODS.map((p) => readSheet(wb, p.sheet)));

  const pool = new pg.Pool({ ...config.db, max: 2 });
  const c = await pool.connect();

  try {
    const mfy = await c.query<{ id: number }>(
      `SELECT id FROM ref.mfy WHERE code = $1`, [FEEDER_CODE],
    );
    const mfyId = mfy.rows[0]?.id;
    if (!mfyId) throw new Error(`Fider (${FEEDER_CODE}) registrda topilmadi`);

    const adminRes = await c.query<{ id: number }>(
      `SELECT id FROM sec.app_user WHERE role = 'admin' ORDER BY id LIMIT 1`,
    );
    const adminId = adminRes.rows[0]?.id;
    if (!adminId) throw new Error('admin foydalanuvchi topilmadi');

    // TP kodi → id. Registr tomoni ham normallashtiriladi (kirill «А»).
    const tpRes = await c.query<{ id: number; code: string }>(
      `SELECT id, code FROM ref.tp WHERE mfy_id = $1`, [mfyId],
    );
    const tpByCode = new Map(tpRes.rows.map((t) => [normalize(t.code), t.id]));

    const resolve = (raw: string): number => {
      const id = tpByCode.get(normalize(tpKey(raw)));
      if (id === undefined) throw new Error(`TP registrda topilmadi: «${raw}» → ${tpKey(raw)}`);
      return id;
    };

    // Audit triggeri ommaviy yuklashda o'chiriladi - boshqa skriptlar bilan bir xil.
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

    // ── 1. Tozalash ────────────────────────────────────────────────────────
    console.log('Eski fakt ma’lumoti o‘chirilmoqda…');
    for (const t of [
      'tp_loss_daily', 'tp_monthly', 'feeder_monthly', 'energy_balance_daily',
      'mfy_monthly_return', 'tp_status_monthly', 'tp_reading_daily', 'network_defect',
      'debt_top_entry', 'violation_act', 'work_photo', 'work', 'daily_form',
      'passport_snapshot', 'submission',
    ]) {
      const { rowCount } = await c.query(`DELETE FROM fact.${t}`);
      if (rowCount) console.log(`  fact.${t}: ${rowCount} qator`);
    }

    // ── 2. Har bir davr ────────────────────────────────────────────────────
    let tpRows = 0;
    for (const [i, p] of PERIODS.entries()) {
      const readings = sheets[i]!;
      const dates = datesOf(p.start, p.days);

      const subRes = await c.query<{ id: number }>(
        `INSERT INTO fact.submission
           (scope_type, scope_id, domain, period_type, period_start, period_end,
            status, created_by, reviewed_by, reviewed_at, submitted_at)
         VALUES ('MFY', $1, 'ENERGY_BALANCE', 'MONTH', $2::date, $3::date,
                 'approved', $4, $4, now(), now())
         RETURNING id`,
        [mfyId, p.start, p.end, adminId],
      );
      const subId = subRes.rows[0]!.id;

      // Fider kunlik jamlari TP kunlik qiymatlaridan YIG'ILADI.
      const feederIn = Array.from({ length: p.days }, () => 0);
      const feederSold = Array.from({ length: p.days }, () => 0);

      for (const rd of readings) {
        const tpId = resolve(rd.tp);
        const bal = spread(rd.balance, p.days);
        const con = spread(rd.consumers, p.days);
        const note = problems.get(tpKey(rd.tp)) ?? null;

        for (let d = 0; d < p.days; d += 1) {
          feederIn[d] = r2(feederIn[d]! + bal[d]!);
          feederSold[d] = r2(feederSold[d]! + con[d]!);
          await c.query(
            `INSERT INTO fact.tp_loss_daily
               (tp_id, biz_date, kwh_balance_meter, kwh_consumers_attached,
                source, file_name, note, created_by, updated_by)
             VALUES ($1, $2::date, $3, $4, 'EXCEL', $5, $6, $7, $7)`,
            [tpId, dates[d], bal[d], con[d], 'xaqulobod_fider.xlsx', note, adminId],
          );
          tpRows += 1;
        }
      }

      for (let d = 0; d < p.days; d += 1) {
        await c.query(
          `INSERT INTO fact.energy_balance_daily
             (submission_id, mfy_id, biz_date, kwh_in, kwh_sold)
           VALUES ($1, $2, $3::date, $4, $5)`,
          [subId, mfyId, dates[d], feederIn[d], feederSold[d]],
        );
      }

      /*
       * Fider oylik balansi. Hisoblagich ko'rsatkichlari (meter_prev/curr/coef)
       * faylda YO'Q - ular sukut bo'yicha 0/0/1 bo'lib qoladi va interfeys
       * «Fider hisoblagichi» kartasida ma'lumot yo'qligini ko'rsatadi.
       */
      const totalIn = r2(readings.reduce((a, r) => a + r.balance, 0));
      const totalSold = r2(readings.reduce((a, r) => a + r.consumers, 0));
      await c.query(
        `INSERT INTO fact.feeder_monthly
           (mfy_id, period_month, kwh_in, kwh_tp_sum, kwh_in_official, source)
         VALUES ($1, $2::date, $3, $4, $5, 'EXCEL')`,
        [mfyId, p.start, totalIn, totalSold, p.officialIn],
      );

      const loss = r2(totalIn - totalSold);
      const pct = totalIn !== 0 ? (loss / totalIn) * 100 : 0;
      console.log(
        `\n${p.sheet} (${p.start} … ${p.end}, ${p.days} kun, ${readings.length} ta TP)`
        + `\n  rasmiy kirim           ${p.officialIn === null ? '- (kelmagan)' : `${num(p.officialIn)} kWh`}`
        + `\n  balans hisoblagichlari ${num(totalIn)} kWh`
        + `\n  iste’molchilar         ${num(totalSold)} kWh`
        + `\n  yo‘qotish              ${num(loss)} kWh (${pct.toFixed(2)}%)`,
      );
    }

    await c.query('COMMIT');

    for (const r of trg.rows) {
      await c.query(`ALTER TABLE ${r.sch}.${r.tbl} ENABLE TRIGGER zz_audit`);
    }

    console.log(`\nfact.tp_loss_daily: ${tpRows} qator`);
    console.log('Agregatlar yangilanmoqda…');
    await c.query('SELECT agg.refresh_all(false)');
    console.log('✓ Tayyor.');
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    c.release();
    await pool.end();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`\n✗ ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
