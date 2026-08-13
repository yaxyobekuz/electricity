/**
 * REGISTRNI MANBAGA MOSLASH - fiderga tegishli bo'lmagan TP larni o'chiradi.
 *
 * SABAB: registrga xatolik bilan 4 ta ortiqcha TP qo'shilgan edi (TP-043,
 * TP-325, TP-354, TP-166А). Ular fiderga ulanmagan, lekin o'lchovlari
 * yig'indiga qo'shilib, iyul hisobotini buzib turardi: foydali oqim
 * 59 681 kWh ga oshiq, abonentlar 410 taga ko'p chiqardi.
 *
 *   node --experimental-strip-types apps/api/scripts/prune-extra-tps.ts [--dry]
 *
 * O'CHIRILADIGAN RO'YXAT QAT'IY YOZILMAGAN. Skript manba fayldagi TP
 * to'plamini o'qiydi va registrda BOR, lekin manbada YO'Q qatorlarni topadi.
 * Shunda kelasi safar manba o'zgarsa, ro'yxatni qo'lda yangilash kerak
 * bo'lmaydi va "qaysi 4 tasi edi" degan savol tug'ilmaydi.
 *
 * FK TARTIBI MUHIM. `ref.tp` ga to'rtta jadval ON DELETE siz bog'langan
 * (ya'ni RESTRICT) - ular oldin tozalanmasa, `DELETE FROM ref.tp` XATO
 * beradi:
 *
 *   fact.work              → RESTRICT   (oldin o'chiriladi)
 *   fact.tp_status_monthly → RESTRICT   (oldin o'chiriladi)
 *   fact.tp_reading_daily  → RESTRICT   (oldin o'chiriladi)
 *   fact.violation_act     → RESTRICT   (tp_id NULL ga o'tkaziladi - dalolatnoma
 *                                        TP siz ham o'z-o'zicha to'liq hujjat)
 *   fact.tp_monthly        → CASCADE    (o'z-o'zidan ketadi)
 *   fact.tp_loss_daily     → CASCADE    (o'z-o'zidan ketadi)
 *
 * IDEMPOTENT: registr allaqachon manbaga mos bo'lsa, hech nima qilmaydi.
 */
import { join } from 'node:path';

import ExcelJS from 'exceljs';
import pg from 'pg';

import { config, REPO_ROOT } from '../src/config.ts';
import { tpMatchKey } from './chinobod-common.ts';

const FEEDER_CODE = 'FIDER-XAQULOBOD';
/** Amaldagi TP ro'yxatining manbasi - eng yangi hisobot. */
const SOURCE_FILE = join(REPO_ROOT, 'xaqulobod_fider_12kunlik.xlsx');
const SOURCE_SHEET = 'Sheet0 (2)';
const COL_CODE = 2;
/** Ma'lumot 5-qatordan boshlanadi (1-4 sarlavhalar), oxirgi qator «Жами». */
const FIRST_ROW = 5;

const text = (x: ExcelJS.CellValue): string => {
  if (x === null || x === undefined) return '';
  if (typeof x === 'object') {
    const o = x as { result?: unknown; text?: string };
    if (o.result !== undefined) return String(o.result);
    return o.text ?? '';
  }
  return String(x);
};

async function readSourceKeys(): Promise<Set<string>> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(SOURCE_FILE);
  const ws = wb.getWorksheet(SOURCE_SHEET);
  if (!ws) throw new Error(`«${SOURCE_SHEET}» varag'i topilmadi: ${SOURCE_FILE}`);

  const keys = new Set<string>();
  for (let r = FIRST_ROW; r <= ws.rowCount; r += 1) {
    const raw = text(ws.getRow(r).getCell(COL_CODE).value).trim();
    // «Жами» yig'indi qatori - unda raqam yo'q.
    if (raw === '' || !/\d/.test(raw)) continue;
    keys.add(tpMatchKey(raw));
  }
  if (keys.size === 0) throw new Error('Manba faylda bironta TP topilmadi');
  return keys;
}

