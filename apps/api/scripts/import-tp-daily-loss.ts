/**
 * TP kunlik chiziqli yo'qotish hisobotini yuklash (elektroset yuboradigan xlsx).
 *
 *   node --experimental-strip-types apps/api/scripts/import-tp-daily-loss.ts <fayl.xlsx>
 *   yoki: npm run import:tp-loss --workspace @beap/api -- <fayl.xlsx>
 *
 * Hech narsani TRUNCATE qilmaydi (farqli `load-feeder-data.ts`dan) - bu
 * qo'shimcha ma'lumot, almashtirish emas. Qayta ishga tushirsa natija bir xil
 * (idempotent, `fact.tp_loss_daily`ning `(tp_id, biz_date)` UPSERT'i orqali).
 */
import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

import { closePool, query, SYSTEM_CONTEXT } from '../src/db/pool.ts';
import { upsertTpLossDaily } from '../src/db/queries/tpLoss.ts';
import { parseTpLossWorkbook } from '../src/services/tpLossImport.ts';

async function main(): Promise<void> {
  const filePath = process.argv[2];
  if (!filePath) {
    throw new Error('Foydalanish: import-tp-daily-loss.ts <fayl.xlsx>');
  }

  const buf = await readFile(resolve(filePath));
  const { rows, warnings } = await parseTpLossWorkbook(buf);
  const tpCodes = [...new Set(rows.map((r) => r.tpCode))];

  process.stdout.write(
    `O'qildi: ${rows.length} qator (${tpCodes.length} ta TP), ${warnings.length} ogohlantirish\n`,
  );
  for (const w of warnings) process.stdout.write(`  ⚠ qator ${w.rowNo}: ${w.message}\n`);

  const found = await query<{ id: number; code: string }>(
    'SELECT id, code FROM ref.tp WHERE code = ANY($1)', [tpCodes], SYSTEM_CONTEXT,
  );
  const byCode = new Map(found.map((r) => [r.code, r.id]));

  const unresolved = tpCodes.filter((c) => !byCode.has(c));
  const resolvedRows = rows.filter((r) => byCode.has(r.tpCode));
  const fileName = basename(filePath);

  const { inserted, updated } = await upsertTpLossDaily(
    SYSTEM_CONTEXT,
    resolvedRows.map((r) => ({
      tpId: byCode.get(r.tpCode)!,
      bizDate: r.bizDate,
      kwhBalanceMeter: r.kwhBalanceMeter,
      kwhConsumersAttached: r.kwhConsumersAttached,
      inspectionNote: r.inspectionNote,
      source: 'EXCEL' as const,
      fileName,
    })),
  );

  process.stdout.write(`\nYozildi: ${inserted} yangi, ${updated} yangilangan.\n`);
  if (unresolved.length > 0) {
    process.stdout.write(`Topilmagan TP kodlari (ref.tp da yo'q): ${unresolved.join(', ')}\n`);
  }
}

main()
  .catch((err: unknown) => {
    process.stderr.write(
      `\n✗ Import xatosi:\n${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
    );
    process.exitCode = 1;
  })
  .finally(() => closePool());
