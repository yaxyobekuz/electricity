/**
 * XAQULOBOD FIDERI - TP muammolari, rejalashtirilgan va bajarilgan ishlar.
 *
 * IKKI MANBA:
 *
 * ─── 1. `xaqulobod_13kunlik.xlsx` · «Аниқланган камчиликлар» ───────────────
 * Eng yangi hisobotning 8-ustuni - 13.08.2026 holatidagi nosozliklar. Bir
 * necha xil yozuv uchraydi:
 *
 *   «Баланс хисоблагич носоз»                        → hisoblagichning o'zi nosoz
 *   «Баланс хисоблагич тока трансформатори носоз»    → tok transformatori nosoz
 *   «Баланс хисоблагич йук»                          → hisoblagich umuman yo'q
 *   «Истеъмолчилар тури бриктирилди»                 → BAJARILGAN ish (o'tgan zamon)
 *
 * Dastlabki uchtasi - HAL ETILMAGAN nosozlik: TP holati `FAULT` bo'ladi va
 * rejalashtirilgan ish ochiladi. Oxirgisi allaqachon bajarilgan.
 *
 * Nosozlik FAQAT o'z oyiga (`FAULT_PERIOD`) yoziladi - ro'yxat bugungi
 * holatni beradi, iyulga orqaga qarab yozilmaydi.
 *
 * ─── 2. `xaqulobod_fider.xlsx` · «бир кунлик» varag'i ─────────────────────
 * 7 ta TP uchun xatlovdan OLDIN (02.08) va KEYIN (05.08) o'lchangan yo'qotish.
 * Ikki o'lchov orasidagi farq - bajarilgan ishning o'lchangan natijasi.
 *
 * NIMA YOZADI:
 *   • `fact.tp_status_monthly` - har bir TP × 2 oy: nosozlar `FAULT`, qolgani `GOOD`
 *   • `fact.work` PLANNED      - har bir nosoz TP uchun bitta ish
 *   • `fact.work` COMPLETED    - xatlov ishlari (o'lchangan natija bilan)
 *
 * TAXMIN (manbada YO'Q, shu skript qo'yadi): rejalashtirilgan ishlarning
 * boshlanish va tugash sanasi. Manba faylda muddat ko'rsatilmagan, «Reja»
 * paneli esa sanasiz ishni tartiblay olmaydi. Shuning uchun sana ma'lumot
 * mavjud oxirgi kunidan keyingi kunga qo'yiladi va ishning izohida bu
 * ATAYLAB yozib qoldiriladi - hisobotni o'qigan odam sanani manbadagi
 * muddat deb o'ylamasin.
 *
 *   node --experimental-strip-types apps/api/scripts/load-tp-problems.ts [--dry]
 *
 * IDEMPOTENT: shu skript yozgan ishlar `description` dagi belgi bo'yicha
 * topilib o'chiriladi, boshqa ishlarga TEGILMAYDI.
 */
import { join } from 'node:path';

import { tpCodeKey } from '@beap/shared';
import ExcelJS from 'exceljs';
import pg from 'pg';

import { config, REPO_ROOT } from '../src/config.ts';

/** Xatlov o'lchovlari («бир кунлик» varag'i) shu faylda qoladi. */
const DEFAULT_FILE = join(REPO_ROOT, 'xaqulobod_fider.xlsx');

/**
 * NOSOZLIKLAR RO'YXATI - eng yangi hisobotning «Аниқланган камчиликлар»
 * ustuni (13.08.2026 holati). Eski faylning «Muammolar» varag'i O'RNINI
 * BOSADI: u 51 ta TP davridagi ro'yxat edi va bugungi holatni bermaydi.
 */
const PROBLEM_FILE = join(REPO_ROOT, 'xaqulobod_13kunlik.xlsx');
const PROBLEM_SHEET = 'Sheet0 (2)';
const PROBLEM_FIRST_ROW = 5;
const PROBLEM_COL_CODE = 2;
const PROBLEM_COL_NOTE = 8;

const FEEDER_CODE = 'FIDER-XAQULOBOD';
const PERIODS = ['2026-07', '2026-08'] as const;

