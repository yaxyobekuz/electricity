/**
 * Tahliliy funksiyalar: anomaliya aniqlash va yo'qotish prognozi.
 *
 * Ikkalasi ham QOIDAGA ASOSLANGAN — o'rtacha/standart chetlanish chegarasi va
 * eng kichik kvadratlar chizig'i, mashinali o'qitish EMAS. Yangi npm paket
 * kerak emas, natija esa oson tekshiriladigan bo'lib qoladi: hokim "nega bu
 * anomaliya?" desa, javob aniq raqam bo'ladi, "model shunday dedi" emas.
 *
 * Bu fayl `db/queries/dashboard.ts` dagi MAVJUD so'rovlarni chaqiradi, yangi
 * SQL yozmaydi. `ai-tools.ts` va `alerts.ts` KEYINROQ shu faylni import
 * qiladi — teskarisi emas, aylanma import (circular import) bo'lmasin.
 */
import type { AppContext } from '../db/pool.ts';
import * as q from '../db/queries/dashboard.ts';

// ─── Natija turlari ─────────────────────────────────────────────────────────

export interface DailyLossAnomaly {
  type: 'day';
  date: string;
  lossPct: number;
  meanLossPct: number;
  stdDevLossPct: number;
  /** Necha standart chetlanish — ishorasi yo'nalishni bildiradi (+ yuqori, - past). */
  deviationStdDev: number;
  severity: 'medium' | 'high';
  messageUz: string;
}

export interface TpStatusAnomaly {
  type: 'tp';
  tpId: number;
  code: string;
  mfyId: number;
  mfyName: string;
  condition: 'OVERLOAD' | 'FAULT';
  loadPct: number | null;
  severity: 'medium' | 'high';
  messageUz: string;
}

export interface AnomalyReport {
  period: string;
  dailyAnomalies: DailyLossAnomaly[];
  tpAnomalies: TpStatusAnomaly[];
}

export interface MonthlyLossPoint {
  period: string;
  lossPct: number;
}

export interface LossForecastPoint {
  period: string;
  projectedLossPct: number;
}

export interface LossForecast {
  historyMonths: MonthlyLossPoint[];
  forecast: LossForecastPoint[];
  trendSlopePerMonth: number;
}

// ─── Anomaliya aniqlash ─────────────────────────────────────────────────────

const ANOMALY_STDDEV_THRESHOLD = 2;
const HIGH_SEVERITY_STDDEV_THRESHOLD = 3;
/** Ortiqcha yuklama shundan oshsa OVERLOAD ham 'high' ga ko'tariladi. */
const HIGH_SEVERITY_LOAD_PCT = 120;

/**
 * Kunlik yo'qotish % va TP holati bo'yicha anomaliyalarni topadi.
 *
 * Ikki mustaqil manba bor: kunlik seriya statistik chetlanish (mean ± 2σ)
 * bo'yicha tekshiriladi, TP holati esa reestrdagi ENUM qiymati bo'yicha —
 * ular birlashtirilmaydi, chunki tabiati boshqa (uzluksiz o'lchov vs holat).
 */
export async function detectAnomalies(
  ctx: AppContext, feederId: number | null, period: string,
): Promise<AnomalyReport> {
  const [range, tpRows] = await Promise.all([
    q.dataRange(ctx),
    q.tpMonitoring(ctx, period, feederId, 500),
  ]);

  const dailyAnomalies = range.maxDate
    ? await computeDailyAnomalies(ctx, feederId, range.minDate ?? range.maxDate, range.maxDate)
    : [];

  const tpAnomalies: TpStatusAnomaly[] = tpRows
    .filter((r) => r.condition === 'OVERLOAD' || r.condition === 'FAULT')
    .map((r) => {
      const condition = r.condition as 'OVERLOAD' | 'FAULT';
      // FAULT — jihoz nosoz, har doim jiddiy. OVERLOAD odatda 'medium', lekin
      // yuklama me'yordan sezilarli oshgan bo'lsa 'high' ga ko'tariladi.
      const severity: 'medium' | 'high' =
        condition === 'FAULT' || (r.loadPct ?? 0) > HIGH_SEVERITY_LOAD_PCT ? 'high' : 'medium';
      const messageUz = condition === 'FAULT'
        ? `${r.code} (${r.mfyName}) transformatori NOSOZ holatda — tekshirish talab qilinadi.`
        : `${r.code} (${r.mfyName}) transformatori ORTIQCHA YUKLANGAN — yuklama ${r.loadPct ?? '—'}%.`;

      return {
        type: 'tp' as const,
        tpId: r.tpId, code: r.code, mfyId: r.mfyId, mfyName: r.mfyName,
        condition, loadPct: r.loadPct, severity, messageUz,
      };
    });

  return { period, dailyAnomalies, tpAnomalies };
}

