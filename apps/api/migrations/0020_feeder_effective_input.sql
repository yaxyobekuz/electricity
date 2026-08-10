-- ═══════════════════════════════════════════════════════════════════════════
-- 0020_feeder_effective_input.sql - rasmiy kirim BARCHA hisob-kitob asosi
--
-- 0019 da rasmiy oylik kirim (`kwh_in_official`) faqat «Jami iste'mol»
-- kartasining ko'rsatuvi uchun ishlatilardi: yo'qotish, foydali oqim ulushi
-- va samaradorlik esa TP balans hisoblagichlari yig'indisiga tayanardi.
-- Natijada bitta ekranda ikki xil asos yonma-yon turardi - iyul kartasi
-- 1 048 000 kWh, yo'qotish esa 722 508 kWh dan hisoblangan −27,7%.
--
-- ENDI: rasmiy qiymat kelgan oyda AMALDAGI KIRIM (`kwh_in`) aynan o'sha
-- bo'ladi va undan kelib chiqadigan hamma narsa - yo'qotish, yo'qotish
-- foizi, hisoblagich qamrovi, samaradorlik indeksi - shu asosda hisoblanadi.
-- Kelmagan oyda hech nima o'zgarmaydi: kirim TP yig'indisidan olinadi.
--
-- Buning uchun yangi hisob-kitob mantig'i KERAK EMAS: `fact.energy_balance_daily`
-- kunlik qatorlariga amaldagi kirim yoziladi, `agg.*` esa allaqachon o'sha
-- qatorlardan yig'iladi.
--
-- TP dan hisoblangan yig'indi YO'QOLMAYDI - u `kwh_in_tp` da saqlanadi va
-- kartada ikkinchi darajali qiymat sifatida ko'rsatiladi. Uch ustunning
-- ma'nosi shundan iborat:
--
--   kwh_in_official - hujjatdagi rasmiy qiymat (NULL = kelmagan);
--   kwh_in_tp       - TP balans hisoblagichlari yig'indisi (o'lchov);
--   kwh_in          - AMALDAGI kirim = kwh_in_official ?? kwh_in_tp.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE fact.feeder_monthly
  ADD COLUMN kwh_in_tp numeric(14,2)
    CHECK (kwh_in_tp IS NULL OR kwh_in_tp >= 0);

COMMENT ON COLUMN fact.feeder_monthly.kwh_in_tp IS
  'TP balans hisoblagichlari YIG''INDISI. `kwh_in` dan farq qilishi mumkin: '
  'rasmiy qiymat kelgan oyda `kwh_in` o''sha rasmiy songa teng bo''ladi.';

COMMENT ON COLUMN fact.feeder_monthly.kwh_in IS
  'AMALDAGI kirim - barcha hisob-kitob shu ustundan boshlanadi. '
  'kwh_in_official mavjud bo''lsa unga, aks holda kwh_in_tp ga teng.';
