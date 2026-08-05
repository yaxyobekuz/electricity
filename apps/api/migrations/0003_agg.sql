-- ═══════════════════════════════════════════════════════════════════════════
-- 0003_agg.sql - agregatlar, pasport roll-up va analitik funksiyalar
--
-- Bu sxemada HECH NARSA kiritilmaydi. Hammasi fact.* dan hisoblanadi.
-- Tuman pasportini qo'lda kiritishning texnik imkoni yo'q - u SUM(MFY).
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── KUNLIK BAZA ────────────────────────────────────────────────────────────
-- Faqat TASDIQLANGAN konvertlar. Qoralama dashboardga chiqmaydi.

CREATE MATERIALIZED VIEW agg.mfy_daily AS
SELECT
  e.mfy_id,
  m.elektroset_id,
  e.biz_date,
  e.kwh_in,
  e.kwh_sold,
  e.kwh_loss_natural,
  e.kwh_loss_technical,
  e.kwh_loss_illegal,
  e.kwh_loss_total,
  e.loss_pct,
  ref.norm_value('NATURAL_LOSS_PCT',   e.mfy_id, e.biz_date) AS natural_norm_pct,
  ref.norm_value('TECHNICAL_LOSS_PCT', e.mfy_id, e.biz_date) AS technical_std_pct,
  ref.norm_value('TOTAL_LOSS_TARGET_PCT', e.mfy_id, e.biz_date) AS total_loss_target_pct
FROM fact.energy_balance_daily e
JOIN fact.submission s ON s.id = e.submission_id AND s.status = 'approved'
JOIN ref.mfy m ON m.id = e.mfy_id;

CREATE UNIQUE INDEX mfy_daily_uq   ON agg.mfy_daily (mfy_id, biz_date);
CREATE INDEX        mfy_daily_date ON agg.mfy_daily (biz_date DESC);
CREATE INDEX        mfy_daily_es   ON agg.mfy_daily (elektroset_id, biz_date DESC);


