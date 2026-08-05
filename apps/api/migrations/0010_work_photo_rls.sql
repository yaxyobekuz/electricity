-- ═══════════════════════════════════════════════════════════════════════════
-- ISH RASMLARI UCHUN QATOR DARAJASIDAGI HIMOYA
--
-- Tizimning qoidasi: yozish huquqi IKKI qatlamda tekshiriladi - API da
-- (tushunarli xato beradi) va Postgres RLS da (API xato qilsa ham himoya
-- qiladi). `fact.work_photo` yangi jadval, shuning uchun u ham shu qoidaga
-- qo'shiladi.
--
-- Rasmda `mfy_id` ustuni yo'q - u ONA ISHDAN olinadi, xuddi TP orqali
-- bog'langan jadvallardagidek.
-- ═══════════════════════════════════════════════════════════════════════════

GRANT SELECT, INSERT, UPDATE, DELETE ON fact.work_photo TO beap_app;
GRANT USAGE, SELECT ON SEQUENCE fact.work_photo_id_seq TO beap_app;

ALTER TABLE fact.work_photo ENABLE ROW LEVEL SECURITY;

CREATE POLICY work_photo_read ON fact.work_photo FOR SELECT TO beap_app
  USING (
    sec.can_read_all()
    OR EXISTS (
      SELECT 1 FROM fact.work w
       WHERE w.id = work_id AND w.mfy_id = ANY (sec.current_mfy_ids())
    )
  );

CREATE POLICY work_photo_insert ON fact.work_photo FOR INSERT TO beap_app
  WITH CHECK (
    EXISTS (SELECT 1 FROM fact.work w WHERE w.id = work_id AND sec.can_write_mfy(w.mfy_id))
  );

CREATE POLICY work_photo_delete ON fact.work_photo FOR DELETE TO beap_app
  USING (
    EXISTS (SELECT 1 FROM fact.work w WHERE w.id = work_id AND sec.can_write_mfy(w.mfy_id))
  );
