-- ═══════════════════════════════════════════════════════════════════════════
-- 0002_fact.sql - submission konverti va qo'lda kiritiladigan fakt jadvallari
--
-- ASOSIY QOIDA: har qanday "jami" va "shundan" qiymati HISOBLANADI
-- (GENERATED ALWAYS AS ... STORED). Xodim faqat bo'laklarni kiritadi.
-- Bu mijoz hujjatlarida topilgan 4 ta arifmetik xatoning oldini oladi.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TYPE sec.submission_status AS ENUM
  ('draft','submitted','approved','rejected','superseded');


-- ─── SUBMISSION KONVERTI ────────────────────────────────────────────────────
-- Har bir kiritilgan fakt bitta konvertga tegishli.
-- Draft → submit → approve, tuzatish va audit shu yerda BIR MARTA hal qilinadi.

CREATE TABLE fact.submission (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scope_type    text NOT NULL CHECK (scope_type IN ('MFY','ELEKTROSET','TUMAN')),
  scope_id      int  NOT NULL,
  domain        text NOT NULL CHECK (domain IN (
                  'ENERGY_BALANCE','MONTHLY_RETURN','TP_STATUS','TP_READING',
                  'NETWORK_DEFECT','DEBT','WORKS','VIOLATION')),
  period_type   text NOT NULL CHECK (period_type IN ('DAY','MONTH')),
  period_start  date NOT NULL,
  period_end    date NOT NULL,
  revision      smallint NOT NULL DEFAULT 1,
  status        sec.submission_status NOT NULL DEFAULT 'draft',
  supersedes_id bigint REFERENCES fact.submission,
  created_by    int NOT NULL REFERENCES sec.app_user,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  submitted_at  timestamptz,
  reviewed_by   int REFERENCES sec.app_user,
  reviewed_at   timestamptz,
  review_note   text,
  -- >30% o'zgargan qiymatlar uchun operator izohlari
  justifications jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT sub_period      CHECK (period_end >= period_start),
  CONSTRAINT sub_no_future   CHECK (period_start <= CURRENT_DATE),
  CONSTRAINT sub_reviewed    CHECK (
    (status IN ('approved','rejected')) = (reviewed_at IS NOT NULL))
);

-- Bir davr + bir domen + bir hudud uchun FAQAT BITTA tasdiqlangan konvert.
CREATE UNIQUE INDEX submission_approved_uq
  ON fact.submission (scope_type, scope_id, domain, period_start)
  WHERE status = 'approved';

-- Bir muallifda bir davr uchun faqat bitta ochiq qoralama.
CREATE UNIQUE INDEX submission_draft_uq
  ON fact.submission (scope_type, scope_id, domain, period_start, created_by)
  WHERE status = 'draft';

CREATE INDEX submission_lookup ON fact.submission (scope_id, domain, period_start DESC);
CREATE INDEX submission_queue  ON fact.submission (status, submitted_at DESC)
  WHERE status = 'submitted';

COMMENT ON TABLE fact.submission IS
  'Tasdiqlangan fakt hech qachon UPDATE qilinmaydi - supersedes_id bilan yangi revision ochiladi';


-- Tasdiqlanganda oldingi revisionni "superseded" ga o'tkazadi.
CREATE FUNCTION fact.trg_submission_supersede() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'approved' AND (OLD.status IS DISTINCT FROM 'approved') THEN
    IF NEW.supersedes_id IS NOT NULL THEN
      UPDATE fact.submission
         SET status = 'superseded', updated_at = now()
       WHERE id = NEW.supersedes_id AND status = 'approved';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE TRIGGER submission_supersede
  BEFORE UPDATE ON fact.submission
  FOR EACH ROW EXECUTE FUNCTION fact.trg_submission_supersede();


-- ─── 1. KUNLIK ENERGIYA BALANSI ─────────────────────────────────────────────

