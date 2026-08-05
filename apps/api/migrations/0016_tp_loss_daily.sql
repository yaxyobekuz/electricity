-- ═══════════════════════════════════════════════════════════════════════════
-- 0016_tp_loss_daily.sql - TP darajasidagi kunlik chiziqli yo'qotish hisoboti
--
-- Elektroset "kunlik chiziqli yo'qotish hisoboti"ni TEZ-TEZ (davriyligi
-- qat'iy emas) yuboradi: 51 TP dan FAQAT balans hisoblagichi ishlaydigan bir
-- nechtasi uchun. Har bir TP+sana - balans hisoblagichi ko'rsatkichi va
-- бириктирилган iste'molchilar yig'indisi orasidagi farq YO'QOTISH bo'lib,
-- MANFIY BO'LISHI MUMKIN (iste'molchilar yig'indisi balansdan katta chiqishi
-- - hisoblagich xatosi yoki noqonuniy ulanish belgisi). Bu DB darajasida
-- TAQIQLANMAYDI - aksincha shu signal keyinroq anomaliya sifatida ishlatiladi.
--
-- SUBMISSION OQIMIGA O'RALMAYDI (`fact.daily_form` bilan bir xil qaror): bu
-- allaqachon hisoblagichdan o'qilgan, tasdiqlashga muhtoj bo'lmagan xom
-- ma'lumot. Qayta yuklansa (tuzatilgan raqam bilan) - UPSERT,
-- `(tp_id, biz_date)` yagona.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE fact.tp_loss_daily (
  id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tp_id                   int  NOT NULL REFERENCES ref.tp ON DELETE CASCADE,
  biz_date                date NOT NULL,

  kwh_balance_meter       numeric(14,2) NOT NULL CHECK (kwh_balance_meter      >= 0),
  kwh_consumers_attached  numeric(14,2) NOT NULL CHECK (kwh_consumers_attached >= 0),

  -- ↓ HISOBLANADI. Manfiy bo'lishi MUMKIN - bu ANOMALIYA belgisi, xato emas,
  -- shuning uchun bu ikki ustunda hech qanday CHECK >= 0 YO'Q (ataylab).
  kwh_loss  numeric(14,2) GENERATED ALWAYS AS (kwh_balance_meter - kwh_consumers_attached) STORED,
  loss_pct  numeric(10,2) GENERATED ALWAYS AS (
              CASE WHEN kwh_balance_meter <> 0
                   THEN round(100 * (kwh_balance_meter - kwh_consumers_attached) / kwh_balance_meter, 2)
              END) STORED,

  -- "Хатловдан кейин" - "74/80" kabi qator, MA'NOSI TASDIQLANMAGAN (mijoz
  -- o'zi ham bilmasligini aytgan). Opaque matn sifatida saqlanadi, hech
  -- qanday sonli xulosa chiqarilmaydi.
  inspection_note  text,

  source        text NOT NULL DEFAULT 'EXCEL' CHECK (source IN ('EXCEL', 'MANUAL')),
  file_name     text,
  note          text,
  created_by    int REFERENCES sec.app_user,
  updated_by    int REFERENCES sec.app_user,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT tld_no_future CHECK (biz_date <= CURRENT_DATE),
  CONSTRAINT tld_uq UNIQUE (tp_id, biz_date)
);

CREATE INDEX tp_loss_daily_date ON fact.tp_loss_daily (biz_date DESC, tp_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON fact.tp_loss_daily TO beap_app;
GRANT USAGE, SELECT ON SEQUENCE fact.tp_loss_daily_id_seq TO beap_app;

ALTER TABLE fact.tp_loss_daily ENABLE ROW LEVEL SECURITY;

-- TP ning egasi ona fider orqali aniqlanadi (jadvalda `mfy_id` yo'q) -
-- `0013_feeder_level.sql`dagi `tp_monthly_read`/`tp_monthly_write` bilan
-- BIR XIL shakl.
CREATE POLICY tp_loss_daily_read ON fact.tp_loss_daily FOR SELECT TO beap_app
  USING (
    sec.can_read_all()
    OR EXISTS (SELECT 1 FROM ref.tp t WHERE t.id = tp_id AND t.mfy_id = ANY (sec.current_mfy_ids()))
  );

CREATE POLICY tp_loss_daily_write ON fact.tp_loss_daily FOR ALL TO beap_app
  USING (EXISTS (SELECT 1 FROM ref.tp t WHERE t.id = tp_id AND sec.can_write_mfy(t.mfy_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM ref.tp t WHERE t.id = tp_id AND sec.can_write_mfy(t.mfy_id)));

CREATE TRIGGER zz_audit AFTER INSERT OR UPDATE OR DELETE ON fact.tp_loss_daily
  FOR EACH ROW EXECUTE FUNCTION sec.trg_audit();

COMMENT ON TABLE fact.tp_loss_daily IS
  'TP darajasidagi kunlik chiziqli yo''qotish - balans hisoblagichi vs бириктирилган iste''molchilar; manfiy qiymat = anomaliya signali';
