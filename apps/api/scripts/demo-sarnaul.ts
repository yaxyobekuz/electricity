/**
 * Sarnaul MFY — maketdagi (mockup) ko'rsatuv ma'lumotlari.
 *
 * NIMA UCHUN ALOHIDA SKRIPT: `seed` tasodifiy, lekin ishonchli taqsimot
 * hosil qiladi. Namoyish uchun esa AYNAN maketdagi raqamlar kerak. Ularni
 * generatorga qattiq yozib qo'yish butun tumanning taqsimotini buzadi,
 * shuning uchun tuzatish shu yerda — bir MFY doirasida, qayta ishga
 * tushirsa ham natija bir xil (idempotent).
 *
 *   node --experimental-strip-types apps/api/scripts/demo-sarnaul.ts
 *
 * NIMA O'ZGARADI:
 *   1. TR-0101…TR-0105 — quvvat, masofa, yuklama va holat maketdagidek.
 *      Qolgan TP lar yuklamasi pasaytiriladi, aks holda ular kartaning
 *      birinchi 5 qatorida shu beshtasini siqib chiqaradi.
 *   2. Ishlar ro'yxati — 4 ta bajarilgan, 4 ta rejadagi ish.
 *      "Iqtisod qilingan energiya" (128 560 kWh) shu ishlar yig'indisidan
 *      HISOBLANADI — panelga qo'lda yozilmaydi.
 *
 * NIMA O'ZGARMAYDI: energiya balansi. "Yo'qotish darajasi 11.2% → 5.0%"
 * ni ko'rsatish uchun bir yillik balansni qayta yozish kerak bo'lardi va u
 * tuman jamlanmasi bilan pasport yaxlitligini buzardi (SUM(MFY) = TUMAN).
 * Shuning uchun bu ikki foiz haqiqiy ma'lumotdan hisoblangan holicha qoladi.
 *
 * Daraxt kesish ishlari (TREE_CLEARING) HAM saqlanadi: ular pasportning
 * "tozalangan km" qatoriga kiradi.
 */
import pg from 'pg';

import { config } from '../src/config.ts';

const MFY_CODE = 'MFY-SARNAUL';

/** Maketdagi transformatorlar: kod → quvvat, masofa, yuklama, holat. */
const TPS = [
  { code: 'TR-0101', kva: 250, distance: 180, load: 65, condition: 'GOOD' },
  { code: 'TR-0102', kva: 250, distance: 320, load: 92, condition: 'OVERLOAD' },
  { code: 'TR-0103', kva: 160, distance: 210, load: 48, condition: 'GOOD' },
  { code: 'TR-0104', kva: 160, distance: 280, load: 78, condition: 'ATTENTION' },
  { code: 'TR-0105', kva: 100, distance: 150, load: 61, condition: 'GOOD' },
] as const;

/**
 * Ishlar. Sana — namoyish "buguni" atrofida: bajarilganlar o'tgan oyda,
 * reja kelasi oyda. Kun raqamlari maketdagidek.
 */
const DONE = [
  { day: '2026-07-22', type: 'TP_MODERNIZATION',  tp: 'TR-0102', title: 'TR-0102 transformator yog‘ini almashtirish', qty: 0,   unit: 'ta', saving: 52_000 },
  { day: '2026-07-20', type: 'CABLE_REPLACEMENT', tp: null,      title: '0.4 kV kabel liniyasi rekonstruksiyasi',      qty: 800, unit: 'm',  saving: 38_560 },
  { day: '2026-07-18', type: 'ILLEGAL_DISCONNECT', tp: null,     title: 'Noqonuniy ulanishlar bartaraf etildi',        qty: 5,   unit: 'ta', saving: 24_000 },
  { day: '2026-07-15', type: 'SUPPORT_REPLACEMENT', tp: null,    title: '3 ta tayanch ustun almashtirildi',            qty: 0,   unit: 'ta', saving: 14_000 },
] as const;