CREATE TABLE fact.energy_balance_daily (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  submission_id      bigint NOT NULL REFERENCES fact.submission ON DELETE CASCADE,
  mfy_id             int  NOT NULL REFERENCES ref.mfy,
  biz_date           date NOT NULL,
  kwh_in             numeric(14,2) NOT NULL CHECK (kwh_in   >= 0),
  kwh_sold           numeric(14,2) NOT NULL CHECK (kwh_sold >= 0),
  kwh_loss_natural   numeric(14,2) NOT NULL DEFAULT 0 CHECK (kwh_loss_natural   >= 0),
  kwh_loss_technical numeric(14,2) NOT NULL DEFAULT 0 CHECK (kwh_loss_technical >= 0),
  kwh_loss_illegal   numeric(14,2) NOT NULL DEFAULT 0 CHECK (kwh_loss_illegal   >= 0),

  -- ↓ HISOBLANADI. Bu ustunlar input formasida FAQAT O'QISH uchun ko'rsatiladi.
  kwh_loss_total numeric(14,2) GENERATED ALWAYS AS (kwh_in - kwh_sold) STORED,
  loss_pct       numeric(6,3)  GENERATED ALWAYS AS (
                   CASE WHEN kwh_in > 0
                        THEN round(100 * (kwh_in - kwh_sold) / kwh_in, 3)
                   END) STORED,

  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT eb_sold_le_in CHECK (kwh_sold <= kwh_in),

  -- DIQQAT: ataylab BAZAVIY ustunlar orqali yozilgan (kwh_in - kwh_sold),
  -- generated ustun (kwh_loss_total) orqali emas - PostgreSQL bir jadvalning
  -- CHECK ifodasida o'sha jadvalning generated ustuniga murojaat qilishga
  -- ruxsat bermaydi. Bu shaklni O'ZGARTIRMANG.
  CONSTRAINT eb_components CHECK (
    abs((kwh_in - kwh_sold)
        - (kwh_loss_natural + kwh_loss_technical + kwh_loss_illegal))
    <= GREATEST(1.0, 0.005 * kwh_in)),

  CONSTRAINT eb_no_future CHECK (biz_date <= CURRENT_DATE),
  CONSTRAINT eb_plausible CHECK (kwh_in <= 5000000)
);

CREATE UNIQUE INDEX eb_uq       ON fact.energy_balance_daily (submission_id, mfy_id, biz_date);
CREATE INDEX        eb_mfy_date ON fact.energy_balance_daily (mfy_id, biz_date DESC);
CREATE INDEX        eb_brin     ON fact.energy_balance_daily USING brin (biz_date);
CREATE INDEX        eb_sub      ON fact.energy_balance_daily (submission_id);

COMMENT ON CONSTRAINT eb_components ON fact.energy_balance_daily IS
  'Yo''qotish tarkibi jamiga mos kelishi shart. Tolerans: max(1 kWh, 0.5% kirim)';


-- ─── 2. OYLIK HISOBOT (pasport 1, 5, 6, 7, 13-qatorlar) ─────────────────────

