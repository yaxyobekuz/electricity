-- ═══════════════════════════════════════════════════════════════════════════
-- 0015_mfy_responsible_public_read.sql - ma'sul shaxs UMUMIY o'qishga ochiladi
--
-- Dashboard tizimga kirmasdan ham ko'rinadi (boshqa barcha panellar singari).
-- `ref.mfy_responsible` boshqa `ref.*` jadvallar kabi (ref.mfy, ref.tp, ...)
-- Row Level Security'siz bo'lishi kerak edi - bu SPRAVOCHNIK, foydalanuvchi
-- scope'iga bog'liq FAKT emas. 0014 buni `fact.feeder_monthly` naqshi bilan
-- adashtirib RLS bilan yopgan edi - shu sabab anonim foydalanuvchida panel
-- bo'sh ko'rinardi. Yozish huquqi API darajasida (`assertMfyWrite`) qoladi.
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS mfy_responsible_read  ON ref.mfy_responsible;
DROP POLICY IF EXISTS mfy_responsible_write ON ref.mfy_responsible;
ALTER TABLE ref.mfy_responsible DISABLE ROW LEVEL SECURITY;
