-- ═══════════════════════════════════════════════════════════════════════════
-- 0019_feeder_official_input.sql - oy uchun BIRIKTIRILGAN rasmiy kirim
--
-- MUAMMO: «Jami iste'mol» kartasi hozir TP balans hisoblagichlari
-- YIG'INDISINI ko'rsatadi. Bu hisoblangan raqam - fider boshidagi kirish
-- hisoblagichi bilan bir xil emas. Iyul 2026 uchun rasmiy qiymat 1 048 000
-- kWh (hisoblagich 19 850 → 20 112, koeffitsient 4 000), TP yig'indisi esa
-- 722 508 kWh: farq 325 ming kWh.
--
-- YECHIM: rasmiy qiymat ALOHIDA ustunda saqlanadi va hisoblangan raqamning
-- ustiga YOZILMAYDI. Interfeys mavjud bo'lsa rasmiy qiymatni birinchi
-- darajada, TP dan hisoblangan raqamni ikkinchi darajada ko'rsatadi.
--
-- NULL = "bu oy uchun rasmiy qiymat kelmagan" (0 EMAS). Avgust 2026 aynan
-- shunday: hujjatda oylik kirish hisoblagichi yo'q, shuning uchun karta
-- hisoblangan raqamni ko'rsatishda davom etadi.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE fact.feeder_monthly
  ADD COLUMN kwh_in_official numeric(14,2)
    CHECK (kwh_in_official IS NULL OR kwh_in_official >= 0);

COMMENT ON COLUMN fact.feeder_monthly.kwh_in_official IS
  'Oy uchun biriktirilgan RASMIY kirim (fider kirish hisoblagichi). '
  'NULL = qiymat kelmagan; bunda TP yig''indisidan hisoblangan `kwh_in` ishlatiladi.';
