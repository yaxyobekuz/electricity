/**
 * Model javobini Telegram HTML formatiga o'giradi.
 *
 * `apps/api/src/services/ai.ts`dagi model `**qalin**` belgisi bilan yozadi
 * (veb klient buni `AiAssistant.tsx`dagi `formatRich()` bilan HTML'ga
 * aylantiradi - shu yerda bir xil naqsh Telegram uchun takrorlanadi). Agar
 * matn xom holda yuborilsa, Telegram uni parse qilmay, ikkita yulduzchani
 * harfma-harf ko'rsatadi - foydalanuvchi buni ko'rgan (skrinshot bilan).
 *
 * NEGA MarkdownV2 EMAS: u ".", "-", "!", "(", ")" kabi juda ko'p belgini
 * qochirishni (escape) talab qiladi - o'zbekcha matn va raqamlarda ular
 * doim uchraydi (masalan "58 680.5 kWh"), bitta unutilgan belgi butun
 * xabarni Telegram xatosi bilan yiqitadi. HTML rejimida faqat uchta belgi
 * (&, <, >) qochiriladi - ancha ishonchli.
 */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * `**qalin**` bo'laklarini `<b>...</b>` ga aylantiradi, qolgan matnni
 * HTML'dan "qochiradi". Oqim davomida hali yopilmagan yakka `**` (masalan
 * "...eng **TP" - ikkinchi `**` hali kelmagan) oddiy matn sifatida qoladi,
 * noto'g'ri teg hosil bo'lmaydi - `AiAssistant.tsx`dagi `formatRich()` bilan
 * BIR XIL bo'lak-bo'lish mantig'i shu xavfsizlikni kafolatlaydi.
 */
export function toTelegramHtml(text: string): string {
  return text
    .split(/(\*\*[^*]+\*\*)/g)
    .map((part) => (
      part.startsWith('**') && part.endsWith('**') && part.length > 4
        ? `<b>${escapeHtml(part.slice(2, -2))}</b>`
        : escapeHtml(part)
    ))
    .join('');
}
