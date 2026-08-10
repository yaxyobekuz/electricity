/**
 * API javob tiplari - server va klient o'rtasidagi shartnoma.
 * Route handler'lar shu tiplarni qaytaradi, TanStack Query shu tiplarni oladi.
 */

import type {
  ConsumerCategory,
  Domain,
  RagStatus,
  Role,
  SubmissionStatus,
  TpCondition,
  ViolationCaseType,
  ViolationStatus,
  WorkStatus,
  WorkType,
} from './constants.ts';

// ─── Spravochniklar ──────────────────────────────────────────────────────────

export interface Elektroset {
  id: number;
  code: string;
  nameUz: string;
  nameUzCyr: string | null;
}

export interface Mfy {
  id: number;
  elektrosetId: number;
  elektrosetName: string;
  code: string;
  nameUz: string;
  nameUzCyr: string | null;
  shortName: string;
  sortOrder: number;
  gridRow: number | null;
  gridCol: number | null;
}

/** Fider bo'yicha ma'sul shaxs - bitta fider uchun bitta amaldagi yozuv. */
export interface MfyResponsible {
  mfyId: number;
  fullName: string;
  position: string | null;
  phone: string | null;
  updatedAt: string;
}

export interface Tp {
  id: number;
  mfyId: number;
  mfyName: string;
  code: string;
  name: string | null;
  ratedKva: number;
  voltageClass: string;
  avgDistanceM: number | null;
  commissionedOn: string | null;
  decommissionedOn: string | null;
}

export interface NetworkSegment {
  id: number;
  mfyId: number;
  voltageKv: number;
  lineType: 'overhead' | 'cable';
  lengthKm: number;
  installedOn: string | null;
  retiredOn: string | null;
}

export interface Norm {
  id: number;
  scopeType: 'TUMAN' | 'ELEKTROSET' | 'MFY';
  scopeId: number | null;
  metric: string;
  valueNum: number;
  unit: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  sourceDoc: string | null;
}

export interface Bootstrap {
  elektrosets: Elektroset[];
  mfys: Mfy[];
  norms: Norm[];
  categories: { code: ConsumerCategory; nameUz: string }[];
  /** Ma'lumotlar oxirgi marta qachon agregatlangani - header'dagi ishonch belgisi. */
  lastRefreshAt: string | null;
  /** Ma'lumot mavjud bo'lgan davrlar oralig'i. */
  dataRange: { minDate: string | null; maxDate: string | null };
}

// ─── Auth ────────────────────────────────────────────────────────────────────

export interface AuthUser {
  id: number;
  login: string;
  fullName: string;
  role: Role;
  /** Foydalanuvchi yoza oladigan MFY id lari (viewer/admin uchun bo'sh = hammasi). */
  mfyIds: number[];
  elektrosetIds: number[];
}

export interface LoginResponse {
  accessToken: string;
  user: AuthUser;
}

// ─── Dashboard: umumiy bloklar ───────────────────────────────────────────────

export interface KpiTile {
  key: string;
  labelUz: string;
  value: number | null;
  unit: string;
  /** O'tgan davrga nisbatan nisbiy o'zgarish, %. */
  deltaPct: number | null;
  /**
   * O'tgan davrdagi AYNIQ qiymat.
   *
   * Foizning o'zi yetarli emas: "↑ 0.2%" nimaga nisbatan ekani ko'rinmaydi.
   * Solishtirish qiymati ko'rsatilsa, raqam o'z-o'zini izohlaydi.
   */
  prevValue: number | null;
  /** Solishtirish davri, masalan `2026-05` - "o'tgan oy" degani. */
  prevPeriod: string;
  /**
   * Joriy oy hali tugamagan bo'lsa, `prevValue` o'tgan oyning TO'LIQ jami
   * emas - shu kunlar soni bo'yicha (1-kundan) olingan. `null` bo'lsa,
   * `prevValue` o'tgan oyning to'liq jami (odatiy holat).
   */
  daysCompared: number | null;
  /** O'sish yaxshimi yoki yomonmi - rangni shu belgilaydi. */
  goodDirection: 'up' | 'down';
  /** Sparkline nuqtalari. */
  spark: number[];
  /**
   * Sparkline nuqtalari qaysi davrni bildiradi.
   * Energiya ko'rsatkichlari kunlik, abonent/qarzdorlik/TP esa oylik yoziladi,
   * shuning uchun diagrammalar bir xil davrni ko'rsatmaydi - buni aytish shart.
   */
  sparkBucket: 'day' | 'month';
  /** Manba (provenance) kaliti - "i" popoveri uchun. */
  metric: string;
}

