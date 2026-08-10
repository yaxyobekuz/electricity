/** API serveri - kirish nuqtasi. */
import cron from 'node-cron';

import { buildApp } from './app.ts';
import { config } from './config.ts';
import { closePool, SYSTEM_CONTEXT } from './db/pool.ts';
import { refreshAggregates } from './services/aggregates.ts';
import * as alerts from './services/alerts.ts';
import * as narrative from './services/narrative.ts';
import * as telegram from './services/telegram.ts';

async function main(): Promise<void> {
  const app = await buildApp();

  // Agregatlarni har 10 daqiqada yangilash (advisory lock ostida).
  const task = cron.schedule(
    '*/10 * * * *',
    () => {
      void refreshAggregates(app.log);
    },
    { timezone: 'Asia/Tashkent' },
  );

  /*
   * Kunlik ogohlantirish push'i - har kuni soat 08:00 da (Toshkent).
   *
   * `SYSTEM_CONTEXT` ishlatiladi: bu foydalanuvchi so'rovi emas, mustaqil
   * fon vazifasi, hech kim tizimga kirmagan. Natija `alerts.ts` ichidagi
   * keshga yoziladi - `routes/ai.ts` GET `/alerts` shu yerdan o'qiydi.
   * Xato yiqilib ketishi mumkin emas: bitta buzuq hisob-kitob butun cron
   * rejalashtiruvchini to'xtatib qo'ymasligi kerak.
   */
  const alertsTask = cron.schedule(
    '0 8 * * *',
    () => {
      void (async () => {
        try {
          const digest = await alerts.computeAlerts(SYSTEM_CONTEXT, null);
          alerts.setCachedDigest(digest);

          const draftedCount = await alerts.autoDraftHighSeverityTpLossWorks(SYSTEM_CONTEXT);
          if (draftedCount > 0) {
            app.log.info(
              { draftedCount }, 'TP yo\'qotish anomaliyasi uchun avtomatik reja yaratildi',
            );
          }

          if (config.telegram.botToken && config.telegram.alertChatId) {
            await telegram.sendMessage(
              config.telegram.botToken, config.telegram.alertChatId, digest.summaryText,
            );
          }
        } catch (err) {
          app.log.error({ err }, 'Kunlik ogohlantirish push\'i muvaffaqiyatsiz tugadi');
        }
      })();
    },
    { timezone: 'Asia/Tashkent' },
  );

  /*
   * Haftalik AI tahliliy xulosa push'i - har Dushanba soat 08:30 da
   * (Toshkent), kunlik ogohlantirish push'idan keyin, hokim ularni ketma-ket
   * o'qisin deb. Xato yiqilib ketishi mumkin emas - sabab yuqoridagi bilan
   * bir xil (bitta buzuq hisob-kitob butun cron rejalashtiruvchini
   * to'xtatib qo'ymasligi kerak).
   */
  const weeklyNarrativeTask = cron.schedule(
    '30 8 * * 1',
    () => {
      void (async () => {
        try {
          const text = await narrative.generateNarrative(SYSTEM_CONTEXT, null, 'weekly');

          if (config.telegram.botToken && config.telegram.alertChatId) {
            await telegram.sendMessage(config.telegram.botToken, config.telegram.alertChatId, text);
          }
        } catch (err) {
          app.log.error({ err }, 'Haftalik tahliliy xulosa push\'i muvaffaqiyatsiz tugadi');
        }
      })();
    },
    { timezone: 'Asia/Tashkent' },
  );

  /*
   * Oylik AI tahliliy xulosa push'i - har oyning 1-kuni soat 09:00 da
   * (Toshkent). Mantiq yuqoridagi haftalik bilan bir xil, faqat `kind`
   * 'monthly'.
   */
  const monthlyNarrativeTask = cron.schedule(
    '0 9 1 * *',
    () => {
      void (async () => {
        try {
          const text = await narrative.generateNarrative(SYSTEM_CONTEXT, null, 'monthly');

          if (config.telegram.botToken && config.telegram.alertChatId) {
            await telegram.sendMessage(config.telegram.botToken, config.telegram.alertChatId, text);
          }
        } catch (err) {
          app.log.error({ err }, 'Oylik tahliliy xulosa push\'i muvaffaqiyatsiz tugadi');
        }
      })();
    },
    { timezone: 'Asia/Tashkent' },
  );

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'To‘xtatilmoqda…');
    task.stop();
    alertsTask.stop();
    weeklyNarrativeTask.stop();
    monthlyNarrativeTask.stop();
    await app.close();
    await closePool();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ host: config.api.host, port: config.api.port });
  app.log.info(`BEAP API tayyor - http://${config.api.host}:${config.api.port}/api`);
}

main().catch((err: unknown) => {
  process.stderr.write(`Server ishga tushmadi: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(1);
});
