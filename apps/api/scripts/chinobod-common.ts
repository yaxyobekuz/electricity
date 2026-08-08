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
