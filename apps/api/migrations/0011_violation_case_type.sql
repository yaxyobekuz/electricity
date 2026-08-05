-- ═══════════════════════════════════════════════════════════════════════════
-- DALOLATNOMA TOIFASI: ma'muriy / jinoiy / iste'molchi aybsiz
--
-- `status` - dalolatnomaning HARAKAT holati (berildi, to'landi, sudda).
-- Toifa esa BOSHQA savolga javob beradi: holat qanday baholandi?
--   • ADMINISTRATIVE - ma'muriy javobgarlik (jarima solinadi)
--   • CRIMINAL       - jinoiy ish belgilari, materiallar sudga/IIB ga
--   • NO_FAULT       - tekshiruvda iste'molchining aybi tasdiqlanmadi
--
-- Aybsiz holat ALOHIDA saqlanadi: uni "dalolatnoma yo'q" deb hisobdan
-- chiqarish tekshiruv statistikasini yolg'on qiladi - reyd bo'lgan, natija
-- esa "aybsiz" degan xulosa bo'lgan.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE fact.violation_act
  ADD COLUMN IF NOT EXISTS case_type text NOT NULL DEFAULT 'ADMINISTRATIVE';

ALTER TABLE fact.violation_act
  DROP CONSTRAINT IF EXISTS va_case_type;
ALTER TABLE fact.violation_act
  ADD CONSTRAINT va_case_type
    CHECK (case_type IN ('ADMINISTRATIVE', 'CRIMINAL', 'NO_FAULT'));

-- Aybsiz deb topilgan holatda jarima bo'lishi mumkin emas.
ALTER TABLE fact.violation_act
  DROP CONSTRAINT IF EXISTS va_no_fault_no_fine;
ALTER TABLE fact.violation_act
  ADD CONSTRAINT va_no_fault_no_fine
    CHECK (case_type <> 'NO_FAULT' OR fine_mln = 0);

/*
 * MAVJUD DEMO QATORLARINI TAQSIMLASH.
 *
 * Toifa ilgari yozilmagan, shuning uchun uni mavjud maydonlardan kelib chiqib
 * tiklaymiz - bu bir martalik, KELGUSIDA toifani operator ochiq tanlaydi:
 *   • sudga oshgan yoki 8000 kWh dan ortiq aniqlangan → jinoiy belgilar
 *   • jarimasi yo'q va yopilgan                        → aybsiz
 *   • qolgani                                          → ma'muriy
 */
UPDATE fact.violation_act
   SET case_type = CASE
     WHEN status = 'COURT' OR kwh_identified >= 8000 THEN 'CRIMINAL'
     WHEN fine_mln = 0 AND status = 'CLOSED'         THEN 'NO_FAULT'
     ELSE 'ADMINISTRATIVE'
   END;

CREATE INDEX IF NOT EXISTS va_case_type_date
  ON fact.violation_act (case_type, act_date DESC);

COMMENT ON COLUMN fact.violation_act.case_type IS
  'Holat toifasi: ADMINISTRATIVE / CRIMINAL / NO_FAULT';
