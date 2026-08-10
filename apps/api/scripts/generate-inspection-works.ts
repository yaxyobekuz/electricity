/**
 * «Хатлов» (hisoblagichlar tekshiruvi) ishlarini `fact.work` ga yozish.
 *
 * MANBA - O'YLAB TOPILMAYDI. `1-8.xlsx` va `2-5.xlsx` har bir TP uchun IKKITA
 * sanani yonma-yon beradi ("Хатловдан кейин" ustuni bilan): birinchisida
 * yo'qotish katta, ikkinchisida sezilarli kichik. Ikki o'lchov orasidagi FARQ
 * - xatlov ishining o'lchangan natijasi, ya'ni tejalgan energiya. Bu fayllar
 * allaqachon `load-chinobod-august.ts` orqali `fact.tp_loss_daily` ga
 * `source='EXCEL'` bilan yuklangan, shuning uchun bu skript XLSX ni qayta
 * o'qimaydi - bazadagi o'sha haqiqiy qatorlarni oladi.
 *
 *   node --experimental-strip-types apps/api/scripts/generate-inspection-works.ts
 *
 * NIMA UCHUN KERAK: «Natijadorlik» kartasidagi «Iqtisod qilingan energiya»
 * (`dashboard.ts` dagi `results()`) FAQAT `fact.work.effect_saving_kwh_month`
 * dan hisoblanadi. `load-feeder-data.ts` esa `fact.work` ni TRUNCATE qiladi -
 * manba hisobotlarda ishlar ustuni yo'q - shuning uchun karta 0 ko'rsatardi.
 *
 * IDEMPOTENT: shu skript yozgan qatorlar (`description` dagi `SOURCE_TAG`
 * bo'yicha topiladi) oldin o'chiriladi, boshqa ishlarga TEGILMAYDI.
 */
import pg from 'pg';

import { num } from '@beap/shared';

import { config } from '../src/config.ts';

/** Faqat shu skript yozgan qatorlarni qayta topish uchun belgi. */
const SOURCE_TAG = '[manba: 1-8.xlsx + 2-5.xlsx · xatlov]';

/**
 * Kunlik tejamkorlikni oylikka keltirish koeffitsienti.
 *
 * 30 - kalendar oyning taxminiy uzunligi. Bu YAGONA taxmin: kunlik farqning
 * o'zi o'lchangan, uni oyga yoyish esa "shu sur'at davom etadi" degan
 * faraz. Shuning uchun raqam kartada "oyiga" deb ko'rsatiladi.
 */
const DAYS_PER_MONTH = 30;

/**
 * `effect_loss_pct_before/after` ustunlarida `CHECK (... BETWEEN 0 AND 100)`
 * turibdi, manba fayldagi foiz esa 7 TP dan 5 tasida MANFIY (biriktirilgan
 * iste'molchilar balans hisoblagichidan ko'p - anomaliya belgisi). Bunday
 * qatorda foiz ustunlari NULL qoldiriladi: kWh dagi natija baribir yoziladi,
 * foiz shakli esa bu holatga MA'NOSIZ. Yolg'on nol yozilmaydi.
 */
const pctOrNull = (x: number): number | null => (x >= 0 && x <= 100 ? Number(x.toFixed(2)) : null);

interface Inspection {
  tpId: number;
  code: string;
  dateBefore: string;
  dateAfter: string;
  lossBefore: number;
  lossAfter: number;
  pctBefore: number;
  pctAfter: number;
  note: string | null;
}

