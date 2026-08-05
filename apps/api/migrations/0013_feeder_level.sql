-- ═══════════════════════════════════════════════════════════════════════════
-- FIDER DARAJASIGA O'TISH
--
-- Tizim qamrovi tuman (22 mahalla) dan BITTA 10 kV FIDER ga toraydi:
-- Chinobod nimstansiyasining «Xaqulobod» fideri va uning 51 ta TP si.
--
-- SXEMA QAYTA NOMLANMAYDI: `ref.mfy` ning bitta qatori endi FIDERNI
-- ifodalaydi. Sabab - `agg.*` matview'lar, RLS siyosatlari, pasport va butun
-- API shu ustunga bog'langan; nomni almashtirish o'nlab fayl va migratsiyani
-- qayta yozish demak, foydasi esa faqat atama.
--
-- Bu migratsiya uchta ishni qiladi:
--   1. TP quvvatini IXTIYORIY qiladi - manba hisobotlarda kVA yo'q;
--   2. fider boshidagi oylik balansni saqlash uchun jadval;
--   3. TP kesimidagi hisoblagich va iste'molchi ma'lumoti uchun jadval.
-- ═══════════════════════════════════════════════════════════════════════════

COMMENT ON TABLE ref.mfy IS
  'Hisob birligi. Fider darajasidagi tizimda bitta qator = bitta 10 kV fider.';

-- ─── 1. TP quvvati ixtiyoriy ────────────────────────────────────────────────
-- Hisobotlarda TP ning nominal quvvati (kVA) ham, masofasi ham berilmagan.
-- Nolni yozish YOLG'ON bo'lardi ("quvvati 0 kVA"), shuning uchun NULL -
-- interfeys uni «-» deb ko'rsatadi.

ALTER TABLE ref.tp ALTER COLUMN rated_kva DROP NOT NULL;
ALTER TABLE ref.tp DROP CONSTRAINT IF EXISTS tp_rated_kva_check;
ALTER TABLE ref.tp
  ADD CONSTRAINT tp_rated_kva_check CHECK (rated_kva IS NULL OR rated_kva > 0);

-- ─── 2. Fider boshidagi oylik balans ────────────────────────────────────────
-- «Умумий ҳисобот» varag'ining aynan nusxasi: fider hisoblagichi ko'rsatkichi,
-- koeffitsienti va shu asosda chiqadigan to'rt raqam. Balans ayniyati
-- CHECK bilan majburlanadi - hisobot o'zi bilan qarama-qarshi bo'lmaydi.

