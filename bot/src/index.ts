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

import { type ChatAction, type ChatMessage, streamChat } from './chat.ts';
import { sendChartPhoto, sendReportFile } from './download.ts';
import { env } from './env.ts';

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
    'Salom! Men BEAP AI yordamchisiman. Elektr energiya balansi, transformatorlar, '
    + 'ishlar va hisobotlar haqida savol bering.',
  );
});

bot.on('message:text', async (ctx) => {
  const chatId = ctx.chat.id;
  pushHistory(chatId, { role: 'user', content: ctx.message.text });

  const placeholder = await ctx.reply('…');
  let acc = '';
  let lastEditAt = 0;
  let hadError = false;

  const editNow = async (text: string): Promise<void> => {
    const clipped = text.length > MAX_MESSAGE_LEN ? `${text.slice(0, MAX_MESSAGE_LEN)}…` : text;
    try {
      await ctx.api.editMessageText(chatId, placeholder.message_id, clipped);
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
        if (!ok) void ctx.reply('Hisobot faylini yuklab bo‘lmadi.');
      });
      return;
    }

    if (action.type === 'chart') {
      const url = typeof action.payload['url'] === 'string' ? action.payload['url'] : null;
      if (!url) return;

      void sendChartPhoto(ctx.api, chatId, env.apiBaseUrl, url).then((ok) => {
        if (!ok) void ctx.reply('Diagrammani yuborib bo‘lmadi.');
      });
    }
  };

  await streamChat(env.apiBaseUrl, histories.get(chatId) ?? [], {
    onDelta: (text) => {
      acc += text;
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
