/**
 * METRIKA MANBASI XARITASI — "manbasiz raqam yo'q" qoidasining majburlanishi.
 *
 * Dashboardda ko'rsatiladigan HAR BIR metrika shu yerda ro'yxatdan o'tishi shart:
 * u yo xodim tomonidan KIRITILADI (`input`), yo tizim tomonidan HISOBLANADI (`derived`).
 *
 * `provenance.test.ts` dashboard panellarida ishlatilgan metrika kalitlarini shu
 * xarita bilan solishtiradi va mos kelmasa build'ni yiqitadi.
 *
 * UI'da har bir KPI kartasining "i" tugmasi aynan shu yozuvni ko'rsatadi —
 * hokim "bu raqam qayerdan keldi?" deb so'raganda javob bir bosishda.
 */

import type { Domain } from './constants.ts';

export interface InputProvenance {
  source: 'input';
  /** Qaysi formada kiritiladi. */
  domain: Domain;
  table: string;
  column: string;
  labelUz: string;
  unit: string;
}

export interface DerivedProvenance {
  source: 'derived';
  /** Hisoblash formulasi — inson o'qishi uchun. */
  formula: string;
  /** Qaysi kiritiladigan metrikalarga tayanadi. */
  dependsOn: readonly string[];
  labelUz: string;
  unit: string;
}

export type Provenance = InputProvenance | DerivedProvenance;

const input = (
  domain: Domain,
  table: string,
  column: string,
  labelUz: string,
  unit: string,
): InputProvenance => ({ source: 'input', domain, table, column, labelUz, unit });

const derived = (
  formula: string,
  dependsOn: readonly string[],
  labelUz: string,
  unit: string,
): DerivedProvenance => ({ source: 'derived', formula, dependsOn, labelUz, unit });