export interface EnergyBalanceNode {
  key: 'in' | 'sold' | 'loss';
  labelUz: string;
  kwh: number;
  /** Tarmoqqa kirgan energiyaga nisbatan ulushi, %. */
  pct: number;
}

export interface EfficiencyBreakdown {
  score: number;
  /** O'tgan davr bahosi - o'zgarishni ko'rsatish uchun. */
  prevScore: number | null;
  components: { key: string; labelUz: string; weight: number; score: number }[];
  /** Statistik prognoz (Holt-Winters) - mavjud bo'lsa. */
  forecast: { period: string; lossPct: number }[] | null;
  /**
   * Tavsiya xulosasi - DETERMINISTIK: normadan oshgan mahallalar soni va
   * yo'qotishning normativ darajasi. Hech qanday model yoki LLM yo'q.
   */
  advice: { count: number; targetLossPct: number; currentLossPct: number } | null;
}

export interface MfyRankRow {
  mfyId: number;
  nameUz: string;
  lossPct: number;
  prevLossPct: number | null;
  deltaPp: number | null;
  rank: number;
  prevRank: number | null;
  rankDelta: number | null;
  trend: 'up' | 'down' | 'flat';
}

/** Amaldagi yo'qotish % va maqsadli daraja - MFY kesimida. */
export interface LossGapRow {
  mfyId: number;
  nameUz: string;
  actualPct: number;
  standardPct: number;
  gapPp: number;
  status: RagStatus;
}

export interface DistanceRow {
  mfyId: number;
  nameUz: string;
  avgDistanceM: number;
  standardM: number;
  compliant: boolean;
  tpCount: number;
  tpOverStandard: number;
}

/**
 * Transformator holati.
 *
 * `null` = MA'LUMOT YO'Q (pasport kiritilmagan yoki oylik holat hisoboti
 * kelmagan), 0 emas. Interfeys bunday maydonni «-» deb ko'rsatadi.
 */
export interface TpMonitorRow {
  tpId: number;
  code: string;
  mfyId: number;
  mfyName: string;
  ratedKva: number | null;
  loadPct: number | null;
  optimalPct: number | null;
  condition: TpCondition | null;
  avgDistanceM: number | null;
  distanceCompliant: boolean | null;
}

/**
 * Fider boshidagi oylik balans - hisoblagich ko'rsatkichi va undan
 * kelib chiqadigan to'rt raqam.
 */
export interface FeederMonthly {
  periodMonth: string;
  substation: string | null;
  inputName: string | null;
  meterPrev: number;
  meterCurr: number;
  meterCoef: number;
  kwhIn: number;
  kwhTpSum: number;
  /** Yo'qotish - kirgan energiya va TP hisoblagichlari yig'indisi ayirmasi. */
  kwhLoss: number;
  /** Hisoblangan: TP hisoblagichlarida qayd etilgan energiya ulushi, %. */
  meteredPct: number;
  /** Hisoblangan: o'rtacha kunlik iste'mol, kWh. */
  avgDailyKwh: number;
  /** Hisoblangan: o'rtacha yuklama, kW. */
  avgLoadKw: number;
  /** Davrdagi kunlar soni - yuqoridagi o'rtachalar shundan chiqadi. */
  days: number;
}

/** TP kesimidagi oylik hisoblagich va iste'molchi ma'lumoti. */
export interface TpMonthlyRow {
  tpId: number;
  code: string;
  consumersTotal: number;
  consumersActive: number;
  consumersDisconnected: number;
  meterNo: string | null;
  meterCoef: number;
  readingPrev: number;
  readingCurr: number;
  kwhMonth: number;
}

/** TP darajasidagi kunlik chiziqli yo'qotish - balans hisoblagichi vs bириктирилган iste'molchilar. */
export interface TpLossDailyRow {
  id: number;
  tpId: number;
  code: string;
  mfyId: number;
  mfyName: string;
  bizDate: string;
  kwhBalanceMeter: number;
  kwhConsumersAttached: number;
  kwhLoss: number;
  lossPct: number | null;
  inspectionNote: string | null;
  source: 'EXCEL' | 'MANUAL';
}

/** `detectTpLossAnomalies()` natijasining bitta elementi. */
export interface TpLossAnomalyItem {
  tpId: number;
  code: string;
  mfyId: number;
  mfyName: string;
  bizDate: string;
  kwhBalanceMeter: number;
  kwhConsumersAttached: number;
  kwhLoss: number;
  lossPct: number | null;
  severity: 'medium' | 'high';
  messageUz: string;
}