async function main(): Promise<void> {
  const pool = new pg.Pool({ ...config.db, max: 2 });
  const c = await pool.connect();

  try {
    const mfy = await c.query<{ id: number }>(
      `SELECT id FROM ref.mfy WHERE code = 'FIDER-XAQULOBOD'`,
    );
    const mfyId = mfy.rows[0]?.id;
    if (!mfyId) throw new Error('Fider (FIDER-XAQULOBOD) registrda topilmadi');

    /*
     * Har bir TP uchun HAQIQIY (EXCEL) o'lchovlarning eng birinchisi va eng
     * oxirgisi. `DISTINCT ON` ikki marta ishlatilmaydi - bitta yig'ma so'rov
     * `min`/`max` sanani topib, shu sanalardagi qiymatni tortib oladi.
     */
    const rows = await c.query<{
      tp_id: number; code: string;
      date_before: string; date_after: string;
      loss_before: number; loss_after: number;
      pct_before: number; pct_after: number;
      note: string | null;
    }>(`
      WITH e AS (
        SELECT l.tp_id, t.code, l.biz_date, l.kwh_loss::float8 AS kwh_loss,
               l.loss_pct::float8 AS loss_pct, l.inspection_note,
               min(l.biz_date) OVER (PARTITION BY l.tp_id) AS d_first,
               max(l.biz_date) OVER (PARTITION BY l.tp_id) AS d_last
          FROM fact.tp_loss_daily l
          JOIN ref.tp t ON t.id = l.tp_id
         WHERE l.source = 'EXCEL' AND t.mfy_id = $1
      )
      SELECT tp_id, code,
             max(biz_date) FILTER (WHERE biz_date = d_first)::text AS date_before,
             max(biz_date) FILTER (WHERE biz_date = d_last)::text  AS date_after,
             max(kwh_loss) FILTER (WHERE biz_date = d_first)       AS loss_before,
             max(kwh_loss) FILTER (WHERE biz_date = d_last)        AS loss_after,
             max(loss_pct) FILTER (WHERE biz_date = d_first)       AS pct_before,
             max(loss_pct) FILTER (WHERE biz_date = d_last)        AS pct_after,
             max(inspection_note) FILTER (WHERE biz_date = d_first) AS note
        FROM e
       WHERE d_first <> d_last
       GROUP BY tp_id, code
       ORDER BY code`,
      [mfyId],
    );

    if (rows.rows.length === 0) {
      throw new Error(
        'Haqiqiy (source=EXCEL) TP o‘lchovlari topilmadi -'
        + ' avval load-chinobod-august.ts ishga tushirilsin',
      );
    }

    /*
     * Yo'qotish KAMAYGAN TP lar. Ortgani bo'lsa - u tejamkorlik EMAS, shuning
     * uchun ish yozuvi ochilmaydi (aks holda "natija" manfiy chiqib,
     * `effect_saving_kwh_month >= 0` CHECK ini buzardi).
     */
    const improved: Inspection[] = rows.rows
      .map((r) => ({
        tpId: r.tp_id, code: r.code,
        dateBefore: r.date_before, dateAfter: r.date_after,
        lossBefore: Number(r.loss_before), lossAfter: Number(r.loss_after),
        pctBefore: Number(r.pct_before), pctAfter: Number(r.pct_after),
        note: r.note,
      }))
      .filter((r) => r.lossBefore - r.lossAfter > 0);

    const skipped = rows.rows.length - improved.length;

    console.log(`\nXatlov natijasi - ${rows.rows.length} ta TP o‘lchangan,`
      + ` ${improved.length} tasida yo‘qotish kamaygan`
      + (skipped > 0 ? `, ${skipped} tasi o‘tkazib yuborildi (kamaymagan)` : ''));

    let totalSaving = 0;
    for (const r of improved) {
      const perDay = r.lossBefore - r.lossAfter;
      totalSaving += perDay * DAYS_PER_MONTH;
      console.log(
        `  ${r.code}  ${r.dateBefore} → ${r.dateAfter}`
        + `  ${num(Math.round(r.lossBefore))} → ${num(Math.round(r.lossAfter))} kWh/kun`
        + `  ·  tejaldi ${num(Math.round(perDay * DAYS_PER_MONTH))} kWh/oy`,
      );
    }
    console.log(`\n  JAMI: ${num(Math.round(totalSaving))} kWh/oy`);

    await c.query('BEGIN');

    // Avvalgi yurgizishning natijasi - faqat shu belgili qatorlar.
    const del = await c.query(
      `DELETE FROM fact.work WHERE mfy_id = $1 AND description LIKE '%' || $2 || '%'`,
      [mfyId, SOURCE_TAG],
    );
    if (del.rowCount) console.log(`\n  (${del.rowCount} ta eski xatlov yozuvi almashtirildi)`);

    for (const r of improved) {
      const perDay = r.lossBefore - r.lossAfter;
      const savingMonth = Number((perDay * DAYS_PER_MONTH).toFixed(2));

      /*
       * `work_type` = OTHER. Manba fayl faqat "хатлов" so'zini beradi -
       * hisoblagich almashtirildimi, noqonuniy ulanish uzildimi yoki boshqa
       * chora ko'rildimi, YOZILMAGAN. Aniqroq tur tanlash tekshirilmagan
       * da'vo bo'lardi.
       */
      await c.query(
        `INSERT INTO fact.work
           (mfy_id, tp_id, work_type, title_uz, description, status,
            planned_start, planned_end, actual_end, progress_pct,
            effect_loss_pct_before, effect_loss_pct_after, effect_saving_kwh_month)
         VALUES ($1, $2, 'OTHER', $3, $4, 'COMPLETED', $5::date, $6::date, $6::date, 100,
                 $7, $8, $9)`,
        [
          mfyId, r.tpId,
          `${r.code} - hisoblagichlar xatlovi`,
          `Balans hisoblagichi va biriktirilgan iste'molchilar o'lchovi`
          + ` ${r.dateBefore} va ${r.dateAfter} kunlari solishtirildi:`
          + ` kunlik yo'qotish ${Math.round(r.lossBefore)} → ${Math.round(r.lossAfter)} kWh.`
          + (r.note ? ` Hisobotdagi "Хатловдан кейин" belgisi: ${r.note}.` : '')
          + ` Oylik tejamkorlik kunlik farqni ${DAYS_PER_MONTH} kunga yoyish orqali olindi.`
          + ` ${SOURCE_TAG}`,
          r.dateBefore, r.dateAfter,
          pctOrNull(r.pctBefore), pctOrNull(r.pctAfter), savingMonth,
        ],
      );
    }

    await c.query('COMMIT');

    const check = await c.query<{ cnt: number; kwh: number }>(
      `SELECT count(*)::int AS cnt, round(sum(effect_saving_kwh_month))::int AS kwh
         FROM fact.work WHERE mfy_id = $1 AND status = 'COMPLETED'`,
      [mfyId],
    );
    const res = check.rows[0]!;
    console.log(`\nYozildi: ${res.cnt} ta tugallangan ish, jami ${num(res.kwh)} kWh/oy tejamkorlik.`);
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
