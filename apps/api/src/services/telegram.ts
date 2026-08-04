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
      body: JSON.stringify({ chat_id: chatId, text }),
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