/**
 * Nosozlik QAYSI oyga tegishli.
 *
 * Ro'yxat 13.08.2026 holatini beradi, iyul uchun nosozlik qayd etilmagan -
 * shuning uchun iyulda hamma TP soz deb yoziladi. Aks holda avgustdagi
 * nosozlik iyulga ham "orqaga qarab" yozilib, o'tmish soxtalashtirilardi.
 */
const FAULT_PERIOD = '2026-08';

/** Faqat shu skript yozgan qatorlarni qayta topish uchun belgi. */
const TAG_PROBLEM = '[manba: xaqulobod_13kunlik.xlsx · Aniqlangan kamchiliklar]';
const TAG_INSPECTION = '[manba: xaqulobod_fider.xlsx · bir kunlik xatlov]';

/**
 * ESKI belgilar - ishlarni ilgari `load-xaqulobod-fider.ts` monoliti yozardi.
 * U endi ish yozmaydi, lekin bazada qolgan qatorlari yangilari bilan
 * yonma-yon turib, ro'yxatni ikki barobar ko'rsatardi. Shu sababli ular ham
 * tozalanadi - qayta paydo bo'lmaydi.
 */
const LEGACY_TAGS = [
  '[manba: xaqulobod_fider.xlsx · Muammolar]',
  '[manba: xaqulobod_fider.xlsx · бир кунлик · xatlov]',
];

/**
 * TOZALASH NAQSHLARI - FAYL NOMIGA BOG'LIQ EMAS.
 *
 * Belgida manba fayl nomi turadi (kimdir bazaga qarab "bu qayerdan keldi?"
 * deb so'rasa javob o'sha yerda). Lekin TOZALASH uchun aynan shu nomdan
 * foydalanib bo'lmaydi: hisobot yangi fayl bilan qayta berilganda belgi
 * o'zgaradi va eski qatorlar topilmay, ro'yxatda ikki marta qolib ketadi -
 * 12 kunlikdan 13 kunlikka o'tishda aynan shu yuz berdi (8 ta eski reja
 * ishi yangilari bilan yonma-yon turib qoldi).
 *
 * Shuning uchun naqsh belgining O'ZGARMAS qismiga - manba nomidan keyingi
 * bo'limga - tayanadi.
 */
const WIPE_PATTERNS = [
  '%· Aniqlangan kamchiliklar]%',
  '%· bir kunlik xatlov]%',
  ...LEGACY_TAGS.map((t) => `%${t}%`),
];

/**
 * Reja oynasi - manbada muddat yo'q, izohda shunday deb aytiladi.
 * Boshlanish sanasi ma'lumot oynasidan (13.08) KEYIN turishi kerak, aks
 * holda reja o'z ma'lumot davrining ichiga tushib qoladi.
 */
const PLAN_START = '2026-08-14';
const PLAN_END = '2026-09-30';
const PLAN_NOTE = 'Muddat manba faylda ko‘rsatilmagan - reja oynasi shartli.';

/** Kunlik natijani oyga keltirish - `generate-inspection-works.ts` dagi bilan bir xil. */
const DAYS_PER_MONTH = 30;

/*
 * Muammo turlari.
 *
 * Kalit - manba fayldagi kirillcha matnning bo'shliqlari siqilgan ko'rinishi.
 * Platforma faqat lotin yozuvida bo'lgani uchun bazaga LOTINCHA matn tushadi.
 */
interface ProblemSpec {
  labelUz: string;
  /** `false` bo'lsa - bu nosozlik emas, allaqachon bajarilgan ish. */
  isFault: boolean;
  workTitle: (code: string) => string;
}

