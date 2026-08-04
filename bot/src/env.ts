/**
 * Bot uchun muhit sozlamalari.
 *
 * `apps/api/src/config.ts` dagi `loadEnvFile()` bilan BIR XIL naqsh, lekin
 * QAYTA YOZILGAN — import qilinmagan. Bot mustaqil `npm` ish maydoni
 * (`@beap/bot`): alohida jarayon, alohida deploy, `apps/api/src` dan HECH
 * NARSA import qilmasligi kerak. `dotenv` qo'shishning hojati yo'q — bizga
 * faqat KEY=VALUE kerak.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const BOT_ROOT = resolve(here, '..');
const REPO_ROOT = resolve(BOT_ROOT, '..');

function loadEnvFile(path: string): void {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile(resolve(REPO_ROOT, '.env'));
loadEnvFile(resolve(REPO_ROOT, '.env.example')); // zaxira — dev uchun

export const env = {
  /** Bo'sh bo'lsa bot butunlay o'chgan holatda qoladi — `index.ts` shu yerda tekshiradi. */
  botToken: (process.env['TELEGRAM_BOT_TOKEN'] ?? '').trim(),
  /**
   * `apps/api`ning `/api` prefiksigacha bo'lgan to'liq manzili — veb
   * klientidagi `resolveBase()` natijasiga mos (`apps/web/src/lib/api.ts`).
   * Oxiridagi `/` lar kesib olinadi, shunda yo'l qo'shilganda ikkitalab
   * qolmaydi.
   */
  apiBaseUrl: (process.env['BOT_API_BASE_URL'] ?? 'http://127.0.0.1:3001/api').replace(/\/+$/, ''),
};