async function main(): Promise<void> {
  const dry = process.argv.includes('--dry');
  const sourceKeys = await readSourceKeys();

  const pool = new pg.Pool({ ...config.db, max: 2 });
  const c = await pool.connect();

  try {
    const mfy = await c.query<{ id: number }>(
      `SELECT id FROM ref.mfy WHERE code = $1`, [FEEDER_CODE],
    );
    const mfyId = mfy.rows[0]?.id;
    if (!mfyId) throw new Error(`Fider (${FEEDER_CODE}) registrda topilmadi`);

    const reg = await c.query<{ id: number; code: string }>(
      `SELECT id, code FROM ref.tp WHERE mfy_id = $1 ORDER BY code`, [mfyId],
    );

    const extra = reg.rows.filter((t) => !sourceKeys.has(tpMatchKey(t.code)));
    const missing = [...sourceKeys].filter(
      (k) => !reg.rows.some((t) => tpMatchKey(t.code) === k),
    );

    console.log(`Manbada ${sourceKeys.size} ta TP · registrda ${reg.rows.length} ta`);
    if (missing.length > 0) {
      throw new Error(
        `Manbada bor, registrda YO'Q: ${missing.join(', ')}.`
        + ' Registrga qo\'shilmaguncha tozalash xavfli - to\'xtatildi.',
      );
    }
    if (extra.length === 0) {
      console.log('✓ Registr manbaga mos - o‘chiriladigan TP yo‘q.');
      return;
    }

    const ids = extra.map((t) => t.id);
    console.log(`\nRegistrda ORTIQCHA ${extra.length} ta TP:`);
    for (const t of extra) {
      const dep = await c.query<{ ld: number; tm: number; ts: number; w: number; va: number }>(
        `SELECT (SELECT count(*) FROM fact.tp_loss_daily     WHERE tp_id = $1) ld,
                (SELECT count(*) FROM fact.tp_monthly        WHERE tp_id = $1) tm,
                (SELECT count(*) FROM fact.tp_status_monthly WHERE tp_id = $1) ts,
                (SELECT count(*) FROM fact.work              WHERE tp_id = $1) w,
                (SELECT count(*) FROM fact.violation_act     WHERE tp_id = $1) va`,
        [t.id],
      );
      const d = dep.rows[0]!;
      console.log(
        `  ${t.code}  ·  kunlik yo‘qotish ${d.ld}, oylik ${d.tm}, holat ${d.ts},`
        + ` ish ${d.w}, dalolatnoma ${d.va}`,
      );
    }

    if (dry) {
      console.log('\n--dry: hech nima o‘chirilmadi.');
      return;
    }

    await c.query('BEGIN');
    // Tartib: RESTRICT li bog'lanishlar oldin.
    const w = await c.query(`DELETE FROM fact.work WHERE tp_id = ANY($1)`, [ids]);
    const ts = await c.query(`DELETE FROM fact.tp_status_monthly WHERE tp_id = ANY($1)`, [ids]);
    const tr = await c.query(`DELETE FROM fact.tp_reading_daily WHERE tp_id = ANY($1)`, [ids]);
    /*
     * Dalolatnoma O'CHIRILMAYDI - u mustaqil hujjat va TP siz ham to'liq.
     * Faqat bog'lanish uziladi.
     */
    const va = await c.query(
      `UPDATE fact.violation_act SET tp_id = NULL WHERE tp_id = ANY($1)`, [ids],
    );
    const tp = await c.query(`DELETE FROM ref.tp WHERE id = ANY($1)`, [ids]);
    await c.query('COMMIT');

    console.log(
      `\nO‘chirildi: ${tp.rowCount} ta TP`
      + ` · ish ${w.rowCount} · holat ${ts.rowCount} · kunlik ko‘rsatkich ${tr.rowCount}`
      + ` · dalolatnoma bog‘lanishi uzildi ${va.rowCount}`
      + '\n  (tp_monthly va tp_loss_daily kaskad bilan ketdi)',
    );

    console.log('Agregatlar yangilanmoqda…');
    await c.query('SELECT agg.refresh_all(false)');

    const left = await c.query<{ n: number }>(
      `SELECT count(*)::int n FROM ref.tp WHERE mfy_id = $1 AND decommissioned_on IS NULL`,
      [mfyId],
    );
    console.log(`✓ Registrda ${left.rows[0]!.n} ta amaldagi TP qoldi.`);
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    c.release();
    await pool.end();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`\n✗ ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