export interface TpLossAnomalyReport {
  asOfDate: string | null;
  anomalies: TpLossAnomalyItem[];
}

/** Yuklashdan OLDIN ko'rsatiladigan qator - TP kodi hali resolve qilingan/qilinmagan. */
export interface TpLossPreviewRow {
  tpCode: string;
  tpId: number | null;
  mfyId: number | null;
  bizDate: string;
  kwhBalanceMeter: number;
  kwhConsumersAttached: number;
  kwhLoss: number;
  lossPct: number | null;
  inspectionNote: string | null;
  willUpsert: boolean;
}

export interface TpLossPreviewResponse {
  rows: TpLossPreviewRow[];
  warnings: { rowNo: number; message: string }[];
  summary: { totalRows: number; resolvedRows: number; unresolvedCodes: string[] };
}

export interface TpLossConfirmResponse {
  inserted: number;
  updated: number;
  skippedUnresolved: string[];
}

export interface DebtBreakdown {
  totalMln: number;
  byCategory: { category: ConsumerCategory; labelUz: string; amountMln: number; pct: number }[];
  topDebtors: { rank: number; debtorName: string; category: ConsumerCategory; amountMln: number; mfyName: string }[];
}

export interface LossMapCell {
  mfyId: number;
  nameUz: string;
  shortName: string;
  /** Plitka maydoni - tarmoqqa kirgan energiya. */
  kwhIn: number;
  lossPct: number;
  normPct: number;
  /** Rang qiymati - normadan farq (p.p.). */
  gapPp: number;
  status: RagStatus;
  gridRow: number | null;
  gridCol: number | null;
}

export interface WorkRow {
  id: number;
  mfyId: number;
  mfyName: string;
  tpCode: string | null;
  workType: WorkType;
  titleUz: string;
  status: WorkStatus;
  plannedStart: string | null;
  plannedEnd: string | null;
  actualEnd: string | null;
  progressPct: number;
  quantity: number;
  unit: string;
  costMln: number;
  effectLossPctBefore: number | null;
  effectLossPctAfter: number | null;
  effectSavingKwhMonth: number;
}

export interface AlertItem {
  id: string;
  severity: 'critical' | 'serious' | 'warning' | 'info';
  titleUz: string;
  detailUz: string;
  /** Bosilganda o'tiladigan sahifa. */
  href: string | null;
  mfyId: number | null;
  /** Qoida kodi - bu deterministik SQL qoidasi, AI emas. */
  rule: string;
}

export interface TimeSeriesPoint {
  date: string;
  kwhIn: number;
  kwhSold: number;
  kwhLoss: number;
  lossPct: number;
}

// ─── Dashboard: to'plangan javoblar ──────────────────────────────────────────

export interface DistrictOverview {
  period: { from: string; to: string };
  tiles: KpiTile[];
  totals: {
    kwhIn: number;
    kwhSold: number;
    kwhLossTotal: number;
    lossPct: number;
    consumersTotal: number;
    consumersActive: number;
    consumersDisconnected: number;
    tpCount: number;
    debtTotalMln: number;
  };
}

export interface MfyOverview extends DistrictOverview {
  mfy: Mfy;
}

export interface CapacityInfo {
  capacityKva: number;
  currentKva: number;
  reserveKva: number;
  loadPct: number;
}

export interface ConsumerBreakdown {
  total: number;
  active: number;
  /** ZAXIRA: hozirda uzilgan holatda turgan abonentlar. */
  disconnected: number;
  /** OQIM: davr ichida yangi ulanganlar. */
  new: number;
  /** OQIM: davr ichida uzilganlar - `disconnected` dan farqli o'laroq. */
  disconnectedNew: number;
  population: number;
  legal: number;
}

/**
 * Energiya taqsimoti - tarmoqqa kirgan energiya qayerga ketgani.
 *
 * Yo'qotish YAGONA toifa: texnologik/tijoriy yoki tabiiy/texnik/noqonuniy
 * kesimi yo'q. U kirgan va sotilgan energiya ayirmasi, ya'ni bitta raqam.
 */
export interface EnergySplit {
  kwhIn: number;
  parts: { key: 'sold' | 'loss'; labelUz: string; kwh: number; pct: number }[];
}

