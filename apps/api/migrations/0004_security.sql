-- ═══════════════════════════════════════════════════════════════════════════
-- 0004_security.sql — audit jurnali va Row Level Security
--
-- Aktor har bir tranzaksiya boshida API tomonidan o'rnatiladi:
--   SET LOCAL app.user_id = '5'; SET LOCAL app.role = 'mfy_operator';
--   SET LOCAL app.mfy_ids = '3,7'; SET LOCAL app.request_id = '...';
-- Bitta joy — unutish imkoni yo'q.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE sec.audit_log (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at           timestamptz NOT NULL DEFAULT clock_timestamp(),
  actor_id     int,
  actor_login  text,
  request_id   text,
  client_ip    inet,
  schema_name  text NOT NULL,
  table_name   text NOT NULL,
  row_pk       text,
  op           char(1) NOT NULL CHECK (op IN ('I','U','D')),
  before       jsonb,
  after        jsonb,
  -- Generated ustun bo'la olmaydi (PostgreSQL generation ifodasida subquery
  -- taqiqlaydi) — trigger to'ldiradi.
  changed_keys text[]
);
CREATE INDEX audit_log_at    ON sec.audit_log (at DESC);
CREATE INDEX audit_log_table ON sec.audit_log (schema_name, table_name, at DESC);
CREATE INDEX audit_log_actor ON sec.audit_log (actor_id, at DESC);


-- Yordamchilar: sozlama yo'q bo'lsa xato bermaydi (seed va migratsiya uchun).
CREATE FUNCTION sec.current_user_id() RETURNS int
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::int;
$$;

CREATE FUNCTION sec.current_role_name() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('app.role', true), ''), 'system');
$$;

CREATE FUNCTION sec.current_mfy_ids() RETURNS int[]
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN coalesce(current_setting('app.mfy_ids', true), '') = '' THEN ARRAY[]::int[]
    ELSE string_to_array(current_setting('app.mfy_ids', true), ',')::int[]
  END;
$$;


-- ─── UMUMIY AUDIT TRIGGERI ──────────────────────────────────────────────────
-- Bitta funksiya, barcha jadvallarga ulanadi.