const PLAN = [
  { day: '2026-08-25', type: 'CABLE_REPLACEMENT', tp: null,      title: '0.4 kV kabel liniya tortish',           qty: 1.2, unit: 'km' },
  { day: '2026-08-28', type: 'TP_MODERNIZATION',  tp: 'TR-0103', title: 'TR-0103 transformatorga servis xizmat', qty: 0,   unit: 'ta' },
  { day: '2026-08-30', type: 'METER_REPLACEMENT', tp: null,      title: 'Hisoblagichlar almashinuvi',            qty: 20,  unit: 'ta' },
  { day: '2026-09-02', type: 'OTHER',             tp: null,      title: 'Yo‘qotishlarni kamaytirish bo‘yicha reyd', qty: 0, unit: 'ta' },
] as const;

/**
 * Dalolatnomalar — "Aniqlangan qoidabuzarliklar" kartasi uchun.
 * Uchala toifa ham ko'rinishi uchun har biridan kamida bittadan.
 */
const ACTS = [
  { no: 'DL-S-101', date: '2026-06-18', kind: 'ADMINISTRATIVE', consumer: 'Abonent №118204', kwh: 3_240, fine: 4.1, status: 'PAID' },
  { no: 'DL-S-102', date: '2026-05-27', kind: 'ADMINISTRATIVE', consumer: 'Abonent №204517', kwh: 1_860, fine: 2.6, status: 'ISSUED' },
  { no: 'DL-S-103', date: '2026-04-09', kind: 'CRIMINAL',       consumer: '«Oq yo‘l» MChJ',   kwh: 14_500, fine: 22.4, status: 'COURT' },
  { no: 'DL-S-104', date: '2026-03-15', kind: 'NO_FAULT',       consumer: 'Abonent №331902', kwh: 0,      fine: 0,    status: 'CLOSED' },
] as const;

