/**
 * XAQULOBOD FIDERI - ENERGIYA o'lchovlari (iyul va avgust 2026).
 *
 *   node --experimental-strip-types apps/api/scripts/load-xaqulobod-fider.ts
 *
 * IKKI MANBA, chunki avgust hisoboti qayta berilgan:
 *
 *   • iyul   - `xaqulobod_fider.xlsx`, «Iyul» varag'i (01–31.07, 31 kun);
 *   • avgust - `xaqulobod_fider_12kunlik.xlsx`, «Sheet0 (2)» (01–12.08, 12 kun).
 *
 * Har ikkalasida ham TP kesimi: balans hisoblagichi va biriktirilgan
 * iste'molchilardan yig'ilgan energiya.
 *
 * BU SKRIPT FAQAT ENERGIYA YOZADI:
 *   `fact.tp_loss_daily`, `fact.energy_balance_daily`, `fact.feeder_monthly`
 *   va ularga tegishli ENERGY_BALANCE konvertlari.
 *
 * Abonentlar → `load-consumers.ts`, nosozlik va ishlar → `load-tp-problems.ts`,
 * dalolatnomalar → `load-violations.ts`. Ilgari hammasi shu yerda edi va har
 * yuklashda boshqa skript yozgan ma'lumot ustidan yozilardi.
 *
 * KUNLARGA TAQSIMLASH: faylda davr bo'yicha BITTA son bor. U kunlarga TENG
 * bo'linadi, oxirgi kunga yaxlitlash qoldig'i qo'shiladi - shuning uchun
 * kunlik qiymatlar yig'indisi manba songa AYNAN teng bo'lib qoladi. Kunlik
 * tebranish manbada yo'q va O'YLAB TOPILMAYDI.
 *
 * REGISTR: bu skript TP qo'shmaydi ham, o'chirmaydi ham. Manbada bor, lekin
 * registrda yo'q TP uchrasa - to'xtaydi. Ortiqcha TP larni olib tashlash
 * `prune-extra-tps.ts` ning ishi.
 *
 * IDEMPOTENT: o'zi yozadigan jadvallarni tozalab, fayldan qayta yozadi.
 */
import { join } from 'node:path';

import ExcelJS from 'exceljs';
import pg from 'pg';

import { num } from '@beap/shared';

import { config, REPO_ROOT } from '../src/config.ts';
import { tpMatchKey } from './chinobod-common.ts';

const FEEDER_CODE = 'FIDER-XAQULOBOD';

/**
 * Manba varag'ining ustun tartibi. Ikki fayl ikki xil joyda saqlaydi,
 * shuning uchun raqamlar davr ta'rifida turadi - kodda emas.
 */
interface SheetLayout {
  file: string;
  sheet: string;
  /** Ma'lumot shu qatordan boshlanadi (yuqorisi sarlavhalar). */
  firstRow: number;
  colCode: number;
  colBalance: number;
  colConsumers: number;
}

interface PeriodSpec {
  period: string;
  label: string;
  start: string;
  end: string;
  days: number;
  layout: SheetLayout;
  /**
   * Oy uchun BIRIKTIRILGAN rasmiy kirim (fider boshidagi hisoblagich).
   * `null` = kelmagan; bunda kirim TP balans hisoblagichlari yig'indisidan
   * olinadi. Manba Excel fayllarida bu son YO'Q.
   */
  officialIn: number | null;
  /**
   * FOYDALI OQIM qaysi o'lchovdan olinadi - bu yo'qotish NIMANI anglatishini
   * belgilaydi:
   *
   *   'tp-balance' → kirim fider boshidan, oqim TP balans hisoblagichlaridan.
   *                  Yo'qotish = FIDER BOSHI bilan TP lar orasidagi yo'qotish.
   *   'consumers'  → oqim biriktirilgan iste'molchilardan.
   *                  Yo'qotish = TP bilan ISTE'MOLCHI orasidagi yo'qotish.
   *
   * Ikkisi har xil narsani o'lchaydi, shuning uchun oylar bir xil bo'lmasa
   * ularni to'g'ridan-to'g'ri solishtirib bo'lmaydi.
   */
  soldFrom: 'tp-balance' | 'consumers';
}

