/**
 * TP kunlik yo'qotish uchun DEMO tarixiy ma'lumot — 2026-07-01 dan bugungacha,
 * barcha 51 TP uchun.
 *
 * Haqiqiy (`source='EXCEL'`, `8-2-2026.xlsx`dan import qilingan 14 qator)
 * HECH QACHON ustidan yozilmaydi — faqat hali BO'SH bo'lgan (tp, sana)
 * juftliklari to'ldiriladi. Generatsiya qilingan qatorlar `source='MANUAL'`
 * bilan belgilanadi — real va demo manba DB darajasida doim ajralib turadi.
 *
 * 7 ta "anomaliya" TP (haqiqiy faylda manfiy/g'ayrioddiy yo'qotish ko'rsatgan)
 * uchun ikkita haqiqiy sana nuqtasi orasida silliq o'tish, ulardan OLDIN esa
 * me'yoriy holatdan asta-sekin uzoqlashuv generatsiya qilinadi — "muammo
 * asta-sekin paydo bo'lgan, tekshiruvdan keyin qisman tuzatilgan" degan
 * izchil hikoya uchun. Qolgan 44 TP uchun FAQAT me'yoriy (anomaliyasiz)
 * qiymatlar — `analytics.detectTpLossAnomalies()` noto'g'ri signal bermasin.
 *
 *   node --experimental-strip-types apps/api/scripts/generate-tp-loss-daily.ts
 */
import { closePool, query, SYSTEM_CONTEXT } from '../src/db/pool.ts';
import { upsertTpLossDaily, type UpsertTpLossInput } from '../src/db/queries/tpLoss.ts';
import { mulberry32 } from '../seed/generate.ts';

const SEED = 20260805;
const rand = mulberry32(SEED);

/** Box–Muller — normal taqsimot (`seed/generate.ts`dagi bilan bir xil, u eksport qilinmagan). */
function gauss(mean = 0, sd = 1): number {
  const u = Math.max(rand(), 1e-9);
  const v = Math.max(rand(), 1e-9);
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

const FROM = '2026-07-01';
/** Fider kodi — `load-feeder-data.ts` shu kod bilan yozadi (`mfy_id` qat'iy emas). */
const FEEDER_CODE = 'FIDER-XAQULOBOD';
const TECH_NORM_PCT = 3.2; // ref.norm_value('TECHNICAL_LOSS_PCT', 25, ...) bilan tasdiqlangan
const MIN_BASELINE_KWH = 30; // kwh_month=0 bo'lgan TP uchun (masalan TP-039) pastki chegara

interface Anchor { date: string; lossPct: number }

/** 7 ta anomaliya TP — haqiqiy fayldan olingan ikkita sana/foiz nuqtasi. */
const ANOMALY_ANCHORS: Record<string, Anchor[]> = {
  'TP-066': [{ date: '2026-08-02', lossPct: -287.18 }, { date: '2026-08-05', lossPct: -100.47 }],
  'TP-089': [{ date: '2026-08-02', lossPct: -172.73 }, { date: '2026-08-05', lossPct: -93.34 }],
  'TP-166': [{ date: '2026-08-01', lossPct: -88.41 }, { date: '2026-08-05', lossPct: -9.23 }],
  'TP-170': [{ date: '2026-08-02', lossPct: -193.14 }, { date: '2026-08-05', lossPct: -76.16 }],
  'TP-171': [{ date: '2026-08-02', lossPct: 18.46 }, { date: '2026-08-05', lossPct: 15.54 }],
  'TP-179': [{ date: '2026-08-02', lossPct: 34.53 }, { date: '2026-08-05', lossPct: 15.95 }],
  'TP-226': [{ date: '2026-08-02', lossPct: -41.23 }, { date: '2026-08-05', lossPct: -11.2 }],
};
/** Muammo boshlanishidan necha kun oldin me'yoriy holatdan uzoqlasha boshlaydi. */
const RAMP_DAYS = 12;

function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  let d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d.getTime() <= end.getTime()) {
    out.push(d.toISOString().slice(0, 10));
    d = new Date(d.getTime() + 86_400_000);
  }
  return out;
}

