-- ═══════════════════════════════════════════════════════════════════════════
-- 0014_mfy_responsible.sql - fider uchun ma'sul shaxs
--
-- Har bir fider (`ref.mfy` qatori) uchun BITTA amaldagi ma'sul shaxs yozuvi -
-- F.I.Sh., lavozimi, telefon raqami. Dashboardda ko'rsatiladi, alohida
-- sozlamalar sahifasida tahrirlanadi. Tarix saqlanmaydi - faqat joriy holat
-- kerak, shuning uchun `mfy_id` PRIMARY KEY (bitta fider = bitta yozuv).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE ref.mfy_responsible (
  mfy_id      int PRIMARY KEY REFERENCES ref.mfy,
  full_name   text NOT NULL,
  position    text,
  phone       text,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  int REFERENCES sec.app_user
);

COMMENT ON TABLE ref.mfy_responsible IS
  'Fider bo''yicha ma''sul shaxs - bitta fider uchun bitta amaldagi yozuv';

GRANT SELECT, INSERT, UPDATE, DELETE ON ref.mfy_responsible TO beap_app;

ALTER TABLE ref.mfy_responsible ENABLE ROW LEVEL SECURITY;

CREATE POLICY mfy_responsible_read ON ref.mfy_responsible FOR SELECT TO beap_app
  USING (sec.can_read_all() OR mfy_id = ANY (sec.current_mfy_ids()));

CREATE POLICY mfy_responsible_write ON ref.mfy_responsible FOR ALL TO beap_app
  USING (sec.can_write_mfy(mfy_id)) WITH CHECK (sec.can_write_mfy(mfy_id));

CREATE TRIGGER zz_audit AFTER INSERT OR UPDATE OR DELETE ON ref.mfy_responsible
  FOR EACH ROW EXECUTE FUNCTION sec.trg_audit();
