/**
 * TP kodi - manba hujjatlardagi ORIGINAL raqam: `10`, `171`, `44A`.
 *
 * Ilgari tizim har bir raqamga `TP-` prefiksini qo'shib, uch xonaga
 * to'ldirib saqlardi (`10` → `TP-010`). Bu ikki narsani buzardi:
 * foydalanuvchi hujjatdagi nom bilan ekrandagini solishtira olmasdi, va
 * bir TP registrda `TP-15A`, hisobotda `15A` ko'rinishida yozilib,
 * solishtirish uchun alohida kalit yasashga majbur qilardi.
 *
 * Endi `ref.tp.code` da hujjatdagi nomning O'ZI turadi. Prefiks qo'shish
 * yoki nol bilan to'ldirish hech qayerda qilinmaydi.
 */

/** Kirillcha, lotinchaga vizual mos keladigan bosh harflar. */
const CYR_TO_LAT: Record<string, string> = {
  А: 'A', В: 'B', С: 'C', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', Т: 'T', Х: 'X',
};

/**
 * Yozilishi har xil bo'lgan kodlarni BITTA kanonik ko'rinishga keltiradi.
 *
 * Manba fayllarda ham, foydalanuvchi yozuvida ham bitta TP turlicha
 * yoziladi - hammasi bir xil kalitga tushadi:
 *
 *   `TP-010`, `ТП 10`, `10-TP`, `010`  → `10`
 *   `44А` (kirill), `44a`, `TP-044A`   → `44A`
 *
 * Kirillcha «А» (U+0410) alohida muhim: manba faylning o'zida `44А` va
 * `122A` yonma-yon turadi - ko'zga bir xil, baytda boshqa. Normalizatsiya
 * bo'lmasa registrda bitta TP ikki marta paydo bo'lardi.
 */
export function tpCodeKey(raw: string): string {
  const s = raw.trim()
    .replace(/[АВСЕКМНОРТХ]/g, (ch) => CYR_TO_LAT[ch] ?? ch)
    .toUpperCase();

  // Prefiks/suffiks ixtiyoriy: «TP-067», «ТП 067», «067-TP» - bari bir TP.
  const bare = s
    .replace(/^T[PП][\s.\-]*/, '')
    .replace(/[\s.\-]*T[PП]$/, '')
    .trim();

  // Boshidagi nollar tushadi, harf qo'shimchasi (`A`) joyida qoladi.
  const m = /^0*(\d+)(.*)$/.exec(bare);
  return m ? `${m[1]}${m[2]!.replace(/\s+/g, '')}` : bare;
}

/** Ikki yozuv ayni TP ni ko'rsatadimi. */
export function tpCodeEq(a: string, b: string): boolean {
  return tpCodeKey(a) === tpCodeKey(b);
}

/**
 * Ro'yxatni TABIIY tartibda saralaydi: `10, 15A, 20, 122, 122A, 171`.
 *
 * Oddiy matn taqqoslashi `10` ni `122` dan keyinga qo'yardi - kod endi nol
 * bilan to'ldirilmaganidan keyin bu ko'zga tashlanadigan xatoga aylandi.
 */
export function compareTpCode(a: string, b: string): number {
  return tpCodeKey(a).localeCompare(tpCodeKey(b), 'en', { numeric: true });
}