/** Bitta dalolatnoma - "nima asosida?" oynasidagi ro'yxat qatori. */
export interface ViolationActRow {
  id: number;
  actNo: string;
  actDate: string;
  mfyId: number;
  mfyName: string;
  tpCode: string | null;
  consumerRef: string | null;
  kwhIdentified: number;
  fineMln: number;
  status: ViolationStatus;
  caseType: ViolationCaseType;
}

/** Toifa bo'yicha yig'indi - kartadagi bitta qator. */
export interface ViolationSummaryRow {
  caseType: ViolationCaseType;
  labelUz: string;
  count: number;
  fineMln: number;
  kwhIdentified: number;
  /** Shu toifadagi dalolatnomalar (eng yangisidan). */
  acts: ViolationActRow[];
}

export interface ViolationSummary {
  /** Qaysi oraliq bo'yicha hisoblangani - kartada ochiq yoziladi. */
  from: string;
  to: string;
  rows: ViolationSummaryRow[];
}

export interface WorkPhoto {
  id: number;
  /** API yo'li - `/api/files/work-photo/:id`. */
  url: string;
  kind: 'BEFORE' | 'AFTER' | 'DOC';
  caption: string | null;
  originalName: string | null;
  sizeBytes: number;
  createdAt: string;
}

/** Ish dalolatnomasi - barcha maydonlar + rasmlar. */
export interface WorkDetail extends WorkRow {
  description: string | null;
  mfyCode: string;
  photos: WorkPhoto[];
}

export interface OperationalMetrics {
  maxLoadKw: number | null;
  minLoadKw: number | null;
  avgVoltageV: number | null;
  outageCount: number | null;
  outageMinutes: number | null;
  nominalVoltageV: number;
}

export interface ResultsSummary {
  lossPctStart: number | null;
  lossPctEnd: number | null;
  improvementPp: number | null;
  savedKwh: number;
  periodFrom: string;
  periodTo: string;
}

// ─── Pasport ─────────────────────────────────────────────────────────────────

export interface PassportRow {
  no: number;
  labelUz: string;
  labelUzCyr: string;
  unit: string;
  value: number | null;
  /** Ichki bo'linmalar ("shundan ..."). */
  children?: { labelUz: string; labelUzCyr: string; value: number | null }[];
  /** Bu qator kiritiladimi yoki hisoblanadimi. */
  source: 'input' | 'derived';
}

export interface Passport {
  scopeType: 'MFY' | 'TUMAN';
  scopeId: number | null;
  scopeName: string;
  period: string;
  rows: PassportRow[];
  frozen: { at: string; by: string; sha256: string } | null;
}

export interface PassportReconcileRow {
  no: number;
  labelUz: string;
  sumOfMfy: number | null;
  frozenValue: number | null;
  diff: number | null;
  ok: boolean;
}

// ─── Input panel ─────────────────────────────────────────────────────────────

export interface Submission {
  id: number;
  scopeType: 'MFY' | 'ELEKTROSET' | 'TUMAN';
  scopeId: number;
  scopeName: string;
  domain: Domain;
  periodStart: string;
  periodEnd: string;
  revision: number;
  status: SubmissionStatus;
  supersedesId: number | null;
  createdBy: number;
  createdByName: string;
  createdAt: string;
  submittedAt: string | null;
  reviewedBy: number | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
}

export interface ValidationIssue {
  path: string;
  message: string;
  severity: 'error' | 'warning';
  /** Qaysi qator (kunlik jadval uchun). */
  rowKey?: string;
}

export interface ValidationReport {
  ok: boolean;
  issues: ValidationIssue[];
  /** Kiritilgan qatorlar / kutilgan qatorlar. */
  completeness: { filled: number; expected: number };
}

export interface CompletenessCell {
  mfyId: number;
  mfyName: string;
  domain: Domain;
  status: SubmissionStatus | 'missing';
  submissionId: number | null;
  updatedAt: string | null;
}

export interface SubmissionDiffRow {
  path: string;
  labelUz: string;
  before: number | string | null;
  after: number | string | null;
  deltaPct: number | null;
  /** >30% o'zgarish uchun operator izohi. */
  justification: string | null;
}

// ─── Umumiy ──────────────────────────────────────────────────────────────────

export interface ApiError {
  error: string;
  message: string;
  /** Maydonga bog'langan xatolar - HeroUI `<Form validationErrors>` uchun. */
  errors?: Record<string, string>;
  requestId?: string;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export type { ConsumerCategory, Domain, RagStatus, Role, SubmissionStatus, TpCondition, ViolationStatus, WorkStatus, WorkType };
