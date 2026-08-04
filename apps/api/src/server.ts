/** API serveri — kirish nuqtasi. */
import cron from 'node-cron';

import { buildApp } from './app.ts';
import { assertProductionSecrets, config } from './config.ts';
import { closePool, SYSTEM_CONTEXT } from './db/pool.ts';
import { refreshAggregates } from './services/aggregates.ts';
import * as alerts from './services/alerts.ts';
import * as telegram from './services/telegram.ts';

async function main(): Promise<void> {
  assertProductionSecrets();

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
   * Kunlik ogohlantirish push'i — har kuni soat 08:00 da (Toshkent).
   *
   * `SYSTEM_CONTEXT` ishlatiladi: bu foydalanuvchi so'rovi emas, mustaqil
   * fon vazifasi, hech kim tizimga kirmagan. Natija `alerts.ts` ichidagi
   * keshga yoziladi — `routes/ai.ts` GET `/alerts` shu yerdan o'qiydi.
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

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'To‘xtatilmoqda…');
    task.stop();
    alertsTask.stop();
    await app.close();
    await closePool();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ host: config.api.host, port: config.api.port });
  app.log.info(`BEAP API tayyor — http://${config.api.host}:${config.api.port}/api`);
}

main().catch((err: unknown) => {
  process.stderr.write(`Server ishga tushmadi: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(1);
});