CREATE TABLE fact.mfy_monthly_return (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  submission_id bigint NOT NULL REFERENCES fact.submission ON DELETE CASCADE,
  mfy_id        int  NOT NULL REFERENCES ref.mfy,
  period_month  date NOT NULL,

  -- 1-qator: faqat bo'laklar kiritiladi
  consumers_population   int NOT NULL CHECK (consumers_population >= 0),
  consumers_legal        int NOT NULL CHECK (consumers_legal >= 0),
  consumers_total        int GENERATED ALWAYS AS
                           (consumers_population + consumers_legal) STORED,
  consumers_active       int NOT NULL DEFAULT 0 CHECK (consumers_active >= 0),
  consumers_disconnected int NOT NULL DEFAULT 0 CHECK (consumers_disconnected >= 0),
  consumers_new          int NOT NULL DEFAULT 0 CHECK (consumers_new >= 0),

  -- 5-qator: faqat bo'laklar, mln so'm
  debt_population_mln numeric(12,1) NOT NULL DEFAULT 0 CHECK (debt_population_mln >= 0),
  debt_legal_mln      numeric(12,1) NOT NULL DEFAULT 0 CHECK (debt_legal_mln >= 0),
  debt_budget_mln     numeric(12,1) NOT NULL DEFAULT 0 CHECK (debt_budget_mln >= 0),
  debt_total_mln      numeric(12,1) GENERATED ALWAYS AS
                        (debt_population_mln + debt_legal_mln + debt_budget_mln) STORED,

  -- 6, 7, 13-qatorlar
  meters_offline_cnt      int NOT NULL DEFAULT 0 CHECK (meters_offline_cnt >= 0),
  low_consumption_cnt     int NOT NULL DEFAULT 0 CHECK (low_consumption_cnt >= 0),
  meters_replace_need_cnt int NOT NULL DEFAULT 0 CHECK (meters_replace_need_cnt >= 0),
  meters_replaced_cnt     int NOT NULL DEFAULT 0 CHECK (meters_replaced_cnt >= 0),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT mr_period_is_month CHECK (period_month = date_trunc('month', period_month)::date),
  CONSTRAINT mr_no_future  CHECK (period_month <= date_trunc('month', CURRENT_DATE)::date),
  CONSTRAINT mr_active_le_total   CHECK (consumers_active       <= consumers_population + consumers_legal),
  CONSTRAINT mr_discon_le_total   CHECK (consumers_disconnected <= consumers_population + consumers_legal),
  CONSTRAINT mr_low_le_total      CHECK (low_consumption_cnt    <= consumers_population + consumers_legal),
  CONSTRAINT mr_offline_le_total  CHECK (meters_offline_cnt     <= consumers_population + consumers_legal),
  CONSTRAINT mr_replaced_le_need  CHECK (meters_replaced_cnt    <= meters_replace_need_cnt)
);

CREATE UNIQUE INDEX mr_uq  ON fact.mfy_monthly_return (submission_id, mfy_id, period_month);
CREATE INDEX        mr_mfy ON fact.mfy_monthly_return (mfy_id, period_month DESC);


-- ─── GO'RAVON XATOSINI BLOKLOVCHI TRIGGER ───────────────────────────────────
-- Haqiqiy hodisa: Go'ravon MFY pasportiga TUMAN ning qarzdorlik raqamlari
-- (4,265.6 / 2,449.1 / 1,816.5) ko'chirib qo'yilgan.
-- Bitta MFY tuman qarzdorligining 60% idan ko'pini tashkil qila olmaydi.
-- Bu cross-table tekshiruv, shuning uchun CHECK emas, trigger.

CREATE FUNCTION fact.trg_return_plausible() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_mine   numeric;
  v_others numeric;
  v_total  numeric;
  v_share  numeric;
BEGIN
  -- Generated ustun BEFORE triggerda hali hisoblanmagan - qo'lda yig'amiz.
  v_mine := NEW.debt_population_mln + NEW.debt_legal_mln + NEW.debt_budget_mln;

  IF v_mine <= 0 THEN
    RETURN NEW;
  END IF;

  SELECT coalesce(sum(r.debt_total_mln), 0) INTO v_others
    FROM fact.mfy_monthly_return r
    JOIN fact.submission s ON s.id = r.submission_id AND s.status = 'approved'
   WHERE r.period_month = NEW.period_month
     AND r.mfy_id <> NEW.mfy_id;

  -- Boshqa MFY lardan hali ma'lumot yo'q bo'lsa, taqqoslashning ma'nosi yo'q.
  IF v_others <= 0 THEN
    RETURN NEW;
  END IF;

  v_total := v_others + v_mine;
  v_share := v_mine / v_total;

  IF v_share > 0.60 THEN
    RAISE EXCEPTION
      'IMPLAUSIBLE_DEBT: MFY (id=%) qarzdorligi % mln so''m - bu tuman jamining % foizi',
      NEW.mfy_id, round(v_mine, 1), round(100 * v_share)
      USING ERRCODE = 'check_violation',
            HINT = 'district_paste_suspected',
            DETAIL = 'Bu qiymat tuman formasidan ko''chirilganga o''xshaydi. Faqat shu MFY ning qarzdorligini kiriting.';
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER return_plausible
  BEFORE INSERT OR UPDATE ON fact.mfy_monthly_return
  FOR EACH ROW EXECUTE FUNCTION fact.trg_return_plausible();


