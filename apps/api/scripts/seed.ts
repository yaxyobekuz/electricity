/**
 * Demo ma'lumot yuklagichi.
 *
 *   npm run seed                  -- 24 oy
 *   npm run seed -- --months 12   -- 12 oy
 *   npm run seed -- --readings 6  -- TP kunlik ko'rsatkichlari 6 oy uchun
 */
import pg from 'pg';

import { config } from '../src/config.ts';
import { generateSeed } from '../seed/generate.ts';

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = Number.parseInt(process.argv[i + 1] ?? '', 10);
  return Number.isFinite(v) ? v : fallback;
}

async function main(): Promise<void> {
  const months = arg('months', 24);
  const readingMonths = Math.min(arg('readings', 3), months);

  const pool = new pg.Pool({ ...config.db, max: 2 });
  const client = await pool.connect();
  const t0 = Date.now();

  try {
    process.stdout.write(`→ ${config.db.database} bazasiga demo ma'lumot yuklanmoqda…\n\n`);

    await client.query('BEGIN');
    // Seed tizim nomidan yozadi - RLS va audit uchun.
    await client.query("SET LOCAL app.role = 'system'");

    const result = await generateSeed(client, {
      months,
      readingMonths,
      log: (msg) => process.stdout.write(`  · ${msg}\n`),
    });

    await client.query('COMMIT');

    process.stdout.write('\n  · Agregatlar yangilanmoqda…\n');
    // Birinchi to'ldirishda CONCURRENTLY ishlamaydi (matview bo'sh).
    await client.query('SELECT agg.refresh_all(false)');

    const ms = Date.now() - t0;
    process.stdout.write(`\n✓ Tayyor - ${(ms / 1000).toFixed(1)} s\n\n`);

    process.stdout.write(`  MFY lar:          ${result.mfyCount}\n`);
    process.stdout.write(`  Transformatorlar: ${result.tpCount}\n`);
    process.stdout.write(`  Davr:             ${result.months[0]} … ${result.months.at(-1)}\n\n`);

    process.stdout.write('  Qatorlar:\n');
    for (const [table, count] of Object.entries(result.rowCounts)) {
      process.stdout.write(`    ${table.padEnd(32)} ${String(count).padStart(8)}\n`);
    }

    if (result.warnings.length > 0) {
      process.stdout.write('\n  ⚠ Manba hujjatlaridagi nomuvofiqliklar:\n');
      for (const w of result.warnings) process.stdout.write(`    • ${w}\n`);
    }

    if (result.integrityDemo) {
      process.stdout.write('\n  Ma\'lumot yaxlitligi namoyishi (Go‘ravon):\n');
      process.stdout.write(`    ${result.integrityDemo}\n`);
    }

    process.stdout.write('\n  Kirish ma\'lumotlari (barcha foydalanuvchilar uchun parol: Beap2026!):\n');
    process.stdout.write('    admin              - Administrator\n');
    process.stdout.write('    hokim              - Hokimiyat kuzatuvchisi\n');
    process.stdout.write('    manager.baliqchi   - Elektroset menejeri\n');
    process.stdout.write('    operator1          - MFY operatori\n\n');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`\n✗ Seed xatosi:\n${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exitCode = 1;
});
