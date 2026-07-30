-- ═══════════════════════════════════════════════════════════════════════════
-- Davr ichida UZILGAN abonentlar soni
--
-- `consumers_disconnected` — bu ZAXIRA (stock): hozirda uzilgan holatda
-- turgan abonentlar soni. U «shu davrda nechta abonent uzildi?» degan
-- savolga javob BERMAYDI: 16 ta uzilgan bo'lsa ham, ular o'tgan yili
-- uzilgan bo'lishi mumkin.
--
-- Dashboarddagi «Uzilgan (bugun)» ko'rsatkichi aynan OQIM (flow) qiymati,
-- shuning uchun alohida ustun kerak. `consumers_new` ham xuddi shunday
-- oqim — u allaqachon mavjud, ya'ni ikkalasi juft bo'lib to'liq manzara
-- beradi: davr ichida nechta ulandi va nechta uzildi.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE fact.mfy_monthly_return
  ADD COLUMN IF NOT EXISTS consumers_disconnected_new int NOT NULL DEFAULT 0;

-- Oqim zaxiradan katta bo'lishi mumkin emas: davr ichida uzilganlar
-- davr oxiridagi uzilganlar to'plamining bir qismi.
ALTER TABLE fact.mfy_monthly_return
  DROP CONSTRAINT IF EXISTS mr_discon_new_nonneg;
ALTER TABLE fact.mfy_monthly_return
  ADD CONSTRAINT mr_discon_new_nonneg CHECK (consumers_disconnected_new >= 0);

ALTER TABLE fact.mfy_monthly_return
  DROP CONSTRAINT IF EXISTS mr_discon_new_le_discon;
ALTER TABLE fact.mfy_monthly_return
  ADD CONSTRAINT mr_discon_new_le_discon
    CHECK (consumers_disconnected_new <= consumers_disconnected);

-- ── Mavjud DEMO qatorlarini to'ldirish ─────────────────────────────────────
--
-- DIQQAT: bu FAQAT demo ma'lumot uchun. Haqiqiy tizimda bu ustun xodim
-- tomonidan kiritiladi — hech qanday taxminiy hisob-kitob qilinmaydi.
-- Taqsimot deterministik (mfy_id va oyga bog'liq), shuning uchun har bir
-- mashinada bir xil chiqadi.
UPDATE fact.mfy_monthly_return
SET consumers_disconnected_new = LEAST(
      consumers_disconnected,
      GREATEST(0, (consumers_disconnected * 0.25)::int
                  + ((mfy_id * 7 + EXTRACT(MONTH FROM period_month)::int * 3) % 4) - 1)
    )
WHERE consumers_disconnected_new = 0;

COMMENT ON COLUMN fact.mfy_monthly_return.consumers_disconnected_new IS
  'Davr ichida uzilgan abonentlar soni (oqim). consumers_disconnected — zaxira.';