-- ─── 3. TP OYLIK HOLATI (pasport 2, 3, 11-qatorlar) ─────────────────────────

CREATE TABLE fact.tp_status_monthly (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  submission_id bigint NOT NULL REFERENCES fact.submission ON DELETE CASCADE,
  tp_id         int  NOT NULL REFERENCES ref.tp,
  period_month  date NOT NULL,
  load_pct      numeric(5,2) NOT NULL DEFAULT 0 CHECK (load_pct BETWEEN 0 AND 200),
  peak_kva      numeric(8,1) NOT NULL DEFAULT 0 CHECK (peak_kva >= 0),
  condition     text NOT NULL DEFAULT 'GOOD'
                  CHECK (condition IN ('GOOD','ATTENTION','OVERLOAD','FAULT')),
  under_load    boolean NOT NULL DEFAULT false,
  repair_needed boolean NOT NULL DEFAULT false,
  repair_reason text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ts_period_is_month CHECK (period_month = date_trunc('month', period_month)::date),
  CONSTRAINT ts_repair_reason CHECK (NOT repair_needed OR repair_reason IS NOT NULL)
);
CREATE UNIQUE INDEX ts_uq ON fact.tp_status_monthly (submission_id, tp_id, period_month);
CREATE INDEX        ts_tp ON fact.tp_status_monthly (tp_id, period_month DESC);


-- ─── 4. TP KUNLIK KO'RSATKICHLARI (yillik partitsiya) ───────────────────────
-- Bu yagona o'sish istiqboliga ega jadval: agar kelajakda hisoblagichlardan
-- telemetriya kelsa, kuniga millionlab qator bo'ladi. Partitsiyalash qarorini
-- keyinroq qo'shish qimmat - shuning uchun hozir kiritamiz.

