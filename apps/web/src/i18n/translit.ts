/**
 * O'zbek lotin → kirill transliteratsiyasi.
 *
 * Nima uchun kerak: UI matnlari i18n JSON da tarjima qilingan, lekin
 * ma'lumotlar bazasidan keladigan yorliqlar (ish nomlari, qarzdor nomlari,
 * TP nomlari) faqat lotinda. Ularni har biri uchun qo'lda tarjima qilish
 * amaliy emas — o'zbek lotin→kirill deyarli deterministik.
 *
 * MFY nomlari BUNDAN MUSTASNO — atoqli otlar uchun DB da `name_uz_cyr`
 * ustuni bor va u har doim ustun turadi.
 */

/** Digraflar birinchi — tartib muhim (`sh` `s`+`h` dan oldin). */
const DIGRAPHS: [RegExp, string][] = [
  [/o['ʻʼ`’‘]/g, 'ў'],
  [/O['ʻʼ`’‘]/g, 'Ў'],
  [/g['ʻʼ`’‘]/g, 'ғ'],
  [/G['ʻʼ`’‘]/g, 'Ғ'],
  [/sh/g, 'ш'], [/Sh/g, 'Ш'], [/SH/g, 'Ш'],
  [/ch/g, 'ч'], [/Ch/g, 'Ч'], [/CH/g, 'Ч'],
  [/ng/g, 'нг'], [/Ng/g, 'Нг'], [/NG/g, 'НГ'],
  [/yo/g, 'ё'], [/Yo/g, 'Ё'], [/YO/g, 'Ё'],
  [/yu/g, 'ю'], [/Yu/g, 'Ю'], [/YU/g, 'Ю'],
  [/ya/g, 'я'], [/Ya/g, 'Я'], [/YA/g, 'Я'],
  [/ts/g, 'ц'], [/Ts/g, 'Ц'],
];

const SINGLES: Record<string, string> = {
  a: 'а', b: 'б', d: 'д', e: 'е', f: 'ф', g: 'г', h: 'ҳ', i: 'и', j: 'ж',
  k: 'к', l: 'л', m: 'м', n: 'н', o: 'о', p: 'п', q: 'қ', r: 'р', s: 'с',
  t: 'т', u: 'у', v: 'в', x: 'х', y: 'й', z: 'з',
  A: 'А', B: 'Б', D: 'Д', E: 'Е', F: 'Ф', G: 'Г', H: 'Ҳ', I: 'И', J: 'Ж',
  K: 'К', L: 'Л', M: 'М', N: 'Н', O: 'О', P: 'П', Q: 'Қ', R: 'Р', S: 'С',
  T: 'Т', U: 'У', V: 'В', X: 'Х', Y: 'Й', Z: 'З',
  "'": 'ъ', 'ʼ': 'ъ',
};

const cache = new Map<string, string>();

export function toCyrillic(text: string): string {
  if (!text) return text;
  const hit = cache.get(text);
  if (hit !== undefined) return hit;

  let out = text;
  for (const [re, rep] of DIGRAPHS) out = out.replace(re, rep);

  out = out
    .split('')
    .map((ch) => SINGLES[ch] ?? ch)
    .join('');

  // So'z boshidagi `е` → `Е`/`е` qoladi; lekin unlidan keyin `ye` bo'lishi kerak.
  // Bu nozik holat kam uchraydi, shuning uchun soddalashtiramiz.

  if (cache.size > 5000) cache.clear();
  cache.set(text, out);
  return out;
}

export type Script = 'latn' | 'cyrl';

/** Faol yozuvga qarab matnni qaytaradi. */
export function script(text: string, s: Script): string {
  return s === 'cyrl' ? toCyrillic(text) : text;
}
