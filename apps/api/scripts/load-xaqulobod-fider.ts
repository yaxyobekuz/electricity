/**
 * `xaqulobod_fider.xlsx` - Xaqulobod fiderining 51 ta TP si bo'yicha iyul va
 * avgust o'lchovlarini yuklaydi.
 *
 *   node --experimental-strip-types apps/api/scripts/load-xaqulobod-fider.ts
 *
 * MANBA - faqat ikkita varaq:
 *   • «Iyul»   - 2026-07-01 … 2026-07-31 (31 kun), 51 qator;
 *   • «Avgust» - 2026-08-01 … 2026-08-10 (10 kun), 51 qator;
 *   • «Muammolar» - TP bo'yicha nosozlik izohi (matn sifatida saqlanadi).
 * Har qatorda uch son: «Hisoblangan» (balans hisoblagichi), «Foydali oqim»
 * (biriktirilgan iste'molchilar) va ularning ayirmasi - «Yo'qotish».
 *
 * FAYLDAGI «бир кунлик» VA «Sheet0» VARAQLARI ISHLATILMAYDI: ular butun
 * Chinobod ETK bo'yicha bir kunlik (01.08.2026) hisobot, ya'ni BOSHQA
 * fiderlarning TP lari ham bor. Bu tizim faqat Xaqulobod fiderini qamraydi,
 * qo'shilsa 51 TP dan tashqari ma'lumot va avgust oynasi bilan ikki marta
 * hisoblash paydo bo'lardi.
 *
 * KUNLARGA TAQSIMLASH: faylda davr bo'yicha BITTA son bor. U kunlarga TENG
 * bo'linadi, oxirgi kunga yaxlitlash qoldig'i qo'shiladi - shuning uchun
 * kunlik qiymatlar yig'indisi fayldagi songa AYNAN teng bo'lib qoladi.
 * Kunlik tebranish manbada yo'q va O'YLAB TOPILMAYDI.
 *
 * NIMA YUKLANMAYDI: iste'molchilar soni, qarzdorlik, TP pasporti (kVA,
 * masofa, yuklama), ishlar, dalolatnomalar va fider bosh hisoblagichining
 * ko'rsatkichi - bu ma'lumotlar faylda YO'Q. Tegishli panellar «ma'lumot
 * yo'q» deb ko'rsatadi.
 *
 * IDEMPOTENT: har ishga tushirilganda fakt jadvallari tozalanadi va
 * fayldan qayta yoziladi.
 */
import { join } from 'node:path';

import ExcelJS from 'exceljs';
import pg from 'pg';

import { config, REPO_ROOT } from '../src/config.ts';

const FILE = join(REPO_ROOT, 'xaqulobod_fider.xlsx');
/** Abonentlar kesimi - TP bo'yicha jami / aloqada / aloqadamas. */
const CONSUMERS_FILE = join(REPO_ROOT, 'xaqulobod_itemolchilar.xlsx');
const FEEDER_CODE = 'FIDER-XAQULOBOD';

/**
 * Varaq → davr. `days` fayl sarlavhasidagi oraliqdan olingan.
 *
 * `officialIn` / `officialSold` - oy uchun BIRIKTIRILGAN rasmiy qiymatlar.
 * Ular Excel fayllarida YO'Q, shuning uchun shu yerda aniq ko'rsatiladi:
 *
 * Ikkala oyda ham naqsh BIR XIL:
 *
 *   • `officialIn`   - fider boshiga biriktirilgan oylik son
 *                      (iyul 1 048 000 - «Умумий ҳисобот» dagi 19 850 →
 *                      20 112 × 4 000; avgust 252 000);
 *   • `officialSold` - TP BALANS hisoblagichlari yig'indisi, ya'ni fiderdan
 *                      TP larga HAQIQATAN yetib borgan energiya
 *                      (iyul 722 507,7; avgust 201 426,3).
 *
 * Iste'molchi hisoblagichlari yig'indisi foydali oqim sifatida OLINMAYDI:
 * iyulda u 922 792,4 - balans hisoblagichlaridan 200 ming kWh ortiq, chunki
 * 19 ta TP da hisoblagich yoki tok transformatori nosoz. U raqam yo'qolmaydi,
 * kartada ikkinchi darajada ko'rinib turadi.
 *
 * `null` = qiymat kelmagan; bunday holda TP hisoblagichlaridan yig'ilgan
 * o'lchov ishlatiladi va u kartada baribir ikkinchi darajada ko'rinadi.
 */