CREATE TABLE fact.tp_reading_daily (
  submission_id bigint NOT NULL REFERENCES fact.submission ON DELETE CASCADE,
  tp_id         int  NOT NULL REFERENCES ref.tp,
  biz_date      date NOT NULL,
  max_load_kw   numeric(10,2) NOT NULL DEFAULT 0 CHECK (max_load_kw >= 0),
  min_load_kw   numeric(10,2) NOT NULL DEFAULT 0 CHECK (min_load_kw >= 0),
  avg_voltage_v numeric(6,1)  NOT NULL DEFAULT 220 CHECK (avg_voltage_v BETWEEN 0 AND 1000),
  outage_count  smallint NOT NULL DEFAULT 0 CHECK (outage_count >= 0),
  outage_minutes int NOT NULL DEFAULT 0 CHECK (outage_minutes >= 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tr_min_le_max  CHECK (min_load_kw <= max_load_kw),
  CONSTRAINT tr_no_future   CHECK (biz_date <= CURRENT_DATE),
  PRIMARY KEY (tp_id, biz_date)
) PARTITION BY RANGE (biz_date);

CREATE TABLE fact.tp_reading_daily_2024 PARTITION OF fact.tp_reading_daily
  FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
CREATE TABLE fact.tp_reading_daily_2025 PARTITION OF fact.tp_reading_daily
  FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
CREATE TABLE fact.tp_reading_daily_2026 PARTITION OF fact.tp_reading_daily
  FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');
CREATE TABLE fact.tp_reading_daily_2027 PARTITION OF fact.tp_reading_daily
  FOR VALUES FROM ('2027-01-01') TO ('2028-01-01');
CREATE TABLE fact.tp_reading_daily_2028 PARTITION OF fact.tp_reading_daily
  FOR VALUES FROM ('2028-01-01') TO ('2029-01-01');

CREATE INDEX tr_date ON fact.tp_reading_daily (biz_date DESC);


-- ─── 5. TARMOQ NUQSONLARI (pasport 12-qator) ────────────────────────────────

CREATE TABLE fact.network_defect (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  submission_id    bigint NOT NULL REFERENCES fact.submission ON DELETE CASCADE,
  mfy_id           int  NOT NULL REFERENCES ref.mfy,
  period_month     date NOT NULL,
  voltage_kv       numeric(4,1) NOT NULL CHECK (voltage_kv IN (0.4, 6, 10, 35)),
  repair_needed_km numeric(8,2) NOT NULL DEFAULT 0 CHECK (repair_needed_km >= 0),
  repaired_km      numeric(8,2) NOT NULL DEFAULT 0 CHECK (repaired_km >= 0),
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT nd_period_is_month CHECK (period_month = date_trunc('month', period_month)::date),
  CONSTRAINT nd_repaired_le_needed CHECK (repaired_km <= repair_needed_km)
);
CREATE UNIQUE INDEX nd_uq ON fact.network_defect (submission_id, mfy_id, period_month, voltage_kv);
CREATE INDEX nd_mfy ON fact.network_defect (mfy_id, period_month DESC);


-- ─── 6. TOP QARZDORLAR ──────────────────────────────────────────────────────

CREATE TABLE fact.debt_top_entry (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  submission_id bigint NOT NULL REFERENCES fact.submission ON DELETE CASCADE,
  mfy_id        int  NOT NULL REFERENCES ref.mfy,
  period_month  date NOT NULL,
  rank          smallint NOT NULL CHECK (rank BETWEEN 1 AND 20),
  debtor_name   text NOT NULL CHECK (length(debtor_name) >= 2),
  category      text NOT NULL DEFAULT 'LEGAL'
                  CHECK (category IN ('POPULATION','LEGAL','BUDGET')),
  amount_mln    numeric(12,1) NOT NULL CHECK (amount_mln >= 0),
  CONSTRAINT dt_period_is_month CHECK (period_month = date_trunc('month', period_month)::date)
);
CREATE UNIQUE INDEX dt_uq ON fact.debt_top_entry (submission_id, mfy_id, period_month, rank);
CREATE INDEX dt_name_trgm ON fact.debt_top_entry USING gin (debtor_name gin_trgm_ops);
CREATE INDEX dt_month ON fact.debt_top_entry (period_month DESC, amount_mln DESC);


-- ─── 7. ISHLAR (reja va bajarilgan - bitta obyekt, ikki holatda) ────────────

CREATE TABLE fact.work (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  submission_id bigint REFERENCES fact.submission ON DELETE SET NULL,
  mfy_id        int  NOT NULL REFERENCES ref.mfy,
  tp_id         int  REFERENCES ref.tp,
  work_type     text NOT NULL CHECK (work_type IN (
                  'CABLE_REPLACEMENT','TP_INSTALL','TP_MODERNIZATION',
                  'OVERHEAD_LINE_RENEWAL','METER_REPLACEMENT','TREE_CLEARING',
                  'ILLEGAL_DISCONNECT','SUPPORT_REPLACEMENT','OTHER')),
  title_uz      text NOT NULL CHECK (length(title_uz) >= 3),
  description   text,
  status        text NOT NULL DEFAULT 'PLANNED'
                  CHECK (status IN ('PLANNED','IN_PROGRESS','COMPLETED','CANCELLED')),
  planned_start date,
  planned_end   date,
  actual_end    date,
  progress_pct  smallint NOT NULL DEFAULT 0 CHECK (progress_pct BETWEEN 0 AND 100),
  quantity      numeric(10,2) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  unit          text NOT NULL DEFAULT 'ta',
  cost_mln      numeric(12,2) NOT NULL DEFAULT 0 CHECK (cost_mln >= 0),
  -- Natija (NATIJADORLIK paneli)
  effect_loss_pct_before  numeric(5,2) CHECK (effect_loss_pct_before BETWEEN 0 AND 100),
  effect_loss_pct_after   numeric(5,2) CHECK (effect_loss_pct_after  BETWEEN 0 AND 100),
  effect_saving_kwh_month numeric(12,2) NOT NULL DEFAULT 0 CHECK (effect_saving_kwh_month >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_dates CHECK (planned_end IS NULL OR planned_start IS NULL
                               OR planned_end >= planned_start),
  CONSTRAINT work_completed CHECK (
    status <> 'COMPLETED' OR (actual_end IS NOT NULL AND progress_pct = 100))
);
CREATE INDEX work_mfy    ON fact.work (mfy_id, status);
CREATE INDEX work_status ON fact.work (status, planned_end);
CREATE INDEX work_done    ON fact.work (actual_end DESC) WHERE status = 'COMPLETED';


-- ─── 8. DALOLATNOMALAR (pasport 10b - "shundan aniqlandi") ──────────────────

CREATE TABLE fact.violation_act (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  submission_id  bigint REFERENCES fact.submission ON DELETE SET NULL,
  mfy_id         int  NOT NULL REFERENCES ref.mfy,
  tp_id          int  REFERENCES ref.tp,
  act_no         text NOT NULL,
  act_date       date NOT NULL,
  consumer_ref   text,
  kwh_identified numeric(12,2) NOT NULL DEFAULT 0 CHECK (kwh_identified >= 0),
  fine_mln       numeric(12,2) NOT NULL DEFAULT 0 CHECK (fine_mln >= 0),
  status         text NOT NULL DEFAULT 'ISSUED'
                   CHECK (status IN ('DRAFT','ISSUED','PAID','COURT','CLOSED')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT va_no_future CHECK (act_date <= CURRENT_DATE),
  CONSTRAINT va_act_uq UNIQUE (mfy_id, act_no)
);
CREATE INDEX va_mfy_date ON fact.violation_act (mfy_id, act_date DESC);


-- ─── PASPORT SNAPSHOT (muzlatilgan rasmiy hujjat) ───────────────────────────
-- Jonli view - dashboard uchun. Snapshot - imzolanadigan hujjat uchun.
-- Keyinchalik mart oyi tuzatilsa ham, imzolangan nusxa o'zgarmaydi.

CREATE TABLE fact.passport_snapshot (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scope_type     text NOT NULL CHECK (scope_type IN ('MFY','TUMAN')),
  scope_id       int,
  period_month   date NOT NULL,
  payload        jsonb NOT NULL,
  content_sha256 text NOT NULL,
  frozen_by      int NOT NULL REFERENCES sec.app_user,
  frozen_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ps_scope CHECK ((scope_type = 'TUMAN') = (scope_id IS NULL)),
  CONSTRAINT ps_uq UNIQUE (scope_type, scope_id, period_month)
);

COMMENT ON COLUMN fact.passport_snapshot.content_sha256 IS
  'Kanonik JSON ning sha256 xeshi - buzilmaganlik dalili. E-IMZO uchun ilgak';

-- Append-only: yozilgandan keyin o'zgartirib/o'chirib bo'lmaydi.
CREATE RULE passport_snapshot_no_update AS ON UPDATE TO fact.passport_snapshot DO INSTEAD NOTHING;
CREATE RULE passport_snapshot_no_delete AS ON DELETE TO fact.passport_snapshot DO INSTEAD NOTHING;


-- ─── HISOBOT NAVBATI (Redis siz) ────────────────────────────────────────────

CREATE TABLE fact.report_job (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind        text NOT NULL,
  params      jsonb NOT NULL DEFAULT '{}'::jsonb,
  status      text NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued','running','done','failed')),
  file_path   text,
  error       text,
  requested_by int NOT NULL REFERENCES sec.app_user,
  created_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX report_job_queue ON fact.report_job (status, created_at) WHERE status = 'queued';


-- ─── AGREGAT YANGILANISH JURNALI ────────────────────────────────────────────
-- Header'dagi "Ma'lumotlar yangilangan: 14:20" belgisini boqadi.
-- Davlat dashboardida ishonch uchun majburiy.

CREATE TABLE agg.refresh_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  ok          boolean,
  views       text[],
  error       text,
  duration_ms int
);
CREATE INDEX refresh_log_recent ON agg.refresh_log (started_at DESC);
