/**
 * i18n - o'zbek lotin (asosiy) va kirill.
 *
 * DIZAYN QARORI: kirill uchun alohida JSON fayl SAQLANMAYDI.
 * O'zbek lotin→kirill transliteratsiyasi deterministik, shuning uchun kirill
 * versiyasi i18next post-processori orqali ish vaqtida hosil qilinadi.
 *
 * Nima uchun shunday:
 *   • ikkita fayl orasida DRIFT bo'lmaydi (yangi kalit qo'shilsa - avtomatik)
 *   • tarjima xatosi imkoniyati nolga tushadi
 *   • ma'lumotlar bazasidan keladigan yorliqlar ham bir xil qoida bilan o'giriladi
 *
 * MUSTASNO: MFY nomlari kabi atoqli otlar uchun DB da `name_uz_cyr` ustuni bor
 * va u har doim transliteratsiyadan ustun turadi.
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import uzLatn from './uz-Latn.json';
import { toCyrillic } from './translit.ts';

export const LANGUAGES = [
  { code: 'uz-Latn', label: 'O‘zbekcha', short: 'LOT' },
  { code: 'uz-Cyrl', label: 'Ўзбекча', short: 'КИР' },
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]['code'];

const STORAGE_KEY = 'beap.lang';

function initialLanguage(): LanguageCode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'uz-Cyrl' || saved === 'uz-Latn') return saved;
  } catch {
    /* localStorage mavjud emas */
  }
  return 'uz-Latn';
}

/** Kirill uchun post-processor - barcha tarjimalarni transliteratsiya qiladi. */
const cyrillicPostProcessor = {
  type: 'postProcessor' as const,
  name: 'cyrillic',
  process(value: string, _key: string, _options: unknown, translator: { language?: string }): string {
    return translator.language === 'uz-Cyrl' ? toCyrillic(value) : value;
  },
};

void i18n
  .use(cyrillicPostProcessor)
  .use(initReactI18next)
  .init({
    // Ikkala til ham AYNAN bir xil resurslardan foydalanadi.
    resources: {
      'uz-Latn': { translation: uzLatn },
      'uz-Cyrl': { translation: uzLatn },
    },
    lng: initialLanguage(),
    fallbackLng: 'uz-Latn',
    postProcess: ['cyrillic'],
    interpolation: { escapeValue: false },
    returnNull: false,
  });

export function setLanguage(code: LanguageCode): void {
  void i18n.changeLanguage(code);
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch {
    /* saqlab bo'lmadi - muhim emas */
  }
  document.documentElement.lang = code === 'uz-Cyrl' ? 'uz-Cyrl' : 'uz';
}

export function currentScript(): 'latn' | 'cyrl' {
  return i18n.language === 'uz-Cyrl' ? 'cyrl' : 'latn';
}

export default i18n;
