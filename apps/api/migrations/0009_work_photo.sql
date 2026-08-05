-- ═══════════════════════════════════════════════════════════════════════════
-- ISH DALOLATNOMASI UCHUN RASMLAR
--
-- "Ish bajarildi" degan yozuvning o'zi dalil emas. Hokim yoki tekshiruvchi
-- "qayerda, qanday qilingan?" deb so'raganda javob RASM bo'ladi - shuning
-- uchun har bir ishga bir nechta surat biriktiriladi.
--
-- Fayl DISKDA saqlanadi (`var/uploads/work/<id>/<uuid>.<ext>`), bazada faqat
-- metama'lumot: BLOB bazani shishiradi va zaxira nusxani og'irlashtiradi.
-- Tizim offline bo'lgani uchun tashqi obyekt-saqlagich (S3 va h.k.) yo'q.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE fact.work_photo (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  work_id       bigint NOT NULL REFERENCES fact.work ON DELETE CASCADE,
  -- Diskdagi nom - tashqaridan kelgan nomga ISHONILMAYDI (yo'l bilan hujum).
  file_name     text NOT NULL,
  original_name text,
  mime          text NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes    int  NOT NULL CHECK (size_bytes > 0),
  -- Ishgacha / keyin / hujjat: dalolatnomada tartib shu bo'yicha chiqadi.
  kind          text NOT NULL DEFAULT 'AFTER' CHECK (kind IN ('BEFORE', 'AFTER', 'DOC')),
  caption       text,
  uploaded_by   int REFERENCES sec.app_user,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX work_photo_work ON fact.work_photo (work_id, created_at);

COMMENT ON TABLE fact.work_photo IS
  'Ish dalolatnomasi rasmlari. Fayl diskda, bu yerda faqat metama''lumot.';
