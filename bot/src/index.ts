/**
 * BEAP Telegram bot — kirish nuqtasi.
 *
 * ALOHIDA JARAYON: `apps/api`/`apps/web` bilan bir xil repoda yashaydi, lekin
 * Postgres'ga to'g'ridan-to'g'ri ulanmaydi va `apps/api/src` dan hech narsa
 * import qilmaydi. Bu — mavjud, ishlab turgan `POST /api/ai/chat` (SSE)
 * oqimining yupqa klienti, xuddi `apps/web/src/lib/ai.ts`dagi
 * `streamAiChat()` brauzer uchun qiladigan ishni Telegram uchun qiladi
 * (`chat.ts`). Bitta "miya" (OpenAI + asboblar, `apps/api/src/services/ai.ts`)
 * ikkala kanalga — veb va Telegram — xizmat qiladi.
 *
 * UZUN SO'ROV (long polling): `bot.start()` faqat TASHQARIGA ulanadi (Telegram
 * serverlariga), hech qanday port tinglamaydi — tizimning "faqat chiquvchi
 * so'rov" tarmoq modeliga mos (`apps/api/src/services/ai.ts`dagi OpenAI
 * chaqiruvi kabi, `config.ts` da izohlangan).
 */
import { Bot } from 'grammy';
import type { Context } from 'grammy';

import { type ChatAction, type ChatMessage, streamChat } from './chat.ts';
import { sendChartBuffer, sendChartPhoto, sendReportFile } from './download.ts';
import { env } from './env.ts';
import { toTelegramHtml } from './format.ts';

// `OPENAI_API_KEY` bo'shligida `aiEnabled()` qanday o'chsa (`services/ai.ts`),
// bot ham token yo'qligida shunday — xatosiz, `exit(0)` bilan.
if (!env.botToken) {
  console.log(
    'Telegram bot o‘chirilgan: TELEGRAM_BOT_TOKEN berilmagan (.env faylini tekshiring).',
  );
  process.exit(0);
}

const HISTORY_LIMIT = 24; // apps/api/src/routes/ai.ts dagi zod sxemasi bilan bir xil chegara
const EDIT_DEBOUNCE_MS = 800;
// Telegram xabar chegarasi 4096 — ozgina zaxira bilan kesamiz.
const MAX_MESSAGE_LEN = 4000;
// CONTRACT 2: 'chart' action'ining payload.url'i shu prefiks bilan boshlansa,
// bu API-nisbiy yo'l emas — inline PNG (base64), HTTP fetch shart emas.
const DATA_URI_PNG_PREFIX = 'data:image/png;base64,';

/** Har bir Telegram chat uchun suhbat tarixi — jarayon xotirasida, DB YO'Q. */
const histories = new Map<number, ChatMessage[]>();

function pushHistory(chatId: number, message: ChatMessage): void {
  const list = histories.get(chatId) ?? [];
  list.push(message);
  histories.set(chatId, list.slice(-HISTORY_LIMIT));
}

const bot = new Bot(env.botToken);

// Bitta yomon yangilanish butun botni yiqitmasin — grammy shu funksiyaga yo'naltiradi.
bot.catch((err) => {
  console.error('Bot xatosi:', err.error instanceof Error ? err.error.message : err.error);
});

bot.command('start', async (ctx) => {
  await ctx.reply(
    toTelegramHtml(
      'Salom! Men BEAP AI yordamchisiman. Elektr energiya balansi, transformatorlar, '
      + 'ishlar va hisobotlar haqida savol bering.',
    ),
    { parse_mode: 'HTML' },
  );
});

/**
 * Matn (yozilgan yoki ovozdan transkripsiya qilingan) uchun to'liq javob
 * oqimi: tarixga qo'shish → "…" bilan joy egallovchi xabar → `streamChat` →
 * bo'lak-bo'lak tahrirlash → yakuniy javobni tarixga qo'shish.
 *
 * `bot.on('message:text', ...)` va `bot.on('message:voice', ...)` (pastda)
 * shu funksiyani chaqiradi — mantiq bitta joyda, ikki kirish nuqtasi.
 */
