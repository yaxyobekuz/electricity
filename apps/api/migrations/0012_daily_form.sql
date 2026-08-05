-- ═══════════════════════════════════════════════════════════════════════════
-- KUNLIK KIRITISH FORMASI
--
-- Mijoz har kuni to'ldiradigan Excel varag'ining AYNAN o'zi: 17 ta ko'rsatkich,
-- bitta mahalla, bitta kun. Fayl yuklansa ham, panelda qo'lda tahrirlansa ham
-- ma'lumot shu jadvalga tushadi - ya'ni "manba nusxasi" bir joyda turadi.
--
-- NEGA ALOHIDA JADVAL, tayyor `fact.*` jadvallariga to'g'ridan-to'g'ri emas:
--   • forma tuzilishi mijozniki - u o'zgarsa, tahlil jadvallari buzilmasin;
--   • ba'zi ustunlar (o'rtacha hisob, texnik quvvat) hech qayerga tushmaydi,
--     lekin kiritilgan holicha saqlanishi kerak;
--   • "kim, qachon, qaysi fayldan" - audit izi shu yerda.
--
-- BIR KUN = BIR QATOR: `(mfy_id, biz_date)` yagona. Qayta yuklansa, oxirgi
-- fayl ustiga yoziladi - mijozning talabi shu.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE fact.daily_form (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  mfy_id            int  NOT NULL REFERENCES ref.mfy,
  biz_date          date NOT NULL,

  -- Abonentlar
  active_consumers  int NOT NULL DEFAULT 0 CHECK (active_consumers  >= 0),
  disconnected      int NOT NULL DEFAULT 0 CHECK (disconnected      >= 0),
  new_connected     int NOT NULL DEFAULT 0 CHECK (new_connected     >= 0),
  disconnected_new  int NOT NULL DEFAULT 0 CHECK (disconnected_new  >= 0),
  legal_consumers   int NOT NULL DEFAULT 0 CHECK (legal_consumers   >= 0),

  -- O'rtacha ko'rsatkichlar (formada bor, tahlilda qayta hisoblanadi)
  avg_consumption   numeric(12,2) NOT NULL DEFAULT 0 CHECK (avg_consumption >= 0),
  avg_bill          numeric(12,2) NOT NULL DEFAULT 0 CHECK (avg_bill        >= 0),

  -- Energiya - MING kWh (fayldagi birlik)
  total_in_mwh      numeric(12,2) NOT NULL DEFAULT 0 CHECK (total_in_mwh      >= 0),
  sold_mwh          numeric(12,2) NOT NULL DEFAULT 0 CHECK (sold_mwh          >= 0),
  total_loss_mwh    numeric(12,2) NOT NULL DEFAULT 0 CHECK (total_loss_mwh    >= 0),
  technological_mwh numeric(12,2) NOT NULL DEFAULT 0 CHECK (technological_mwh >= 0),
  commercial_mwh    numeric(12,2) NOT NULL DEFAULT 0 CHECK (commercial_mwh    >= 0),

  -- Moliyaviy va tarmoq
  debt_mln          numeric(14,2) NOT NULL DEFAULT 0 CHECK (debt_mln     >= 0),
  capacity_kva      numeric(12,2) NOT NULL DEFAULT 0 CHECK (capacity_kva >= 0),
  current_kva       numeric(12,2) NOT NULL DEFAULT 0 CHECK (current_kva  >= 0),
  tp_count          int NOT NULL DEFAULT 0 CHECK (tp_count >= 0),

  -- Manba izi
  source        text NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('EXCEL', 'MANUAL')),
  file_name     text,
  note          text,
  created_by    int REFERENCES sec.app_user,
  updated_by    int REFERENCES sec.app_user,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT df_no_future CHECK (biz_date <= CURRENT_DATE),
  CONSTRAINT df_sold_le_in CHECK (sold_mwh <= total_in_mwh),
  CONSTRAINT df_uq UNIQUE (mfy_id, biz_date)
);

CREATE INDEX daily_form_date ON fact.daily_form (biz_date DESC, mfy_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON fact.daily_form TO beap_app;
GRANT USAGE, SELECT ON SEQUENCE fact.daily_form_id_seq TO beap_app;

ALTER TABLE fact.daily_form ENABLE ROW LEVEL SECURITY;

CREATE POLICY daily_form_read ON fact.daily_form FOR SELECT TO beap_app
  USING (sec.can_read_all() OR mfy_id = ANY (sec.current_mfy_ids()));

CREATE POLICY daily_form_insert ON fact.daily_form FOR INSERT TO beap_app
  WITH CHECK (sec.can_write_mfy(mfy_id));

CREATE POLICY daily_form_update ON fact.daily_form FOR UPDATE TO beap_app
  USING (sec.can_write_mfy(mfy_id)) WITH CHECK (sec.can_write_mfy(mfy_id));

CREATE POLICY daily_form_delete ON fact.daily_form FOR DELETE TO beap_app
  USING (sec.can_write_mfy(mfy_id));

COMMENT ON TABLE fact.daily_form IS
  'Mijozning kunlik Excel formasi - bir mahalla, bir kun, 17 ko''rsatkich';
