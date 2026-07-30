/**
 * TanStack Query kalitlari va hook'lar.
 *
 * `placeholderData: keepPreviousData` — davr almashganda skeleton CHAQNAMAYDI,
 * oldingi render kamaytirilgan shaffoflikda turadi. Skeleton faqat birinchi
 * yuklashda ko'rinadi.
 */
import type {
  AlertItem, Bootstrap, CapacityInfo, ConsumerBreakdown, DebtBreakdown,
  DistanceRow, DistrictOverview, EfficiencyBreakdown, EnergyBalanceNode,
  LossMapCell, LossStructure, MfyOverview, MfyRankRow, OperationalMetrics,
  Passport, PassportReconcileRow, ResultsSummary, Submission, TechnicalLossRow,
  TimeSeriesPoint, TpMonitorRow, WorkRow, CompletenessCell,
} from '@beap/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { api, qs } from './api.ts';

export const keys = {
  bootstrap: ['ref', 'bootstrap'] as const,
  district: (panel: string, params: Record<string, unknown> = {}) =>
    ['dash', 'district', panel, params] as const,
  mfy: (id: number, panel: string, params: Record<string, unknown> = {}) =>
    ['dash', 'mfy', id, panel, params] as const,
  passport: (scope: string, id: number | null, period: string) =>
    ['passport', scope, id, period] as const,
  entry: (part: string, params: Record<string, unknown> = {}) =>
    ['entry', part, params] as const,
};

const DASH_OPTIONS = {
  staleTime: 60_000,
  placeholderData: keepPreviousData,
} as const;

// ─── Spravochniklar ─────────────────────────────────────────────────────────

export function useBootstrap() {
  return useQuery({
    queryKey: keys.bootstrap,
    queryFn: ({ signal }) => api.get<Bootstrap>('/ref/bootstrap', signal),
    staleTime: 10 * 60_000,
  });
}

// ─── Tuman paneli ───────────────────────────────────────────────────────────

export function useDistrictOverview(period?: string) {
  return useQuery({
    queryKey: keys.district('overview', { period }),
    queryFn: ({ signal }) => api.get<DistrictOverview>(`/dash/district/overview${qs({ period })}`, signal),
    ...DASH_OPTIONS,
  });
}

export function useEnergyBalance(period?: string) {
  return useQuery({
    queryKey: keys.district('energy-balance', { period }),
    queryFn: ({ signal }) => api.get<EnergyBalanceNode[]>(`/dash/district/energy-balance${qs({ period })}`, signal),
    ...DASH_OPTIONS,
  });
}

export function useEfficiency(period?: string) {
  return useQuery({
    queryKey: keys.district('efficiency', { period }),
    queryFn: ({ signal }) => api.get<EfficiencyBreakdown>(`/dash/district/efficiency${qs({ period })}`, signal),
    ...DASH_OPTIONS,
  });
}

export function useTpMonitoring(period?: string, limit = 60) {
  return useQuery({
    queryKey: keys.district('tp-monitoring', { period, limit }),
    queryFn: ({ signal }) => api.get<TpMonitorRow[]>(`/dash/district/tp-monitoring${qs({ period, limit })}`, signal),
    ...DASH_OPTIONS,
  });
}

export function useMfyRanking(date?: string) {
  return useQuery({
    queryKey: keys.district('mfy-ranking', { date }),
    queryFn: ({ signal }) => api.get<MfyRankRow[]>(`/dash/district/mfy-ranking${qs({ date })}`, signal),
    ...DASH_OPTIONS,
  });
}

export interface RankHistoryEntry {
  mfyId: number;
  nameUz: string;
  points: { period: string; rank: number; lossPct: number }[];
}

export function useRankingHistory(period?: string, months = 12) {
  return useQuery({
    queryKey: keys.district('ranking-history', { period, months }),
    queryFn: ({ signal }) => api.get<RankHistoryEntry[]>(`/dash/district/ranking-history${qs({ period, months })}`, signal),
    ...DASH_OPTIONS,
  });
}