interface PeriodSpec {
  sheet: string;
  period: string;
  start: string;
  end: string;
  days: number;
  /** Oy uchun biriktirilgan rasmiy qiymatlar; `null` = kelmagan. */
  officialIn: number | null;
  officialSold: number | null;
  /**
   * Shu oyda «Muammolar» varag'idagi TP lar NOSOZ deb belgilanadimi.
   *
   * Varaq holatni «shu paytgacha», ya'ni oxirgi (avgust) holatiga ko'ra
   * beradi va iyul uchun nosozlik qayd etilmagan. Shuning uchun iyulda hamma
   * TP soz deb yoziladi, nosozlik esa avgustda paydo bo'ladi.
   */
  faultsFromProblems: boolean;
  /**
   * Qarzdorlik - SO'MDA yoziladi (mijoz shu ko'rinishda beradi), bazaga esa
   * mln so'mga o'girib tushadi. Manba Excel fayllarida yo'q, alohida
   * berilgan.
   */
  debtPopulationSum: number;
  debtLegalSum: number;
  /** Abonentlar faylidagi ustun raqamlari. */
  activeCol: number;
  disconnectedCol: number;
}

const PERIODS: PeriodSpec[] = [
  {
    sheet: 'Iyul', period: '2026-07', start: '2026-07-01', end: '2026-07-31',
    days: 31, officialIn: 1_048_000, officialSold: 722_507.7, faultsFromProblems: false,
    debtPopulationSum: 275_788_690, debtLegalSum: 128_764_000,
    // «xaqulobod_itemolchilar.xlsx» dagi ustunlar: aloqada / aloqadamas.
    activeCol: 6, disconnectedCol: 7,
  },
  {
    sheet: 'Avgust', period: '2026-08', start: '2026-08-01', end: '2026-08-10',
    days: 10, officialIn: 252_000, officialSold: 201_426.3, faultsFromProblems: true,
    debtPopulationSum: 261_861_400, debtLegalSum: 68_430_140,
    activeCol: 8, disconnectedCol: 9,
  },
];

// ─── Excel yordamchilari ─────────────────────────────────────────────────────

const val = (c: ExcelJS.Cell): unknown => {
  const v = c.value;
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    const o = v as { result?: unknown; text?: string };
    if (o.result !== undefined) return o.result;
    return o.text ?? null;
  }
  return v;
};

