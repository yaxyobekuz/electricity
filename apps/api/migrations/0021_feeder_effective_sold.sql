-- ═══════════════════════════════════════════════════════════════════════════
-- 0021_feeder_effective_sold.sql - foydali oqim uchun ham rasmiy qiymat
--
-- 0020 da KIRIM uchun uch bosqichli tuzilma joriy qilingan edi:
--   kwh_in_official ?? kwh_in_tp  →  kwh_in (amaldagi, barcha hisob asosi).
--
-- FOYDALI OQIM ham aynan shunday ishlashi kerak: hujjatda oy uchun umumiy
-- qiymat berilgan bo'lsa, yo'qotish va foizlar o'sha songa tayanadi;
-- berilmagan bo'lsa - TP iste'molchilaridan yig'ilgan qiymatga.
--
-- USTUN NOMI ALMASHTIRILADI: `kwh_tp_sum` («TP lar yig'indisi») endi
-- AMALDAGI foydali oqimni saqlaydi va u rasmiy songa teng bo'lishi mumkin -
-- ya'ni eski nom mazmunga zid bo'lib qolardi. `kwh_sold` deb ataladi,
-- o'lchangan yig'indi esa `kwh_sold_tp` da qoladi.
--
-- `kwh_loss` (generated) `kwh_in - kwh_tp_sum` edi; PostgreSQL ustun nomi
-- o'zgarganda ifodani o'zi yangilaydi, shuning uchun u qayta yozilmaydi.
--
-- Yakuniy tuzilma - kirim va oqim uchun BIR XIL:
--   kwh_in_official   / kwh_sold_official  - hujjatdagi rasmiy son (NULL = yo'q)
--   kwh_in_tp         / kwh_sold_tp        - TP hisoblagichlaridan o'lchov
--   kwh_in            / kwh_sold           - AMALDAGI qiymat (official ?? tp)
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE fact.feeder_monthly RENAME COLUMN kwh_tp_sum TO kwh_sold;

ALTER TABLE fact.feeder_monthly
  ADD COLUMN kwh_sold_official numeric(14,2)
    CHECK (kwh_sold_official IS NULL OR kwh_sold_official >= 0),
  ADD COLUMN kwh_sold_tp numeric(14,2)
    CHECK (kwh_sold_tp IS NULL OR kwh_sold_tp >= 0);

COMMENT ON COLUMN fact.feeder_monthly.kwh_sold IS
  'AMALDAGI foydali oqim - hisob-kitob shu ustundan boshlanadi. '
  'kwh_sold_official mavjud bo''lsa unga, aks holda kwh_sold_tp ga teng.';

COMMENT ON COLUMN fact.feeder_monthly.kwh_sold_official IS
  'Oy uchun biriktirilgan RASMIY foydali oqim. NULL = qiymat kelmagan.';

COMMENT ON COLUMN fact.feeder_monthly.kwh_sold_tp IS
  'TP biriktirilgan iste''molchilaridan YIG''ILGAN foydali oqim (o''lchov).';
