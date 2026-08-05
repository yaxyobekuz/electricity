-- ═══════════════════════════════════════════════════════════════════════════
-- 0001_init.sql - sxemalar, kengaytmalar, xavfsizlik va spravochniklar
--
-- PostgreSQL 17 bilan mos yoziladi (18.x da ham ishlaydi).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE SCHEMA IF NOT EXISTS ref;   -- spravochniklar (o'lchamlar)
CREATE SCHEMA IF NOT EXISTS fact;  -- qo'lda kiritiladigan faktlar
CREATE SCHEMA IF NOT EXISTS agg;   -- agregatlar (view / matview)
CREATE SCHEMA IF NOT EXISTS sec;   -- foydalanuvchilar, audit
CREATE SCHEMA IF NOT EXISTS stg;   -- Excel import uchun vaqtinchalik joy

COMMENT ON SCHEMA ref  IS 'Spravochniklar: elektroset, MFY, TP, tarmoq, normalar';
COMMENT ON SCHEMA fact IS 'Qo''lda kiritiladigan faktlar. Har biri fact.submission ga tegishli';
COMMENT ON SCHEMA agg  IS 'Agregatlar. Bu yerda hech narsa kiritilmaydi - faqat hisoblanadi';
COMMENT ON SCHEMA sec  IS 'Foydalanuvchilar, rollar, sessiyalar, audit jurnali';


-- ─── XAVFSIZLIK ─────────────────────────────────────────────────────────────

CREATE TABLE sec.app_user (
  id          int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  login       text NOT NULL UNIQUE,
  full_name   text NOT NULL,
  password_hash text NOT NULL,
  role        text NOT NULL CHECK (role IN
                ('mfy_operator','elektroset_manager','hokimiyat_viewer','admin')),
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

COMMENT ON TABLE sec.app_user IS 'Tizim foydalanuvchilari. Parol argon2id bilan xeshlanadi';

-- Foydalanuvchi qaysi hududga yoza oladi. Bo'sh bo'lsa - faqat o'qiydi.
CREATE TABLE sec.user_scope (
  id         int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    int NOT NULL REFERENCES sec.app_user ON DELETE CASCADE,
  scope_type text NOT NULL CHECK (scope_type IN ('MFY','ELEKTROSET','TUMAN')),
  scope_id   int
);
-- PRIMARY KEY ifoda qabul qilmaydi - NULL li scope_id uchun unique index.
CREATE UNIQUE INDEX user_scope_uq
  ON sec.user_scope (user_id, scope_type, coalesce(scope_id, -1));
CREATE INDEX user_scope_user ON sec.user_scope (user_id);

CREATE TABLE sec.refresh_token (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    int NOT NULL REFERENCES sec.app_user ON DELETE CASCADE,
  family_id  uuid NOT NULL,
  token_hash text NOT NULL UNIQUE,
  issued_at  timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  revoked_at timestamptz,
  client_ip  inet,
  user_agent text
);
CREATE INDEX refresh_token_user  ON sec.refresh_token (user_id);
CREATE INDEX refresh_token_family ON sec.refresh_token (family_id);

COMMENT ON COLUMN sec.refresh_token.family_id IS
  'Token oilasi. Ishlatilgan token qayta kelsa - butun oila bekor qilinadi (reuse detection)';

-- Migratsiya jurnali (runner tomonidan boshqariladi)
CREATE TABLE IF NOT EXISTS sec.schema_migration (
  filename   text PRIMARY KEY,
  sha256     text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  duration_ms int
);


-- ─── SPRAVOCHNIKLAR ─────────────────────────────────────────────────────────

CREATE TABLE ref.elektroset (
  id          smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code        text NOT NULL UNIQUE,
  name_uz     text NOT NULL,
  name_uz_cyr text,
  is_active   boolean NOT NULL DEFAULT true
);

CREATE TABLE ref.mfy (
  id            int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  elektroset_id smallint NOT NULL REFERENCES ref.elektroset,
  code          text NOT NULL UNIQUE,
  name_uz       text NOT NULL,
  name_uz_cyr   text,
  short_name    text NOT NULL,
  sort_order    smallint NOT NULL DEFAULT 0,
  -- Heks-kartogramma uchun joy (MFY ro'yxati tasdiqlangandan keyin to'ldiriladi).
  -- Xarita EMAS - hech qanday geografik ma'lumot va tashqi xizmat ishlatilmaydi.
  grid_row      smallint,
  grid_col      smallint,
  valid_from    date NOT NULL DEFAULT '2024-01-01',
  valid_to      date,
  CONSTRAINT mfy_valid_range CHECK (valid_to IS NULL OR valid_to > valid_from)
);
CREATE INDEX mfy_elektroset ON ref.mfy (elektroset_id);

COMMENT ON COLUMN ref.mfy.valid_to IS
  'MFY lar qaror bilan birlashtiriladi/qayta nomlanadi. Tarixiy ma''lumot saqlanib qoladi';

CREATE TABLE ref.tp (
  id                int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  mfy_id            int NOT NULL REFERENCES ref.mfy,
  code              text NOT NULL UNIQUE,
  name              text,
  rated_kva         numeric(8,1) NOT NULL CHECK (rated_kva > 0),
  voltage_class     text NOT NULL DEFAULT '10/0.4'
                      CHECK (voltage_class IN ('10/0.4','6/0.4','35/10')),
  -- TP dan iste'molchigacha o'rtacha masofa. Norma: <= 300 m (ref.norm da).
  avg_distance_m    numeric(7,1) CHECK (avg_distance_m IS NULL OR avg_distance_m >= 0),
  commissioned_on   date,
  decommissioned_on date,
  CONSTRAINT tp_life CHECK (decommissioned_on IS NULL OR commissioned_on IS NULL
                            OR decommissioned_on >= commissioned_on)
);
CREATE INDEX tp_mfy ON ref.tp (mfy_id);
CREATE INDEX tp_code_trgm ON ref.tp USING gin (code gin_trgm_ops);

COMMENT ON COLUMN ref.tp.voltage_class IS
  '35/10 = nimstansiya (pasportning tuman darajasidagi qo''shimcha qatori)';

-- Pasport 4-qatorining manbasi. Uzunlik SUM bilan olinadi, qo'lda kiritilmaydi.
CREATE TABLE ref.network_segment (
  id           int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  mfy_id       int NOT NULL REFERENCES ref.mfy,
  voltage_kv   numeric(4,1) NOT NULL CHECK (voltage_kv IN (0.4, 6, 10, 35)),
  line_type    text NOT NULL DEFAULT 'overhead' CHECK (line_type IN ('overhead','cable')),
  length_km    numeric(8,2) NOT NULL CHECK (length_km > 0),
  installed_on date,
  retired_on   date
);
CREATE INDEX network_segment_mfy ON ref.network_segment (mfy_id) WHERE retired_on IS NULL;

CREATE TABLE ref.consumer_category (
  id      smallint PRIMARY KEY,
  code    text NOT NULL UNIQUE,
  name_uz text NOT NULL,
  name_uz_cyr text
);

-- Standartlar. Vaqt bo'yicha versiyalanadi va MFY darajasida qayta belgilanishi mumkin.
CREATE TABLE ref.norm (
  id             int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scope_type     text NOT NULL CHECK (scope_type IN ('TUMAN','ELEKTROSET','MFY')),
  scope_id       int,
  metric         text NOT NULL,
  value_num      numeric(10,3) NOT NULL,
  unit           text NOT NULL,
  effective_from date NOT NULL,
  effective_to   date,
  source_doc     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT norm_range CHECK (effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT norm_scope_id CHECK ((scope_type = 'TUMAN') = (scope_id IS NULL)),
  -- Bitta metrikaning ikkita bir-birini qoplaydigan versiyasi bo'lishi MUMKIN EMAS.
  -- "2025-03-14 da norma qancha edi?" savoliga har doim yagona javob bor.
  CONSTRAINT norm_no_overlap EXCLUDE USING gist (
    scope_type WITH =,
    coalesce(scope_id, -1) WITH =,
    metric WITH =,
    daterange(effective_from, effective_to, '[)') WITH &&
  )
);
CREATE INDEX norm_lookup ON ref.norm (metric, scope_type, scope_id, effective_from DESC);

COMMENT ON CONSTRAINT norm_no_overlap ON ref.norm IS
  'Davlat auditi "o''sha kuni norma qancha edi" deb so''raydi - javob yagona bo''lishi shart';


-- ─── NORMANI SANAGA QARAB TOPISH ────────────────────────────────────────────
-- MFY normasi tuman normasidan ustun turadi.

CREATE FUNCTION ref.norm_value(
  p_metric text,
  p_mfy_id int,
  p_on     date
) RETURNS numeric
LANGUAGE sql STABLE AS $$
  SELECT n.value_num
  FROM ref.norm n
  LEFT JOIN ref.mfy m ON m.id = p_mfy_id
  WHERE n.metric = p_metric
    AND p_on >= n.effective_from
    AND (n.effective_to IS NULL OR p_on < n.effective_to)
    AND (
      (n.scope_type = 'MFY'        AND n.scope_id = p_mfy_id) OR
      (n.scope_type = 'ELEKTROSET' AND n.scope_id = m.elektroset_id) OR
      (n.scope_type = 'TUMAN')
    )
  ORDER BY CASE n.scope_type WHEN 'MFY' THEN 1 WHEN 'ELEKTROSET' THEN 2 ELSE 3 END
  LIMIT 1;
$$;

COMMENT ON FUNCTION ref.norm_value IS
  'Berilgan sanada amal qilgan normani qaytaradi. MFY > Elektroset > Tuman ustuvorligi bilan';