export const METRIC_PROVENANCE = {
  // ── Energiya balansi ───────────────────────────────────────────────────────
  kwhIn: input('ENERGY_BALANCE', 'fact.energy_balance_daily', 'kwh_in', 'Tarmoqqa kirgan energiya', 'kWh'),
  kwhSold: input('ENERGY_BALANCE', 'fact.energy_balance_daily', 'kwh_sold', 'Sotilgan elektr energiyasi', 'kWh'),
  kwhLossNatural: input('ENERGY_BALANCE', 'fact.energy_balance_daily', 'kwh_loss_natural', 'Tabiiy yo‘qotish', 'kWh'),
  kwhLossTechnical: input('ENERGY_BALANCE', 'fact.energy_balance_daily', 'kwh_loss_technical', 'Texnik yo‘qotish', 'kWh'),
  kwhLossIllegal: input('ENERGY_BALANCE', 'fact.energy_balance_daily', 'kwh_loss_illegal', 'Noqonuniy foydalanish', 'kWh'),

  kwhLossTotal: derived(
    'kwh_in − kwh_sold',
    ['kwhIn', 'kwhSold'],
    'Jami yo‘qotish',
    'kWh',
  ),
  lossPct: derived(
    '100 × (kwh_in − kwh_sold) / kwh_in',
    ['kwhIn', 'kwhSold'],
    'Yo‘qotish darajasi',
    '%',
  ),
  naturalLossPct: derived(
    '100 × Σ kwh_loss_natural / Σ kwh_in',
    ['kwhLossNatural', 'kwhIn'],
    'Tabiiy yo‘qotish ulushi',
    '%',
  ),
  technicalLossPct: derived(
    '100 × Σ kwh_loss_technical / Σ kwh_in',
    ['kwhLossTechnical', 'kwhIn'],
    'Texnik yo‘qotish ulushi',
    '%',
  ),
  illegalLossPct: derived(
    '100 × Σ kwh_loss_illegal / Σ kwh_in',
    ['kwhLossIllegal', 'kwhIn'],
    'Noqonuniy foydalanish ulushi',
    '%',
  ),

  // ── Abonentlar ─────────────────────────────────────────────────────────────
  consumersPopulation: input('MONTHLY_RETURN', 'fact.mfy_monthly_return', 'consumers_population', 'Aholi iste’molchilari', 'ta'),
  consumersLegal: input('MONTHLY_RETURN', 'fact.mfy_monthly_return', 'consumers_legal', 'Yuridik iste’molchilar', 'ta'),
  consumersActive: input('MONTHLY_RETURN', 'fact.mfy_monthly_return', 'consumers_active', 'Faol abonentlar', 'ta'),
  consumersDisconnected: input('MONTHLY_RETURN', 'fact.mfy_monthly_return', 'consumers_disconnected', 'Tarmoqdan ajralgan', 'ta'),
  consumersNew: input('MONTHLY_RETURN', 'fact.mfy_monthly_return', 'consumers_new', 'Yangi ulangan', 'ta'),
  consumersTotal: derived(
    'consumers_population + consumers_legal',
    ['consumersPopulation', 'consumersLegal'],
    'Jami iste’molchilar',
    'ta',
  ),
  avgConsumptionPerConsumer: derived(
    'Σ kwh_sold / consumers_active / kunlar soni',
    ['kwhSold', 'consumersActive'],
    'O‘rtacha iste’mol (1 abonent)',
    'kWh/kun',
  ),

  // ── Qarzdorlik ─────────────────────────────────────────────────────────────
  debtPopulationMln: input('MONTHLY_RETURN', 'fact.mfy_monthly_return', 'debt_population_mln', 'Aholi qarzdorligi', 'mln so‘m'),
  debtLegalMln: input('MONTHLY_RETURN', 'fact.mfy_monthly_return', 'debt_legal_mln', 'Yuridik qarzdorlik', 'mln so‘m'),
  debtBudgetMln: input('MONTHLY_RETURN', 'fact.mfy_monthly_return', 'debt_budget_mln', 'Budjet qarzdorligi', 'mln so‘m'),
  debtTotalMln: derived(
    'debt_population_mln + debt_legal_mln + debt_budget_mln',
    ['debtPopulationMln', 'debtLegalMln', 'debtBudgetMln'],
    'Jami qarzdorlik',
    'mln so‘m',
  ),
  debtorName: input('DEBT', 'fact.debt_top_entry', 'debtor_name', 'Qarzdor nomi', '—'),
  debtorAmountMln: input('DEBT', 'fact.debt_top_entry', 'amount_mln', 'Qarzdor summasi', 'mln so‘m'),

  // ── Hisoblagichlar ─────────────────────────────────────────────────────────
  metersOfflineCnt: input('MONTHLY_RETURN', 'fact.mfy_monthly_return', 'meters_offline_cnt', 'Aloqadan chiqqan hisoblagichlar', 'ta'),
  lowConsumptionCnt: input('MONTHLY_RETURN', 'fact.mfy_monthly_return', 'low_consumption_cnt', '0 va 50 kWh dan kam iste’molchilar', 'ta'),
  metersReplaceNeedCnt: input('MONTHLY_RETURN', 'fact.mfy_monthly_return', 'meters_replace_need_cnt', 'Almashtirish kerak', 'ta'),
  metersReplacedCnt: input('MONTHLY_RETURN', 'fact.mfy_monthly_return', 'meters_replaced_cnt', 'Almashtirilgan', 'ta'),

  // ── Transformatorlar ───────────────────────────────────────────────────────
  tpRatedKva: input('TP_STATUS', 'ref.tp', 'rated_kva', 'TP quvvati', 'kVA'),
  tpAvgDistanceM: input('TP_STATUS', 'ref.tp', 'avg_distance_m', 'TP → iste’molchi masofasi', 'm'),
  tpLoadPct: input('TP_STATUS', 'fact.tp_status_monthly', 'load_pct', 'TP yuklamasi', '%'),
  tpPeakKva: input('TP_STATUS', 'fact.tp_status_monthly', 'peak_kva', 'TP peak quvvati', 'kVA'),
  tpCondition: input('TP_STATUS', 'fact.tp_status_monthly', 'condition', 'TP holati', '—'),
  tpUnderLoad: input('TP_STATUS', 'fact.tp_status_monthly', 'under_load', 'Yuklama bilan ishlayotgan TP', '—'),
  tpRepairNeeded: input('TP_STATUS', 'fact.tp_status_monthly', 'repair_needed', 'Ta’mir kerak', '—'),
  tpCount: derived('COUNT(ref.tp)', ['tpRatedKva'], 'Transformatorlar soni', 'ta'),
  tpOverloadedCount: derived(
    'COUNT(*) FILTER (WHERE load_pct >= TP_OVERLOAD_PCT)',
    ['tpLoadPct'],
    'Ortiqcha yuklangan TP lar',
    'ta',
  ),
  networkCapacityKva: derived('Σ ref.tp.rated_kva', ['tpRatedKva'], 'Texnik quvvat', 'kVA'),
  networkLoadKva: derived(
    'Σ (rated_kva × load_pct / 100)',
    ['tpRatedKva', 'tpLoadPct'],
    'Joriy foydalanish',
    'kVA',
  ),
  networkReserveKva: derived(
    'Σ rated_kva − Σ (rated_kva × load_pct / 100)',
    ['tpRatedKva', 'tpLoadPct'],
    'Zaxira quvvat',
    'kVA',
  ),
  distanceCompliancePct: derived(
    '100 × COUNT(avg_distance_m ≤ TP_MAX_DISTANCE_M) / COUNT(*)',
    ['tpAvgDistanceM'],
    'Masofa normasiga muvofiqlik',
    '%',
  ),

  // ── Tezkor ko'rsatkichlar ──────────────────────────────────────────────────
  maxLoadKw: input('TP_READING', 'fact.tp_reading_daily', 'max_load_kw', 'Maksimal yuklama', 'kW'),
  minLoadKw: input('TP_READING', 'fact.tp_reading_daily', 'min_load_kw', 'Minimal yuklama', 'kW'),
  avgVoltageV: input('TP_READING', 'fact.tp_reading_daily', 'avg_voltage_v', 'O‘rtacha kuchlanish', 'V'),
  outageCount: input('TP_READING', 'fact.tp_reading_daily', 'outage_count', 'O‘chirishlar soni', 'ta'),
  outageMinutes: input('TP_READING', 'fact.tp_reading_daily', 'outage_minutes', 'O‘chirish davomiyligi', 'daq'),

  // ── Tarmoq ─────────────────────────────────────────────────────────────────
  lineLengthKm: input('NETWORK_DEFECT', 'ref.network_segment', 'length_km', 'Tarmoq uzunligi', 'km'),
  repairNeededKm: input('NETWORK_DEFECT', 'fact.network_defect', 'repair_needed_km', 'Ta’mir kerak bo‘lgan tarmoq', 'km'),
  repairedKm: input('NETWORK_DEFECT', 'fact.network_defect', 'repaired_km', 'Ta’mirlangan tarmoq', 'km'),

  // ── Ishlar ─────────────────────────────────────────────────────────────────
  workProgressPct: input('WORKS', 'fact.work', 'progress_pct', 'Ish bajarilishi', '%'),
  workQuantity: input('WORKS', 'fact.work', 'quantity', 'Ish hajmi', '—'),
  workCostMln: input('WORKS', 'fact.work', 'cost_mln', 'Ish qiymati', 'mln so‘m'),
  workEffectBefore: input('WORKS', 'fact.work', 'effect_loss_pct_before', 'Ishdan oldingi yo‘qotish', '%'),
  workEffectAfter: input('WORKS', 'fact.work', 'effect_loss_pct_after', 'Ishdan keyingi yo‘qotish', '%'),
  workSavingKwh: input('WORKS', 'fact.work', 'effect_saving_kwh_month', 'Tejalgan energiya', 'kWh/oy'),
  treeClearingKm: derived(
    'Σ quantity WHERE work_type = TREE_CLEARING AND status = COMPLETED',
    ['workQuantity'],
    'Daraxtlardan tozalangan tarmoq',
    'km',
  ),

  // ── Dalolatnomalar ─────────────────────────────────────────────────────────
  violationKwhIdentified: input('VIOLATION', 'fact.violation_act', 'kwh_identified', 'Aniqlangan yo‘qotish', 'kWh'),
  violationFineMln: input('VIOLATION', 'fact.violation_act', 'fine_mln', 'Jarima', 'mln so‘m'),
  violationCount: derived('COUNT(fact.violation_act)', ['violationKwhIdentified'], 'Dalolatnomalar soni', 'ta'),

  // ── Normalar ───────────────────────────────────────────────────────────────
  naturalLossNorm: input('MONTHLY_RETURN', 'ref.norm', 'NATURAL_LOSS_PCT', 'Tabiiy yo‘qotish normasi', '%'),
  technicalLossStandard: input('MONTHLY_RETURN', 'ref.norm', 'TECHNICAL_LOSS_PCT', 'Texnik yo‘qotish standarti', '%'),
  tpMaxDistanceNorm: input('MONTHLY_RETURN', 'ref.norm', 'TP_MAX_DISTANCE_M', 'Masofa normasi', 'm'),

  // ── Murakkab hosilalar ─────────────────────────────────────────────────────
  efficiencyIndex: derived(
    '0.35×yo‘qotish + 0.20×qarzdorlik + 0.15×hisoblagich + 0.15×TP yuklama + 0.15×masofa',
    ['lossPct', 'debtTotalMln', 'metersOfflineCnt', 'tpLoadPct', 'tpAvgDistanceM'],
    'Energiya samaradorlik indeksi',
    'ball',
  ),
  technicalLossGapPp: derived(
    'amaldagi texnik yo‘qotish % − TECHNICAL_LOSS_PCT normasi',
    ['technicalLossPct', 'technicalLossStandard'],
    'Standartdan farq',
    'p.p.',
  ),
  debtMonths: derived(
    'debt_total_mln / (oylik hisoblangan summa)',
    ['debtTotalMln', 'kwhSold'],
    'Qarzdorlik (oylarda)',
    'oy',
  ),
} as const satisfies Record<string, Provenance>;

