/**
 * Raqam / birlik formatlash — dashboard va input panel uchun yagona qoida.
 *
 * Muhim: mijoz hujjatlarida birlik chalkashligi bor (kWh vs ming kWh, mln vs mlrd so'm).
 * Shu sababli SAQLASH birligi qat'iy va formatlash faqat shu yerda bo'ladi:
 *   • energiya  → kWh          (baza), ko'rsatishda avtomatik ming/mln kWh
 *   • qarzdorlik → mln so'm    (baza), ko'rsatishda avtomatik mlrd so'm
 *   • uzunlik   → km
 *   • masofa    → m
 */

const LOCALE = 'uz-Latn-UZ';

/** Ba'zi muhitlarda `uz-Latn-UZ` mavjud emas — o'sha holatda `en-US` ga tushadi. */
function nf(options: Intl.NumberFormatOptions): Intl.NumberFormat {
  try {
    return new Intl.NumberFormat(LOCALE, options);
  } catch {
    return new Intl.NumberFormat('en-US', options);
  }
}

const cache = new Map<string, Intl.NumberFormat>();
function fmt(options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = JSON.stringify(options);
  let f = cache.get(key);
  if (!f) {
    f = nf(options);
    cache.set(key, f);
  }
  return f;
}

// ─── Umumiy raqam ────────────────────────────────────────────────────────────

export function num(value: number | null | undefined, digits = 0): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return fmt({ minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}

export function pct(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${fmt({ minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value)}%`;
}

/** Farq (foiz punkti) — doim ishora bilan. */
export function deltaPp(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const s = fmt({ minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Math.abs(value));
  if (Math.abs(value) < 10 ** -digits / 2) return `0.0 p.p.`;
  return `${value > 0 ? '+' : '−'}${s} p.p.`;
}

/** Nisbiy o'zgarish foizda — doim ishora bilan. */
export function deltaPct(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const s = fmt({ minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Math.abs(value));
  return `${value > 0 ? '↑' : value < 0 ? '↓' : ''}${s}%`;
}

// ─── Energiya (baza birligi: kWh) ────────────────────────────────────────────

export interface ScaledValue {
  value: number;
  unit: string;
  text: string;
}

export function energy(kwh: number | null | undefined): ScaledValue {
  if (kwh == null || !Number.isFinite(kwh)) return { value: 0, unit: 'kWh', text: '—' };
  const abs = Math.abs(kwh);
  if (abs >= 1e6) {
    const v = kwh / 1e6;
    return { value: v, unit: 'mln kWh', text: `${num(v, 1)} mln kWh` };
  }
  if (abs >= 1e4) {
    const v = kwh / 1e3;
    return { value: v, unit: 'ming kWh', text: `${num(v, 1)} ming kWh` };
  }
  return { value: kwh, unit: 'kWh', text: `${num(kwh, 0)} kWh` };
}

/** Faqat qiymat (birliksiz) — KPI kartalari uchun, birlik alohida ko'rsatiladi. */
export function energyParts(kwh: number | null | undefined): { value: string; unit: string } {
  const e = energy(kwh);
  return { value: kwh == null ? '—' : num(e.value, e.unit === 'kWh' ? 0 : 1), unit: e.unit };
}

/** Pasport 8 va 10-qatorlari uchun: ming kWh. */
export function thousandKwh(kwh: number | null | undefined, digits = 1): string {
  if (kwh == null || !Number.isFinite(kwh)) return '—';
  return `${num(kwh / 1000, digits)} ming kWh`;
}

// ─── Pul (baza birligi: mln so'm) ────────────────────────────────────────────

export function money(mln: number | null | undefined): ScaledValue {
  if (mln == null || !Number.isFinite(mln)) return { value: 0, unit: 'mln so‘m', text: '—' };
  if (Math.abs(mln) >= 1000) {
    const v = mln / 1000;
    return { value: v, unit: 'mlrd so‘m', text: `${num(v, 1)} mlrd so‘m` };
  }
  return { value: mln, unit: 'mln so‘m', text: `${num(mln, 1)} mln so‘m` };
}

export function moneyParts(mln: number | null | undefined): { value: string; unit: string } {
  const m = money(mln);
  return { value: mln == null ? '—' : num(m.value, 1), unit: m.unit };
}

// ─── O'lchamlar ──────────────────────────────────────────────────────────────

export const km = (v: number | null | undefined, digits = 1) => (v == null ? '—' : `${num(v, digits)} km`);
export const meters = (v: number | null | undefined) => (v == null ? '—' : `${num(v, 0)} m`);
export const kva = (v: number | null | undefined) => (v == null ? '—' : `${num(v, 0)} kVA`);
export const kw = (v: number | null | undefined) => (v == null ? '—' : `${num(v, 0)} kW`);
export const volts = (v: number | null | undefined) => (v == null ? '—' : `${num(v, 0)} V`);
export const pieces = (v: number | null | undefined) => (v == null ? '—' : `${num(v, 0)} ta`);

// ─── Sana / davr ─────────────────────────────────────────────────────────────

const MONTHS_UZ_LATN = [
  'yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun',
  'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr',
];
const MONTHS_UZ_CYRL = [
  'январ', 'феврал', 'март', 'апрел', 'май', 'июн',
  'июл', 'август', 'сентабр', 'октабр', 'ноябр', 'декабр',
];

export type Script = 'latn' | 'cyrl';

/** `2026-06` → `iyun 2026` */
export function periodLabel(period: string, script: Script = 'latn'): string {
  const [y, m] = period.split('-');
  const names = script === 'cyrl' ? MONTHS_UZ_CYRL : MONTHS_UZ_LATN;
  const name = names[Number(m) - 1];
  return name ? `${name} ${y}` : period;
}

/** `2026-06-23` → `23-iyun 2026` */
export function dateLabel(iso: string, script: Script = 'latn'): string {
  const [y, m, d] = iso.split('-');
  const names = script === 'cyrl' ? MONTHS_UZ_CYRL : MONTHS_UZ_LATN;
  const name = names[Number(m) - 1];
  return name ? `${Number(d)}-${name} ${y}` : iso;
}

/** `2026-06-23` → `23.06` (grafik o'qlari uchun) */
export function dateShort(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${d}.${m}`;
}

export function timeLabel(d: Date | string): string {
  const dt = typeof d === 'string' ? new Date(d) : d;
  return `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
}