async function respondToText(ctx: Context, chatId: number, text: string): Promise<void> {
  pushHistory(chatId, { role: 'user', content: text });

  const placeholder = await ctx.reply('…');
  let acc = '';
  let lastEditAt = 0;
  let hadError = false;

  const editNow = async (body: string): Promise<void> => {
    const clipped = body.length > MAX_MESSAGE_LEN ? `${body.slice(0, MAX_MESSAGE_LEN)}…` : body;
    try {
      await ctx.api.editMessageText(
        chatId, placeholder.message_id, toTelegramHtml(clipped), { parse_mode: 'HTML' },
      );
    } catch {
      // "message is not modified" yoki tarmoq xatosi — oqimni to'xtatmaymiz,
      // keyingi bo'lak yoki yakuniy tahrir baribir yetib boradi.
    }
  };

  const handleAction = (action: ChatAction): void => {
    // navigate/set_period/set_as_of_date — brauzersiz ma'nosiz, e'tiborsiz qoldiriladi.
    if (action.type === 'download') {
      const url = typeof action.payload['url'] === 'string' ? action.payload['url'] : null;
      if (!url) return;

      void sendReportFile(ctx.api, chatId, env.apiBaseUrl, url).then((ok) => {
        if (!ok) void ctx.reply('Hisobot faylini yuklab bo‘lmadi.', { parse_mode: 'HTML' });
      });
      return;
    }

    if (action.type === 'chart') {
      const url = typeof action.payload['url'] === 'string' ? action.payload['url'] : null;
      if (!url) return;

      // CONTRACT 2: payload.url endi yoki API-nisbiy yo'l (4 ta doimiy
      // diagramma turi — ilgarigidek `sendChartPhoto` bilan fetch qilinadi),
      // yoki inline 'data:image/png;base64,...' rasm ('render_table'/
      // 'render_custom_chart' asboblari qaytargan) — bu holda HTTP so'rov
      // shart emas, baytlar to'g'ridan-to'g'ri shu yerda dekodlanadi.
      if (url.startsWith(DATA_URI_PNG_PREFIX)) {
        const buf = Buffer.from(url.slice(DATA_URI_PNG_PREFIX.length), 'base64');
        void sendChartBuffer(ctx.api, chatId, buf).then((ok) => {
          if (!ok) void ctx.reply('Diagrammani yuborib bo‘lmadi.', { parse_mode: 'HTML' });
        });
        return;
      }

      void sendChartPhoto(ctx.api, chatId, env.apiBaseUrl, url).then((ok) => {
        if (!ok) void ctx.reply('Diagrammani yuborib bo‘lmadi.', { parse_mode: 'HTML' });
      });
    }
  };

  await streamChat(env.apiBaseUrl, histories.get(chatId) ?? [], {
    onDelta: (delta) => {
      acc += delta;
      const now = Date.now();
      if (now - lastEditAt >= EDIT_DEBOUNCE_MS) {
        lastEditAt = now;
        void editNow(acc);
      }
    },
    onAction: handleAction,
    onError: (message) => {
      hadError = true;
      void editNow(`Xatolik: ${message}`);
    },
  });

  if (hadError) return;

  await editNow(acc || 'Javob bo‘sh keldi.');
  pushHistory(chatId, { role: 'assistant', content: acc });
}

bot.on('message:text', async (ctx) => {
  await respondToText(ctx, ctx.chat.id, ctx.message.text);
});

/**
 * Ovozli xabar (Telegram voice note, ogg/opus): avval Telegram fayl serveridan
 * baytlar yuklab olinadi, so'ng `POST /api/ai/transcribe`ga multipart/form-data
 * bilan yuboriladi (CONTRACT 1, `apps/api/src/services/telegram.ts`dagi
 * `sendDocument` bilan bir xil FormData/Blob naqshi). Transkripsiya
 * muvaffaqiyatli bo'lsa, foydalanuvchi nima eshitilganini ko'radi (xato
 * eshitilgan bo'lsa shu yerda payqaydi), so'ng xuddi yozib yuborgandek
 * `respondToText` davom etadi.
 */
bot.on('message:voice', async (ctx) => {
  const chatId = ctx.chat.id;
  const placeholder = await ctx.reply('🎤 tinglanmoqda…');

  let transcribed: string;
  try {
    const file = await ctx.getFile();
    if (!file.file_path) throw new Error('file_path yo‘q');

    const fileRes = await fetch(
      `https://api.telegram.org/file/bot${env.botToken}/${file.file_path}`,
    );
    if (!fileRes.ok) throw new Error(`Faylni yuklab bo‘lmadi (${fileRes.status})`);
    const audioBuf = Buffer.from(await fileRes.arrayBuffer());

    const form = new FormData();
    form.append('audio', new Blob([audioBuf]), 'voice.ogg');

    const res = await fetch(`${env.apiBaseUrl}/ai/transcribe`, { method: 'POST', body: form });
    if (!res.ok) throw new Error(`So‘rov xatosi (${res.status})`);

    const body = (await res.json()) as { text?: string };
    if (!body.text) throw new Error('Bo‘sh natija');
    transcribed = body.text;
  } catch {
    try {
      await ctx.api.editMessageText(chatId, placeholder.message_id, 'Ovozli xabarni tushunib bo‘lmadi.');
    } catch {
      // Tahrirlab bo'lmasa ham indamaymiz — foydalanuvchi joy egallovchini ko'radi.
    }
    return;
  }

  try {
    await ctx.api.editMessageText(
      chatId, placeholder.message_id, toTelegramHtml(`🎤 "${transcribed}"`), { parse_mode: 'HTML' },
    );
  } catch {
    // "message is not modified" yoki tarmoq xatosi — javob baribir davom etadi.
  }

  await respondToText(ctx, chatId, transcribed);
});

const shutdown = async (signal: string): Promise<void> => {
  console.log(`Bot to‘xtatilmoqda… (${signal})`);
  await bot.stop();
  process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

console.log('BEAP Telegram bot ishga tushmoqda (long polling)…');
bot.start({
  onStart: (info) => console.log(`Bot tayyor: @${info.username}`),
}).catch((err: unknown) => {
  console.error('Bot ishga tushmadi:', err instanceof Error ? err.message : err);
  process.exit(1);
});
