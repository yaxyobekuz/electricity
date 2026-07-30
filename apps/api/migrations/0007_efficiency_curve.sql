-- ═══════════════════════════════════════════════════════════════════════════
-- 0007_efficiency_curve.sql — samaradorlik indeksining yo'qotish komponentini
-- keskinlashtirish
--
-- MUAMMO: dastlabki egri chiziq maqsadning 3 barobarida 0 ball berardi.
-- Natijada 13.5% yo'qotishli MFY 66 ball olardi — dashboard muammoni
-- ko'rsatmasdi.
--
-- YECHIM: maqsad darajasida 100 ball, maqsadning 2 BAROBARIDA 0 ball.
--   8.0% maqsad, 8.6% amaldagi  → 92 ball  (yaxshi)
--   8.0% maqsad, 13.5% amaldagi → 31 ball  (tanqidiy)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION agg.efficiency_index(
  p_scope text,
  p_id    int,
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
      -- Maqsadda 100 ball, maqsadning 2 barobarida 0 ball (chiziqli).
      greatest(0, least(100, 100 * (1 -
        ((CASE WHEN b.kwh_in > 0 THEN 100 * b.kwh_loss / b.kwh_in ELSE 0 END)
          - b.target_loss_pct) / nullif(b.target_loss_pct, 0)
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
