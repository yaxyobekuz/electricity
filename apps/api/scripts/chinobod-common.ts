/**
 * Chinobod ETK yuklovchilari uchun umumiy yordamchilar.
 *
 * `load-chinobod-july.ts` va `load-chinobod-august.ts` ikkalasi ham shu
 * fayldan o'qiydi - TP kodini keltirish qoidasi ikki joyda takrorlanmasin
 * (aks holda registrdagi kod bilan kunlik hisobotdagi kod mos kelmay qoladi).
 */

/** Kirillcha, lotinchaga vizual mos keladigan bosh harflar. */
const CYR_TO_LAT: Record<string, string> = {
  А: 'A', В: 'B', С: 'C', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', Т: 'T', Х: 'X',
};

/**
 * TP raqamini yagona kodga keltiradi: `44` → `TP-044`, `166А` → `TP-166A`.
 *
 * Manba fayllarda bitta TP goh lotincha, goh kirillcha «A» bilan yoziladi
 * («44A» va «44А») - ular BITTA TP. Kirillcha harflar lotinchaga o'giriladi,
 * shunda `ref.tp.code` bo'yicha ikki xil yozuv paydo bo'lmaydi.
 */
export function tpCodeOf(raw: string): string {
  const s = raw.trim().replace(/[АВСЕКМНОРТХ]/g, (ch) => CYR_TO_LAT[ch] ?? ch);
  const m = /^(\d+)(.*)$/.exec(s);
  if (!m) return `TP-${s}`;
  return `TP-${m[1]!.padStart(3, '0')}${m[2]!.toUpperCase()}`;
}

/**
 * TP kodining SOLISHTIRISH kaliti - `tpCodeOf` dan farqli o'laroq yangi kod
 * yasamaydi, balki mavjud ikki yozuvni bir ko'rinishga keltiradi.
 *
 * Kerak, chunki `ref.tp.code` registrda IZCHIL EMAS: `TP-010` nol bilan
 * to'ldirilgan, `TP-15A` esa yo'q; `TP-166А`, `TP-44А`, `TP-47А` da kirillcha
 * «А» (U+0410) turibdi. Manba fayllar ham har xil yozadi. Ikkala tomonni shu
 * kalit orqali solishtirsa, 47 tasi ham mos tushadi:
 *
 *   `TP-010` va `10`    → `10`
 *   `TP-166А` va `166A` → `166A`
 */
export function tpMatchKey(raw: string): string {
  const s = raw.trim()
    .replace(/^TP-/i, '')
    .replace(/[АВСЕКМНОРТХ]/g, (ch) => CYR_TO_LAT[ch] ?? ch)
    .toUpperCase();
  const m = /^0*(\d+)(.*)$/.exec(s);
  return m ? `${Number(m[1])}${m[2]!.trim()}` : s;
}
