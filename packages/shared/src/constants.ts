/**
 * Domen konstantalari — API va Web ikkalasi uchun yagona manba.
 *
 * Bu yerdagi raqamlar mijozning haqiqiy PASPORT hujjatlaridan olingan.
 * Ularni o'zgartirish seed kalibrovkasini va tekshiruv testlarini buzadi.
 */

// ─── Rollar ──────────────────────────────────────────────────────────────────

export const ROLES = ['mfy_operator', 'elektroset_manager', 'hokimiyat_viewer', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL_UZ: Record<Role, string> = {
  mfy_operator: 'MFY operatori',
  elektroset_manager: 'Elektroset menejeri',
  hokimiyat_viewer: 'Hokimiyat kuzatuvchisi',
  admin: 'Administrator',
};

/** Ma'lumot yozish huquqiga ega rollar. */
export const WRITE_ROLES: readonly Role[] = ['mfy_operator', 'elektroset_manager', 'admin'];
/** Submission tasdiqlash huquqiga ega rollar. */
export const APPROVE_ROLES: readonly Role[] = ['elektroset_manager', 'admin'];

// ─── Submission workflow ─────────────────────────────────────────────────────

export const SUBMISSION_STATUSES = [
  'draft',
  'submitted',
  'approved',
  'rejected',
  'superseded',
] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export const SUBMISSION_STATUS_LABEL_UZ: Record<SubmissionStatus, string> = {
  draft: 'Qoralama',
  submitted: 'Yuborilgan',
  approved: 'Tasdiqlangan',
  rejected: 'Rad etilgan',
  superseded: 'Almashtirilgan',
};

/** Ruxsat etilgan holat o'tishlari. Boshqa har qanday o'tish rad etiladi. */
export const SUBMISSION_TRANSITIONS: Record<SubmissionStatus, readonly SubmissionStatus[]> = {
  draft: ['submitted'],
  submitted: ['approved', 'rejected'],
  rejected: ['draft', 'submitted'],
  approved: ['superseded'],
  superseded: [],
};

export function canTransition(from: SubmissionStatus, to: SubmissionStatus): boolean {
  return SUBMISSION_TRANSITIONS[from].includes(to);
}

// ─── Ma'lumot domenlari ──────────────────────────────────────────────────────

export const DOMAINS = [
  'ENERGY_BALANCE',
  'MONTHLY_RETURN',
  'TP_STATUS',
  'TP_READING',
  'NETWORK_DEFECT',
  'DEBT',
  'WORKS',
  'VIOLATION',
] as const;
export type Domain = (typeof DOMAINS)[number];

export const DOMAIN_LABEL_UZ: Record<Domain, string> = {
  ENERGY_BALANCE: 'Energiya balansi',
  MONTHLY_RETURN: 'Oylik hisobot',
  TP_STATUS: 'TP holati',
  TP_READING: 'TP ko‘rsatkichlari',
  NETWORK_DEFECT: 'Tarmoq nuqsonlari',
  DEBT: 'Qarzdorlik tafsiloti',
  WORKS: 'Ishlar',
  VIOLATION: 'Dalolatnomalar',
};

/** Qaysi domen qanday davriylikda kiritiladi. */
export const DOMAIN_PERIOD: Record<Domain, 'DAY' | 'MONTH'> = {
  ENERGY_BALANCE: 'MONTH', // oylik konvert, ichida kunlik qatorlar
  MONTHLY_RETURN: 'MONTH',
  TP_STATUS: 'MONTH',
  TP_READING: 'MONTH', // oylik konvert, ichida kunlik qatorlar
  NETWORK_DEFECT: 'MONTH',
  DEBT: 'MONTH',
  WORKS: 'MONTH',
  VIOLATION: 'MONTH',
};

// ─── Normalar (standartlar) ──────────────────────────────────────────────────

export const NORM_METRICS = [
  'NATURAL_LOSS_PCT',
  'TECHNICAL_LOSS_PCT',
  'TOTAL_LOSS_TARGET_PCT',
  'TP_MAX_DISTANCE_M',
  'TP_OPTIMAL_LOAD_PCT_MIN',
  'TP_OPTIMAL_LOAD_PCT_MAX',
  'TP_OVERLOAD_PCT',
  'VOLTAGE_NOMINAL_V',
  'VOLTAGE_TOLERANCE_PCT',
  'LOW_CONSUMPTION_KWH',
] as const;
export type NormMetric = (typeof NORM_METRICS)[number];

export const NORM_LABEL_UZ: Record<NormMetric, string> = {
  NATURAL_LOSS_PCT: 'Tabiiy yo‘qotish normasi',
  TECHNICAL_LOSS_PCT: 'Texnik yo‘qotish standarti',
  TOTAL_LOSS_TARGET_PCT: 'Jami yo‘qotish maqsadi',
  TP_MAX_DISTANCE_M: 'TP → iste’molchi maksimal masofa',
  TP_OPTIMAL_LOAD_PCT_MIN: 'TP optimal yuklama (min)',
  TP_OPTIMAL_LOAD_PCT_MAX: 'TP optimal yuklama (maks)',
  TP_OVERLOAD_PCT: 'TP ortiqcha yuklama chegarasi',
  VOLTAGE_NOMINAL_V: 'Nominal kuchlanish',
  VOLTAGE_TOLERANCE_PCT: 'Kuchlanish chetlanishi',
  LOW_CONSUMPTION_KWH: 'Kam iste’mol chegarasi',
};

// ─── Holat (RAG) chegaralari ─────────────────────────────────────────────────

export const RAG_STATUSES = ['good', 'warning', 'serious', 'critical'] as const;
export type RagStatus = (typeof RAG_STATUSES)[number];

export const RAG_LABEL_UZ: Record<RagStatus, string> = {
  good: 'Yaxshi',
  warning: 'Diqqat',
  serious: 'Jiddiy',
  critical: 'Tanqidiy',
};

/** Amaldagi qiymatning standartga nisbatan ko'paytmasi bo'yicha holat. */
export const RAG_MULTIPLIERS = { warning: 1.0, serious: 1.25, critical: 1.6 } as const;

export function ragByStandard(actual: number, standard: number): RagStatus {
  if (!Number.isFinite(standard) || standard <= 0) return 'good';
  const ratio = actual / standard;
  if (ratio <= RAG_MULTIPLIERS.warning) return 'good';
  if (ratio <= RAG_MULTIPLIERS.serious) return 'warning';
  if (ratio <= RAG_MULTIPLIERS.critical) return 'serious';
  return 'critical';
}

// ─── TP holati ───────────────────────────────────────────────────────────────

export const TP_CONDITIONS = ['GOOD', 'ATTENTION', 'OVERLOAD', 'FAULT'] as const;
export type TpCondition = (typeof TP_CONDITIONS)[number];

export const TP_CONDITION_LABEL_UZ: Record<TpCondition, string> = {
  GOOD: 'Yaxshi',
  ATTENTION: 'Diqqat talab qiladi',
  OVERLOAD: 'Ortiqcha yuklama',
  FAULT: 'Nosozlik',
};

// ─── Ishlar ──────────────────────────────────────────────────────────────────

export const WORK_TYPES = [
  'CABLE_REPLACEMENT',
  'TP_INSTALL',
  'TP_MODERNIZATION',
  'OVERHEAD_LINE_RENEWAL',
  'METER_REPLACEMENT',
  'TREE_CLEARING',
  'ILLEGAL_DISCONNECT',
  'SUPPORT_REPLACEMENT',
  'OTHER',
] as const;
export type WorkType = (typeof WORK_TYPES)[number];

export const WORK_TYPE_LABEL_UZ: Record<WorkType, string> = {
  CABLE_REPLACEMENT: 'Kabel almashtirish',
  TP_INSTALL: 'Transformator o‘rnatish',
  TP_MODERNIZATION: 'TP modernizatsiyasi',
  OVERHEAD_LINE_RENEWAL: 'Havo liniyasini yangilash',
  METER_REPLACEMENT: 'Hisoblagich almashtirish',
  TREE_CLEARING: 'Daraxtlardan tozalash',
  ILLEGAL_DISCONNECT: 'Noqonuniy ulanishni bartaraf etish',
  SUPPORT_REPLACEMENT: 'Tayanch ustun almashtirish',
  OTHER: 'Boshqa',
};

export const WORK_UNIT_BY_TYPE: Record<WorkType, string> = {
  CABLE_REPLACEMENT: 'km',
  TP_INSTALL: 'ta',
  TP_MODERNIZATION: 'ta',
  OVERHEAD_LINE_RENEWAL: 'km',
  METER_REPLACEMENT: 'ta',
  TREE_CLEARING: 'km',
  ILLEGAL_DISCONNECT: 'ta',
  SUPPORT_REPLACEMENT: 'ta',
  OTHER: 'ta',
};

export const WORK_STATUSES = ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
export type WorkStatus = (typeof WORK_STATUSES)[number];

export const WORK_STATUS_LABEL_UZ: Record<WorkStatus, string> = {
  PLANNED: 'Reja',
  IN_PROGRESS: 'Jarayonda',
  COMPLETED: 'Bajarildi',
  CANCELLED: 'Bekor qilindi',
};

// ─── Dalolatnoma ─────────────────────────────────────────────────────────────

export const VIOLATION_STATUSES = ['DRAFT', 'ISSUED', 'PAID', 'COURT', 'CLOSED'] as const;
export type ViolationStatus = (typeof VIOLATION_STATUSES)[number];

export const VIOLATION_STATUS_LABEL_UZ: Record<ViolationStatus, string> = {
  DRAFT: 'Qoralama',
  ISSUED: 'Berilgan',
  PAID: 'To‘langan',
  COURT: 'Sudda',
  CLOSED: 'Yopilgan',
};

/**
 * Dalolatnoma TOIFASI — `status` dan farqli o'laroq, holat qanday
 * baholanganini bildiradi (harakat holatini emas).
 */
export const VIOLATION_CASE_TYPES = ['ADMINISTRATIVE', 'CRIMINAL', 'NO_FAULT'] as const;
export type ViolationCaseType = (typeof VIOLATION_CASE_TYPES)[number];

export const VIOLATION_CASE_LABEL_UZ: Record<ViolationCaseType, string> = {
  ADMINISTRATIVE: 'Ma’muriy holat',
  CRIMINAL: 'Jinoiy holat',
  NO_FAULT: 'Iste’molchi aybsiz',
};

/** Har bir toifaning ma'nosi — kartadagi "nima asosida?" oynasi uchun. */
export const VIOLATION_CASE_MEANING_UZ: Record<ViolationCaseType, string> = {
  ADMINISTRATIVE:
    'Tekshiruvda qoidabuzarlik tasdiqlangan va ma’muriy javobgarlik qo‘llanilgan: '
    + 'dalolatnoma rasmiylashtirilib, aniqlangan energiya qiymati va jarima hisoblangan.',
  CRIMINAL:
    'Qoidabuzarlikda jinoiy ish belgilari bor: materiallar sudga yoki ichki ishlar '
    + 'organiga yuborilgan. Odatda katta hajmdagi hisobga olinmagan energiya yoki '
    + 'takroriy holat.',
  NO_FAULT:
    'Reyd yoki tekshiruv o‘tkazilgan, dalolatnoma rasmiylashtirilgan, ammo '
    + 'iste’molchining aybi tasdiqlanmagan — jarima solinmaydi. Bu holat hisobdan '
    + 'chiqarilmaydi: tekshiruv statistikasi to‘liq bo‘lishi kerak.',
};

// ─── Iste'molchi toifalari ───────────────────────────────────────────────────

export const CONSUMER_CATEGORIES = ['POPULATION', 'LEGAL', 'BUDGET'] as const;
export type ConsumerCategory = (typeof CONSUMER_CATEGORIES)[number];

export const CONSUMER_CATEGORY_LABEL_UZ: Record<ConsumerCategory, string> = {
  POPULATION: 'Aholi',
  LEGAL: 'Yuridik',
  BUDGET: 'Budjet tashkilotlari',
};

// ─── Samaradorlik indeksi ────────────────────────────────────────────────────

/**
 * Indeks komponentlari va vaznlari. Yig'indisi = 1.00.
 * Hokim "nega 85?" deb so'raganda UI aynan shu jadvalni ochib ko'rsatadi.
 */
export const EFFICIENCY_COMPONENTS = [
  { key: 'loss', weight: 0.35, labelUz: 'Yo‘qotish darajasi' },
  { key: 'debt', weight: 0.2, labelUz: 'Qarzdorlik holati' },
  { key: 'meter', weight: 0.15, labelUz: 'Hisoblagichlar aloqasi' },
  { key: 'tp', weight: 0.15, labelUz: 'TP yuklamasi' },
  { key: 'distance', weight: 0.15, labelUz: 'TP → iste’molchi masofasi' },
] as const;
export type EfficiencyComponentKey = (typeof EFFICIENCY_COMPONENTS)[number]['key'];

// ─── Balans validatsiyasi ────────────────────────────────────────────────────

/**
 * Yo'qotish tarkibi jamiga mos kelishi uchun ruxsat etilgan farq.
 * DB `eb_components` CHECK cheklovi bilan AYNAN bir xil bo'lishi shart.
 */
export function balanceTolerance(kwhIn: number): number {
  return Math.max(1, 0.005 * kwhIn);
}

// ─── Davr yordamchilari ──────────────────────────────────────────────────────

/** `YYYY-MM` → oyning birinchi kuni `YYYY-MM-01`. */
export function periodToMonthStart(period: string): string {
  return `${period}-01`;
}

/** `YYYY-MM-DD` yoki `Date` → `YYYY-MM`. */
export function toPeriod(d: string | Date): string {
  const s = typeof d === 'string' ? d : d.toISOString().slice(0, 10);
  return s.slice(0, 7);
}

/** Oydagi kunlar soni (UTC bo'yicha, vaqt mintaqasi ta'sirisiz). */
export function daysInPeriod(period: string): number {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y!, m!, 0)).getUTCDate();
}

/** Davrdagi barcha kunlar `YYYY-MM-DD` ro'yxati. */
export function periodDates(period: string): string[] {
  const n = daysInPeriod(period);
  return Array.from({ length: n }, (_, i) => `${period}-${String(i + 1).padStart(2, '0')}`);
}

/** Davrni `delta` oyga suradi. */
export function shiftPeriod(period: string, delta: number): string {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