export function useTechnicalLoss(period?: string) {
  return useQuery({
    queryKey: keys.district('technical-loss', { period }),
    queryFn: ({ signal }) => api.get<TechnicalLossRow[]>(`/dash/district/technical-loss${qs({ period })}`, signal),
    ...DASH_OPTIONS,
  });
}

export function useDistance(period?: string) {
  return useQuery({
    queryKey: keys.district('distance', { period }),
    queryFn: ({ signal }) => api.get<DistanceRow[]>(`/dash/district/distance${qs({ period })}`, signal),
    ...DASH_OPTIONS,
  });
}

export function useDebt(period?: string) {
  return useQuery({
    queryKey: keys.district('debt', { period }),
    queryFn: ({ signal }) => api.get<DebtBreakdown>(`/dash/district/debt${qs({ period })}`, signal),
    ...DASH_OPTIONS,
  });
}

export function useLossMap(period?: string) {
  return useQuery({
    queryKey: keys.district('loss-map', { period }),
    queryFn: ({ signal }) => api.get<LossMapCell[]>(`/dash/district/loss-map${qs({ period })}`, signal),
    ...DASH_OPTIONS,
  });
}

export function useWorks(status?: string) {
  return useQuery({
    queryKey: keys.district('works', { status }),
    queryFn: ({ signal }) => api.get<WorkRow[]>(`/dash/district/works${qs({ status })}`, signal),
    ...DASH_OPTIONS,
  });
}

export function useAlerts(period?: string) {
  return useQuery({
    queryKey: keys.district('alerts', { period }),
    queryFn: ({ signal }) => api.get<AlertItem[]>(`/dash/district/alerts${qs({ period })}`, signal),
    ...DASH_OPTIONS,
  });
}

export function useDistrictSeries(params: { from?: string; to?: string; bucket?: 'day' | 'week' | 'month' } = {}) {
  return useQuery({
    queryKey: keys.district('series', params),
    queryFn: ({ signal }) => api.get<TimeSeriesPoint[]>(`/dash/district/series${qs(params)}`, signal),
    ...DASH_OPTIONS,
  });
}

export function useDistrictLossStructure(period?: string) {
  return useQuery({
    queryKey: keys.district('loss-structure', { period }),
    queryFn: ({ signal }) => api.get<LossStructure>(`/dash/district/loss-structure${qs({ period })}`, signal),
    ...DASH_OPTIONS,
  });
}

export function useDistrictResults(period?: string, months = 12) {
  return useQuery({
    queryKey: keys.district('results', { period, months }),
    queryFn: ({ signal }) => api.get<ResultsSummary>(`/dash/district/results${qs({ period, months })}`, signal),
    ...DASH_OPTIONS,
  });
}

// ─── MFY paneli ─────────────────────────────────────────────────────────────

export function useMfyOverview(id: number, period?: string) {
  return useQuery({
    queryKey: keys.mfy(id, 'overview', { period }),
    queryFn: ({ signal }) => api.get<MfyOverview>(`/dash/mfy/${id}/overview${qs({ period })}`, signal),
    ...DASH_OPTIONS,
  });
}

export function useMfyDynamics(id: number, params: { from?: string; to?: string; bucket?: 'day' | 'week' | 'month' } = {}) {
  return useQuery({
    queryKey: keys.mfy(id, 'dynamics', params),
    queryFn: ({ signal }) => api.get<TimeSeriesPoint[]>(`/dash/mfy/${id}/dynamics${qs(params)}`, signal),
    ...DASH_OPTIONS,
  });
}

export function useMfyCapacity(id: number, period?: string) {
  return useQuery({
    queryKey: keys.mfy(id, 'capacity', { period }),
    queryFn: ({ signal }) => api.get<CapacityInfo>(`/dash/mfy/${id}/capacity${qs({ period })}`, signal),
    ...DASH_OPTIONS,
  });
}

export function useMfyConsumers(id: number, period?: string) {
  return useQuery({
    queryKey: keys.mfy(id, 'consumers', { period }),
    queryFn: ({ signal }) => api.get<ConsumerBreakdown>(`/dash/mfy/${id}/consumers${qs({ period })}`, signal),
    ...DASH_OPTIONS,
  });
}

