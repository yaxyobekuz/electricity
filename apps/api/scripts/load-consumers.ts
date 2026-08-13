/**
 * XAQULOBOD FIDERI - iste'molchilar kesimi (iyul va avgust 2026).
 *
 * MANBA: `xaqulobod_itemolchilar.xlsx`, birinchi varaq. Har bir qator - bitta
 * TP, ustunlar:
 *
 *   3  TP nomer          10, 20, …, 122A, 166А
 *   5  Jami              biriktirilgan iste'molchilar soni
 *   6  Aloqada Iyul      hisoblagichi aloqaga chiqayotganlar
 *   7  Aloqadamas Iyul   aloqaga chiqmayotganlar
 *   8  Aloqada Avgust
 *   9  Aloqadamas Avgust
 *
 * «Jami» ikkala oy uchun ham BIR XIL: fayl abonentlar bazasining hozirgi
 * holatini beradi, oylar esa faqat ALOQA holatida farq qiladi.
 *
 * NIMA YOZADI:
 *   • `fact.tp_monthly`         - har bir TP × oy (47 × 2 = 94 qator)
 *   • `fact.mfy_monthly_return` - fider bo'yicha UMUMIY yig'indi (2 qator)
 *
 * Ikkinchisi kerak, chunki dashboard KPI raqamlari `agg.mfy_monthly` orqali
 * aynan shu jadvaldan oziqlanadi, TP kesimidan emas. Jami iste'molchilar
 * o'sha yerda AHOLI va YURIDIK bo'laklariga ajratiladi - ajratma manba
 * faylda yo'q, u `LEGAL_CONSUMERS` konstantasida turadi.
 *
 * NIMAGA TEGMAYDI: `tp_monthly` dagi hisoblagich ustunlari (meter_no, coef,
 * reading_prev/curr, kwh_month) va `mfy_monthly_return` dagi qarzdorlik va
 * hisoblagich ustunlari. Ular boshqa hisobotlardan keladi - qayta ishga
 * tushirilganda ustidan nol yozilmasin.
 *
 *   node --experimental-strip-types apps/api/scripts/load-consumers.ts [--dry] [fayl.xlsx]
 *
 * Idempotent: qayta yurgizilsa natija bir xil.
 */
import { join } from 'node:path';

import ExcelJS from 'exceljs';
import pg from 'pg';

import { config, REPO_ROOT } from '../src/config.ts';

const PERIODS = [
  { period: '2026-07', label: 'iyul' },
  { period: '2026-08', label: 'avgust' },
] as const;

/** Eski fayl («xaqulobod_itemolchilar.xlsx») - IYUL aloqa holati shu yerdan. */
const COL_CODE = 3;
const COL_TOTAL = 5;
const COL_JULY_ACTIVE = 6;
const COL_JULY_OFFLINE = 7;

/** Yangi fayl - TP ro'yxati, jami abonent va AVGUST aloqa holati. */
const NEW_FILE = join(REPO_ROOT, 'xaqulobod_fider_12kunlik.xlsx');
const NEW_SHEET = 'Sheet0 (2)';
const NEW_FIRST_ROW = 5;
const NEW_COL_CODE = 2;
const NEW_COL_TOTAL = 9;
const NEW_COL_ACTIVE = 10;
const NEW_COL_OFFLINE = 11;

const FEEDER_CODE = 'FIDER-XAQULOBOD';

/*
 * YURIDIK iste'molchilar (abonentlar) soni.
 *
 * Manba faylda aholi/yuridik ajratmasi YO'Q - u faqat TP bo'yicha JAMI
 * beradi. Bu son fider bo'yicha alohida aytilgan va butun fiderga tegishli,
 * TP kesimida taqsimlanmagan.
 *
 * MUHIM: bu son jamining ICHIDA, ustiga qo'shilmaydi. Ya'ni
 * `aholi = jami − yuridik`. Aks holda `consumers_total` (GENERATED ustun:
 * aholi + yuridik) TP kesimi yig'indisidan katta chiqib, ikki jadval
 * bir-biriga zid bo'lib qolardi.
 */