async function main(): Promise<void> {
  const pool = new pg.Pool({ ...config.db, max: 2 });
  const c = await pool.connect();

  try {
    await c.query('BEGIN');

    const mfy = await c.query<{ id: number }>(
      'SELECT id FROM ref.mfy WHERE code = $1', [MFY_CODE],
    );
    const mfyId = mfy.rows[0]?.id;
    if (!mfyId) throw new Error(`MFY topilmadi: ${MFY_CODE}`);

    // ── 1. Transformatorlar ────────────────────────────────────────────
    const period = await c.query<{ p: string }>(
      `SELECT to_char(max(period_month), 'YYYY-MM-DD') AS p FROM fact.tp_status_monthly`,
    );
    const lastPeriod = period.rows[0]!.p;

    for (const tp of TPS) {
      await c.query(
        `UPDATE ref.tp SET rated_kva = $2, avg_distance_m = $3
          WHERE code = $1 AND mfy_id = $4`,
        [tp.code, tp.kva, tp.distance, mfyId],
      );
      const res = await c.query(
        `UPDATE fact.tp_status_monthly ts
            SET load_pct = $2,
                peak_kva = round($2::numeric * $3 / 100, 1),
                condition = $4,
                under_load = ($2 < 30),
                updated_at = now()
          FROM ref.tp t
         WHERE t.id = ts.tp_id AND t.code = $1 AND ts.period_month = $5::date`,
        [tp.code, tp.load, tp.kva, tp.condition, lastPeriod],
      );
      if (res.rowCount === 0) throw new Error(`${tp.code}: ${lastPeriod} davri uchun qator yo‘q`);
    }

    /*
     * Qolgan TP lar — maketdagi beshtasidan PAST yuklama bilan.
     * Karta holat va yuklama bo'yicha saralaydi; aks holda 70% li sog'lom
     * transformator 48% li TR-0103 ni ro'yxatdan siqib chiqaradi.
     */
    await c.query(
      `UPDATE fact.tp_status_monthly ts
          SET load_pct = round(30 + (t.id % 7) * 2.5, 2),
              peak_kva = round(t.rated_kva * (30 + (t.id % 7) * 2.5) / 100, 1),
              condition = 'GOOD',
              under_load = false,
              updated_at = now()
        FROM ref.tp t
       WHERE t.id = ts.tp_id AND t.mfy_id = $1
         AND ts.period_month = $2::date
         AND t.code <> ALL($3::text[])`,
      [mfyId, lastPeriod, TPS.map((t) => t.code)],
    );

    // ── 2. Ishlar ──────────────────────────────────────────────────────
    // Daraxt kesish ishlari PASPORT qatoriga kiradi — ularga tegilmaydi.
    await c.query(
      `DELETE FROM fact.work WHERE mfy_id = $1 AND work_type <> 'TREE_CLEARING'`,
      [mfyId],
    );

    for (const w of DONE) {
      await c.query(
        `INSERT INTO fact.work
           (mfy_id, tp_id, work_type, title_uz, status, planned_start, planned_end,
            actual_end, progress_pct, quantity, unit, cost_mln, effect_saving_kwh_month)
         VALUES ($1,
                 (SELECT id FROM ref.tp WHERE code = $2),
                 $3, $4, 'COMPLETED', $5::date - 10, $5::date, $5::date, 100, $6, $7, 0, $8)`,
        [mfyId, w.tp, w.type, w.title, w.day, w.qty, w.unit, w.saving],
      );
    }

    for (const w of PLAN) {
      await c.query(
        `INSERT INTO fact.work
           (mfy_id, tp_id, work_type, title_uz, status, planned_start, planned_end,
            progress_pct, quantity, unit, cost_mln)
         VALUES ($1,
                 (SELECT id FROM ref.tp WHERE code = $2),
                 $3, $4, 'PLANNED', $5::date - 7, $5::date, 0, $6, $7, 0)`,
        [mfyId, w.tp, w.type, w.title, w.day, w.qty, w.unit],
      );
    }

    /*
     * Eski daraxt kesish ishlari kartaning tepasiga chiqib qolmasin:
     * sana OY ICHIDA suriladi — oylik "tozalangan km" o'zgarmaydi.
     */
    await c.query(
      `UPDATE fact.work
          SET actual_end = date_trunc('month', actual_end)::date + 4
        WHERE mfy_id = $1 AND work_type = 'TREE_CLEARING' AND actual_end IS NOT NULL`,
      [mfyId],
    );

    // ── 3. Dalolatnomalar ──────────────────────────────────────────────
    // Faqat SHU skript qo'shganlari almashtiriladi (`DL-S-` prefiksi).
    await c.query(
      `DELETE FROM fact.violation_act WHERE mfy_id = $1 AND act_no LIKE 'DL-S-%'`, [mfyId],
    );
    for (const a of ACTS) {
      await c.query(
        `INSERT INTO fact.violation_act
           (mfy_id, act_no, act_date, consumer_ref, kwh_identified, fine_mln, status, case_type)
         VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8)`,
        [mfyId, a.no, a.date, a.consumer, a.kwh, a.fine, a.status, a.kind],
      );
    }

    await c.query('COMMIT');

    // Matview — tranzaksiyadan TASHQARIDA (CONCURRENTLY buni talab qiladi).
    await c.query('REFRESH MATERIALIZED VIEW CONCURRENTLY agg.tp_monthly');

    const check = await c.query<{ code: string; load_pct: number; condition: string }>(
      `SELECT code, load_pct, condition, avg_distance_m, distance_compliant
         FROM agg.tp_monthly
        WHERE mfy_id = $1 AND period_month = $2::date
        ORDER BY CASE condition WHEN 'OVERLOAD' THEN 0 WHEN 'FAULT' THEN 1
                                WHEN 'ATTENTION' THEN 2 ELSE 3 END,
                 (NOT coalesce(distance_compliant, true)) DESC, load_pct DESC
        LIMIT 5`,
      [mfyId, lastPeriod],
    );
    const saved = await c.query<{ kwh: number }>(
      `SELECT sum(effect_saving_kwh_month) AS kwh FROM fact.work
        WHERE mfy_id = $1 AND status = 'COMPLETED'`, [mfyId],
    );

    console.log(`\nSarnaul MFY (id ${mfyId}), davr ${lastPeriod}:`);
    console.table(check.rows);
    console.log(`Iqtisod qilingan energiya: ${Number(saved.rows[0]?.kwh ?? 0).toLocaleString('uz-UZ')} kWh`);
  } catch (err) {
    await c.query('ROLLBACK');
    throw err;
  } finally {
    c.release();
    await pool.end();
  }
}

await main();