CREATE TABLE fact.feeder_monthly (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  mfy_id        int  NOT NULL REFERENCES ref.mfy,
  period_month  date NOT NULL,

  substation    text,          -- «НИМ станция Чинобод»
  input_name    text,          -- «ВВОД Т2 40 000 кВА»
  meter_prev    numeric(14,2) NOT NULL DEFAULT 0 CHECK (meter_prev >= 0),
  meter_curr    numeric(14,2) NOT NULL DEFAULT 0 CHECK (meter_curr >= 0),
  meter_coef    numeric(10,2) NOT NULL DEFAULT 1 CHECK (meter_coef > 0),

  kwh_in                numeric(14,2) NOT NULL DEFAULT 0 CHECK (kwh_in >= 0),
  kwh_tp_sum            numeric(14,2) NOT NULL DEFAULT 0 CHECK (kwh_tp_sum >= 0),
  kwh_tech_loss         numeric(14,2) NOT NULL DEFAULT 0 CHECK (kwh_tech_loss >= 0),
  kwh_commercial_loss   numeric(14,2) NOT NULL DEFAULT 0 CHECK (kwh_commercial_loss >= 0),

  source        text NOT NULL DEFAULT 'EXCEL' CHECK (source IN ('EXCEL', 'MANUAL')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fm_period_is_month CHECK (period_month = date_trunc('month', period_month)::date),
  -- Kirgan energiya = TP lar o'lchagani + texnologik + tijoriy (1 kWh dopusk).
  CONSTRAINT fm_balance CHECK (
    abs(kwh_in - (kwh_tp_sum + kwh_tech_loss + kwh_commercial_loss)) <= 1),
  CONSTRAINT fm_uq UNIQUE (mfy_id, period_month)
);

-- ─── 3. TP kesimi ───────────────────────────────────────────────────────────
-- «Тўлиқ ҳисобот» varag'ining aynan nusxasi. `fact.tp_status_monthly` yuklama
-- foizi va texnik holat uchun qoladi (u ma'lumot hisobotlarda yo'q), bu jadval
-- esa hisoblagich va iste'molchi kesimini saqlaydi.

CREATE TABLE fact.tp_monthly (
  id                     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tp_id                  int  NOT NULL REFERENCES ref.tp ON DELETE CASCADE,
  period_month           date NOT NULL,

  consumers_total        int NOT NULL DEFAULT 0 CHECK (consumers_total        >= 0),
  consumers_active       int NOT NULL DEFAULT 0 CHECK (consumers_active       >= 0),
  consumers_disconnected int NOT NULL DEFAULT 0 CHECK (consumers_disconnected >= 0),

  meter_no      text,
  meter_coef    numeric(10,2) NOT NULL DEFAULT 1 CHECK (meter_coef > 0),
  reading_prev  numeric(14,2) NOT NULL DEFAULT 0 CHECK (reading_prev >= 0),
  reading_curr  numeric(14,2) NOT NULL DEFAULT 0 CHECK (reading_curr >= 0),
  kwh_month     numeric(14,2) NOT NULL DEFAULT 0 CHECK (kwh_month >= 0),

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT tm_period_is_month CHECK (period_month = date_trunc('month', period_month)::date),
  CONSTRAINT tm_active_le_total CHECK (consumers_active <= consumers_total),
  CONSTRAINT tm_uq UNIQUE (tp_id, period_month)
);

CREATE INDEX tp_monthly_period ON fact.tp_monthly (period_month DESC, tp_id);

-- ─── 4. Huquqlar va qator darajasidagi himoya ───────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON fact.feeder_monthly, fact.tp_monthly TO beap_app;
GRANT USAGE, SELECT ON SEQUENCE fact.feeder_monthly_id_seq, fact.tp_monthly_id_seq TO beap_app;

ALTER TABLE fact.feeder_monthly ENABLE ROW LEVEL SECURITY;

CREATE POLICY feeder_monthly_read ON fact.feeder_monthly FOR SELECT TO beap_app
  USING (sec.can_read_all() OR mfy_id = ANY (sec.current_mfy_ids()));

CREATE POLICY feeder_monthly_write ON fact.feeder_monthly FOR ALL TO beap_app
  USING (sec.can_write_mfy(mfy_id)) WITH CHECK (sec.can_write_mfy(mfy_id));

ALTER TABLE fact.tp_monthly ENABLE ROW LEVEL SECURITY;

-- TP ning egasi ona fider orqali aniqlanadi (jadvalda `mfy_id` yo'q).
CREATE POLICY tp_monthly_read ON fact.tp_monthly FOR SELECT TO beap_app
  USING (
    sec.can_read_all()
    OR EXISTS (SELECT 1 FROM ref.tp t WHERE t.id = tp_id AND t.mfy_id = ANY (sec.current_mfy_ids()))
  );

CREATE POLICY tp_monthly_write ON fact.tp_monthly FOR ALL TO beap_app
  USING (EXISTS (SELECT 1 FROM ref.tp t WHERE t.id = tp_id AND sec.can_write_mfy(t.mfy_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM ref.tp t WHERE t.id = tp_id AND sec.can_write_mfy(t.mfy_id)));

COMMENT ON TABLE fact.feeder_monthly IS 'Fider boshidagi oylik balans - «Умумий ҳисобот» nusxasi';
COMMENT ON TABLE fact.tp_monthly     IS 'TP kesimidagi oylik hisoblagich va iste''molchi ma''lumoti';
