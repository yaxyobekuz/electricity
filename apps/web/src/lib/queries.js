import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, qs } from './api.ts';
export const keys = {
    bootstrap: ['ref', 'bootstrap'],
    district: (panel, params = {}) => ['dash', 'district', panel, params],
    mfy: (id, panel, params = {}) => ['dash', 'mfy', id, panel, params],
    passport: (scope, id, period) => ['passport', scope, id, period],
    entry: (part, params = {}) => ['entry', part, params],
};
const DASH_OPTIONS = {
    staleTime: 60_000,
    placeholderData: keepPreviousData,
};
// ─── Spravochniklar ─────────────────────────────────────────────────────────
export function useBootstrap() {
    return useQuery({
        queryKey: keys.bootstrap,
        queryFn: ({ signal }) => api.get('/ref/bootstrap', signal),
        staleTime: 10 * 60_000,
    });
}
// ─── Tuman paneli ───────────────────────────────────────────────────────────
export function useDistrictOverview(period) {
    return useQuery({
        queryKey: keys.district('overview', { period }),
        queryFn: ({ signal }) => api.get(`/dash/district/overview${qs({ period })}`, signal),
        ...DASH_OPTIONS,
    });
}
export function useEnergyBalance(period) {
    return useQuery({
        queryKey: keys.district('energy-balance', { period }),
        queryFn: ({ signal }) => api.get(`/dash/district/energy-balance${qs({ period })}`, signal),
        ...DASH_OPTIONS,
    });
}
export function useEfficiency(period) {
    return useQuery({
        queryKey: keys.district('efficiency', { period }),
        queryFn: ({ signal }) => api.get(`/dash/district/efficiency${qs({ period })}`, signal),
        ...DASH_OPTIONS,
    });
}
export function useTpMonitoring(period, limit = 60) {
    return useQuery({
        queryKey: keys.district('tp-monitoring', { period, limit }),
        queryFn: ({ signal }) => api.get(`/dash/district/tp-monitoring${qs({ period, limit })}`, signal),
        ...DASH_OPTIONS,
    });
}
export function useMfyRanking(date) {
    return useQuery({
        queryKey: keys.district('mfy-ranking', { date }),
        queryFn: ({ signal }) => api.get(`/dash/district/mfy-ranking${qs({ date })}`, signal),
        ...DASH_OPTIONS,
    });
}
export function useRankingHistory(period, months = 12) {
    return useQuery({
        queryKey: keys.district('ranking-history', { period, months }),
        queryFn: ({ signal }) => api.get(`/dash/district/ranking-history${qs({ period, months })}`, signal),
        ...DASH_OPTIONS,
    });
}
export function useTechnicalLoss(period) {
    return useQuery({
        queryKey: keys.district('technical-loss', { period }),
        queryFn: ({ signal }) => api.get(`/dash/district/technical-loss${qs({ period })}`, signal),
        ...DASH_OPTIONS,
    });
}
export function useDistance(period) {
    return useQuery({
        queryKey: keys.district('distance', { period }),
        queryFn: ({ signal }) => api.get(`/dash/district/distance${qs({ period })}`, signal),
        ...DASH_OPTIONS,
    });
}
export function useDebt(period) {
    return useQuery({
        queryKey: keys.district('debt', { period }),
        queryFn: ({ signal }) => api.get(`/dash/district/debt${qs({ period })}`, signal),
        ...DASH_OPTIONS,
    });
}
export function useLossMap(period) {
    return useQuery({
        queryKey: keys.district('loss-map', { period }),
        queryFn: ({ signal }) => api.get(`/dash/district/loss-map${qs({ period })}`, signal),
        ...DASH_OPTIONS,
    });
}
export function useWorks(status) {
    return useQuery({
        queryKey: keys.district('works', { status }),
        queryFn: ({ signal }) => api.get(`/dash/district/works${qs({ status })}`, signal),
        ...DASH_OPTIONS,
    });
}
export function useAlerts(period) {
    return useQuery({
        queryKey: keys.district('alerts', { period }),
        queryFn: ({ signal }) => api.get(`/dash/district/alerts${qs({ period })}`, signal),
        ...DASH_OPTIONS,
    });
}
export function useDistrictSeries(params = {}) {
    return useQuery({
        queryKey: keys.district('series', params),
        queryFn: ({ signal }) => api.get(`/dash/district/series${qs(params)}`, signal),
        ...DASH_OPTIONS,
    });
}
export function useDistrictLossStructure(period) {
    return useQuery({
        queryKey: keys.district('loss-structure', { period }),
        queryFn: ({ signal }) => api.get(`/dash/district/loss-structure${qs({ period })}`, signal),
        ...DASH_OPTIONS,
    });
}
export function useDistrictResults(period, months = 12) {
    return useQuery({
        queryKey: keys.district('results', { period, months }),
        queryFn: ({ signal }) => api.get(`/dash/district/results${qs({ period, months })}`, signal),
        ...DASH_OPTIONS,
    });
}
// ─── MFY paneli ─────────────────────────────────────────────────────────────
export function useMfyOverview(id, period) {
    return useQuery({
        queryKey: keys.mfy(id, 'overview', { period }),
        queryFn: ({ signal }) => api.get(`/dash/mfy/${id}/overview${qs({ period })}`, signal),
        ...DASH_OPTIONS,
    });
}
export function useMfyDynamics(id, params = {}) {
    return useQuery({
        queryKey: keys.mfy(id, 'dynamics', params),
        queryFn: ({ signal }) => api.get(`/dash/mfy/${id}/dynamics${qs(params)}`, signal),
        ...DASH_OPTIONS,
    });
}
export function useMfyCapacity(id, period) {
    return useQuery({
        queryKey: keys.mfy(id, 'capacity', { period }),
        queryFn: ({ signal }) => api.get(`/dash/mfy/${id}/capacity${qs({ period })}`, signal),
        ...DASH_OPTIONS,
    });
}
export function useMfyConsumers(id, period) {
    return useQuery({
        queryKey: keys.mfy(id, 'consumers', { period }),
        queryFn: ({ signal }) => api.get(`/dash/mfy/${id}/consumers${qs({ period })}`, signal),
        ...DASH_OPTIONS,
    });
}
export function useMfyTp(id, period) {
    return useQuery({
        queryKey: keys.mfy(id, 'tp', { period }),
        queryFn: ({ signal }) => api.get(`/dash/mfy/${id}/tp${qs({ period })}`, signal),
        ...DASH_OPTIONS,
    });
}
export function useMfyLossStructure(id, period) {
    return useQuery({
        queryKey: keys.mfy(id, 'loss-structure', { period }),
        queryFn: ({ signal }) => api.get(`/dash/mfy/${id}/loss-structure${qs({ period })}`, signal),
        ...DASH_OPTIONS,
    });
}
export function useMfyDebt(id, period) {
    return useQuery({
        queryKey: keys.mfy(id, 'debt', { period }),
        queryFn: ({ signal }) => api.get(`/dash/mfy/${id}/debt${qs({ period })}`, signal),
        ...DASH_OPTIONS,
    });
}
export function useMfyOperational(id, period) {
    return useQuery({
        queryKey: keys.mfy(id, 'operational', { period }),
        queryFn: ({ signal }) => api.get(`/dash/mfy/${id}/operational${qs({ period })}`, signal),
        ...DASH_OPTIONS,
    });
}
export function useMfyWorks(id) {
    return useQuery({
        queryKey: keys.mfy(id, 'works'),
        queryFn: ({ signal }) => api.get(`/dash/mfy/${id}/works`, signal),
        ...DASH_OPTIONS,
    });
}
export function useMfyResults(id, period, months = 12) {
    return useQuery({
        queryKey: keys.mfy(id, 'results', { period, months }),
        queryFn: ({ signal }) => api.get(`/dash/mfy/${id}/results${qs({ period, months })}`, signal),
        ...DASH_OPTIONS,
    });
}
export function useMfyEfficiency(id, period) {
    return useQuery({
        queryKey: keys.mfy(id, 'efficiency', { period }),
        queryFn: ({ signal }) => api.get(`/dash/mfy/${id}/efficiency${qs({ period })}`, signal),
        ...DASH_OPTIONS,
    });
}
// ─── Pasport ────────────────────────────────────────────────────────────────
export function useTumanPassport(period) {
    return useQuery({
        queryKey: keys.passport('tuman', null, period ?? 'latest'),
        queryFn: ({ signal }) => api.get(`/passport/tuman${qs({ period })}`, signal),
        ...DASH_OPTIONS,
    });
}
export function useMfyPassport(id, period) {
    return useQuery({
        queryKey: keys.passport('mfy', id, period ?? 'latest'),
        queryFn: ({ signal }) => api.get(`/passport/mfy/${id}${qs({ period })}`, signal),
        // MFY tanlanmaguncha so'rov yubormaymiz — aks holda `/passport/mfy/0`
        // ketadi va server 400 qaytaradi.
        enabled: typeof id === 'number' && id > 0,
        ...DASH_OPTIONS,
    });
}
export function useReconcile(period) {
    return useQuery({
        queryKey: ['passport', 'reconcile', period ?? 'none'],
        queryFn: ({ signal }) => api.get(`/passport/tuman/${period}/reconcile`, signal),
        // Davr aniqlanmaguncha kutamiz — bo'sh davr `/tuman//reconcile` beradi.
        enabled: Boolean(period),
        ...DASH_OPTIONS,
    });
}
// ─── Input panel ────────────────────────────────────────────────────────────
export function useCompleteness(period, enabled = true) {
    return useQuery({
        queryKey: keys.entry('periods', { period }),
        queryFn: ({ signal }) => api.get(`/entry/periods${qs({ period })}`, signal),
        enabled,
        staleTime: 30_000,
    });
}
export function useReviewQueue(enabled = true) {
    return useQuery({
        queryKey: keys.entry('review-queue'),
        queryFn: ({ signal }) => api.get('/entry/review-queue', signal),
        enabled,
        staleTime: 15_000,
    });
}