export function useMfyTp(id: number, period?: string) {
  return useQuery({
    queryKey: keys.mfy(id, 'tp', { period }),
    queryFn: ({ signal }) => api.get<TpMonitorRow[]>(`/dash/mfy/${id}/tp${qs({ period })}`, signal),
    ...DASH_OPTIONS,
  });
}

export function useMfyLossStructure(id: number, period?: string) {
  return useQuery({
    queryKey: keys.mfy(id, 'loss-structure', { period }),
    queryFn: ({ signal }) => api.get<LossStructure>(`/dash/mfy/${id}/loss-structure${qs({ period })}`, signal),
    ...DASH_OPTIONS,
  });
}

export function useMfyDebt(id: number, period?: string) {
  return useQuery({
    queryKey: keys.mfy(id, 'debt', { period }),
    queryFn: ({ signal }) => api.get<DebtBreakdown>(`/dash/mfy/${id}/debt${qs({ period })}`, signal),
    ...DASH_OPTIONS,
  });
}

export function useMfyOperational(id: number, period?: string) {
  return useQuery({
    queryKey: keys.mfy(id, 'operational', { period }),
    queryFn: ({ signal }) => api.get<OperationalMetrics>(`/dash/mfy/${id}/operational${qs({ period })}`, signal),
    ...DASH_OPTIONS,
  });
}

export function useMfyWorks(id: number) {
  return useQuery({
    queryKey: keys.mfy(id, 'works'),
    queryFn: ({ signal }) => api.get<WorkRow[]>(`/dash/mfy/${id}/works`, signal),
    ...DASH_OPTIONS,
  });
}

export function useMfyResults(id: number, period?: string, months = 12) {
  return useQuery({
    queryKey: keys.mfy(id, 'results', { period, months }),
    queryFn: ({ signal }) => api.get<ResultsSummary>(`/dash/mfy/${id}/results${qs({ period, months })}`, signal),
    ...DASH_OPTIONS,
  });
}

export function useMfyEfficiency(id: number, period?: string) {
  return useQuery({
    queryKey: keys.mfy(id, 'efficiency', { period }),
    queryFn: ({ signal }) => api.get<EfficiencyBreakdown>(`/dash/mfy/${id}/efficiency${qs({ period })}`, signal),
    ...DASH_OPTIONS,
  });
}

// ─── Pasport ────────────────────────────────────────────────────────────────

export function useTumanPassport(period?: string) {
  return useQuery({
    queryKey: keys.passport('tuman', null, period ?? 'latest'),
    queryFn: ({ signal }) => api.get<Passport>(`/passport/tuman${qs({ period })}`, signal),
    ...DASH_OPTIONS,
  });
}

export function useMfyPassport(id: number, period?: string) {
  return useQuery({
    queryKey: keys.passport('mfy', id, period ?? 'latest'),
    queryFn: ({ signal }) => api.get<Passport>(`/passport/mfy/${id}${qs({ period })}`, signal),
    ...DASH_OPTIONS,
  });
}

export function useReconcile(period: string) {
  return useQuery({
    queryKey: ['passport', 'reconcile', period],
    queryFn: ({ signal }) => api.get<PassportReconcileRow[]>(`/passport/tuman/${period}/reconcile`, signal),
    ...DASH_OPTIONS,
  });
}

// ─── Input panel ────────────────────────────────────────────────────────────

export function useCompleteness(period: string, enabled = true) {
  return useQuery({
    queryKey: keys.entry('periods', { period }),
    queryFn: ({ signal }) => api.get<CompletenessCell[]>(`/entry/periods${qs({ period })}`, signal),
    enabled,
    staleTime: 30_000,
  });
}

export function useReviewQueue(enabled = true) {
  return useQuery({
    queryKey: keys.entry('review-queue'),
    queryFn: ({ signal }) => api.get<Submission[]>('/entry/review-queue', signal),
    enabled,
    staleTime: 15_000,
  });
}