export type MetricKey = keyof typeof METRIC_PROVENANCE;

export function getProvenance(key: MetricKey): Provenance {
  return METRIC_PROVENANCE[key];
}

export function isKnownMetric(key: string): key is MetricKey {
  return key in METRIC_PROVENANCE;
}

/** UI'da "i" popoveri uchun tayyor matn. */
export function provenanceText(key: MetricKey): string {
  const p = METRIC_PROVENANCE[key];
  if (p.source === 'input') {
    return `Qo‘lda kiritiladi — «${p.labelUz}» maydoni, «${p.domain}» formasida.`;
  }
  return `Tizim hisoblaydi: ${p.formula}`;
}

/** Barcha kiritiladigan metrikalar — input panel qamrovini tekshirish uchun. */
export function inputMetrics(): MetricKey[] {
  return (Object.keys(METRIC_PROVENANCE) as MetricKey[]).filter(
    (k) => METRIC_PROVENANCE[k].source === 'input',
  );
}

/** Berilgan domenda kiritiladigan metrikalar. */
export function metricsForDomain(domain: Domain): MetricKey[] {
  return (Object.keys(METRIC_PROVENANCE) as MetricKey[]).filter((k) => {
    const p = METRIC_PROVENANCE[k];
    return p.source === 'input' && p.domain === domain;
  });
}