const numOf = (c: ExcelJS.Cell): number => {
  const v = val(c);
  if (typeof v === 'number') return v;
  const n = Number(String(v ?? '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

const r2 = (x: number): number => Math.round(x * 100) / 100;

/**
 * Kunlik tejamkorlikni oyga keltirish koeffitsienti.
 *
 * 30 - kalendar oyning taxminiy uzunligi. Bu YAGONA taxmin: kunlik farqning
 * o'zi o'lchangan, uni oyga yoyish esa "shu sur'at davom etadi" degan faraz.
 * Shuning uchun karta raqamni "oyiga" deb ko'rsatadi.
 */
const DAYS_PER_MONTH = 30;

/** Xatlov yozuvlarini keyin qayta topish uchun belgi. */
const SOURCE_TAG = '[manba: xaqulobod_fider.xlsx · бир кунлик · xatlov]';

/** Reja ishlari uchun belgi. */
const PROBLEM_TAG = '[manba: xaqulobod_fider.xlsx · Muammolar]';

/**
 * «Muammolar» varag'idagi kirillcha izohlarning lotincha ko'rinishi.
 *
 * FAQAT YOZUV TIZIMI o'zgaradi - mazmun manbadagidek qoladi va asl matn
 * izohda saqlanadi. Qanday chora ko'rilishi (hisoblagich almashtiriladimi,
 * ta'mirlanadimi) hujjatda YOZILMAGAN, shuning uchun sarlavha muammoni
 * ataydi, yechimni EMAS.
 */
const PROBLEM_LABEL_UZ: Record<string, string> = {
  'Баланс хисоблагич носоз': 'balans hisoblagichi nosoz',
  'Баланс хисоблагич тока трансформатори носоз':
    'balans hisoblagichining tok transformatori nosoz',
  'Истеъмолчилар тури бриктирилди': 'iste’molchilar turi biriktirilgan',
};

/**
 * `effect_loss_pct_*` ustunlarida `CHECK (... BETWEEN 0 AND 100)` turibdi,
 * manba foizi esa nosoz hisoblagichli TP larda MANFIY. Bunday qatorda foiz
 * NULL qoldiriladi: kWh dagi natija baribir yoziladi, foiz shakli esa bu
 * holatga ma'nosiz. Yolg'on nol yozilmaydi.
 */
const pctOrNull = (x: number): number | null =>
  x >= 0 && x <= 100 ? Number(x.toFixed(2)) : null;

/**
 * TP kodini registr ko'rinishiga keltiradi.
 *
 * Faylda «10», «122A», registrda esa «TP-010», «TP-122A». Bundan tashqari
 * registrda uchta kod KIRILL «А» (U+0410) bilan yozilgan (TP-166А, TP-44А,
 * TP-47А), faylda esa lotin «A». Shuning uchun taqqoslashda ikkala tomon ham
 * kirilldan lotinga normallashtiriladi.
 */
const normalize = (s: string): string => s.trim().toUpperCase().replace(/А/g, 'A');

function tpKey(raw: string): string {
  const c = normalize(raw);
  return `TP-${/^\d+$/.test(c) ? c.padStart(3, '0') : c}`;
}

/**
 * Davr jamini `n` kunga teng taqsimlaydi.
 * Oxirgi kun qoldiqni oladi - yig'indi manba songa AYNAN teng bo'ladi.
 * Manfiy qiymatlar bilan ham to'g'ri ishlaydi.
 */
function spread(total: number, n: number): number[] {
  const per = r2(total / n);
  const out = Array.from({ length: n }, () => per);
  out[n - 1] = r2(total - per * (n - 1));
  return out;
}

function datesOf(start: string, n: number): string[] {
  const d0 = new Date(`${start}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(d0);
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

interface TpReading {
  tp: string;
  balance: number;
  consumers: number;
}

async function readSheet(wb: ExcelJS.Workbook, sheet: string): Promise<TpReading[]> {
  const ws = wb.getWorksheet(sheet);
  if (!ws) throw new Error(`«${sheet}» varag'i topilmadi`);

  const out: TpReading[] = [];
  // 1-qator sarlavha, 2-qator ustun nomlari, ma'lumot 3-qatordan boshlanadi.
  for (let r = 3; r <= ws.rowCount; r += 1) {
    const row = ws.getRow(r);
    const tp = String(val(row.getCell(2)) ?? '').trim();
    if (tp === '') continue;
    out.push({ tp, balance: numOf(row.getCell(5)), consumers: numOf(row.getCell(6)) });
  }
  return out;
}

interface ConsumerRow {
  total: number;
  active: number;
  disconnected: number;
}

/**
 * Abonentlar varag'i - TP bo'yicha jami / aloqada / aloqadamas.
 *
 * Bo'sh katak 0 degani (hujjatda nol yozilmagan). Har qatorda
 * «aloqada + aloqadamas = jami» ayniyati bajarilishi TEKSHIRILADI -
 * buzilgan qator jimgina o'tib ketmasin.
 */
function readConsumers(
  wb: ExcelJS.Workbook, activeCol: number, disconnectedCol: number,
): Map<string, ConsumerRow> {
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('Abonentlar varag‘i topilmadi');

  const out = new Map<string, ConsumerRow>();
  // 1-qator sarlavha, ma'lumot 2-qatordan.
  for (let r = 2; r <= ws.rowCount; r += 1) {
    const row = ws.getRow(r);
    const tp = String(val(row.getCell(3)) ?? '').trim();
    if (tp === '') continue;

    const total = numOf(row.getCell(5));
    const active = numOf(row.getCell(activeCol));
    const disconnected = numOf(row.getCell(disconnectedCol));
    if (active + disconnected !== total) {
      throw new Error(
        `Abonentlar izchil emas (TP «${tp}»): ${active} + ${disconnected} ≠ ${total}`,
      );
    }
    out.set(tpKey(tp), { total, active, disconnected });
  }
  return out;
}

/** «Хатлов» - bitta TP ning tekshiruvdan oldingi va keyingi o'lchovi. */
interface Inspection {
  tp: string;
  dateBefore: string;
  dateAfter: string;
  lossBefore: number;
  lossAfter: number;
  pctBefore: number;
  pctAfter: number;
  note: string | null;
}

/**
 * Sana katagi uch xil kelishi mumkin: formula natijasi sifatida `Date`,
 * ISO satr yoki «01/08/2026» ko'rinishidagi matn.
 */
const asDate = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

/**
 * «бир кунлик» varag'i - hisoblagichlar XATLOVI o'tkazilgan TP lar.
 *
 * Har qatorda ikkita o'lchov yonma-yon turadi: xatlovdan oldin (3–7-ustunlar)
 * va keyin (9–12-ustunlar). Ikkisi orasidagi farq - ishning O'LCHANGAN
 * natijasi, ya'ni bu yagona joy bo'lib, undan «Amalga oshirilgan ishlar»
 * paneli haqiqiy raqam bilan to'ladi.
 */
function readInspections(wb: ExcelJS.Workbook): Inspection[] {
  const ws = wb.getWorksheet('бир кунлик');
  if (!ws) return [];

  const out: Inspection[] = [];
  for (let r = 5; r <= ws.rowCount; r += 1) {
    const row = ws.getRow(r);
    const tp = String(val(row.getCell(2)) ?? '').trim();
    // Oxirgi qator - «Жами» yig'indisi, TP nomi yo'q.
    if (tp === '' || !/\d/.test(tp)) continue;

    const dateBefore = asDate(val(row.getCell(3)));
    const dateAfter = asDate(val(row.getCell(9)));
    if (!dateBefore || !dateAfter) continue;

    const balAfter = numOf(row.getCell(10));
    const lossAfter = numOf(row.getCell(12));
    out.push({
      tp,
      dateBefore,
      dateAfter,
      lossBefore: numOf(row.getCell(6)),
      lossAfter,
      pctBefore: numOf(row.getCell(7)),
      // «Keyin» foizi ustunda yo'q - o'sha qatordagi ikki sondan chiqadi.
      pctAfter: balAfter !== 0 ? (lossAfter / balAfter) * 100 : 0,
      note: String(val(row.getCell(8)) ?? '').trim() || null,
    });
  }
  return out;
}

async function readProblems(wb: ExcelJS.Workbook): Promise<Map<string, string>> {
  const ws = wb.getWorksheet('Muammolar');
  const map = new Map<string, string>();
  if (!ws) return map;
  for (let r = 3; r <= ws.rowCount; r += 1) {
    const row = ws.getRow(r);
    const tp = String(val(row.getCell(2)) ?? '').trim();
    const note = String(val(row.getCell(3)) ?? '').trim();
    if (tp !== '' && note !== '') map.set(tpKey(tp), note);
  }
  return map;
}

const num = (x: number): string => x.toLocaleString('en-US', { maximumFractionDigits: 1 });

async function main(): Promise<void> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(FILE);

  const cwb = new ExcelJS.Workbook();
  await cwb.xlsx.readFile(CONSUMERS_FILE);

  const problems = await readProblems(wb);
  const inspections = readInspections(wb);
  const sheets = await Promise.all(PERIODS.map((p) => readSheet(wb, p.sheet)));
  const consumers = PERIODS.map((p) => readConsumers(cwb, p.activeCol, p.disconnectedCol));

  const pool = new pg.Pool({ ...config.db, max: 2 });
  const c = await pool.connect();

  try {
    const mfy = await c.query<{ id: number }>(
      `SELECT id FROM ref.mfy WHERE code = $1`, [FEEDER_CODE],
    );
    const mfyId = mfy.rows[0]?.id;
    if (!mfyId) throw new Error(`Fider (${FEEDER_CODE}) registrda topilmadi`);

    const adminRes = await c.query<{ id: number }>(
      `SELECT id FROM sec.app_user WHERE role = 'admin' ORDER BY id LIMIT 1`,
    );
    const adminId = adminRes.rows[0]?.id;
    if (!adminId) throw new Error('admin foydalanuvchi topilmadi');

    // TP kodi → id. Registr tomoni ham normallashtiriladi (kirill «А»).
    const tpRes = await c.query<{ id: number; code: string }>(
      `SELECT id, code FROM ref.tp WHERE mfy_id = $1`, [mfyId],
    );
    const tpByCode = new Map(tpRes.rows.map((t) => [normalize(t.code), t.id]));

    /** Tayyor kod bo'yicha («TP-024») - registrdagi kirill «А» hisobga olinadi. */
    const resolveCode = (code: string): number => {
      const id = tpByCode.get(normalize(code));
      if (id === undefined) throw new Error(`TP registrda topilmadi: ${code}`);
      return id;
    };

    /** Fayldagi xom nom bo'yicha («24», «122A»). */
    const resolve = (raw: string): number => resolveCode(tpKey(raw));

    // Audit triggeri ommaviy yuklashda o'chiriladi - boshqa skriptlar bilan bir xil.
    const trg = await c.query<{ sch: string; tbl: string }>(`
      SELECT n.nspname AS sch, c.relname AS tbl
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE t.tgname = 'zz_audit' AND NOT t.tgisinternal`);
    for (const r of trg.rows) {
      await c.query(`ALTER TABLE ${r.sch}.${r.tbl} DISABLE TRIGGER zz_audit`);
    }

    await c.query('BEGIN');

    // ── 1. Tozalash ────────────────────────────────────────────────────────
    console.log('Eski fakt ma’lumoti o‘chirilmoqda…');
    for (const t of [
      'tp_loss_daily', 'tp_monthly', 'feeder_monthly', 'energy_balance_daily',
      'mfy_monthly_return', 'tp_status_monthly', 'tp_reading_daily', 'network_defect',
      'debt_top_entry', 'violation_act', 'work_photo', 'work', 'daily_form',
      'passport_snapshot', 'submission',
    ]) {
      const { rowCount } = await c.query(`DELETE FROM fact.${t}`);
      if (rowCount) console.log(`  fact.${t}: ${rowCount} qator`);
    }

    // ── 2. Har bir davr ────────────────────────────────────────────────────
    let tpRows = 0;
    for (const [i, p] of PERIODS.entries()) {
      const readings = sheets[i]!;
      const dates = datesOf(p.start, p.days);

      const subRes = await c.query<{ id: number }>(
        `INSERT INTO fact.submission
           (scope_type, scope_id, domain, period_type, period_start, period_end,
            status, created_by, reviewed_by, reviewed_at, submitted_at)
         VALUES ('MFY', $1, 'ENERGY_BALANCE', 'MONTH', $2::date, $3::date,
                 'approved', $4, $4, now(), now())
         RETURNING id`,
        [mfyId, p.start, p.end, adminId],
      );
      const subId = subRes.rows[0]!.id;

      // Foydali oqim - TP kunlik iste'molchi qiymatlaridan YIG'ILADI.
      const feederSold = Array.from({ length: p.days }, () => 0);

      const cons = consumers[i]!;

      for (const rd of readings) {
        const tpId = resolve(rd.tp);
        const bal = spread(rd.balance, p.days);
        const con = spread(rd.consumers, p.days);
        const note = problems.get(tpKey(rd.tp)) ?? null;

        /*
         * TP oylik kesimi: abonentlar «xaqulobod_itemolchilar.xlsx» dan,
         * oylik iste'mol esa fider faylining «Foydali oqim» ustunidan.
         * Hisoblagich raqami/koeffitsienti/ko'rsatkichlari IKKALA faylda
         * ham yo'q - ular sukut qiymatida qoladi.
         */
        const cr = cons.get(tpKey(rd.tp));
        if (!cr) throw new Error(`Abonentlar faylida TP topilmadi: «${rd.tp}»`);
        await c.query(
          `INSERT INTO fact.tp_monthly
             (tp_id, period_month, consumers_total, consumers_active,
              consumers_disconnected, kwh_month)
           VALUES ($1, $2::date, $3, $4, $5, $6)`,
          [tpId, p.start, cr.total, cr.active, cr.disconnected, rd.consumers],
        );

        for (let d = 0; d < p.days; d += 1) {
          feederSold[d] = r2(feederSold[d]! + con[d]!);
          await c.query(
            `INSERT INTO fact.tp_loss_daily
               (tp_id, biz_date, kwh_balance_meter, kwh_consumers_attached,
                source, file_name, note, created_by, updated_by)
             VALUES ($1, $2::date, $3, $4, 'EXCEL', $5, $6, $7, $7)`,
            [tpId, dates[d], bal[d], con[d], 'xaqulobod_fider.xlsx', note, adminId],
          );
          tpRows += 1;
        }
      }

      const totalInTp = r2(readings.reduce((a, r) => a + r.balance, 0));
      const totalSold = r2(readings.reduce((a, r) => a + r.consumers, 0));

      /*
       * AMALDAGI kirim - rasmiy qiymat kelgan bo'lsa o'sha, aks holda TP
       * balans hisoblagichlari yig'indisi. Kunlik qatorlarga AYNAN shu son
       * yoziladi, chunki `agg.mfy_daily`/`mfy_monthly` va ular orqali barcha
       * ko'rsatkichlar (yo'qotish, foizi, samaradorlik) shu qatorlardan
       * yig'iladi - alohida hisob-kitob mantig'i kerak emas.
       */
      const effectiveIn = p.officialIn ?? totalInTp;
      const effectiveSold = p.officialSold ?? totalSold;
      const dailyIn = spread(effectiveIn, p.days);
      /*
       * Rasmiy foydali oqim kelgan bo'lsa u ham kunlarga teng taqsimlanadi;
       * kelmagan bo'lsa TP iste'molchilaridan kun-ba-kun yig'ilgan qiymat
       * ishlatiladi (u kunlik tebranishni saqlaydi).
       */
      const dailySold = p.officialSold === null ? feederSold : spread(p.officialSold, p.days);

      for (let d = 0; d < p.days; d += 1) {
        await c.query(
          `INSERT INTO fact.energy_balance_daily
             (submission_id, mfy_id, biz_date, kwh_in, kwh_sold)
           VALUES ($1, $2, $3::date, $4, $5)`,
          [subId, mfyId, dates[d], dailyIn[d], dailySold[d]],
        );
      }

      /*
       * Fider oylik balansi. Hisoblagich ko'rsatkichlari (meter_prev/curr/coef)
       * faylda YO'Q - ular sukut bo'yicha 0/0/1 bo'lib qoladi va interfeys
       * «Fider hisoblagichi» kartasida ma'lumot yo'qligini ko'rsatadi.
       */
      await c.query(
        `INSERT INTO fact.feeder_monthly
           (mfy_id, period_month, kwh_in, kwh_sold,
            kwh_in_official, kwh_in_tp, kwh_sold_official, kwh_sold_tp, source)
         VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, 'EXCEL')`,
        [mfyId, p.start, effectiveIn, effectiveSold,
          p.officialIn, totalInTp, p.officialSold, totalSold],
      );

      /*
       * Fider darajasidagi abonentlar hisoboti - TP kesimidan yig'iladi.
       *
       * AHOLI / YURIDIK ajratmasi hujjatda YO'Q, shuning uchun jami son
       * ajratilmagan holda `consumers_population` ga yoziladi va
       * `consumers_legal` 0 bo'lib qoladi (baza `consumers_total` ni shu
       * ikkisidan hosil qiladi). Bu taxmin emas - shunchaki mavjud yagona
       * raqamni buzmasdan saqlash usuli.
       *
       * Qarzdorlik, yangi ulanganlar va hisoblagich ko'rsatkichlari ikkala
       * faylda ham yo'q - ular 0 bo'lib qoladi.
       */
      const cTotal = [...cons.values()].reduce((a, x) => a + x.total, 0);
      const cActive = [...cons.values()].reduce((a, x) => a + x.active, 0);
      const cDisc = [...cons.values()].reduce((a, x) => a + x.disconnected, 0);

      const mrSub = await c.query<{ id: number }>(
        `INSERT INTO fact.submission
           (scope_type, scope_id, domain, period_type, period_start, period_end,
            status, created_by, reviewed_by, reviewed_at, submitted_at)
         VALUES ('MFY', $1, 'MONTHLY_RETURN', 'MONTH', $2::date, $3::date,
                 'approved', $4, $4, now(), now())
         RETURNING id`,
        [mfyId, p.start, p.end, adminId],
      );
      /*
       * Qarzdorlik so'mdan MLN SO'MGA o'giriladi - baza shu birlikda
       * saqlaydi. Budjet tashkilotlari ulushi berilmagan, 0 bo'lib qoladi.
       */
      const debtPopMln = p.debtPopulationSum / 1e6;
      const debtLegalMln = p.debtLegalSum / 1e6;
      await c.query(
        `INSERT INTO fact.mfy_monthly_return
           (submission_id, mfy_id, period_month, consumers_population, consumers_legal,
            consumers_active, consumers_disconnected,
            debt_population_mln, debt_legal_mln)
         VALUES ($1, $2, $3::date, $4, 0, $5, $6, $7, $8)`,
        [mrSub.rows[0]!.id, mfyId, p.start, cTotal, cActive, cDisc,
          debtPopMln, debtLegalMln],
      );

      /*
       * TP OYLIK HOLATI - «Transformatorlar» kartasidagi nosoz/soz tarkibi
       * shundan chiqadi. Nosozlik manbai «Muammolar» varag'i, sabab esa
       * o'sha yerdagi matnning o'zi (`ts_repair_reason` cheklovi sababsiz
       * "ta'mir kerak" yozishga yo'l qo'ymaydi).
       *
       * Yuklama foizi va cho'qqi quvvat manbada YO'Q - 0 bo'lib qoladi.
       */
      const tsSub = await c.query<{ id: number }>(
        `INSERT INTO fact.submission
           (scope_type, scope_id, domain, period_type, period_start, period_end,
            status, created_by, reviewed_by, reviewed_at, submitted_at)
         VALUES ('MFY', $1, 'TP_STATUS', 'MONTH', $2::date, $3::date,
                 'approved', $4, $4, now(), now())
         RETURNING id`,
        [mfyId, p.start, p.end, adminId],
      );
      let faulty = 0;
      for (const rd of readings) {
        const problem = p.faultsFromProblems ? (problems.get(tpKey(rd.tp)) ?? null) : null;
        if (problem) faulty += 1;
        await c.query(
          `INSERT INTO fact.tp_status_monthly
             (submission_id, tp_id, period_month, condition, under_load,
              repair_needed, repair_reason)
           VALUES ($1, $2, $3::date, $4, true, $5, $6)`,
          [
            tsSub.rows[0]!.id, resolve(rd.tp), p.start,
            problem ? 'FAULT' : 'GOOD', problem !== null, problem,
          ],
        );
      }

      const loss = r2(effectiveIn - effectiveSold);
      const pct = effectiveIn !== 0 ? (loss / effectiveIn) * 100 : 0;
      console.log(
        `\n${p.sheet} (${p.start} … ${p.end}, ${p.days} kun, ${readings.length} ta TP)`
        + `\n  rasmiy kirim           ${p.officialIn === null ? '- (kelmagan)' : `${num(p.officialIn)} kWh`}`
        + `\n  TP balans hisoblagichi ${num(totalInTp)} kWh`
        + `\n  AMALDAGI kirim         ${num(effectiveIn)} kWh`
        + `\n  rasmiy foydali oqim    ${p.officialSold === null ? '- (kelmagan)' : `${num(p.officialSold)} kWh`}`
        + `\n  TP iste’molchilari     ${num(totalSold)} kWh`
        + `\n  AMALDAGI foydali oqim  ${num(effectiveSold)} kWh`
        + `\n  yo‘qotish              ${num(loss)} kWh (${pct.toFixed(2)}%)`
        + `\n  abonentlar             ${num(cTotal)} ta`
        + ` (aloqada ${num(cActive)}, aloqadamas ${num(cDisc)})`
        + `\n  transformatorlar       ${readings.length} ta`
        + ` (nosoz ${faulty}, soz ${readings.length - faulty})`
        + `\n  qarzdorlik             ${num(debtPopMln + debtLegalMln)} mln so‘m`
        + ` (aholi ${num(debtPopMln)}, yuridik ${num(debtLegalMln)})`,
      );
    }

    // ── 3. Xatlov ishlari ──────────────────────────────────────────────────
    /*
     * Yo'qotish KAMAYGAN TP lar uchungina ish yozuvi ochiladi.
     *
     * Qolganlarida yo'qotish ikkala o'lchovda ham MANFIY (balans hisoblagichi
     * yoki tok transformatori nosoz): |yo'qotish| kichraygan bo'lsa-da,
     * `lossBefore − lossAfter` manfiy chiqadi va uni "tejamkorlik" deb
     * yozish `effect_saving_kwh_month >= 0` cheklovini ham, haqiqatni ham
     * buzardi. Ular tekshiruv ro'yxatida qoladi, natija sifatida emas.
     */
    const improved = inspections.filter((x) => x.lossBefore - x.lossAfter > 0);
    console.log(
      `\nXatlov - ${inspections.length} ta TP o‘lchangan,`
      + ` ${improved.length} tasida yo‘qotish kamaygan`
      + (inspections.length - improved.length > 0
        ? `, ${inspections.length - improved.length} tasi o‘tkazib yuborildi (manfiy yo‘qotish)` : ''),
    );

    for (const x of improved) {
      const perDay = r2(x.lossBefore - x.lossAfter);
      const savingMonth = r2(perDay * DAYS_PER_MONTH);
      const code = tpKey(x.tp);
      await c.query(
        `INSERT INTO fact.work
           (mfy_id, tp_id, work_type, title_uz, description, status,
            planned_start, planned_end, actual_end, progress_pct,
            effect_loss_pct_before, effect_loss_pct_after, effect_saving_kwh_month)
         VALUES ($1, $2, 'OTHER', $3, $4, 'COMPLETED', $5::date, $6::date, $6::date, 100,
                 $7, $8, $9)`,
        [
          mfyId, resolve(x.tp),
          `${code} - hisoblagichlar xatlovi`,
          `Balans hisoblagichi va biriktirilgan iste'molchilar o'lchovi`
          + ` ${x.dateBefore} va ${x.dateAfter} kunlari solishtirildi:`
          + ` kunlik yo'qotish ${Math.round(x.lossBefore)} → ${Math.round(x.lossAfter)} kWh.`
          + (x.note ? ` Hisobotdagi "Хатловдан кейин" belgisi: ${x.note}.` : '')
          + ` Oylik tejamkorlik kunlik farqni ${DAYS_PER_MONTH} kunga yoyish orqali olindi.`
          + ` ${SOURCE_TAG}`,
          x.dateBefore, x.dateAfter,
          pctOrNull(x.pctBefore), pctOrNull(x.pctAfter), savingMonth,
        ],
      );
      console.log(
        `  ${code}  ${x.dateBefore} → ${x.dateAfter}`
        + `  ${num(Math.round(x.lossBefore))} → ${num(Math.round(x.lossAfter))} kWh/kun`
        + `  ·  tejaldi ${num(Math.round(savingMonth))} kWh/oy`,
      );
    }

    // ── 4. Muammolar → rejalashtirilgan ishlar ─────────────────────────────
    /*
     * «Muammolar» varag'idagi har bir TP uchun bitta REJA ishi ochiladi.
     * Varaq sarlavhasining o'zi aytadi: «ayrim muammolar qisman hal qilingan
     * ... ammo to'liq hal etilmagan» - ya'ni ular hamon ochiq ish.
     *
     * MUDDAT YOZILMAYDI: hujjatda sana yo'q, o'ylab topilgan muddat esa
     * rejani soxta aniq ko'rsatardi. `planned_start`/`planned_end` NULL
     * qoladi va interfeys muddatni «-» deb ko'rsatadi.
     *
     * `work_type = OTHER`: nosozlik TURI ma'lum, lekin ko'riladigan CHORA
     * (almashtirish / ta'mirlash) hujjatda yozilmagan - aniqroq tur tanlash
     * tekshirilmagan da'vo bo'lardi.
     */
    let planned = 0;
    for (const [code, note] of [...problems.entries()].sort()) {
      const labelUz = PROBLEM_LABEL_UZ[note] ?? note;
      await c.query(
        `INSERT INTO fact.work
           (mfy_id, tp_id, work_type, title_uz, description, status, progress_pct)
         VALUES ($1, $2, 'OTHER', $3, $4, 'PLANNED', 0)`,
        [
          mfyId, resolveCode(code),
          `${code} - ${labelUz}`,
          `Hisobotning «Muammolar» varag'ida qayd etilgan: «${note}».`
          + ' Muddat va ko’riladigan chora hujjatda ko’rsatilmagan.'
          + ` ${PROBLEM_TAG}`,
        ],
      );
      planned += 1;
    }
    console.log(`\nMuammolar - ${planned} ta TP uchun reja ishi ochildi`);

    await c.query('COMMIT');

    for (const r of trg.rows) {
      await c.query(`ALTER TABLE ${r.sch}.${r.tbl} ENABLE TRIGGER zz_audit`);
    }

    console.log(`\nfact.tp_loss_daily: ${tpRows} qator`);
    console.log('Agregatlar yangilanmoqda…');
    await c.query('SELECT agg.refresh_all(false)');
    console.log('✓ Tayyor.');
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
