/**
 * Telegram Bot API ga ko'prik — mustaqil, tashqi paketsiz HTTP yordamchisi.
 *
 * Bu yerda INTERAKTIV bot YO'Q (buyruqlarni tinglash, uzun so'rov/long
 * polling va h.k.) — u alohida bot/ ish maydonida yashaydi va o'z holicha
 * ishlaydi. Shu modul esa faqat BITTALIK xabar/fayl YUBORISH uchun: uni
 * serverning kunlik ogohlantirish push'i (apps/api/src/server.ts, keyingi
 * bosqichda qo'shiladi) chaqiradi, lekin istalgan joydan foydalanish mumkin.
 *
 * NEGA config.ts IMPORT QILINMAYDI: bu modul global sozlamalardan mustaqil
 * qolishi kerak — parallel bajarilayotgan boshqa bosqichlar bilan yuklanish
 * tartibiga bog'liqlik bo'lmasin. Shuning uchun bot tokeni har bir
 * funksiyaga ochiq parametr sifatida beriladi (config'dan o'zi o'qilmaydi).
 *
 * Ikkala funksiya ham HECH QACHON xato TASHLAMAYDI (throw qilmaydi) — bular
 * "eng yaxshi urinish" (best-effort) bildirishnomalar: Telegram tarmog'i
 * ishlamay qolsa ham chaqiruvchi (masalan, cron job) yiqilib qolmasligi
 * shart.
 */

const API_ROOT = 'https://api.telegram.org';

/**
 * Model javobini Telegram HTML formatiga o'giradi.
 *
 * Bu yerdagi mantiq `bot/src/format.ts`dagi `toTelegramHtml()` bilan BIR
 * XIL — lekin u alohida ish maydonida (bot/), shu modul esa apps/api
 * ish maydonida yashaydi, ular bir-birini import qila olmaydi (workspace
 * chegarasi). Shu sababli kichik dublikat qasddan qilingan — xuddi
 * .env o'qish mantig'i `config.ts` va `bot/src/env.ts` orasida
 * takrorlanganidek.
 *
 * NEGA MarkdownV2 EMAS: u ".", "-", "!", "(", ")" kabi juda ko'p belgini
 * qochirishni (escape) talab qiladi — o'zbekcha matn va raqamlarda ular
 * doim uchraydi (masalan "58 680.5 kWh"), bitta unutilgan belgi butun
 * xabarni Telegram xatosi bilan yiqitadi. HTML rejimida faqat uchta belgi
 * (&, <, >) qochiriladi — ancha ishonchli.
 */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * `**qalin**` bo'laklarini `<b>...</b>` ga aylantiradi, qolgan matnni
 * HTML'dan "qochiradi". Oqim davomida hali yopilmagan yakka `**` oddiy
 * matn sifatida qoladi, noto'g'ri teg hosil bo'lmaydi.
 */
function toTelegramHtml(text: string): string {
  return text
    .split(/(\*\*[^*]+\*\*)/g)
    .map((part) => (
      part.startsWith('**') && part.endsWith('**') && part.length > 4
        ? `<b>${escapeHtml(part.slice(2, -2))}</b>`
        : escapeHtml(part)
    ))
    .join('');
}

/**
 * Oddiy matnli xabar yuboradi.
 *
 * `botToken` yoki `chatId` bo'sh bo'lsa — so'rov umuman yuborilmaydi va
 * darhol `false` qaytadi (masalan, hali Telegram sozlanmagan foydalanuvchi
 * uchun bildirishnoma jimgina o'tkazib yuboriladi).
 */
export async function sendMessage(
  botToken: string, chatId: string, text: string,
): Promise<boolean> {
  if (!botToken || !chatId) return false;

  try {
    const res = await fetch(`${API_ROOT}/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: toTelegramHtml(text),
        parse_mode: 'HTML',
      }),
    });
    return res.ok;
  } catch {
    // Tarmoq yo'q / Telegram ishlamayapti — bu ham muvaffaqiyatsizlik, lekin
    // chaqiruvchini yiqitmaymiz, shunchaki "yuborilmadi" deb qaytamiz.
    return false;
  }
}

/**
 * Faylni (masalan, kunlik Excel hisobotni) hujjat sifatida yuboradi.
 *
 * Node 24 ning o'rnatilgan FormData/Blob obyektlaridan foydalaniladi —
 * multipart/form-data so'rovi uchun qo'shimcha npm paketi shart emas.
 */
export async function sendDocument(
  botToken: string,
  chatId: string,
  fileBuffer: Buffer | Uint8Array,
  filename: string,
  caption?: string,
): Promise<boolean> {
  if (!botToken || !chatId) return false;

  try {
    const form = new FormData();
    form.append('chat_id', chatId);
    form.append('document', new Blob([fileBuffer]), filename);
    if (caption) form.append('caption', caption);

    const res = await fetch(`${API_ROOT}/bot${botToken}/sendDocument`, {
      method: 'POST',
      body: form,
    });
    return res.ok;
  } catch {
    return false;
  }
}