const PROBLEMS: Record<string, ProblemSpec> = {
  'баланс хисоблагич носоз': {
    labelUz: 'Balans hisoblagich nosoz',
    isFault: true,
    workTitle: (c) => `${c} balans hisoblagichini almashtirish`,
  },
  'баланс хисоблагич тока трансформатори носоз': {
    labelUz: 'Balans hisoblagich tok transformatori nosoz',
    isFault: true,
    workTitle: (c) => `${c} balans hisoblagichi tok transformatorini almashtirish`,
  },
  'баланс хисоблагич йук': {
    labelUz: 'Balans hisoblagich yo‘q',
    isFault: true,
    workTitle: (c) => `${c} ga balans hisoblagich o‘rnatish`,
  },
  'истеъмолчилар тури бриктирилди': {
    labelUz: 'Iste’molchilar turi biriktirildi',
    isFault: false,
    workTitle: (c) => `${c} bo‘yicha iste’molchilar turi biriktirildi`,
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// Yordamchilar
// ═══════════════════════════════════════════════════════════════════════════

const text = (x: ExcelJS.CellValue): string => {
  if (x === null || x === undefined) return '';
  if (x instanceof Date) return x.toISOString().slice(0, 10);
  if (typeof x === 'object') {
    const o = x as { result?: unknown; text?: string; richText?: { text: string }[] };
    if (o.richText) return o.richText.map((t) => t.text).join('');
    return String(o.result ?? o.text ?? '');
  }
  return String(x);
};

const numOf = (x: ExcelJS.CellValue): number => {
  const v = text(x).replace(/\s/g, '').replace(',', '.');
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Manba fayl va registr kodini bir ko'rinishga keltiradi (`@beap/shared`). */
const matchKey = tpCodeKey;

/** Izohni solishtirish uchun: kichik harf, ortiqcha bo'shliqlar olib tashlanadi. */
const problemKey = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ');

// ═══════════════════════════════════════════════════════════════════════════
// Manbani o'qish
// ═══════════════════════════════════════════════════════════════════════════

interface Problem { rawCode: string; key: string; spec: ProblemSpec }

interface Inspection {
  rawCode: string;
  key: string;
  dateBefore: string;
  dateAfter: string;
  lossBefore: number;
  lossAfter: number;
  /** «Хатловдан кейин» ustuni, masalan `74/80`. */
  checked: string;
}

async function readSource(file: string): Promise<{ problems: Problem[]; inspections: Inspection[] }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);

  // ── Nosozliklar - eng yangi hisobotdan ──────────────────────────────────
  const pwb = new ExcelJS.Workbook();
  await pwb.xlsx.readFile(PROBLEM_FILE);
  const mw = pwb.getWorksheet(PROBLEM_SHEET);
  if (!mw) throw new Error(`${PROBLEM_FILE}: «${PROBLEM_SHEET}» varag'i topilmadi`);
  if (!/камчилик/i.test(text(mw.getRow(3).getCell(PROBLEM_COL_NOTE).value))) {
    throw new Error(
      `«${PROBLEM_SHEET}» varag‘ining ${PROBLEM_COL_NOTE}-ustuni`
      + ' «Аниқланган камчиликлар» emas - fayl tuzilmasi o‘zgargan.',
    );
  }

  const problems: Problem[] = [];
  for (let r = PROBLEM_FIRST_ROW; r <= mw.rowCount; r += 1) {
    const rawCode = text(mw.getRow(r).getCell(PROBLEM_COL_CODE).value).trim();
    const note = text(mw.getRow(r).getCell(PROBLEM_COL_NOTE).value).trim();
    // Oxirgi qator «Жами»; kamchiligi yo'q TP larda katak bo'sh.
    if (!rawCode || !/\d/.test(rawCode) || !note) continue;

    const spec = PROBLEMS[problemKey(note)];
    if (!spec) {
      throw new Error(
        `${r}-qator, TP ${rawCode}: noma'lum muammo turi «${note}».\n`
        + '  Skriptdagi PROBLEMS ro‘yxatiga qo‘shing - jimgina o‘tkazib yuborilmaydi.',
      );
    }
    problems.push({ rawCode, key: matchKey(rawCode), spec });
  }

  // ── «бир кунлик» - xatlovdan oldin/keyin ────────────────────────────────
  const dw = wb.getWorksheet('бир кунлик');
  if (!dw) throw new Error(`${file}: «бир кунлик» varag'i topilmadi`);

  const inspections: Inspection[] = [];
  for (let r = 5; r <= dw.rowCount; r += 1) {
    const row = dw.getRow(r);
    const rawCode = text(row.getCell(2).value).trim();
    // «Жами» qatori va bo'sh qatorlar tashlab ketiladi.
    if (!rawCode || !/^\d/.test(rawCode)) continue;

    const dateAfter = text(row.getCell(9).value).trim();
    if (!dateAfter) continue;

    inspections.push({
      rawCode,
      key: matchKey(rawCode),
      dateBefore: text(row.getCell(3).value).trim(),
      dateAfter,
      lossBefore: numOf(row.getCell(6).value),
      lossAfter: numOf(row.getCell(12).value),
      checked: text(row.getCell(8).value).trim(),
    });
  }

  return { problems, inspections };
}

/** `01/08/2026` yoki `2026-08-05` → `2026-08-05`. */
function isoDate(raw: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  throw new Error(`Sana o‘qib bo‘lmadi: "${raw}"`);
}

// ═══════════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const file = args.find((a) => !a.startsWith('--')) ?? DEFAULT_FILE;

  console.log(
    `Nosozliklar: ${PROBLEM_FILE.split('/').pop()} · ${PROBLEM_SHEET}`
    + `\nXatlov:      ${file.split('/').pop()} · бир кунлик${dry ? '   [DRY-RUN]' : ''}`,
  );
  const { problems, inspections } = await readSource(file);

  const faults = problems.filter((p) => p.spec.isFault);
  const done = problems.filter((p) => !p.spec.isFault);
  console.log(
    `\n«Aniqlangan kamchiliklar»: ${problems.length} ta yozuv -`
    + ` ${faults.length} ta hal etilmagan nosozlik, ${done.length} ta bajarilgan.`,
  );
  console.log(`«бир кунлик»: ${inspections.length} ta xatlov o‘lchovi.`);

  const client = new pg.Client({
    host: config.db.host, port: config.db.port, database: config.db.database,
    user: config.db.user, password: config.db.password,
  });
  await client.connect();

  try {
    const feeder = await client.query<{ id: number }>(
      `SELECT id FROM ref.mfy WHERE code = $1 AND valid_to IS NULL`, [FEEDER_CODE]);
    const mfyId = feeder.rows[0]?.id;
    if (!mfyId) throw new Error(`Registrda "${FEEDER_CODE}" fideri topilmadi`);

    const tpRows = await client.query<{ id: number; code: string }>(
      `SELECT id, code FROM ref.tp WHERE mfy_id = $1`, [mfyId]);
    const byKey = new Map<string, { id: number; code: string }>();
    for (const t of tpRows.rows) byKey.set(matchKey(t.code), t);

    const unknown = [...problems, ...inspections].filter((p) => !byKey.has(p.key));
    if (unknown.length > 0) {
      throw new Error(`Registrda topilmagan TP: ${unknown.map((u) => u.rawCode).join(', ')}`);
    }

    console.log('\nNOSOZ TP LAR:');
    for (const p of faults) {
      console.log(`  ${byKey.get(p.key)!.code.padEnd(9)} ${p.spec.labelUz}`);
    }
    console.log('\nXATLOV NATIJASI (kunlik yo‘qotish, kWh):');
    for (const i of inspections) {
      const diff = i.lossBefore - i.lossAfter;
      const note = diff > 0
        ? `tejaldi ${(diff * DAYS_PER_MONTH).toFixed(0).padStart(8)} kWh/oy`
        : `nomuvofiqlik ${Math.abs(i.lossBefore).toFixed(0)} → ${Math.abs(i.lossAfter).toFixed(0)}`
          + ' (manfiy yo‘qotish - tejamkorlik deb hisoblanmaydi)';
      console.log(
        `  ${byKey.get(i.key)!.code.padEnd(9)} ${i.lossBefore.toFixed(1).padStart(10)}`
        + ` → ${i.lossAfter.toFixed(1).padStart(9)}   ${note}`,
      );
    }

    if (dry) {
      console.log('\n[DRY-RUN] Baza o‘zgartirilmadi.');
      return;
    }

    await client.query('BEGIN');
    const admin = await client.query<{ id: number }>(
      `SELECT id FROM sec.app_user WHERE role = 'admin' AND is_active ORDER BY id LIMIT 1`);
    const adminId = admin.rows[0]?.id ?? null;
    await client.query(
      `SELECT set_config('app.user_id', $1, true), set_config('app.role', 'admin', true),
              set_config('app.mfy_ids', '', true), set_config('app.request_id', 'load-tp-problems', true)`,
      [adminId === null ? '' : String(adminId)]);

    // ── 1. TP holati ──────────────────────────────────────────────────────
    const faultByKey = new Map(faults.map((f) => [f.key, f.spec]));
    let statusWritten = 0;

    for (const period of PERIODS) {
      const pStart = `${period}-01`;

      const existing = await client.query<{ id: number }>(
        `SELECT id FROM fact.submission
          WHERE scope_type = 'MFY' AND scope_id = $1 AND domain = 'TP_STATUS'
            AND period_start = $2::date AND status = 'approved'`, [mfyId, pStart]);

      let subId = existing.rows[0]?.id;
      if (!subId) {
        const ins = await client.query<{ id: number }>(
          `INSERT INTO fact.submission
             (scope_type, scope_id, domain, period_type, period_start, period_end,
              revision, status, created_by, submitted_at, reviewed_by, reviewed_at, review_note)
           VALUES ('MFY', $1, 'TP_STATUS', 'MONTH', $2::date,
                   ($2::date + INTERVAL '1 month' - INTERVAL '1 day')::date,
                   1, 'approved', $3, now(), $3, now(),
                   'TP holati manba fayldan yuklandi (load-tp-problems.ts)')
           RETURNING id`, [mfyId, pStart, adminId]);
        subId = ins.rows[0]!.id;
        console.log(`\n${period}: TP_STATUS konverti ochildi (#${subId})`);
      }

      for (const tp of tpRows.rows) {
        // Nosozlik FAQAT o'z oyiga yoziladi - iyulda hamma TP soz.
        const spec = period === FAULT_PERIOD ? faultByKey.get(matchKey(tp.code)) : undefined;
        await client.query(
          `INSERT INTO fact.tp_status_monthly
             (submission_id, tp_id, period_month, condition, repair_needed, repair_reason)
           VALUES ($1, $2, $3::date, $4, $5, $6)
           ON CONFLICT (submission_id, tp_id, period_month) DO UPDATE
             SET condition     = EXCLUDED.condition,
                 repair_needed = EXCLUDED.repair_needed,
                 repair_reason = EXCLUDED.repair_reason,
                 updated_at    = now()`,
          [subId, tp.id, pStart,
            spec ? 'FAULT' : 'GOOD', Boolean(spec), spec?.labelUz ?? null]);
        statusWritten += 1;
      }
    }

    // ── 2. Ishlar ─────────────────────────────────────────────────────────
    // Avval shu skript yozgan ishlarni olib tashlaymiz - qayta yurgizilganda
    // takrorlanmasin. Boshqa manbadan kelgan ishlarga tegilmaydi.
    const wiped = await client.query(
      `DELETE FROM fact.work
        WHERE description LIKE ANY($1)`,
      [WIPE_PATTERNS]);
    if (wiped.rowCount) console.log(`\nEski ${wiped.rowCount} ta ish o‘chirildi (qayta yozish).`);

    // 2a. Rejalashtirilgan - hal etilmagan nosozliklar.
    for (const p of faults) {
      const tp = byKey.get(p.key)!;
      await client.query(
        `INSERT INTO fact.work
           (mfy_id, tp_id, work_type, title_uz, description, status,
            planned_start, planned_end, progress_pct, quantity, unit)
         VALUES ($1, $2, 'METER_REPLACEMENT', $3, $4, 'PLANNED', $5::date, $6::date, 0, 1, 'ta')`,
        [mfyId, tp.id, p.spec.workTitle(tp.code),
          `${p.spec.labelUz}. ${PLAN_NOTE} ${TAG_PROBLEM}`,
          PLAN_START, PLAN_END]);
    }

    // 2b. Bajarilgan - manbada o'tgan zamonda yozilgan ish.
    for (const p of done) {
      const tp = byKey.get(p.key)!;
      await client.query(
        `INSERT INTO fact.work
           (mfy_id, tp_id, work_type, title_uz, description, status,
            planned_start, planned_end, actual_end, progress_pct, quantity, unit)
         VALUES ($1, $2, 'OTHER', $3, $4, 'COMPLETED', $5::date, $5::date, $5::date, 100, 1, 'ta')`,
        [mfyId, tp.id, p.spec.workTitle(tp.code),
          `${p.spec.labelUz}. ${TAG_PROBLEM}`, `${PERIODS[1]}-01`]);
    }

    /*
     * 2c. Bajarilgan - xatlov, O'LCHANGAN natija bilan.
     *
     * `work_type = OTHER`: manba faqat «хатлов» faktini beradi - hisoblagich
     * almashtirildimi yoki noqonuniy ulanish uzildimi, YOZILMAGAN. Aniqroq
     * tur tanlash tekshirilmagan da'vo bo'lardi (`generate-inspection-
     * works.ts` dagi bilan bir xil qaror).
     *
     * TEJAMKORLIK FAQAT yo'qotish HAQIQATAN kamayganda yoziladi.
     *
     * 7 ta TP dan 5 tasida yo'qotish MANFIY (biriktirilgan iste'molchilar
     * balans hisoblagichidan ko'p - o'lchov anomaliyasi belgisi). U yerda
     * xatlovdan keyin nomuvofiqlik kichraygan, lekin bu TEJALGAN ENERGIYA
     * EMAS - o'lchov xatosining tuzatilishi. `effect_saving_kwh_month` esa
     * «Iqtisod qilingan energiya» kartasiga tushadi, shuning uchun bunday
     * qatorda 0 qoladi (`generate-inspection-works.ts` dagi bilan bir xil
     * qoida). Ishning O'ZI baribir yoziladi - xatlov haqiqatan bo'lgan.
     */
    let saved = 0;
    for (const i of inspections) {
      const tp = byKey.get(i.key)!;
      const dailySaving = i.lossBefore - i.lossAfter;
      const monthly = dailySaving > 0 ? Number((dailySaving * DAYS_PER_MONTH).toFixed(2)) : 0;
      saved += monthly;

      const effect = dailySaving > 0
        ? `Kunlik yo‘qotish ${i.lossBefore.toFixed(1)} → ${i.lossAfter.toFixed(1)} kWh,`
          + ` oylik natija ${DAYS_PER_MONTH} kunga yoyilgan.`
        : `Yo‘qotish MANFIY (${i.lossBefore.toFixed(1)} → ${i.lossAfter.toFixed(1)} kWh/kun):`
          + ' biriktirilgan iste’molchilar balans hisoblagichidan ko‘p - o‘lchov anomaliyasi.'
          + ' Nomuvofiqlik kichraygan, lekin bu tejalgan energiya emas, shuning uchun'
          + ' natija ustuni bo‘sh qoldirilgan.';

      await client.query(
        `INSERT INTO fact.work
           (mfy_id, tp_id, work_type, title_uz, description, status,
            planned_start, planned_end, actual_end, progress_pct, quantity, unit,
            effect_saving_kwh_month)
         VALUES ($1, $2, 'OTHER', $3, $4, 'COMPLETED', $5::date, $6::date, $6::date, 100, 1, 'ta', $7)`,
        [mfyId, tp.id, `${tp.code} - hisoblagichlar xatlovi`,
          `${effect} Tekshirilgan hisoblagich: ${i.checked}. ${TAG_INSPECTION}`,
          isoDate(i.dateBefore), isoDate(i.dateAfter), monthly]);
    }

    await client.query('COMMIT');

    console.log(`\nYozildi:`);
    console.log(`  TP holati        ${statusWritten} qator (${FAULT_PERIOD} da ${faults.length} ta FAULT)`);
    console.log(`  Rejalashtirilgan ${faults.length} ta ish`);
    console.log(`  Bajarilgan       ${done.length + inspections.length} ta ish`);
    console.log(`  Tejalgan energiya ${Math.round(saved).toLocaleString('en-US').replace(/,/g, ' ')} kWh/oy`);

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
