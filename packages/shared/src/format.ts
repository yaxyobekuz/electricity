/**
 * Raqam / birlik formatlash - dashboard va input panel uchun yagona qoida.
 *
 * Muhim: mijoz hujjatlarida birlik chalkashligi bor (kWh vs ming kWh, mln vs mlrd so'm).
 * Shu sababli SAQLASH birligi qat'iy va formatlash faqat shu yerda bo'ladi:
 *   • energiya  → kWh          (baza), ko'rsatishda kWh yoki ming kWh
 *   • qarzdorlik → mln so'm    (baza), ko'rsatishda avtomatik mlrd so'm
 *   • uzunlik   → km
 *   • masofa    → m
 */

const LOCALE = 'uz-Latn-UZ';

/** Ba'zi muhitlarda `uz-Latn-UZ` mavjud emas - o'sha holatda `en-US` ga tushadi. */
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
  if (value == null || !Number.isFinite(value)) return '-';
  return fmt({ minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}

export function pct(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return '-';
  return `${fmt({ minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value)}%`;
}

/** Farq (foiz punkti) - doim ishora bilan. */
export function deltaPp(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return '-';
  const s = fmt({ minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Math.abs(value));
  if (Math.abs(value) < 10 ** -digits / 2) return `0.0 p.p.`;
  return `${value > 0 ? '+' : '−'}${s} p.p.`;
}

/** Nisbiy o'zgarish foizda - doim ishora bilan. */
export function deltaPct(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return '-';
  const s = fmt({ minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Math.abs(value));
  return `${value > 0 ? '↑' : value < 0 ? '↓' : ''}${s}%`;
}

// ─── Energiya (baza birligi: kWh) ────────────────────────────────────────────

export interface ScaledValue {
  value: number;
  unit: string;
  text: string;
}

/**
 * Energiya - eng katta birlik «ming kWh».
 *
 * «Mln kWh» ATAYLAB ISHLATILMAYDI: 1 048 000 kWh «1.0 mln kWh» ko'rinishida
 * uch xonani yo'qotadi va 1 048 000 bilan 1 000 000 ni ajratib bo'lmay
 * qoladi. Fider oylik hajmi million atrofida bo'lgani uchun bu aynan eng
 * muhim joyda aniqlikni yeb qo'yardi - «1 048 ming kWh» esa manba raqamni
 * to'liq ko'rsatadi.
 *
 * Kasr xonasi kattalikka qarab tanlanadi: mingdan oshgan qiymatda o'ndan
 * bir ulush shovqin (1 048.0), kichigida esa ma'noli (722.5).
 */
export function energy(kwh: number | null | undefined): ScaledValue {
  if (kwh == null || !Number.isFinite(kwh)) return { value: 0, unit: 'kWh', text: '-' };
  const abs = Math.abs(kwh);
  if (abs >= 1e4) {
    const v = kwh / 1e3;
    const digits = Math.abs(v) >= 1000 ? 0 : 1;
    return { value: v, unit: 'ming kWh', text: `${num(v, digits)} ming kWh` };
  }
  return { value: kwh, unit: 'kWh', text: `${num(kwh, 0)} kWh` };
}

/** Faqat qiymat (birliksiz) - KPI kartalari uchun, birlik alohida ko'rsatiladi. */
export function energyParts(kwh: number | null | undefined): { value: string; unit: string } {
  const e = energy(kwh);
  if (kwh == null) return { value: '-', unit: e.unit };
  const digits = e.unit === 'kWh' || Math.abs(e.value) >= 1000 ? 0 : 1;
  return { value: num(e.value, digits), unit: e.unit };
}

/** Pasport 8 va 10-qatorlari uchun: ming kWh. */
export function thousandKwh(kwh: number | null | undefined, digits = 1): string {
  if (kwh == null || !Number.isFinite(kwh)) return '-';
  return `${num(kwh / 1000, digits)} ming kWh`;
}

// ─── Pul (baza birligi: mln so'm) ────────────────────────────────────────────

export function money(mln: number | null | undefined): ScaledValue {
  if (mln == null || !Number.isFinite(mln)) return { value: 0, unit: 'mln so‘m', text: '-' };
  if (Math.abs(mln) >= 1000) {
    const v = mln / 1000;
    return { value: v, unit: 'mlrd so‘m', text: `${num(v, 1)} mlrd so‘m` };
  }
  return { value: mln, unit: 'mln so‘m', text: `${num(mln, 1)} mln so‘m` };
}

export function moneyParts(mln: number | null | undefined): { value: string; unit: string } {
  const m = money(mln);
  return { value: mln == null ? '-' : num(m.value, 1), unit: m.unit };
}

// ─── O'lchamlar ──────────────────────────────────────────────────────────────

export const km = (v: number | null | undefined, digits = 1) => (v == null ? '-' : `${num(v, digits)} km`);
export const meters = (v: number | null | undefined) => (v == null ? '-' : `${num(v, 0)} m`);
export const kva = (v: number | null | undefined) => (v == null ? '-' : `${num(v, 0)} kVA`);
export const kw = (v: number | null | undefined) => (v == null ? '-' : `${num(v, 0)} kW`);
export const volts = (v: number | null | undefined) => (v == null ? '-' : `${num(v, 0)} V`);
export const pieces = (v: number | null | undefined) => (v == null ? '-' : `${num(v, 0)} ta`);

// ─── Sana / davr ─────────────────────────────────────────────────────────────

const MONTHS_UZ_LATN = [
  'yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun',
  'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr',
];
const MONTHS_UZ_CYRL = [
  'январ', 'феврал', 'март', 'апрел', 'май', 'июн',
  'июл', 'август', 'сентабр', 'октабр', 'ноябр', 'декабр',
];

/*
 * Qisqartmalar QO'LDA yozilgan, to'liq nomdan kesib olinmaydi:
 * `'iyun'.slice(0, 3)` va `'iyul'.slice(0, 3)` ikkalasi ham «iyu» beradi,
 * ya'ni iyun bilan iyul diagramma o'qida farqlanmay qolardi.
 */
const MONTHS_UZ_LATN_SHORT = [
  'yan', 'fev', 'mar', 'apr', 'may', 'iyn',
  'iyl', 'avg', 'sen', 'okt', 'noy', 'dek',
];
const MONTHS_UZ_CYRL_SHORT = [
  'янв', 'фев', 'мар', 'апр', 'май', 'июн',
  'июл', 'авг', 'сен', 'окт', 'ноя', 'дек',
];

export type Script = 'latn' | 'cyrl';

/**
 * TIZIM BO'YICHA YAGONA SANA KO'RINISHI: `21-may, 2025`.
 *
 * Raqamli ko'rinishlar (`21.05.2025`, `05/21/2025`, `2025-05-21`) taqiqlanadi -
 * kun/oy tartibi o'quvchiga bog'liq bo'lib qoladi va hisobotlarda chalkashlik
 * tug'diradi. Oy nomi yozilganda tartib bir ma'noli bo'ladi.
 *
 * Shuning uchun sana KO'RSATISH faqat shu yerdagi funksiyalar orqali bo'ladi:
 * komponentlarda `toLocaleDateString` yoki qo'lda `split('-')` ishlatilmaydi.
 */

/** `2026-06-23` → `23-iyun, 2026` - tizimdagi ASOSIY sana ko'rinishi. */
export function dateLabel(iso: string, script: Script = 'latn'): string {
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  const names = script === 'cyrl' ? MONTHS_UZ_CYRL : MONTHS_UZ_LATN;
  const name = names[Number(m) - 1];
  return name && y ? `${Number(d)}-${name}, ${y}` : iso;
}

/**
 * `2026-06-23` → `23.06.2026` - TOR ustunlar uchun raqamli ko'rinish.
 *
 * Ro'yxatlarda ("Amalga oshirilgan ishlar") sana ustuni ensiz bo'ladi va
 * "23-iyun, 2026" ikki qatorga bo'linib ketadi. Matnli ko'rinish esa asosiy
 * bo'lib qoladi - bu faqat jadval/ro'yxat kataklari uchun.
 */
export function dateShort(iso: string): string {
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return y && m && d ? `${d}.${m}.${y}` : iso;
}

/** `2026-06` → `06.2026` - tor kartalarda davr belgisi. */
export function monthShort(period: string): string {
  const [y, m] = String(period).slice(0, 7).split('-');
  return y && m ? `${m}.${y}` : period;
}

/** `2026-06` → `iyun, 2026` - kunsiz davr (oylik hisobotlar). */
export function periodLabel(period: string, script: Script = 'latn'): string {
  const [y, m] = String(period).split('-');
  const names = script === 'cyrl' ? MONTHS_UZ_CYRL : MONTHS_UZ_LATN;
  const name = names[Number(m) - 1];
  return name && y ? `${name}, ${y}` : period;
}

/** `periodLabel` ning taxallusi - diagramma o'qlarida ma'noni oydinlashtiradi. */
export const monthLabel = periodLabel;

/**
 * `2026-05-17` → `17-may` - yilsiz, FAQAT diagramma o'qlari uchun.
 *
 * O'qda 9 ta belgi yonma-yon turadi; har biriga yil qo'shilsa yorliqlar
 * bir-birini bosadi. Yil sarlavha va tooltipda to'liq ko'rinadi.
 */
export function dateDayMonth(iso: string, script: Script = 'latn'): string {
  const [, m, d] = String(iso).slice(0, 10).split('-');
  const names = script === 'cyrl' ? MONTHS_UZ_CYRL : MONTHS_UZ_LATN;
  const name = names[Number(m) - 1];
  return name ? `${Number(d)}-${name}` : iso;
}

/**
 * `2026-08-02` → `2-avg` - TOR diagramma o'qi uchun.
 *
 * `dateDayMonth` bir haftalik oynada («2-avgust» × 7) yorliqlarni
 * bir-biriga yopishtirib qo'yadi: panel kengligi ~340px, har bir yorliq
 * esa ~60px joy so'raydi. Qisqartma bilan ikki barobar ko'p sig'adi.
 */
export function dateDayMonthShort(iso: string, script: Script = 'latn'): string {
  const [, m, d] = String(iso).slice(0, 10).split('-');
  const names = script === 'cyrl' ? MONTHS_UZ_CYRL_SHORT : MONTHS_UZ_LATN_SHORT;
  const name = names[Number(m) - 1];
  return name ? `${Number(d)}-${name}` : iso;
}

/** `Date` yoki ISO belgi → `21-may, 2025 14:30`. */
export function dateTimeLabel(d: Date | string, script: Script = 'latn'): string {
  const dt = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return '-';
  return `${dateLabel(isoDate(dt), script)} ${timeLabel(dt)}`;
}

/** Mahalliy vaqt zonasidagi `YYYY-MM-DD` - `toISOString` UTC ga surib yuboradi. */
export function isoDate(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Qisqartirilgan raqam - diagramma o'qlari uchun: `1500000` → `1.5M`.
 *
 * O'q yorliqlari to'liq raqamlar bilan («1 500 000») bir-biriga tegib
 * ketadi va o'qib bo'lmaydi. Aniq qiymat tooltip va jadvalda qoladi.
 */
export function compact(value: number): string {
  const abs = Math.abs(value);
  const strip = (n: number): string => {
    const s = n.toFixed(1);
    return s.endsWith('.0') ? s.slice(0, -2) : s;
  };
  if (abs >= 1e9) return `${strip(value / 1e9)}B`;
  if (abs >= 1e6) return `${strip(value / 1e6)}M`;
  if (abs >= 1e3) return `${strip(value / 1e3)}k`;
  return strip(value);
}

/** `14:30` - mahalliy vaqt. */
export function timeLabel(d: Date | string): string {
  const dt = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return '-';
  return `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
}
