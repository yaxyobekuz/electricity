/**
 * Chinobod ETK yuklovchilari uchun umumiy yordamchilar.
 *
 * TP kodi bilan ishlash qoidasi endi `@beap/shared` da - skriptlar, API va
 * veb bir xil normalizatsiyadan foydalanadi. Bu yerda faqat qayta eksport:
 * yuklovchilar tarixan shu fayldan import qiladi.
 */
import { tpCodeKey } from '@beap/shared';

export { compareTpCode, tpCodeEq, tpCodeKey } from '@beap/shared';

/**
 * Registrga yoziladigan TP kodi - hujjatdagi nomning O'ZI (`44` → `44`,
 * `166А` → `166A`). Prefiks qo'shilmaydi, nol bilan to'ldirilmaydi.
 *
 * Yozish va solishtirish uchun bitta funksiya ishlaydi: registrdagi kod
 * kanonik ko'rinishda saqlangani uchun ikkinchi "match key" endi keraksiz.
 */
export const tpCodeOf = tpCodeKey;

/** @deprecated `tpCodeKey` bilan bir xil - eski chaqiruvlar uchun qoldirilgan. */
export const tpMatchKey = tpCodeKey;