CREATE FUNCTION sec.trg_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_before jsonb;
  v_after  jsonb;
  v_pk     text;
  v_keys   text[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_after := to_jsonb(NEW);
  ELSIF TG_OP = 'UPDATE' THEN
    v_before := to_jsonb(OLD);
    v_after  := to_jsonb(NEW);
    -- Hech narsa o'zgarmagan bo'lsa yozmaymiz (autosave shovqinini kesadi).
    IF v_before = v_after THEN
      RETURN NULL;
    END IF;
  ELSE
    v_before := to_jsonb(OLD);
  END IF;

  v_pk := coalesce(v_after ->> 'id', v_before ->> 'id');

  IF v_before IS NOT NULL AND v_after IS NOT NULL THEN
    SELECT array_agg(k) INTO v_keys
      FROM jsonb_object_keys(v_after) k
     WHERE v_before -> k IS DISTINCT FROM v_after -> k;
  END IF;

  INSERT INTO sec.audit_log (
    actor_id, actor_login, request_id, schema_name, table_name, row_pk, op,
    before, after, changed_keys)
  VALUES (
    sec.current_user_id(),
    (SELECT login FROM sec.app_user WHERE id = sec.current_user_id()),
    nullif(current_setting('app.request_id', true), ''),
    TG_TABLE_SCHEMA, TG_TABLE_NAME, v_pk,
    left(TG_OP, 1), v_before, v_after, v_keys);

  RETURN NULL;
END $$;

COMMENT ON FUNCTION sec.trg_audit IS
  'AFTER trigger. NULL qaytaradi — natijaga ta''sir qilmaydi';


-- Auditni barcha fakt va spravochnik jadvallariga ulash.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch, c.relname AS tbl
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('fact', 'ref')
      AND c.relkind = 'r'                       -- oddiy jadvallar
      AND c.relname NOT LIKE 'tp_reading_daily%' -- yuqori hajm, audit qilinmaydi
      AND c.relname <> 'report_job'
  LOOP
    EXECUTE format(
      'CREATE TRIGGER zz_audit AFTER INSERT OR UPDATE OR DELETE ON %I.%I
       FOR EACH ROW EXECUTE FUNCTION sec.trg_audit()', r.sch, r.tbl);
  END LOOP;
END $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
--
-- MFY operatori boshqa MFY qatoriga API xatosi yoki SQL injection orqali ham
-- yoza olmaydi. Tasdiqlangan qator storage darajasida o'zgarmas bo'lib qoladi.
-- ═══════════════════════════════════════════════════════════════════════════

-- Rol: ilova shu rol ostida ulanadi (superuser EMAS — aks holda RLS chetlab o'tiladi).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'beap_app') THEN
    CREATE ROLE beap_app NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA ref, fact, agg, sec, stg TO beap_app;
GRANT SELECT ON ALL TABLES IN SCHEMA ref, agg TO beap_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA fact, stg TO beap_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ref TO beap_app;
GRANT SELECT, INSERT ON sec.audit_log TO beap_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON sec.app_user, sec.user_scope, sec.refresh_token TO beap_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ref, fact, sec, stg TO beap_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ref, agg, sec TO beap_app;

-- Snapshot faqat qo'shiladi — o'zgartirilmaydi, o'chirilmaydi.
REVOKE UPDATE, DELETE ON fact.passport_snapshot FROM beap_app;


-- Yordamchi: joriy foydalanuvchi shu MFY ga yoza oladimi?
CREATE FUNCTION sec.can_write_mfy(p_mfy_id int) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT sec.current_role_name() IN ('admin', 'system')
      OR p_mfy_id = ANY (sec.current_mfy_ids());
$$;

CREATE FUNCTION sec.can_read_all() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT sec.current_role_name() IN ('admin', 'system', 'hokimiyat_viewer', 'elektroset_manager');
$$;

-- Yordamchi: konvert hali tahrirlanadigan holatdami?
CREATE FUNCTION sec.submission_editable(p_submission_id bigint) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM fact.submission s
    WHERE s.id = p_submission_id AND s.status IN ('draft', 'rejected'));
$$;


-- ─── SIYOSATLAR ─────────────────────────────────────────────────────────────

-- fact.submission
ALTER TABLE fact.submission ENABLE ROW LEVEL SECURITY;

CREATE POLICY submission_read ON fact.submission FOR SELECT TO beap_app
  USING (sec.can_read_all()
      OR (scope_type = 'MFY' AND scope_id = ANY (sec.current_mfy_ids())));

CREATE POLICY submission_insert ON fact.submission FOR INSERT TO beap_app
  WITH CHECK (sec.current_role_name() IN ('admin','system')
           OR (scope_type = 'MFY' AND scope_id = ANY (sec.current_mfy_ids())));

-- Operator faqat o'z qoralamasini o'zgartiradi; menejer/admin holatni o'zgartiradi.
CREATE POLICY submission_update ON fact.submission FOR UPDATE TO beap_app
  USING (sec.current_role_name() IN ('admin','system','elektroset_manager')
      OR (scope_type = 'MFY' AND scope_id = ANY (sec.current_mfy_ids())
          AND status IN ('draft','rejected')));

CREATE POLICY submission_delete ON fact.submission FOR DELETE TO beap_app
  USING (sec.current_role_name() IN ('admin','system')
      OR (scope_type = 'MFY' AND scope_id = ANY (sec.current_mfy_ids())
          AND status = 'draft'));


-- MFY ga bog'langan fakt jadvallari uchun bir xil naqsh.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'energy_balance_daily', 'mfy_monthly_return', 'network_defect',
    'debt_top_entry', 'work', 'violation_act'
  ] LOOP
    EXECUTE format('ALTER TABLE fact.%I ENABLE ROW LEVEL SECURITY', t);

    EXECUTE format($f$
      CREATE POLICY %1$s_read ON fact.%1$I FOR SELECT TO beap_app
        USING (sec.can_read_all() OR mfy_id = ANY (sec.current_mfy_ids()))
    $f$, t);

    EXECUTE format($f$
      CREATE POLICY %1$s_insert ON fact.%1$I FOR INSERT TO beap_app
        WITH CHECK (sec.can_write_mfy(mfy_id))
    $f$, t);

    EXECUTE format($f$
      CREATE POLICY %1$s_update ON fact.%1$I FOR UPDATE TO beap_app
        USING (sec.can_write_mfy(mfy_id)
               AND (submission_id IS NULL OR sec.submission_editable(submission_id)))
        WITH CHECK (sec.can_write_mfy(mfy_id))
    $f$, t);

    EXECUTE format($f$
      CREATE POLICY %1$s_delete ON fact.%1$I FOR DELETE TO beap_app
        USING (sec.can_write_mfy(mfy_id)
               AND (submission_id IS NULL OR sec.submission_editable(submission_id)))
    $f$, t);
  END LOOP;
END $$;


-- TP orqali bog'langan jadvallar (mfy_id ustuni yo'q).
ALTER TABLE fact.tp_status_monthly ENABLE ROW LEVEL SECURITY;

CREATE POLICY tp_status_read ON fact.tp_status_monthly FOR SELECT TO beap_app
  USING (sec.can_read_all()
      OR EXISTS (SELECT 1 FROM ref.tp t
                 WHERE t.id = tp_id AND t.mfy_id = ANY (sec.current_mfy_ids())));

CREATE POLICY tp_status_write ON fact.tp_status_monthly FOR ALL TO beap_app
  USING (EXISTS (SELECT 1 FROM ref.tp t WHERE t.id = tp_id AND sec.can_write_mfy(t.mfy_id))
         AND sec.submission_editable(submission_id))
  WITH CHECK (EXISTS (SELECT 1 FROM ref.tp t WHERE t.id = tp_id AND sec.can_write_mfy(t.mfy_id)));

ALTER TABLE fact.tp_reading_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY tp_reading_read ON fact.tp_reading_daily FOR SELECT TO beap_app
  USING (sec.can_read_all()
      OR EXISTS (SELECT 1 FROM ref.tp t
                 WHERE t.id = tp_id AND t.mfy_id = ANY (sec.current_mfy_ids())));

CREATE POLICY tp_reading_write ON fact.tp_reading_daily FOR ALL TO beap_app
  USING (EXISTS (SELECT 1 FROM ref.tp t WHERE t.id = tp_id AND sec.can_write_mfy(t.mfy_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM ref.tp t WHERE t.id = tp_id AND sec.can_write_mfy(t.mfy_id)));


-- Pasport snapshot: hamma o'qiydi, faqat admin yozadi.
ALTER TABLE fact.passport_snapshot ENABLE ROW LEVEL SECURITY;
CREATE POLICY snapshot_read ON fact.passport_snapshot FOR SELECT TO beap_app USING (true);
CREATE POLICY snapshot_insert ON fact.passport_snapshot FOR INSERT TO beap_app
  WITH CHECK (sec.current_role_name() IN ('admin','system'));


COMMENT ON POLICY submission_update ON fact.submission IS
  'Operator faqat o''z qoralamasini tahrirlaydi. Tasdiqlangan konvert o''zgarmas';
