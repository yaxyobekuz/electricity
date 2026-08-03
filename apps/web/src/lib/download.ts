/**
 * Faylni DASTURIY ravishda yuklab olish.
 *
 * Panelning eski tugmalari `window.location.href` bilan ishlaydi — bu oddiy
 * havola bosish bilan bir xil va odatiy holatda yetarli. AI agent uchun esa
 * yaramaydi: sahifadan chiqib ketiladi, SPA qayta yuklanadi va chat oynasi
 * yopiladi. Shu sababli fayl `fetch` bilan olinadi va yashirin havola orqali
 * saqlanadi — sahifa joyida qoladi.
 *
 * Naqsh `components/ui/AuthImage.tsx` dan: blob → object URL → tozalash.
 */
import { apiFetchRaw } from './api.ts';

/** `Content-Disposition` dan fayl nomini ajratadi. */
function fileNameFrom(header: string | null, fallback: string): string {
  if (!header) return fallback;

  // RFC 5987: `filename*=UTF-8''...` — kirill/lotin nomlar shu yerda.
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

/**
 * API dan faylni olib, foydalanuvchining kompyuteriga saqlaydi.
 *
 * @param path  API yo'li, masalan `/report/period/monthly.xlsx?period=2026-07`
 * @returns saqlangan fayl nomi — chatda "shu fayl yuklandi" deb ko'rsatish uchun
 */
export async function downloadFile(path: string, fallbackName = 'hisobot'): Promise<string> {
  const res = await apiFetchRaw(path);
  const name = fileNameFrom(res.headers.get('Content-Disposition'), fallbackName);
  const blob = await res.blob();

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();

  /*
   * Darhol bo'shatib bo'lmaydi: ba'zi brauzerlar `click()` dan keyin
   * blobni asinxron o'qiydi. Bir soniya kutish yetarli va xotira ham
   * bo'sh qolmaydi.
   */
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  return name;
}