-- ─── TUMAN KUNLIK (view - matview kerak emas, MFY dan yig'iladi) ────────────

CREATE VIEW agg.v_tuman_daily AS
SELECT
  biz_date,
  sum(kwh_in)             AS kwh_in,
  sum(kwh_sold)           AS kwh_sold,
  sum(kwh_loss_natural)   AS kwh_loss_natural,
  sum(kwh_loss_technical) AS kwh_loss_technical,
  sum(kwh_loss_illegal)   AS kwh_loss_illegal,
  sum(kwh_loss_total)     AS kwh_loss_total,
  CASE WHEN sum(kwh_in) > 0
       THEN round(100 * sum(kwh_loss_total) / sum(kwh_in), 3) END AS loss_pct
FROM agg.mfy_daily
GROUP BY biz_date;


-- ─── OYLIK BAZA - barcha domenlar bir qatorda ───────────────────────────────

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
         sum(kwh_loss_natural)        AS kwh_loss_natural,
         sum(kwh_loss_technical)      AS kwh_loss_technical,
         sum(kwh_loss_illegal)        AS kwh_loss_illegal,
         sum(kwh_loss_total)          AS kwh_loss_total,
         max(natural_norm_pct)        AS natural_norm_pct,
         max(technical_std_pct)       AS technical_std_pct,
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
  coalesce(eb.kwh_loss_natural, 0)     AS kwh_loss_natural,
  coalesce(eb.kwh_loss_technical, 0)   AS kwh_loss_technical,
  coalesce(eb.kwh_loss_illegal, 0)     AS kwh_loss_illegal,
  coalesce(eb.kwh_loss_total, 0)       AS kwh_loss_total,
  CASE WHEN coalesce(eb.kwh_in, 0) > 0
       THEN round(100 * eb.kwh_loss_total / eb.kwh_in, 3) END          AS loss_pct,
  CASE WHEN coalesce(eb.kwh_in, 0) > 0
       THEN round(100 * eb.kwh_loss_technical / eb.kwh_in, 3) END      AS technical_pct,
  CASE WHEN coalesce(eb.kwh_in, 0) > 0
       THEN round(100 * eb.kwh_loss_natural / eb.kwh_in, 3) END        AS natural_pct,
  CASE WHEN coalesce(eb.kwh_in, 0) > 0
       THEN round(100 * eb.kwh_loss_illegal / eb.kwh_in, 3) END        AS illegal_pct,
  eb.natural_norm_pct,
  eb.technical_std_pct,
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


-- ─── TP OYLIK MONITORINGI ───────────────────────────────────────────────────

CREATE MATERIALIZED VIEW agg.tp_monthly AS
SELECT
  t.id                AS tp_id,
  t.code,
  t.mfy_id,
  m.name_uz           AS mfy_name,
  m.elektroset_id,
  ts.period_month,
  t.rated_kva,
  t.voltage_class,
  t.avg_distance_m,
  ts.load_pct,
  ts.peak_kva,
  ts.condition,
  ts.under_load,
  ts.repair_needed,
  ts.repair_reason,
  ref.norm_value('TP_OPTIMAL_LOAD_PCT_MAX', t.mfy_id, ts.period_month) AS optimal_pct,
  ref.norm_value('TP_OVERLOAD_PCT',        t.mfy_id, ts.period_month) AS overload_pct,
  ref.norm_value('TP_MAX_DISTANCE_M',      t.mfy_id, ts.period_month) AS max_distance_m,
  (t.avg_distance_m IS NOT NULL
   AND t.avg_distance_m <= ref.norm_value('TP_MAX_DISTANCE_M', t.mfy_id, ts.period_month)
  ) AS distance_compliant
FROM fact.tp_status_monthly ts
JOIN fact.submission s ON s.id = ts.submission_id AND s.status = 'approved'
JOIN ref.tp t ON t.id = ts.tp_id
JOIN ref.mfy m ON m.id = t.mfy_id;

CREATE UNIQUE INDEX tp_monthly_uq ON agg.tp_monthly (tp_id, period_month);
CREATE INDEX tp_monthly_month ON agg.tp_monthly (period_month DESC, load_pct DESC);
CREATE INDEX tp_monthly_mfy   ON agg.tp_monthly (mfy_id, period_month DESC);


-- ─── MFY YO'QOTISH REYTINGI (kunlik, o'rin o'zgarishi bilan) ────────────────
-- Bitta so'rovda: joriy qiymat, kechagi qiymat, farq, o'rin, o'rin farqi, trend.
-- N+1 so'rov YO'Q.

CREATE FUNCTION agg.mfy_loss_rank(p_date date)
RETURNS TABLE (
  mfy_id int, name_uz text, loss_pct numeric, prev_loss_pct numeric,
  delta_pp numeric, rnk int, prev_rnk int, rank_delta int, trend text
)
LANGUAGE sql STABLE AS $$
  WITH d AS (
    SELECT a.mfy_id, m.name_uz, a.biz_date, a.loss_pct
    FROM agg.mfy_daily a
    JOIN ref.mfy m ON m.id = a.mfy_id
    WHERE a.biz_date IN (p_date, p_date - 1)
  ),
  t AS (
    SELECT d.mfy_id, d.name_uz, d.loss_pct,
           rank() OVER (ORDER BY d.loss_pct DESC) AS rnk
    FROM d WHERE d.biz_date = p_date
  ),
  y AS (
    SELECT d.mfy_id, d.loss_pct AS prev_loss_pct,
           rank() OVER (ORDER BY d.loss_pct DESC) AS prev_rnk
    FROM d WHERE d.biz_date = p_date - 1
  )
  SELECT t.mfy_id, t.name_uz, t.loss_pct, y.prev_loss_pct,
         round(t.loss_pct - y.prev_loss_pct, 2) AS delta_pp,
         t.rnk::int, y.prev_rnk::int,
         (y.prev_rnk - t.rnk)::int AS rank_delta,
         CASE
           WHEN y.prev_loss_pct IS NULL              THEN 'flat'
           WHEN t.loss_pct - y.prev_loss_pct >  0.15 THEN 'up'
           WHEN t.loss_pct - y.prev_loss_pct < -0.15 THEN 'down'
           ELSE 'flat'
         END AS trend
  FROM t LEFT JOIN y ON y.mfy_id = t.mfy_id
  ORDER BY t.rnk;
$$;


-- ─── TEXNIK YO'QOTISH: STANDART vs AMALDAGI ─────────────────────────────────

CREATE VIEW agg.v_technical_loss_gap AS
SELECT
  a.mfy_id,
  m.name_uz,
  a.period_month,
  a.technical_pct  AS actual_pct,
  a.technical_std_pct AS standard_pct,
  round(a.technical_pct - a.technical_std_pct, 2) AS gap_pp,
  CASE
    WHEN a.technical_std_pct IS NULL OR a.technical_std_pct <= 0 THEN 'good'
    WHEN a.technical_pct <= a.technical_std_pct              THEN 'good'
    WHEN a.technical_pct <= a.technical_std_pct * 1.25       THEN 'warning'
    WHEN a.technical_pct <= a.technical_std_pct * 1.60       THEN 'serious'
    ELSE 'critical'
  END AS status
FROM agg.mfy_monthly a
JOIN ref.mfy m ON m.id = a.mfy_id
WHERE a.technical_pct IS NOT NULL;


-- ─── ENERGIYA SAMARADORLIK INDEKSI (0–100) ──────────────────────────────────
-- Sehrli raqam emas - hujjatlashtirilgan, takrorlanadigan formula.
-- 5 komponent, vaznlari: yo'qotish 35%, qarzdorlik 20%, hisoblagich 15%,
-- TP yuklama 15%, masofa 15%.  UI'da har bir komponent ochib ko'rsatiladi.

CREATE FUNCTION agg.efficiency_index(
  p_scope text,          -- 'TUMAN' | 'ELEKTROSET' | 'MFY'
  p_id    int,           -- TUMAN uchun NULL
  p_month date
) RETURNS TABLE (
  score numeric, c_loss numeric, c_debt numeric,
  c_meter numeric, c_tp numeric, c_distance numeric
)
LANGUAGE sql STABLE AS $$
  WITH b AS (
    SELECT
      sum(a.kwh_in)                                  AS kwh_in,
      sum(a.kwh_loss_total)                          AS kwh_loss,
      sum(a.kwh_sold)                                AS kwh_sold,
      sum(a.consumers_total)                         AS consumers_total,
      sum(a.debt_total_mln)                          AS debt_total_mln,
      sum(a.meters_offline_cnt)                      AS meters_offline,
      sum(a.tp_total)                                AS tp_total,
      sum(a.tp_overloaded)                           AS tp_overloaded,
      sum(a.tp_with_distance)                        AS tp_with_distance,
      sum(a.tp_within_distance)                      AS tp_within_distance,
      max(coalesce(a.total_loss_target_pct, 8.0))    AS target_loss_pct
    FROM agg.mfy_monthly a
    JOIN ref.mfy m ON m.id = a.mfy_id
    WHERE a.period_month = p_month
      AND (p_scope = 'TUMAN'
        OR (p_scope = 'ELEKTROSET' AND m.elektroset_id = p_id)
        OR (p_scope = 'MFY'        AND a.mfy_id = p_id))
  ),
  x AS (
    SELECT
      -- Maqsad darajasida 100 ball, maqsadning 3 barobarida 0 ball (chiziqli).
      greatest(0, least(100, 100 * (1 -
        ((CASE WHEN b.kwh_in > 0 THEN 100 * b.kwh_loss / b.kwh_in ELSE 0 END)
          - b.target_loss_pct) / nullif(2 * b.target_loss_pct, 0)
      ))) AS c_loss,
      -- Qarzdorlik oylarda: 0 oyda 100 ball, 6+ oyda 0 ball.
      -- Oylik hisob taxminan: sotilgan kWh × 450 so'm/kWh → mln so'm.
      greatest(0, least(100, 100 * (1 -
        (b.debt_total_mln / nullif(b.kwh_sold * 450.0 / 1e6, 0)) / 6.0
      ))) AS c_debt,
      greatest(0, least(100,
        100 * (1 - b.meters_offline::numeric / nullif(b.consumers_total, 0))
      )) AS c_meter,
      greatest(0, least(100,
        100 * (1 - b.tp_overloaded::numeric / nullif(b.tp_total, 0))
      )) AS c_tp,
      greatest(0, least(100,
        100 * (b.tp_within_distance::numeric / nullif(b.tp_with_distance, 0))
      )) AS c_distance
    FROM b
  )
  SELECT
    round(0.35 * coalesce(x.c_loss, 0) + 0.20 * coalesce(x.c_debt, 0)
        + 0.15 * coalesce(x.c_meter, 0) + 0.15 * coalesce(x.c_tp, 0)
        + 0.15 * coalesce(x.c_distance, 0), 1),
    round(coalesce(x.c_loss, 0), 1), round(coalesce(x.c_debt, 0), 1),
    round(coalesce(x.c_meter, 0), 1), round(coalesce(x.c_tp, 0), 1),
    round(coalesce(x.c_distance, 0), 1)
  FROM x;
$$;

COMMENT ON FUNCTION agg.efficiency_index IS
  'Hokim "nega 85?" deb so''raganda - 5 komponent va ularning vaznlari qaytariladi';


-- ═══════════════════════════════════════════════════════════════════════════
-- PASPORT
-- ═══════════════════════════════════════════════════════════════════════════
-- MFY pasporti - VIEW. Hech qachon pasport sifatida kiritilmaydi.
-- Har bir qator o'z manbasidan hisoblanadi (0003 dagi jadvalga qarang).

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
  -- 10a. Tijoriy yo'qotish (ming kWh)
  round(a.kwh_loss_illegal / 1000.0, 1)             AS commercial_loss_thsd_kwh,
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
  round(sum(p.commercial_loss_thsd_kwh), 1) AS commercial_loss_thsd_kwh,
  round(sum(p.identified_loss_thsd_kwh), 1) AS identified_loss_thsd_kwh,
  sum(p.tp_repair_needed)             AS tp_repair_needed,
  round(sum(p.repair_km_total), 2)    AS repair_km_total,
  round(sum(p.repair_km_04), 2)       AS repair_km_04,
  round(sum(p.repair_km_10), 2)       AS repair_km_10,
  sum(p.meters_replace_need_cnt)      AS meters_replace_need_cnt,
  sum(p.meters_replaced_cnt)          AS meters_replaced_cnt
FROM agg.v_mfy_passport p
GROUP BY p.period_month;


-- ─── MATVIEW LARNI YANGILASH ────────────────────────────────────────────────
-- Tartib muhim: mfy_daily → mfy_monthly (u mfy_daily ga tayanadi).

CREATE FUNCTION agg.refresh_all(p_concurrent boolean DEFAULT true)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  t0 timestamptz := clock_timestamp();
  log_id bigint;
BEGIN
  INSERT INTO agg.refresh_log (views) VALUES (ARRAY['mfy_daily','mfy_monthly','tp_monthly'])
    RETURNING id INTO log_id;

  IF p_concurrent THEN
    REFRESH MATERIALIZED VIEW CONCURRENTLY agg.mfy_daily;
    REFRESH MATERIALIZED VIEW CONCURRENTLY agg.tp_monthly;
    REFRESH MATERIALIZED VIEW CONCURRENTLY agg.mfy_monthly;
  ELSE
    REFRESH MATERIALIZED VIEW agg.mfy_daily;
    REFRESH MATERIALIZED VIEW agg.tp_monthly;
    REFRESH MATERIALIZED VIEW agg.mfy_monthly;
  END IF;

  UPDATE agg.refresh_log
     SET finished_at = clock_timestamp(), ok = true,
         duration_ms = (extract(epoch FROM clock_timestamp() - t0) * 1000)::int
   WHERE id = log_id;
EXCEPTION WHEN OTHERS THEN
  UPDATE agg.refresh_log
     SET finished_at = clock_timestamp(), ok = false, error = SQLERRM,
         duration_ms = (extract(epoch FROM clock_timestamp() - t0) * 1000)::int
   WHERE id = log_id;
  RAISE;
END $$;

COMMENT ON FUNCTION agg.refresh_all IS
  'Birinchi to''ldirishda p_concurrent := false (CONCURRENTLY bo''sh matview da ishlamaydi)';