const LEGAL_CONSUMERS = 69;

const DEFAULT_FILE = join(REPO_ROOT, 'xaqulobod_itemolchilar.xlsx');

/** Kutilayotgan sarlavha - fayl tuzilmasi o'zgarsa jimgina noto'g'ri o'qimaslik uchun. */
const EXPECTED_HEADER: Record<number, RegExp> = {
  [COL_CODE]: /tp\s*nomer/i,
  [COL_TOTAL]: /jami/i,
  [COL_JULY_ACTIVE]: /aloqada\s*iyul/i,
  [COL_JULY_OFFLINE]: /aloqadamas\s*iyul/i,
};

// ═══════════════════════════════════════════════════════════════════════════
// Excel yordamchilari
// ═══════════════════════════════════════════════════════════════════════════

const text = (x: ExcelJS.CellValue): string => {
  if (x === null || x === undefined) return '';
  if (typeof x === 'object') {
    const o = x as { result?: unknown; text?: string };
    return String(o.result ?? o.text ?? '');
  }
  return String(x);
};

/** Bo'sh katak = 0 (faylda «aloqadamas» nol bo'lganda katak bo'sh qoldirilgan). */
const intOf = (x: ExcelJS.CellValue): number => {
  const v = text(x).replace(/\s/g, '').replace(',', '.');
  if (v === '') return 0;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Son emas: "${text(x)}"`);
  return Math.round(n);
};

/*
 * TP kodini SOLISHTIRISH kaliti.
 *
 * `ref.tp.code` registrda IZCHIL EMAS: `TP-010` nol bilan to'ldirilgan, lekin
 * `TP-15A`, `TP-66A` to'ldirilmagan; `TP-166А`, `TP-44А`, `TP-47А` da esa
 * kirillcha «А» (U+0410) turibdi. Shu sababli `chinobod-common.ts` dagi
 * `tpCodeOf()` bilan (u har doim 3 xonaga to'ldiradi va kirillni lotinga
 * o'giradi) hammasi ham mos kelmaydi.
 *
 * Bu yerda REGISTR O'ZGARTIRILMAYDI - ikkala tomon ham bir xil kanonik
 * ko'rinishga keltirilib solishtiriladi: prefiks olib tashlanadi, kirill
 * harflar lotinga o'giriladi, boshidagi nollar tushiriladi.
 *   `TP-010` va `10` → `10`;  `TP-166А` va `166А` → `166A`
 */
const CYR_TO_LAT: Record<string, string> = {
  А: 'A', В: 'B', С: 'C', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', Т: 'T', Х: 'X',
};

function matchKey(raw: string): string {
  const s = raw.trim()
    .replace(/^TP-/i, '')
    .replace(/[АВСЕКМНОРТХ]/g, (c) => CYR_TO_LAT[c] ?? c)
    .toUpperCase();
  const m = /^0*(\d+)(.*)$/.exec(s);
  return m ? `${Number(m[1])}${m[2]!.trim()}` : s;
}

// ═══════════════════════════════════════════════════════════════════════════
// Manbani o'qish
// ═══════════════════════════════════════════════════════════════════════════

interface TpConsumers {
  rawCode: string;
  key: string;
  total: number;
  /** Davr → [aloqada, aloqada emas]. */
  byPeriod: Map<string, { active: number; offline: number }>;
}

/** Bitta fayldagi bitta qator - bitta TP ning bitta davr uchun holati. */
interface PeriodRow {
  rawCode: string;
  key: string;
  total: number;
  active: number;
  offline: number;
}

async function readWorkbook(file: string): Promise<PeriodRow[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error(`${file}: varaq topilmadi`);

  const header = ws.getRow(1);
  for (const [col, re] of Object.entries(EXPECTED_HEADER)) {
    const got = text(header.getCell(Number(col)).value).trim();
    if (!re.test(got)) {
      throw new Error(
        `${file}: ${col}-ustun sarlavhasi kutilganidan farq qiladi.\n`
        + `  kutilgan: ${re}\n  topilgan: "${got}"\n`
        + '  Fayl tuzilmasi o‘zgargan - skriptni moslashtiring.',
      );
    }
  }

  const rows: PeriodRow[] = [];
  const seen = new Set<string>();

  for (let r = 2; r <= ws.rowCount; r += 1) {
    const row = ws.getRow(r);
    const rawCode = text(row.getCell(COL_CODE).value).trim();
    if (!rawCode) continue;

    const key = matchKey(rawCode);
    if (seen.has(key)) throw new Error(`${r}-qator: TP "${rawCode}" faylda takrorlangan`);
    seen.add(key);

    const total = intOf(row.getCell(COL_TOTAL).value);
    const active = intOf(row.getCell(COL_JULY_ACTIVE).value);
    const offline = intOf(row.getCell(COL_JULY_OFFLINE).value);
    // Manba ma'lumotining o'zini tekshiramiz: jim tuzatish yo'q, xato tashlanadi.
    if (active + offline !== total) {
      throw new Error(
        `${r}-qator, TP ${rawCode}, iyul: aloqada (${active}) + aloqada emas (${offline}) `
        + `= ${active + offline}, «Jami» esa ${total}. Manba faylni tekshiring.`,
      );
    }

    rows.push({ rawCode, key, total, active, offline });
  }

  if (rows.length === 0) throw new Error(`${file}: ma'lumot qatori topilmadi`);
  return rows;
}

