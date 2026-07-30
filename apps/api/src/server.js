/** API serveri — kirish nuqtasi. */
import cron from 'node-cron';
import { buildApp } from './app.ts';
import { assertProductionSecrets, config } from './config.ts';
import { closePool } from './db/pool.ts';
import { refreshAggregates } from './services/aggregates.ts';
async function main() {
    assertProductionSecrets();
    const app = await buildApp();
    // Agregatlarni har 10 daqiqada yangilash (advisory lock ostida).
    const task = cron.schedule('*/10 * * * *', () => {
        void refreshAggregates(app.log);
    }, { timezone: 'Asia/Tashkent' });
    const shutdown = async (signal) => {
        app.log.info({ signal }, 'To‘xtatilmoqda…');
        task.stop();
        await app.close();
        await closePool();
        process.exit(0);
    };
    process.on('SIGINT', () => void shutdown('SIGINT'));
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    await app.listen({ host: config.api.host, port: config.api.port });
    app.log.info(`BEAP API tayyor — http://${config.api.host}:${config.api.port}/api`);
}
main().catch((err) => {
    process.stderr.write(`Server ishga tushmadi: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
    process.exit(1);
});
