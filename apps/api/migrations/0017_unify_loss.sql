-- ═══════════════════════════════════════════════════════════════════════════
-- 0017_unify_loss.sql - yo'qotish toifalarini BITTA "Yo'qotish" ga birlashtirish
--
-- MUAMMO: yo'qotish ikki qatlamda bo'lingan holda saqlanardi va ko'rsatilardi:
--   fact.energy_balance_daily - tabiiy / texnik / noqonuniy (3 ta ustun),
--   fact.feeder_monthly       - texnologik / tijoriy (2 ta ustun).
-- Bu bo'linish operator uchun kiritish yukini oshirardi (bir xil jamini uch
-- ustunga taqsimlash), ekranda esa bir necha xil "yo'qotish" raqami paydo
-- bo'lardi.
--
-- YECHIM: yagona yo'qotish. Ikkala qatlamda ham u ALLAQACHON hosila:
--   energy_balance_daily.kwh_loss_total = kwh_in - kwh_sold   (mavjud, generated)
--   feeder_monthly.kwh_loss             = kwh_in - kwh_tp_sum (shu yerda qo'shiladi)
-- Shuning uchun yangi saqlanadigan ustun kerak emas - tarkib ustunlari
-- o'chiriladi, jami esa o'z-o'zidan hisoblanib qolaveradi.
--
-- DIQQAT: bu QAYTARIB BO'LMAYDIGAN amal - tabiiy/texnik/noqonuniy kesimi
-- yo'qoladi. Jami yo'qotish (kwh_in - kwh_sold) o'zgarmaydi, ya'ni hech bir
-- dashboard raqami siljimaydi.
-- ═══════════════════════════════════════════════════════════════════════════


-- ─── 1. AGREGAT QATLAMINI OLIB TASHLASH ─────────────────────────────────────
-- Matview lar bazaviy ustunlarga bog'langan - ustun o'chirishdan oldin ular
-- olib tashlanadi va quyida qayta quriladi.

DROP VIEW IF EXISTS agg.v_tuman_passport;
DROP VIEW IF EXISTS agg.v_mfy_passport;
DROP VIEW IF EXISTS agg.v_technical_loss_gap;
DROP VIEW IF EXISTS agg.v_tuman_daily;
DROP MATERIALIZED VIEW IF EXISTS agg.mfy_monthly;
DROP MATERIALIZED VIEW IF EXISTS agg.mfy_daily;


-- ─── 2. KUNLIK BALANS: TARKIB USTUNLARINI O'CHIRISH ─────────────────────────
-- `eb_components` yo'qotish tarkibi jamiga mos kelishini tekshirardi. Tarkib
-- qolmagach, tekshiradigan narsa ham qolmaydi: jami o'zi generated ustun.

ALTER TABLE fact.energy_balance_daily
  DROP CONSTRAINT IF EXISTS eb_components,
  DROP COLUMN IF EXISTS kwh_loss_natural,
  DROP COLUMN IF EXISTS kwh_loss_technical,
  DROP COLUMN IF EXISTS kwh_loss_illegal;


-- ─── 3. FIDER OYLIK BALANSI: texnologik + tijoriy → yagona yo'qotish ────────
-- Eski `fm_balance` kirgan = TP yig'indisi + texnologik + tijoriy ekanini
-- talab qilardi. Endi yo'qotish shu ayirmaning O'ZI, shuning uchun ayniyat
-- buzilishi mumkin emas - tekshiruv o'rniga `kwh_tp_sum <= kwh_in` qoladi.

ALTER TABLE fact.feeder_monthly
  DROP CONSTRAINT IF EXISTS fm_balance,
  DROP COLUMN IF EXISTS kwh_tech_loss,
  DROP COLUMN IF EXISTS kwh_commercial_loss;

-- Eski ayniyat 1 kWh dopusk bilan tekshirilardi, ya'ni `kwh_tp_sum` kirgan
-- energiyadan 1 kWh ga oshib turgan qatorlar qonuniy edi. Yagona yo'qotishda
-- bunday qator manfiy yo'qotish berardi - shu 1 kWh yaxlitlanadi.
UPDATE fact.feeder_monthly SET kwh_tp_sum = kwh_in WHERE kwh_tp_sum > kwh_in;

ALTER TABLE fact.feeder_monthly
  ADD COLUMN kwh_loss numeric(14,2)
    GENERATED ALWAYS AS (kwh_in - kwh_tp_sum) STORED,
  ADD CONSTRAINT fm_tp_sum_le_in CHECK (kwh_tp_sum <= kwh_in);

COMMENT ON COLUMN fact.feeder_monthly.kwh_loss IS
  'Yo''qotish - fider hisoblagichi va TP hisoblagichlari yig''indisi ayirmasi';


-- ─── 4. NORMALAR: tarkib normalari endi ishlatilmaydi ───────────────────────
-- NATURAL_LOSS_PCT va TECHNICAL_LOSS_PCT faqat o'chirilgan tarkib ustunlariga
-- taqqoslash uchun kerak edi. Yagona yo'qotish TOTAL_LOSS_TARGET_PCT ga
-- taqqoslanadi - u o'z holicha qoladi.

DELETE FROM ref.norm WHERE metric IN ('NATURAL_LOSS_PCT', 'TECHNICAL_LOSS_PCT');


-- ─── 5. KUNLIK BAZA (qayta qurish) ──────────────────────────────────────────

CREATE MATERIALIZED VIEW agg.mfy_daily AS
SELECT
  e.mfy_id,
  m.elektroset_id,
  e.biz_date,
  e.kwh_in,
  e.kwh_sold,
  e.kwh_loss_total,
  e.loss_pct,
  ref.norm_value('TOTAL_LOSS_TARGET_PCT', e.mfy_id, e.biz_date) AS total_loss_target_pct
FROM fact.energy_balance_daily e
JOIN fact.submission s ON s.id = e.submission_id AND s.status = 'approved'
JOIN ref.mfy m ON m.id = e.mfy_id;

CREATE UNIQUE INDEX mfy_daily_uq   ON agg.mfy_daily (mfy_id, biz_date);
CREATE INDEX        mfy_daily_date ON agg.mfy_daily (biz_date DESC);
CREATE INDEX        mfy_daily_es   ON agg.mfy_daily (elektroset_id, biz_date DESC);


-- ─── 6. TUMAN KUNLIK ────────────────────────────────────────────────────────

CREATE VIEW agg.v_tuman_daily AS
SELECT
  biz_date,
  sum(kwh_in)         AS kwh_in,
  sum(kwh_sold)       AS kwh_sold,
  sum(kwh_loss_total) AS kwh_loss_total,
  CASE WHEN sum(kwh_in) > 0
       THEN round(100 * sum(kwh_loss_total) / sum(kwh_in), 3) END AS loss_pct
FROM agg.mfy_daily
GROUP BY biz_date;


-- ─── 7. OYLIK BAZA (qayta qurish) ───────────────────────────────────────────

CREATE MATERIALIZED VIEW agg.mfy_monthly AS
WITH spine AS (
  SELECT mfy_id, date_trunc('month', biz_date)::date AS period_month FROM agg.mfy_daily
  UNION
  SELECT r.mfy_id, r.period_month
    FROM fact.mfy_monthly_return r
    JOIN fact.submission s ON s.id = r.submission_id AND s.status = 'approved'
),
eb AS (
  SELECT mfy_id, date_trunc('month', biz_date)::date AS period_month,
         count(*)                     AS days_filled,
         sum(kwh_in)                  AS kwh_in,
         sum(kwh_sold)                AS kwh_sold,
         sum(kwh_loss_total)          AS kwh_loss_total,
         max(total_loss_target_pct)   AS total_loss_target_pct
  FROM agg.mfy_daily GROUP BY 1, 2
),
mr AS (
  SELECT r.mfy_id, r.period_month,
         r.consumers_total, r.consumers_population, r.consumers_legal,
         r.consumers_active, r.consumers_disconnected, r.consumers_new,
         r.debt_total_mln, r.debt_population_mln, r.debt_legal_mln, r.debt_budget_mln,
         r.meters_offline_cnt, r.low_consumption_cnt,
         r.meters_replace_need_cnt, r.meters_replaced_cnt
  FROM fact.mfy_monthly_return r
  JOIN fact.submission s ON s.id = r.submission_id AND s.status = 'approved'
),
tp AS (
  SELECT t.mfy_id, ts.period_month,
         count(*)                                              AS tp_total,
         count(*) FILTER (WHERE ts.under_load)                 AS tp_under_load,
         count(*) FILTER (WHERE ts.repair_needed)              AS tp_repair_needed,
         count(*) FILTER (WHERE ts.condition = 'OVERLOAD')     AS tp_overloaded,
         count(*) FILTER (WHERE ts.condition = 'ATTENTION')    AS tp_attention,
         round(avg(ts.load_pct), 2)                            AS tp_avg_load_pct,
         sum(t.rated_kva)                                      AS capacity_kva,
         round(sum(t.rated_kva * ts.load_pct / 100.0), 1)      AS used_kva
  FROM fact.tp_status_monthly ts
  JOIN fact.submission s ON s.id = ts.submission_id AND s.status = 'approved'
  JOIN ref.tp t ON t.id = ts.tp_id
  GROUP BY 1, 2
),
dist AS (
  SELECT t.mfy_id,
         count(*)                                          AS tp_with_distance,
         count(*) FILTER (WHERE t.avg_distance_m <= 300)   AS tp_within_distance,
         round(avg(t.avg_distance_m), 1)                   AS avg_distance_m
  FROM ref.tp t
  WHERE t.decommissioned_on IS NULL AND t.avg_distance_m IS NOT NULL
  GROUP BY 1
),
va AS (
  SELECT v.mfy_id, date_trunc('month', v.act_date)::date AS period_month,
         count(*)                 AS violation_cnt,
         sum(v.kwh_identified)    AS kwh_identified,
         sum(v.fine_mln)          AS fine_mln
  FROM fact.violation_act v
  GROUP BY 1, 2
),
nd AS (
  SELECT d.mfy_id, d.period_month,
         sum(d.repair_needed_km) FILTER (WHERE d.voltage_kv = 0.4) AS repair_km_04,
         sum(d.repair_needed_km) FILTER (WHERE d.voltage_kv >= 6)  AS repair_km_10,
         sum(d.repair_needed_km)                                   AS repair_km_total,
         sum(d.repaired_km)                                        AS repaired_km_total
  FROM fact.network_defect d
  JOIN fact.submission s ON s.id = d.submission_id AND s.status = 'approved'
  GROUP BY 1, 2
),
tree AS (
  SELECT w.mfy_id, date_trunc('month', w.actual_end)::date AS period_month,
         sum(w.quantity) AS tree_km
  FROM fact.work w
  WHERE w.work_type = 'TREE_CLEARING' AND w.status = 'COMPLETED' AND w.actual_end IS NOT NULL
  GROUP BY 1, 2
)
SELECT
  sp.mfy_id,
  m.elektroset_id,
  sp.period_month,
  coalesce(eb.days_filled, 0)          AS days_filled,
  coalesce(eb.kwh_in, 0)               AS kwh_in,
  coalesce(eb.kwh_sold, 0)             AS kwh_sold,
  coalesce(eb.kwh_loss_total, 0)       AS kwh_loss_total,
  CASE WHEN coalesce(eb.kwh_in, 0) > 0
       THEN round(100 * eb.kwh_loss_total / eb.kwh_in, 3) END          AS loss_pct,
  eb.total_loss_target_pct,

  mr.consumers_total, mr.consumers_population, mr.consumers_legal,
  mr.consumers_active, mr.consumers_disconnected, mr.consumers_new,
  mr.debt_total_mln, mr.debt_population_mln, mr.debt_legal_mln, mr.debt_budget_mln,
  mr.meters_offline_cnt, mr.low_consumption_cnt,
  mr.meters_replace_need_cnt, mr.meters_replaced_cnt,

  coalesce(tp.tp_total, 0)        AS tp_total,
  coalesce(tp.tp_under_load, 0)   AS tp_under_load,
  coalesce(tp.tp_repair_needed, 0) AS tp_repair_needed,
  coalesce(tp.tp_overloaded, 0)   AS tp_overloaded,
  coalesce(tp.tp_attention, 0)    AS tp_attention,
  tp.tp_avg_load_pct,
  coalesce(tp.capacity_kva, 0)    AS capacity_kva,
  coalesce(tp.used_kva, 0)        AS used_kva,

  coalesce(dist.tp_with_distance, 0)   AS tp_with_distance,
  coalesce(dist.tp_within_distance, 0) AS tp_within_distance,
  dist.avg_distance_m,

  coalesce(va.violation_cnt, 0)   AS violation_cnt,
  coalesce(va.kwh_identified, 0)  AS kwh_identified,
  coalesce(va.fine_mln, 0)        AS fine_mln,

  coalesce(nd.repair_km_04, 0)     AS repair_km_04,
  coalesce(nd.repair_km_10, 0)     AS repair_km_10,
  coalesce(nd.repair_km_total, 0)  AS repair_km_total,
  coalesce(nd.repaired_km_total, 0) AS repaired_km_total,

  coalesce(tree.tree_km, 0)       AS tree_clearing_km
FROM spine sp
JOIN ref.mfy m ON m.id = sp.mfy_id
LEFT JOIN eb   ON eb.mfy_id   = sp.mfy_id AND eb.period_month   = sp.period_month
LEFT JOIN mr   ON mr.mfy_id   = sp.mfy_id AND mr.period_month   = sp.period_month
LEFT JOIN tp   ON tp.mfy_id   = sp.mfy_id AND tp.period_month   = sp.period_month
LEFT JOIN dist ON dist.mfy_id = sp.mfy_id
LEFT JOIN va   ON va.mfy_id   = sp.mfy_id AND va.period_month   = sp.period_month
LEFT JOIN nd   ON nd.mfy_id   = sp.mfy_id AND nd.period_month   = sp.period_month
LEFT JOIN tree ON tree.mfy_id = sp.mfy_id AND tree.period_month = sp.period_month;

CREATE UNIQUE INDEX mfy_monthly_uq    ON agg.mfy_monthly (mfy_id, period_month);
CREATE INDEX        mfy_monthly_month ON agg.mfy_monthly (period_month DESC);
CREATE INDEX        mfy_monthly_es    ON agg.mfy_monthly (elektroset_id, period_month DESC);


-- ─── 8. YO'QOTISH: MAQSAD vs AMALDAGI ───────────────────────────────────────
-- Eski `v_technical_loss_gap` texnik yo'qotishni TECHNICAL_LOSS_PCT ga
-- taqqoslardi. Endi yagona yo'qotish TOTAL_LOSS_TARGET_PCT ga taqqoslanadi.

CREATE VIEW agg.v_loss_gap AS
SELECT
  a.mfy_id,
  m.name_uz,
  a.period_month,
  a.loss_pct              AS actual_pct,
  a.total_loss_target_pct AS standard_pct,
  round(a.loss_pct - a.total_loss_target_pct, 2) AS gap_pp,
  CASE
    WHEN a.total_loss_target_pct IS NULL OR a.total_loss_target_pct <= 0 THEN 'good'
    WHEN a.loss_pct <= a.total_loss_target_pct                THEN 'good'
    WHEN a.loss_pct <= a.total_loss_target_pct * 1.25          THEN 'warning'
    WHEN a.loss_pct <= a.total_loss_target_pct * 1.60          THEN 'serious'
    ELSE 'critical'
  END AS status
FROM agg.mfy_monthly a
JOIN ref.mfy m ON m.id = a.mfy_id
WHERE a.loss_pct IS NOT NULL;


-- ─── 9. PASPORT (qayta qurish) ──────────────────────────────────────────────
-- 10-qator "Tijoriy yo'qotishlar" edi - endi shunchaki "Yo'qotishlar",
-- manbasi kwh_loss_total.

CREATE VIEW agg.v_mfy_passport AS
WITH lines AS (
  SELECT mfy_id,
         sum(length_km) FILTER (WHERE voltage_kv = 0.4) AS line_km_04,
         sum(length_km) FILTER (WHERE voltage_kv >= 6)  AS line_km_10,
         sum(length_km)                                 AS line_km_total
  FROM ref.network_segment
  WHERE retired_on IS NULL
  GROUP BY 1
),
substations AS (
  SELECT mfy_id, count(*) AS substation_cnt
  FROM ref.tp
  WHERE voltage_class = '35/10' AND decommissioned_on IS NULL
  GROUP BY 1
)
SELECT
  a.mfy_id,
  m.name_uz,
  m.name_uz_cyr,
  m.elektroset_id,
  a.period_month,
  -- 1. Iste'molchilar
  a.consumers_total, a.consumers_population, a.consumers_legal,
  -- (tuman darajasida qo'shimcha) Nimstansiyalar
  coalesce(ss.substation_cnt, 0)                    AS substation_cnt,
  -- 2. Transformatorlar
  a.tp_total                                        AS transformer_cnt,
  -- 3. Yuklama bilan ishlayotgan TP
  a.tp_under_load,
  -- 4. Tarmoqlar (registrdan SUM - kiritilmaydi)
  coalesce(ln.line_km_total, 0)                     AS line_km_total,
  coalesce(ln.line_km_04, 0)                        AS line_km_04,
  coalesce(ln.line_km_10, 0)                        AS line_km_10,
  -- 5. Qarzdorlik
  a.debt_total_mln, a.debt_population_mln, a.debt_legal_mln, a.debt_budget_mln,
  -- 6. Aloqadan chiqqan hisoblagichlar
  a.meters_offline_cnt,
  -- 7. 0 va <50 kWh iste'molchilar
  a.low_consumption_cnt,
  -- 8. Oqib o'tgan energiya (ming kWh)
  round(a.kwh_in / 1000.0, 1)                       AS monthly_thsd_kwh,
  -- 9. Daraxtlardan tozalash (km)
  a.tree_clearing_km,
  -- 10a. Yo'qotish (ming kWh)
  round(a.kwh_loss_total / 1000.0, 1)               AS loss_thsd_kwh,
  -- 10b. Shundan aniqlandi (ming kWh)
  round(a.kwh_identified / 1000.0, 1)               AS identified_loss_thsd_kwh,
  -- 11. Ta'mir kerak bo'lgan TP lar
  a.tp_repair_needed,
  -- 12. Ta'mir kerak bo'lgan tarmoqlar (km)
  a.repair_km_total, a.repair_km_04, a.repair_km_10,
  -- 13. Hisoblagichlar
  a.meters_replace_need_cnt, a.meters_replaced_cnt
FROM agg.mfy_monthly a
JOIN ref.mfy m ON m.id = a.mfy_id
LEFT JOIN lines ln ON ln.mfy_id = a.mfy_id
LEFT JOIN substations ss ON ss.mfy_id = a.mfy_id;


-- Tuman pasporti - SOF ROLL-UP. Qo'lda kiritish imkoni yo'q.
CREATE VIEW agg.v_tuman_passport AS
SELECT
  p.period_month,
  sum(p.consumers_total)              AS consumers_total,
  sum(p.consumers_population)         AS consumers_population,
  sum(p.consumers_legal)              AS consumers_legal,
  sum(p.substation_cnt)               AS substation_cnt,
  sum(p.transformer_cnt)              AS transformer_cnt,
  sum(p.tp_under_load)                AS tp_under_load,
  sum(p.line_km_total)                AS line_km_total,
  sum(p.line_km_04)                   AS line_km_04,
  sum(p.line_km_10)                   AS line_km_10,
  sum(p.debt_total_mln)               AS debt_total_mln,
  sum(p.debt_population_mln)          AS debt_population_mln,
  sum(p.debt_legal_mln)               AS debt_legal_mln,
  sum(p.debt_budget_mln)              AS debt_budget_mln,
  sum(p.meters_offline_cnt)           AS meters_offline_cnt,
  sum(p.low_consumption_cnt)          AS low_consumption_cnt,
  round(sum(p.monthly_thsd_kwh), 1)   AS monthly_thsd_kwh,
  round(sum(p.tree_clearing_km), 1)   AS tree_clearing_km,
  round(sum(p.loss_thsd_kwh), 1)      AS loss_thsd_kwh,
  round(sum(p.identified_loss_thsd_kwh), 1) AS identified_loss_thsd_kwh,
  sum(p.tp_repair_needed)             AS tp_repair_needed,
  round(sum(p.repair_km_total), 2)    AS repair_km_total,
  round(sum(p.repair_km_04), 2)       AS repair_km_04,
  round(sum(p.repair_km_10), 2)       AS repair_km_10,
  sum(p.meters_replace_need_cnt)      AS meters_replace_need_cnt,
  sum(p.meters_replaced_cnt)          AS meters_replaced_cnt
FROM agg.v_mfy_passport p
GROUP BY p.period_month;


-- ─── 10. HUQUQLAR ───────────────────────────────────────────────────────────
-- 0004 dagi GRANT faqat o'sha paytda mavjud obyektlarga tegishli edi -
-- qayta qurilganlariga qaytadan beriladi.

GRANT SELECT ON agg.mfy_daily, agg.mfy_monthly, agg.v_tuman_daily,
                agg.v_loss_gap, agg.v_mfy_passport, agg.v_tuman_passport
  TO beap_app;