/** Anomaliya TP uchun shu kundagi taxminiy yo'qotish % — ikki haqiqiy nuqta orasida/oldida silliq. */
function anomalyLossPct(anchors: Anchor[], date: string): number {
  const first = anchors[0]!;
  const last = anchors[anchors.length - 1]!;

  if (date <= first.date) {
    const daysBefore = (Date.parse(first.date) - Date.parse(date)) / 86_400_000;
    if (daysBefore >= RAMP_DAYS) return TECH_NORM_PCT + gauss(0, 1);
    const t = 1 - daysBefore / RAMP_DAYS;
    return TECH_NORM_PCT + (first.lossPct - TECH_NORM_PCT) * t + gauss(0, 2);
  }

  const span = Date.parse(last.date) - Date.parse(first.date);
  const t = span > 0 ? (Date.parse(date) - Date.parse(first.date)) / span : 1;
  return first.lossPct + (last.lossPct - first.lossPct) * clamp(t, 0, 1) + gauss(0, 2);
}

/** Dam olish kunlari iste'mol/balans biroz pastroq — `load-feeder-data.ts`dagi DAY_WEIGHTS bilan bir xil g'oya. */
function dayWeight(date: string): number {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6 ? 0.9 : 1.05;
}

async function main(): Promise<void> {
  /*
   * Oxirgi kun — BUGUN, ma'lumotlar bazasidan. `fact.tp_loss_daily` dagi
   * `tld_no_future` CHECK ham shu `CURRENT_DATE` ga qaraydi, shuning uchun
   * sana bu yerda qo'lda yozilmaydi (aks holda ertaga skript o'zi buzilardi).
   */
  const todayRows = await query<{ today: string }>(
    'SELECT CURRENT_DATE::text AS today', [], SYSTEM_CONTEXT,
  );
  const TO = todayRows[0]!.today;

  const tps = await query<{ id: number; code: string; kwh_month: number | null }>(
    `SELECT t.id, t.code, m.kwh_month
       FROM ref.tp t
       JOIN ref.mfy f ON f.id = t.mfy_id AND f.code = $1
       LEFT JOIN fact.tp_monthly m ON m.tp_id = t.id AND m.period_month = $2::date
      ORDER BY t.code`,
    [FEEDER_CODE, FROM], SYSTEM_CONTEXT,
  );
  if (tps.length === 0) throw new Error(`${FEEDER_CODE} fideri yoki uning TP lari topilmadi`);

  const existing = await query<{ tp_id: number; biz_date: string }>(
    'SELECT tp_id, biz_date::text FROM fact.tp_loss_daily', [], SYSTEM_CONTEXT,
  );
  const existingSet = new Set(existing.map((r) => `${r.tp_id}:${r.biz_date}`));

  const dates = dateRange(FROM, TO);
  const rows: UpsertTpLossInput[] = [];
  let skipped = 0;

  for (const tp of tps) {
    const anchors = ANOMALY_ANCHORS[tp.code];
    const baseline = Math.max(MIN_BASELINE_KWH, Number(tp.kwh_month ?? 0) / 31);

    for (const date of dates) {
      if (existingSet.has(`${tp.id}:${date}`)) { skipped += 1; continue; }

      const lossPct = anchors
        ? anomalyLossPct(anchors, date)
        : clamp(TECH_NORM_PCT + gauss(0, 1.3), -2, 12);

      const kwhBalanceMeter = Number(Math.max(5, baseline * dayWeight(date) * (1 + gauss(0, 0.08))).toFixed(2));
      const kwhConsumersAttached = Number(Math.max(0, kwhBalanceMeter * (1 - lossPct / 100)).toFixed(2));

      rows.push({
        tpId: tp.id, bizDate: date, kwhBalanceMeter, kwhConsumersAttached,
        inspectionNote: null, source: 'MANUAL', fileName: null,
      });
    }
  }

  process.stdout.write(
    `Davr: ${FROM} … ${TO} (${dates.length} kun × ${tps.length} TP)\n`
    + `Generatsiya qilinmoqda: ${rows.length} ta yangi qator, ${skipped} ta o'tkazib yuborildi (allaqachon mavjud)…\n`,
  );

  const { inserted, updated } = await upsertTpLossDaily(SYSTEM_CONTEXT, rows);
  process.stdout.write(`\nYozildi: ${inserted} yangi, ${updated} yangilangan.\n`);
}

main()
  .catch((err: unknown) => {
    process.stderr.write(`\n✗ Xato:\n${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
    process.exitCode = 1;
  })
  .finally(() => closePool());
