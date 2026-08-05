/**
 * `download_report` asbobi qaytargan faylni olib, Telegram hujjat sifatida
 * yuboradi.
 *
 * `fileNameFrom()` — `apps/web/src/lib/download.ts` dagi funksiya bilan bir
 * xil: `Content-Disposition` sarlavhasidan fayl nomini ajratadi, avval RFC
 * 5987 UTF-8 nusxasini sinab ko'radi (kirill/lotin nomlar shu yerda), aks
 * holda oddiy `filename=` ga tushadi.
 *
 * MANZIL QURILISHI: `action.payload.url` server tomonidan APi-NISBIY
 * beriladi, masalan "/report/period/monthly.xlsx?period=2026-07" — `/api`
 * prefiksisiz (`apps/api/src/services/ai-tools.ts`dagi izohga qarang: "klient
 * uni apiUrl() bilan qo'shadi"). Veb klientda `apiUrl()`/`apiFetchRaw()`
 * buni `${BASE}${path}` qilib qo'shadi, `BASE` esa `/api` bilan tugaydigan
 * to'liq manzil (`apps/web/src/lib/api.ts`). `BOT_API_BASE_URL` xuddi shu
 * `BASE` vazifasini o'taydi (standart holatda ham `/api` bilan tugaydi),
 * shuning uchun bu yerda ham KESIB OLINMAYDI — to'g'ridan-to'g'ri
 * qo'shiladi. Aks holda `/api/report` prefiksi (`apps/api/src/app.ts`dagi
 * `app.register(reportRoutes, { prefix: '/api/report' })`) tushib qolib,
 * so'rov 404 bilan tugaydi.
 */
import { InputFile } from 'grammy';
import type { Api } from 'grammy';

function fileNameFrom(header: string | null, fallback: string): string {
  if (!header) return fallback;

  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (utf8?.[1]) {
    try {
      return decodeURIComponent(utf8[1]);
    } catch {
      /* buzuq kodlash — oddiy nomga tushamiz */
    }
  }

  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain?.[1] ?? fallback;
}

/** Fayl olinib, xabar sifatida yuborilsa `true` qaytaradi — chaqiruvchi shunga qarab xabar ko'rsatadi. */
export async function sendReportFile(
  api: Api, chatId: number, apiBaseUrl: string, url: string,
): Promise<boolean> {
  try {
    const res = await fetch(`${apiBaseUrl}${url}`);
    if (!res.ok) return false;

    const buf = Buffer.from(await res.arrayBuffer());
    const name = fileNameFrom(res.headers.get('content-disposition'), 'hisobot.xlsx');
    await api.sendDocument(chatId, new InputFile(buf, name));
    return true;
  } catch {
    // Tarmoq xatosi — chaqiruvchi foydalanuvchiga qisqa xabar yozadi.
    return false;
  }
}

/**
 * `show_chart` asbobi qaytargan PNG'ni olib, Telegramga RASM sifatida (hujjat
 * emas) yuboradi — `sendReportFile` bilan bir xil manzil qurish/fetch/xato
 * naqshi, faqat `sendDocument` o'rniga `sendPhoto` chaqiriladi, shunda chat
 * ichida diagramma to'g'ridan-to'g'ri ko'rinadi. Rasmlar uchun foydalanuvchiga
 * ko'rinadigan haqiqiy fayl nomi shart emas — shuning uchun `fileNameFrom` ham
 * chaqirilmaydi, doim 'chart.png'.
 */
export async function sendChartPhoto(
  api: Api, chatId: number, apiBaseUrl: string, url: string,
): Promise<boolean> {
  try {
    const res = await fetch(`${apiBaseUrl}${url}`);
    if (!res.ok) return false;

    const buf = Buffer.from(await res.arrayBuffer());
    await api.sendPhoto(chatId, new InputFile(buf, 'chart.png'));
    return true;
  } catch {
    // Tarmoq xatosi — chaqiruvchi foydalanuvchiga qisqa xabar yozadi.
    return false;
  }
}

/**
 * `sendChartPhoto` bilan bir xil, lekin PNG baytlari chaqiruvchida
 * ALLAQACHON tayyor bo'lganda (fetch shart emas) — masalan 'chart'
 * action'ining payload.url'i 'data:image/png;base64,...' inline rasm
 * bo'lsa ('render_table'/'render_custom_chart' asboblari qaytargan,
 * ai-tools.ts'ga qarang). Baytlar base64'dan `index.ts`da dekodlanadi,
 * bu funksiya faqat yuboradi.
 */
export async function sendChartBuffer(
  api: Api, chatId: number, buf: Buffer,
): Promise<boolean> {
  try {
    await api.sendPhoto(chatId, new InputFile(buf, 'chart.png'));
    return true;
  } catch {
    // Tarmoq xatosi — chaqiruvchi foydalanuvchiga qisqa xabar yozadi.
    return false;
  }
}