const PERIODS: PeriodSpec[] = [
  {
    period: '2026-07', label: 'Iyul', start: '2026-07-01', end: '2026-07-31', days: 31,
    layout: {
      file: 'xaqulobod_fider.xlsx', sheet: 'Iyul',
      firstRow: 3, colCode: 2, colBalance: 5, colConsumers: 6,
    },
    /*
     * «Умумий ҳисобот» hujjatidan: hisoblagich 19 850 → 20 112, koeffitsient
     * 4 000. Fider boshidagi o'lchov, ya'ni TP soniga bog'liq emas.
     */
    officialIn: 1_048_000,
    /*
     * Foydali oqim ISTE'MOLCHI hisoblagichlaridan (816 199 kWh).
     *
     * Ilgari bu yerda TP balans hisoblagichlari yig'indisi (662 827) turardi
     * va ikki narsani buzardi: birinchidan, aynan o'sha son «Jami iste'mol»
     * kartasining «TP bo'yicha» qatorida ham turib, bitta raqam ikki joyda
     * ikki xil nom bilan ko'rinardi; ikkinchidan, iyul avgustdan boshqa
     * o'lchovda hisoblanardi va ikki oyni solishtirib bo'lmasdi.
     *
     * NATIJASI OCHIQ: iste'molchi hisoblagichlari balansdan 153 ming kWh
     * KO'P ko'rsatadi (21 ta TP da balans hisoblagichi yoki tok
     * transformatori nosoz), shuning uchun yo'qotish 385 173 dan 231 801 ga
     * (36,75% → 22,12%) tushadi. Bu yaxshilanish EMAS - o'lchov asosining
     * o'zgarishi. TP darajasidagi nosozlik `/transformers` sahifasida
     * manfiy yo'qotish bo'lib ko'rinib turadi.
     */
    soldFrom: 'consumers',
  },
  {
    period: '2026-08', label: 'Avgust', start: '2026-08-01', end: '2026-08-12', days: 12,
    layout: {
      file: 'xaqulobod_fider_12kunlik.xlsx', sheet: 'Sheet0 (2)',
      firstRow: 5, colCode: 2, colBalance: 4, colConsumers: 5,
    },
    /*
     * Avgust uchun fider boshidagi rasmiy o'lchov berilmagan, shuning uchun
     * kirim ham, oqim ham TP hisoblagichlaridan olinadi va natija fayldagi
     * «Жами» qatoriga aynan tushadi: 191 184,5 → 157 399,0, yo'qotish 17,67%.
     *
     * DIQQAT: bu iyuldan BOSHQA narsani o'lchaydi. Iyulda yo'qotish fider
     * boshi bilan TP lar orasida, avgustda esa TP bilan iste'molchi orasida.
     * Rasmiy son kelganda shu yerga yozilsa, ikkala oy bir asosga qaytadi.
     */
    officialIn: null,
    soldFrom: 'consumers',
  },
];

// ─── Excel yordamchilari ─────────────────────────────────────────────────────

const val = (c: ExcelJS.Cell): unknown => {
  const v = c.value;
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    const o = v as { result?: unknown; text?: string };
    if (o.result !== undefined) return o.result;
    return o.text ?? null;
  }
  return v;
};

