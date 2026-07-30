-- ═══════════════════════════════════════════════════════════════════════════
-- 0005_reference_data.sql — o'zgarmas spravochnik ma'lumotlari
--
-- MFY / TP / tarmoq segmentlari bu yerda EMAS — ular `seed/mfy.seed.json`
-- dan yuklanadi, chunki mijoz haqiqiy ro'yxatni tasdiqlagach faqat o'sha
-- fayl o'zgarishi kerak.
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO ref.consumer_category (id, code, name_uz, name_uz_cyr) VALUES
  (1, 'POPULATION', 'Aholi',                 'Аҳоли'),
  (2, 'LEGAL',      'Yuridik (ulgurji)',     'Юридик (улгуржи)'),
  (3, 'BUDGET',     'Budjet tashkilotlari',  'Бюджет ташкилотлари')
ON CONFLICT (id) DO NOTHING;


INSERT INTO ref.elektroset (code, name_uz, name_uz_cyr) VALUES
  ('BALIQCHI', 'Baliqchi Elektraset', 'Балиқчи Электрасет'),
  ('CHINOBOD', 'Chinobod Elektraset', 'Чинобод Электрасет')
ON CONFLICT (code) DO NOTHING;


-- ─── NORMALAR (tuman darajasida, 2024-01-01 dan amalda) ─────────────────────
-- Qiymatlar mockup dashboardidan va soha amaliyotidan olingan.
-- Mijoz rasmiy qarorni taqdim etganda `source_doc` to'ldiriladi va yangi
-- `effective_from` bilan versiya qo'shiladi (eskisi tarixda qoladi).

INSERT INTO ref.norm (scope_type, scope_id, metric, value_num, unit, effective_from, source_doc) VALUES
  ('TUMAN', NULL, 'NATURAL_LOSS_PCT',        4.200, '%',  '2024-01-01', 'Mockup / soha amaliyoti — rasmiy hujjat kutilmoqda'),
  ('TUMAN', NULL, 'TECHNICAL_LOSS_PCT',      3.200, '%',  '2024-01-01', 'Mockup / soha amaliyoti — rasmiy hujjat kutilmoqda'),
  ('TUMAN', NULL, 'TOTAL_LOSS_TARGET_PCT',   8.000, '%',  '2024-01-01', 'Tuman maqsadli ko''rsatkichi'),
  ('TUMAN', NULL, 'TP_MAX_DISTANCE_M',     300.000, 'm',  '2024-01-01', 'TP → iste''molchi standart masofasi'),
  ('TUMAN', NULL, 'TP_OPTIMAL_LOAD_PCT_MIN', 40.000, '%', '2024-01-01', 'TP samarali yuklama oralig''i'),
  ('TUMAN', NULL, 'TP_OPTIMAL_LOAD_PCT_MAX', 70.000, '%', '2024-01-01', 'TP samarali yuklama oralig''i'),
  ('TUMAN', NULL, 'TP_OVERLOAD_PCT',         90.000, '%', '2024-01-01', 'Ortiqcha yuklama chegarasi'),
  ('TUMAN', NULL, 'VOLTAGE_NOMINAL_V',      220.000, 'V', '2024-01-01', 'Nominal kuchlanish'),
  ('TUMAN', NULL, 'VOLTAGE_TOLERANCE_PCT',   10.000, '%', '2024-01-01', 'Ruxsat etilgan chetlanish'),
  ('TUMAN', NULL, 'LOW_CONSUMPTION_KWH',     50.000, 'kWh','2024-01-01', 'Pasport 7-qatori: 0 va 50 kWh dan kam')
ON CONFLICT ON CONSTRAINT norm_no_overlap DO NOTHING;