async function computeDailyAnomalies(
  ctx: AppContext, feederId: number | null, from: string, to: string,
): Promise<DailyLossAnomaly[]> {
  const rows = await q.timeSeries(ctx, from, to, 'day', feederId);

  /*
   * Kirish (kwhIn) 0 bo'lgan kunlar statistikadan chiqarib tashlanadi.
   * Bunday kun — hisobot hali kelmagani, `timeSeries` esa buni "yo'qotish
   * 0%" deb qaytaradi (dashboard.ts dagi COALESCE tufayli). Aks holda
   * ma'lumot yo'qligi soxta "g'ayrioddiy past yo'qotish" anomaliyasi
   * sifatida chiqib ketardi.
   */
  const points = rows.filter((r) => r.kwhIn > 0);
  if (points.length < 2) return [];

  const mean = points.reduce((s, p) => s + p.lossPct, 0) / points.length;
  const variance = points.reduce((s, p) => s + (p.lossPct - mean) ** 2, 0) / points.length;
  const stdDev = Math.sqrt(variance);
  if (stdDev === 0) return []; // hamma kun bir xil — chetlanish yo'q

  const anomalies: DailyLossAnomaly[] = [];
  for (const p of points) {
    const deviation = (p.lossPct - mean) / stdDev;
    const abs = Math.abs(deviation);
    if (abs <= ANOMALY_STDDEV_THRESHOLD) continue;

    const severity: 'medium' | 'high' = abs > HIGH_SEVERITY_STDDEV_THRESHOLD ? 'high' : 'medium';
    const direction = deviation > 0 ? 'yuqori' : 'past';
    const messageUz = `${p.date} kunida yo'qotish ${p.lossPct.toFixed(1)}% — o'rtachadan `
      + `(${mean.toFixed(1)}%) odatdagidan sezilarli ${direction}, `
      + `${abs.toFixed(1)} marta standart chetlanishga teng.`;

    anomalies.push({
      type: 'day',
      date: p.date,
      lossPct: p.lossPct,
      meanLossPct: Number(mean.toFixed(2)),
      stdDevLossPct: Number(stdDev.toFixed(2)),
      deviationStdDev: Number(deviation.toFixed(2)),
      severity,
      messageUz,
    });
  }
  return anomalies;
}

// ─── Yo'qotish prognozi ─────────────────────────────────────────────────────

/**
 * Oxirgi ~12 oylik yo'qotish % trendiga chiziqli regressiya o'tkazib,
 * kelasi oylarni ekstrapolyatsiya qiladi.
 *
 * `timeSeries(..., 'month', ...)` ishlatiladi — u `agg.mfy_daily` ustidan
 * to'g'ridan-to'g'ri oylik `lossPct` qaytaradi, ya'ni `districtOverview()`
 * ni har oy uchun alohida chaqirishga qaraganda bitta so'rov bilan toza
 * seriya beradi.
 */
export async function forecastLosses(
  ctx: AppContext, feederId: number | null, monthsAhead: number,
): Promise<LossForecast> {
  const range = await q.dataRange(ctx);
  if (!range.maxDate) return { historyMonths: [], forecast: [], trendSlopePerMonth: 0 };

  // Taxminan oxirgi 12 oy — lekin mavjud eng erta sanadan oldinga o'tmaydi.
  const to = range.maxDate;
  const twelveAgo = new Date(`${to}T00:00:00Z`);
  twelveAgo.setUTCMonth(twelveAgo.getUTCMonth() - 11);
  const minDate = range.minDate ? new Date(`${range.minDate}T00:00:00Z`) : twelveAgo;
  const from = (twelveAgo.getTime() > minDate.getTime() ? twelveAgo : minDate)
    .toISOString().slice(0, 10);

  const rows = await q.timeSeries(ctx, from, to, 'month', feederId);
  const historyMonths: MonthlyLossPoint[] = rows.map((r) => ({
    period: r.date.slice(0, 7),
    lossPct: r.lossPct,
  }));

  const { slope, intercept } = linearRegression(historyMonths.map((h) => h.lossPct));
  const n = historyMonths.length;
  const lastPeriod = historyMonths.at(-1)?.period ?? to.slice(0, 7);
  const steps = Math.max(0, Math.floor(monthsAhead));

  const forecast: LossForecastPoint[] = Array.from({ length: steps }, (_, k) => {
    const raw = intercept + slope * (n - 1 + k + 1);
    return {
      period: shiftMonth(lastPeriod, k + 1),
      projectedLossPct: Number(Math.min(100, Math.max(0, raw)).toFixed(2)),
    };
  });

  return { historyMonths, forecast, trendSlopePerMonth: Number(slope.toFixed(3)) };
}

/** Eng kichik kvadratlar usuli: x = oy indeksi (0..n-1), y = yo'qotish %. */
function linearRegression(ys: number[]): { slope: number; intercept: number } {
  const n = ys.length;
  if (n === 0) return { slope: 0, intercept: 0 };

  const meanX = (n - 1) / 2;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i += 1) {
    num += (i - meanX) * (ys[i]! - meanY);
    den += (i - meanX) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = meanY - slope * meanX;
  return { slope, intercept };
}

function shiftMonth(period: string, delta: number): string {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
