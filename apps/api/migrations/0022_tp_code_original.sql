-- ═══════════════════════════════════════════════════════════════════════════
-- 0022. TP kodi - hujjatdagi ORIGINAL nom
--
-- SABAB: registrda kod sun'iy ko'rinishda saqlanardi - `TP-` prefiksi va uch
-- xonagacha nol bilan to'ldirish (`10` → `TP-010`). Manba hujjatlarda esa TP
-- oddiygina `10`, `171`, `44А` deb yuritiladi. Ekrandagi nom hujjatdagi nom
-- bilan mos kelmagani uchun foydalanuvchi ikkalasini solishtira olmasdi.
--
-- Endi `ref.tp.code` da hujjatdagi nomning O'ZI turadi. Kod - `UNIQUE`, lekin
-- FK lar `id` orqali ishlaydi, shuning uchun bog'liq qatorlarga tegilmaydi.
--
-- KIRILL «А» (U+0410): registrda `TP-44А` va `TP-47А` da kirillcha, qolgan
-- «A» li kodlarda lotincha harf turibdi - ko'zga bir xil, baytda boshqa.
-- Shu bo'lgani uchun qidiruv «44A» ni topa olmasdi. Bu yerda hammasi
-- lotinchaga keltiriladi: ko'rinish o'zgarmaydi, xato yo'qoladi.
-- ═══════════════════════════════════════════════════════════════════════════

UPDATE ref.tp
SET code = translate(
             upper(regexp_replace(btrim(code), '^TP-?0*', '', 'i')),
             'АВСЕКМНОРТХ', 'ABCEKMHOPTX')
WHERE code ~* '^TP';

COMMENT ON COLUMN ref.tp.code IS
  'Hujjatdagi original TP nomi: «10», «171», «44A». Prefiks QO''SHILMAYDI '
  'va nol bilan to''ldirilmaydi. Kirillcha harflar lotinchaga keltiriladi.';