/**
 * Yangi hisobot - AMALDAGI TP ro'yxati, jami abonent va avgust aloqa holati.
 *
 * Bu fayl TP↔abonent bog'lanishida ASOSIY manba: eski faylda 6 ta «A»
 * transformatorning yorlig'i bir pozitsiyaga surilgan (masalan 107 ta abonent
 * `131A` ga emas, `15A` ga tegishli).
 */
async function readNewWorkbook(): Promise<PeriodRow[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(NEW_FILE);
  const ws = wb.getWorksheet(NEW_SHEET);
  if (!ws) throw new Error(`${NEW_FILE}: «${NEW_SHEET}» varag'i topilmadi`);

  const rows: PeriodRow[] = [];
  const seen = new Set<string>();

  for (let r = NEW_FIRST_ROW; r <= ws.rowCount; r += 1) {
    const row = ws.getRow(r);
    const rawCode = text(row.getCell(NEW_COL_CODE).value).trim();
    // Oxirgi qator «Жами» - unda TP raqami yo'q.
    if (!rawCode || !/\d/.test(rawCode)) continue;

    const key = matchKey(rawCode);
    if (seen.has(key)) throw new Error(`${r}-qator: TP "${rawCode}" yangi faylda takrorlangan`);
    seen.add(key);

    const total = intOf(row.getCell(NEW_COL_TOTAL).value);
    const active = intOf(row.getCell(NEW_COL_ACTIVE).value);
    const offline = intOf(row.getCell(NEW_COL_OFFLINE).value);
    if (active + offline !== total) {
      throw new Error(
        `${r}-qator, TP ${rawCode}, avgust: aloqada (${active}) + aloqada emas (${offline}) `
        + `= ${active + offline}, «Jami» esa ${total}. Manba faylni tekshiring.`,
      );
    }

    rows.push({ rawCode, key, total, active, offline });
  }

  if (rows.length === 0) throw new Error(`${NEW_FILE}: ma'lumot qatori topilmadi`);
  return rows;
}