const numOf = (c: ExcelJS.Cell): number => {
  const v = val(c);
  if (typeof v === 'number') return v;
  const n = Number(String(v ?? '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

const r2 = (x: number): number => Math.round(x * 100) / 100;

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
  rawCode: string;
  key: string;
  balance: number;
  consumers: number;
}

async function readPeriod(p: PeriodSpec): Promise<TpReading[]> {
  const { file, sheet, firstRow, colCode, colBalance, colConsumers } = p.layout;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(join(REPO_ROOT, file));
  const ws = wb.getWorksheet(sheet);
  if (!ws) throw new Error(`«${sheet}» varag'i topilmadi: ${file}`);

  const out: TpReading[] = [];
  const seen = new Set<string>();
  for (let r = firstRow; r <= ws.rowCount; r += 1) {
    const row = ws.getRow(r);
    const rawCode = String(val(row.getCell(colCode)) ?? '').trim();
    // Oxirgi qator «Жами» - unda TP raqami yo'q.
    if (rawCode === '' || !/\d/.test(rawCode)) continue;

    const key = tpMatchKey(rawCode);
    if (seen.has(key)) throw new Error(`${p.label}: TP takrorlangan - «${rawCode}»`);
    seen.add(key);

    out.push({
      rawCode, key,
      balance: numOf(row.getCell(colBalance)),
      consumers: numOf(row.getCell(colConsumers)),
    });
  }
  if (out.length === 0) throw new Error(`${p.label}: bironta TP qatori topilmadi`);
  return out;
}

async function main(): Promise<void> {
  const readings = await Promise.all(PERIODS.map(readPeriod));

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

    const tpRes = await c.query<{ id: number; code: string }>(
      `SELECT id, code FROM ref.tp WHERE mfy_id = $1`, [mfyId],
    );
    const tpByKey = new Map(tpRes.rows.map((t) => [tpMatchKey(t.code), t.id]));

    /*
     * REGISTR - amaldagi TP ro'yxatining yagona manbai.
     *
     * Iyul varag'i registr tuzatilishidan OLDIN yozilgan va unda fiderga
     * tegishli bo'lmagan TP lar bor. Ular o'tkazib yuboriladi, lekin JIM
     * emas: qaysi TP va qancha energiya hisobdan chiqqani yoziladi.
     * Aks holda "iyul jamisi nega o'zgardi?" degan savolga javob qolmasdi.
     */
    for (const [i, rows] of readings.entries()) {
      const unknown = rows.filter((x) => !tpByKey.has(x.key));
      if (unknown.length === 0) continue;

      const bal = unknown.reduce((a, x) => a + x.balance, 0);
      const con = unknown.reduce((a, x) => a + x.consumers, 0);
      console.log(
        `\n${PERIODS[i]!.label}: registrda yo‘q ${unknown.length} ta TP hisobga olinmadi`
        + ` - ${unknown.map((x) => x.rawCode).join(', ')}`
        + `\n  (balans ${num(r2(bal))} kWh, iste’molchilar ${num(r2(con))} kWh)`,
      );
      readings[i] = rows.filter((x) => tpByKey.has(x.key));
    }

    for (const [i, rows] of readings.entries()) {
      if (rows.length === 0) throw new Error(`${PERIODS[i]!.label}: registrga mos TP qolmadi`);
    }

    // Audit triggeri ommaviy yuklashda o'chiriladi.
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

    /*
     * FAQAT SHU SKRIPT YOZADIGAN jadvallar tozalanadi. Konvertlar ham faqat
     * ENERGY_BALANCE domeni bo'yicha - abonentlar va TP holati boshqa
     * skriptlarning konvertlariga tayanadi va ular o'z joyida qolishi kerak.
     */
    console.log('Eski energiya ma’lumoti o‘chirilmoqda…');
    for (const t of ['tp_loss_daily', 'feeder_monthly', 'energy_balance_daily']) {
      const { rowCount } = await c.query(`DELETE FROM fact.${t}`);
      if (rowCount) console.log(`  fact.${t}: ${rowCount} qator`);
    }
    const subDel = await c.query(
      `DELETE FROM fact.submission
        WHERE scope_type = 'MFY' AND scope_id = $1 AND domain = 'ENERGY_BALANCE'`,
      [mfyId],
    );
    if (subDel.rowCount) console.log(`  fact.submission: ${subDel.rowCount} qator`);

    let tpRows = 0;
    for (const [i, p] of PERIODS.entries()) {
      const rows = readings[i]!;
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

      // Fider kunlik oqimi TP kunlik qiymatlaridan yig'iladi.
      const soldDaily = Array.from({ length: p.days }, () => 0);

      for (const rd of rows) {
        /*
         * `tp_monthly.kwh_month` - TP ning davr bo'yicha iste'moli.
         *
         * ENERGIYA ustuni, shuning uchun egasi shu skript. `load-consumers.ts`
         * unga ataylab tegmaydi (u faqat abonent ustunlarini yangilaydi), aks
         * holda ikkalasi bir-birining ustidan yozardi. Yangilanmasa esa eski
         * davrning qiymati qolib ketadi va /transformers sahifasi eskirgan
         * raqamni ko'rsatadi.
         */
        await c.query(
          `INSERT INTO fact.tp_monthly (tp_id, period_month, kwh_month)
           VALUES ($1, $2::date, $3)
           ON CONFLICT (tp_id, period_month) DO UPDATE
             SET kwh_month = EXCLUDED.kwh_month, updated_at = now()`,
          [tpByKey.get(rd.key), p.start, rd.consumers],
        );

        const bal = spread(rd.balance, p.days);
        const con = spread(rd.consumers, p.days);
        const sold = p.soldFrom === 'tp-balance' ? bal : con;
        for (let d = 0; d < p.days; d += 1) {
          soldDaily[d] = r2(soldDaily[d]! + sold[d]!);
          await c.query(
            `INSERT INTO fact.tp_loss_daily
               (tp_id, biz_date, kwh_balance_meter, kwh_consumers_attached,
                source, file_name, created_by, updated_by)
             VALUES ($1, $2::date, $3, $4, 'EXCEL', $5, $6, $6)`,
            [tpByKey.get(rd.key), dates[d], bal[d], con[d], p.layout.file, adminId],
          );
          tpRows += 1;
        }
      }

      const totalInTp = r2(rows.reduce((a, x) => a + x.balance, 0));
      const totalConsumers = r2(rows.reduce((a, x) => a + x.consumers, 0));
      const totalSold = p.soldFrom === 'tp-balance' ? totalInTp : totalConsumers;

      /*
       * AMALDAGI kirim - rasmiy son kelgan bo'lsa o'sha, aks holda TP balans
       * hisoblagichlari yig'indisi. Kunlik qatorlarga AYNAN shu son yoziladi,
       * chunki `agg.mfy_daily`/`mfy_monthly` va ular orqali barcha
       * ko'rsatkichlar (yo'qotish, foizi, samaradorlik) shu qatorlardan
       * yig'iladi - alohida hisob-kitob mantig'i kerak emas.
       */
      const effectiveIn = p.officialIn ?? totalInTp;
      const inDaily = spread(effectiveIn, p.days);

      for (let d = 0; d < p.days; d += 1) {
        await c.query(
          `INSERT INTO fact.energy_balance_daily
             (submission_id, mfy_id, biz_date, kwh_in, kwh_sold)
           VALUES ($1, $2, $3::date, $4, $5)`,
          [subId, mfyId, dates[d], inDaily[d], soldDaily[d]],
        );
      }

      /*
       * Fider oylik balansi. Hisoblagich ko'rsatkichlari (meter_prev/curr/coef)
       * manbalarda YO'Q - sukut qiymatida qoladi va interfeys «Fider
       * hisoblagichi» kartasida ma'lumot yo'qligini ko'rsatadi.
       */
      await c.query(
        `INSERT INTO fact.feeder_monthly
           (mfy_id, period_month, kwh_in, kwh_sold,
            kwh_in_official, kwh_in_tp, kwh_sold_tp, source)
         VALUES ($1, $2::date, $3, $4, $5, $6, $7, 'EXCEL')`,
        // `kwh_sold_tp` DOIM iste'molchi hisoblagichlari - kartadagi ikkinchi
        // darajali qiymat, asosiy raqam qaysi o'lchovdan olinishidan qat'i nazar.
        [mfyId, p.start, effectiveIn, totalSold, p.officialIn, totalInTp, totalConsumers],
      );

      const loss = r2(effectiveIn - totalSold);
      const pct = effectiveIn !== 0 ? (loss / effectiveIn) * 100 : 0;
      console.log(
        `\n${p.label} (${p.start} … ${p.end}, ${p.days} kun, ${rows.length} ta TP)`
        + `\n  manba                  ${p.layout.file} · ${p.layout.sheet}`
        + `\n  rasmiy kirim           ${p.officialIn === null ? '- (kelmagan)' : `${num(p.officialIn)} kWh`}`
        + `\n  TP balans hisoblagichi ${num(totalInTp)} kWh`
        + `\n  iste’molchi hisoblagichlari ${num(totalConsumers)} kWh`
        + `\n  AMALDAGI kirim         ${num(effectiveIn)} kWh`
        + `\n  foydali oqim           ${num(totalSold)} kWh`
        + ` (${p.soldFrom === 'tp-balance' ? 'TP balansidan' : 'iste’molchilardan'})`
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
