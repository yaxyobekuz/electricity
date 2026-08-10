-- ═══════════════════════════════════════════════════════════════════════════
-- 0018_allow_negative_loss.sql - MANFIY yo'qotishga ruxsat
--
-- SABAB: haqiqiy o'lchov ma'lumoti (`xaqulobod_fider.xlsx`) bir necha joyda
-- "sotilgan > kirgan" holatini beradi:
--
--   • Iyul 2026 bo'yicha fider kesimida iste'molchilardan yig'ilgan energiya
--     balans hisoblagichlaridan 200 285 kWh KO'P (−27,7%);
--   • TP-024 va TP-305 da balans hisoblagichining o'zi MANFIY ko'rsatkich
--     bergan (−942,4 va −1283,4 kWh).
--
-- Bu xato emas - hujjatning «Muammolar» varag'ida ikkala TP ham «Баланс
-- хисоблагич носоз» deb qayd etilgan, yana 15 ta TP da esa «тока
-- трансформатори носоз». Ya'ni MANFIY YO'QOTISH - o'lchov tizimidagi
-- nosozlikning eng aniq belgisi. Uni bazaga kiritmaslik muammoni
-- ko'rinmas qilib qo'yadi.
--
-- `fact.tp_loss_daily` allaqachon shu tamoyilda qurilgan: uning `kwh_loss`
-- ustunida ataylab CHECK yo'q ("Manfiy bo'lishi MUMKIN - bu ANOMALIYA
-- belgisi, xato emas", 0016). Shu qoida endi kirish ustunlariga va fider
-- darajasiga ham yoyiladi.
--
-- NIMA O'ZGARMAYDI: yaxlitlik cheklovlari (sana kelajakda emas, davr oyning
-- birinchi kuni, plausibility chegarasi) va iste'molchilardan yig'ilgan
-- energiyaning manfiy bo'lmasligi - u hisoblagichlar YIG'INDISI, manfiy
-- bo'la olmaydi.
-- ═══════════════════════════════════════════════════════════════════════════


-- ─── 1. Fider kunlik balansi ────────────────────────────────────────────────
-- «Sotilgan <= kirgan» endi talab qilinmaydi. `kwh_loss_total` (generated)
-- manfiy chiqadi va dashboard buni shundayligicha ko'rsatadi.

ALTER TABLE fact.energy_balance_daily
  DROP CONSTRAINT IF EXISTS eb_sold_le_in;


-- ─── 2. Fider oylik balansi ─────────────────────────────────────────────────
-- 0017 da qo'shilgan `fm_tp_sum_le_in` xuddi shu sababdan olib tashlanadi.

ALTER TABLE fact.feeder_monthly
  DROP CONSTRAINT IF EXISTS fm_tp_sum_le_in;


-- ─── 3. TP balans hisoblagichi ──────────────────────────────────────────────
-- Nosoz hisoblagich manfiy ko'rsatkich beradi - u AYNAN saqlanadi.
-- Iste'molchilardan yig'ilgan ustun cheklovi O'Z O'RNIDA QOLADI.

ALTER TABLE fact.tp_loss_daily
  DROP CONSTRAINT IF EXISTS tp_loss_daily_kwh_balance_meter_check;

COMMENT ON COLUMN fact.tp_loss_daily.kwh_balance_meter IS
  'Balans hisoblagichi ko''rsatkichi. MANFIY bo''lishi mumkin - nosoz '
  'hisoblagich belgisi, xato emas (0018).';