/**
 * Ikki faylni BIRLASHTIRADI: yorliq yangi fayldan, iyul aloqa holati eskidan.
 *
 * MUAMMO: eski faylda TP yorliqlari surilgan, shuning uchun `131A` ni `131A`
 * ga qarab bog'lash noto'g'ri qiymat beradi. Lekin ikkala faylning QATOR
 * TARTIBI bir xil - eskisida shunchaki ortiqcha TP lar bor.
 *
 * Shu sababli moslash POZITSIYA bo'yicha ketadi: ikki ro'yxat yonma-yon
 * yuriladi va «Jami» ustuni mos tushgan joyda juftlik hosil bo'ladi, mos
 * kelmasa eski qator ortiqcha deb o'tkazib yuboriladi.
 *
 * Bu jimgina taxmin emas - oxirida ikkita shart TEKSHIRILADI:
 *   • yangi fayldagi HAR BIR qator juftlik topgan bo'lishi;
 *   • o'tkazib yuborilgan eski qatorlar yangi faylda UMUMAN yo'qligi.
 * Bittasi buzilsa skript to'xtaydi.
 */
function align(oldRows: PeriodRow[], newRows: PeriodRow[]): TpConsumers[] {
  const out: TpConsumers[] = [];
  const skipped: PeriodRow[] = [];
  const relabelled: { from: string; to: string; total: number }[] = [];

  let i = 0;
  for (const nw of newRows) {
    while (i < oldRows.length && oldRows[i]!.total !== nw.total) {
      skipped.push(oldRows[i]!);
      i += 1;
    }
    if (i >= oldRows.length) {
      throw new Error(
        `Eski fayl bilan moslashtirib bo‘lmadi: «${nw.rawCode}» (jami ${nw.total})`
        + ' uchun juftlik topilmadi. Fayllar tartibi o‘zgargan bo‘lishi mumkin.',
      );
    }
    const od = oldRows[i]!;
    i += 1;

    if (od.key !== nw.key) relabelled.push({ from: od.rawCode, to: nw.rawCode, total: nw.total });

    const byPeriod = new Map<string, { active: number; offline: number }>();
    byPeriod.set('2026-07', { active: od.active, offline: od.offline });
    byPeriod.set('2026-08', { active: nw.active, offline: nw.offline });
    out.push({ rawCode: nw.rawCode, key: nw.key, total: nw.total, byPeriod });
  }
  while (i < oldRows.length) { skipped.push(oldRows[i]!); i += 1; }

  const newKeys = new Set(newRows.map((x) => x.key));
  const wrong = skipped.filter((x) => newKeys.has(x.key));
  if (wrong.length > 0) {
    throw new Error(
      'Moslash noto‘g‘ri ketdi: o‘tkazib yuborilgan TP yangi faylda ham bor - '
      + wrong.map((x) => x.rawCode).join(', '),
    );
  }

  if (skipped.length > 0) {
    console.log(`\nEski fayldagi ortiqcha ${skipped.length} ta TP hisobga olinmadi:`);
    console.log('  ' + skipped.map((x) => `${x.rawCode} (${x.total} ta)`).join(', '));
  }
  if (relabelled.length > 0) {
    console.log(`\nYangi fayl bo‘yicha qayta bog‘landi (${relabelled.length} ta):`);
    for (const r of relabelled) {
      console.log(`  ${String(r.total).padStart(4)} ta abonent:  ${r.from}  →  ${r.to}`);
    }
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// Yozish
// ═══════════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const file = args.find((a) => !a.startsWith('--')) ?? DEFAULT_FILE;

  console.log(`Manba: ${file}${dry ? '  [DRY-RUN - hech narsa yozilmaydi]' : ''}`);
  const [oldRows, newRows] = await Promise.all([readWorkbook(file), readNewWorkbook()]);
  console.log(`Yangi ro‘yxat: ${NEW_FILE.split('/').pop()} · ${newRows.length} ta TP`);
  const source = align(oldRows, newRows);
  console.log(`O‘qildi: ${source.length} ta TP · har bir qatorda aloqada + aloqada emas = jami ✓`);

  const client = new pg.Client({
    host: config.db.host, port: config.db.port, database: config.db.database,
    user: config.db.user, password: config.db.password,
  });
  await client.connect();

  try {
    // ── Registrga bog'lash ────────────────────────────────────────────────
    const feeder = await client.query<{ id: number }>(
      `SELECT id FROM ref.mfy WHERE code = $1 AND valid_to IS NULL`, [FEEDER_CODE]);
    const mfyId = feeder.rows[0]?.id;
    if (!mfyId) throw new Error(`Registrda "${FEEDER_CODE}" fideri topilmadi`);

    const tpRows = await client.query<{ id: number; code: string }>(
      `SELECT id, code FROM ref.tp WHERE mfy_id = $1`, [mfyId]);

    const byKey = new Map<string, number>();
    for (const t of tpRows.rows) {
      const k = matchKey(t.code);
      if (byKey.has(k)) throw new Error(`Registrda ikkita TP bir xil kalitga tushdi: "${k}"`);
      byKey.set(k, t.id);
    }

    const missing = source.filter((s) => !byKey.has(s.key));
    if (missing.length > 0) {
      throw new Error(
        `Registrda topilmagan TP lar (${missing.length} ta): `
        + missing.map((m) => m.rawCode).join(', '),
      );
    }
    console.log(`Registrga bog‘landi: ${source.length} / ${tpRows.rows.length} ta TP`);

    // ── Jamlar ────────────────────────────────────────────────────────────
    const totals = PERIODS.map((p) => {
      const active = source.reduce((a, s) => a + s.byPeriod.get(p.period)!.active, 0);
      const offline = source.reduce((a, s) => a + s.byPeriod.get(p.period)!.offline, 0);
      return { ...p, active, offline };
    });
    const grandTotal = source.reduce((a, s) => a + s.total, 0);

    if (LEGAL_CONSUMERS > grandTotal) {
      throw new Error(
        `Yuridik iste'molchilar soni (${LEGAL_CONSUMERS}) jami iste'molchilardan `
        + `(${grandTotal}) ko‘p bo‘lishi mumkin emas.`,
      );
    }
    const populationConsumers = grandTotal - LEGAL_CONSUMERS;

    console.log(`\nUMUMIY YIG‘INDI  ·  jami iste'molchilar: ${grandTotal}`);
    console.log(`  shundan aholi ${populationConsumers} · yuridik ${LEGAL_CONSUMERS}`);
    for (const t of totals) {
      const pct = grandTotal > 0 ? ((t.offline / grandTotal) * 100).toFixed(2) : '0';
      console.log(
        `  ${t.label.padEnd(7)} aloqada ${String(t.active).padStart(5)}`
        + ` · aloqada emas ${String(t.offline).padStart(4)} (${pct}%)`,
      );
    }

    if (dry) {
      console.log('\n[DRY-RUN] Baza o‘zgartirilmadi.');
      return;
    }

    // ── Tranzaksiya ───────────────────────────────────────────────────────
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.user_id', $1, true), set_config('app.role', 'admin', true),
              set_config('app.mfy_ids', '', true), set_config('app.request_id', 'load-consumers', true)`,
      [String((await client.query<{ id: number }>(
        `SELECT id FROM sec.app_user WHERE role = 'admin' AND is_active ORDER BY id LIMIT 1`,
      )).rows[0]?.id ?? '')],
    );

    let tpWritten = 0;

    for (const p of PERIODS) {
      const pStart = `${p.period}-01`;

      // 1) TP kesimi. Hisoblagich ustunlariga TEGILMAYDI - `DO UPDATE` faqat
      //    iste'molchi ustunlarini yangilaydi.
      for (const s of source) {
        const v = s.byPeriod.get(p.period)!;
        await client.query(
          `INSERT INTO fact.tp_monthly
             (tp_id, period_month, consumers_total, consumers_active, consumers_disconnected)
           VALUES ($1, $2::date, $3, $4, $5)
           ON CONFLICT (tp_id, period_month) DO UPDATE
             SET consumers_total        = EXCLUDED.consumers_total,
                 consumers_active       = EXCLUDED.consumers_active,
                 consumers_disconnected = EXCLUDED.consumers_disconnected,
                 updated_at             = now()`,
          [byKey.get(s.key), pStart, s.total, v.active, v.offline]);
        tpWritten += 1;
      }

      // 2) Fider bo'yicha umumiy yig'indi.
      //
      //    `mfy_monthly_return.submission_id` NOT NULL - konvertsiz yozib
      //    bo'lmaydi. Tasdiqlangan MONTHLY_RETURN konverti bo'lmasa ochamiz:
      //    `agg.mfy_monthly` FAQAT `approved` konvertlarni hisobga oladi.
      const t = totals.find((x) => x.period === p.period)!;

      const existing = await client.query<{ id: number }>(
        `SELECT id FROM fact.submission
          WHERE scope_type = 'MFY' AND scope_id = $1 AND domain = 'MONTHLY_RETURN'
            AND period_start = $2::date AND status = 'approved'`,
        [mfyId, pStart]);

      let submissionId = existing.rows[0]?.id;
      if (!submissionId) {
        const ins = await client.query<{ id: number }>(
          `INSERT INTO fact.submission
             (scope_type, scope_id, domain, period_type, period_start, period_end,
              revision, status, created_by, submitted_at, reviewed_by, reviewed_at, review_note)
           VALUES ('MFY', $1, 'MONTHLY_RETURN', 'MONTH', $2::date,
                   ($2::date + INTERVAL '1 month' - INTERVAL '1 day')::date,
                   1, 'approved', $3, now(), $3, now(),
                   'Iste’molchilar kesimi manba fayldan yuklandi (load-consumers.ts)')
           RETURNING id`,
          [mfyId, pStart, (await client.query<{ id: number }>(
            `SELECT id FROM sec.app_user WHERE role = 'admin' AND is_active ORDER BY id LIMIT 1`,
          )).rows[0]!.id]);
        submissionId = ins.rows[0]!.id;
        console.log(`  ${p.label}: MONTHLY_RETURN konverti ochildi (#${submissionId})`);
      }

      /*
       * `consumers_total` GENERATED (aholi + yuridik), shuning uchun u
       * to'g'ridan-to'g'ri yozilmaydi - bo'laklar yoziladi va jami o'z-o'zidan
       * chiqadi (yuqoridagi `LEGAL_CONSUMERS` izohiga qarang).
       *
       * Qarzdorlik va hisoblagich ustunlari `DO UPDATE` da YO'Q: ular boshqa
       * hisobotdan keladi, bu skript ularni nolga tushirmasligi kerak.
       */
      await client.query(
        `INSERT INTO fact.mfy_monthly_return
           (submission_id, mfy_id, period_month,
            consumers_population, consumers_legal, consumers_active, consumers_disconnected)
         VALUES ($1, $2, $3::date, $4, $5, $6, $7)
         ON CONFLICT (submission_id, mfy_id, period_month) DO UPDATE
           SET consumers_population   = EXCLUDED.consumers_population,
               consumers_legal        = EXCLUDED.consumers_legal,
               consumers_active       = EXCLUDED.consumers_active,
               consumers_disconnected = EXCLUDED.consumers_disconnected,
               updated_at             = now()`,
        [submissionId, mfyId, pStart, populationConsumers, LEGAL_CONSUMERS, t.active, t.offline]);
    }

    await client.query('COMMIT');
    console.log(`\nYozildi: ${tpWritten} ta TP × oy qatori + ${PERIODS.length} ta umumiy yig‘indi.`);

    // ── Agregatlarni yangilash ────────────────────────────────────────────
    await client.query('SELECT agg.refresh_all(true)');
    console.log('Agregatlar yangilandi.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    await client.end();
  }
}

await main();
