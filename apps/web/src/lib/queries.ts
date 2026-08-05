/**
 * TanStack Query kalitlari va hook'lar.
 *
 * `placeholderData: keepPreviousData` - davr almashganda skeleton CHAQNAMAYDI,
 * oldingi render kamaytirilgan shaffoflikda turadi. Skeleton faqat birinchi
 * yuklashda ko'rinadi.
 */
import type {
  Bootstrap, CapacityInfo, CompletenessCell, ConsumerBreakdown, DebtBreakdown,
  DistrictOverview, EfficiencyBreakdown, EnergyBalanceNode, FeederMonthly, LossStructure,
  MfyOverview, MfyResponsible, OperationalMetrics, ResultsSummary, Submission, TimeSeriesPoint,
  TpLossAnomalyReport, TpLossConfirmResponse, TpLossDailyRow, TpLossPreviewResponse,
  TpMonitorRow, TpMonthlyRow, ViolationSummary, WorkDetail, WorkRow,
} from '@beap/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { fetchAlerts } from './ai.ts';
import { api, apiFetchRaw, qs } from './api.ts';

export const keys = {
  bootstrap: ['ref', 'bootstrap'] as const,
  district: (panel: string, params: Record<string, unknown> = {}) =>
    ['dash', 'district', panel, params] as const,
  mfy: (id: number, panel: string, params: Record<string, unknown> = {}) =>
    ['dash', 'mfy', id, panel, params] as const,
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

/**
 * Kunlik ogohlantirish digest'i - yuqori chiziqdagi qo'ng'iroq belgisi uchun.
 *
 * Server tarafida kesh cron orqali kuniga bir marta yangilanadi, shuning
 * uchun mijozda ham tez-tez so'rashning hojati yo'q: 5 daqiqalik
 * `refetchInterval` shunchaki sahifa ochiq turgan paytda yangi kun
 * boshlangani (yangi kesh hisoblangani) sezilishi uchun yetarli.
 */
export function useAlerts() {
  return useQuery({
    queryKey: ['ai', 'alerts'] as const,
    queryFn: ({ signal }) => fetchAlerts(signal),
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
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

/** Fider boshidagi oylik balans - hisoblagich ko'rsatkichlari bilan. */
export function useFeederMonthly(id: number, period?: string) {
  return useQuery({
    queryKey: keys.mfy(id, 'feeder-monthly', { period }),
    queryFn: ({ signal }) => api.get<FeederMonthly>(`/dash/mfy/${id}/feeder-monthly${qs({ period })}`, signal),
    ...DASH_OPTIONS,
  });
}

/** TP kesimidagi oylik hisobot - hisoblagich, iste'molchilar, iste'mol. */
export function useTpMonthly(period?: string) {
  return useQuery({
    queryKey: keys.district('tp-monthly', { period }),
    queryFn: ({ signal }) => api.get<TpMonthlyRow[]>(`/dash/district/tp-monthly${qs({ period })}`, signal),
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

export function useMfyViolations(id: number, period?: string) {
  return useQuery({
    queryKey: keys.mfy(id, 'violations', { period }),
    queryFn: ({ signal }) => api.get<ViolationSummary>(`/dash/mfy/${id}/violations${qs({ period })}`, signal),
    ...DASH_OPTIONS,
  });
}

/** Bitta ish - dalolatnoma oynasi. `null` bo'lsa so'rov yuborilmaydi. */
export function useWork(id: number | null) {
  return useQuery({
    queryKey: ['dash', 'work', id] as const,
    queryFn: ({ signal }) => api.get<WorkDetail>(`/dash/work/${String(id)}`, signal),
    enabled: id !== null,
    staleTime: 30_000,
  });
}

/** Dalolatnomaga rasm biriktirish. */
export function useUploadWorkPhoto(workId: number | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { file: File; kind?: 'BEFORE' | 'AFTER' | 'DOC'; caption?: string }) => {
      const form = new FormData();
      form.append('file', input.file);
      const res = await apiFetchRaw(
        `/files/work-photo/${String(workId)}${qs({ kind: input.kind ?? 'AFTER', caption: input.caption })}`,
        { method: 'POST', body: form },
      );
      return (await res.json()) as { id: number; url: string };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['dash', 'work', workId] });
    },
  });
}

export function useDeleteWorkPhoto(workId: number | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (photoId: number) => api.delete<void>(`/files/work-photo/${String(photoId)}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['dash', 'work', workId] });
    },
  });
}

export function useDistrictSeries(params: { from?: string; to?: string; bucket?: 'day' | 'week' | 'month'; last?: number } = {}) {
  return useQuery({
    queryKey: keys.district('series', params),
    queryFn: ({ signal }) => api.get<TimeSeriesPoint[]>(`/dash/district/series${qs(params)}`, signal),
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

export function useMfyDynamics(id: number, params: { from?: string; to?: string; bucket?: 'day' | 'week' | 'month'; last?: number } = {}) {
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

/** Fiderning TP kesimi - hisoblagich, iste'molchilar, oylik iste'mol. */
export function useMfyTpMonthly(id: number, period?: string) {
  return useQuery({
    queryKey: keys.mfy(id, 'tp-monthly', { period }),
    queryFn: ({ signal }) => api.get<TpMonthlyRow[]>(`/dash/mfy/${id}/tp-monthly${qs({ period })}`, signal),
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

/** TP darajasidagi kunlik chiziqli yo'qotish - har bir TP uchun eng so'nggi o'qish. */
/**
 * `period` berilsa - shu OY uchun HAR BIR TP yig'indisi (global davr
 * tanlagich bilan birga o'zgaradi). Berilmasa - eng so'nggi o'qish.
 */
export function useMfyTpLoss(id: number, params: { period?: string; limit?: number } = {}) {
  return useQuery({
    queryKey: keys.mfy(id, 'tp-loss', params),
    queryFn: ({ signal }) => api.get<TpLossDailyRow[]>(`/dash/mfy/${id}/tp-loss${qs(params)}`, signal),
    ...DASH_OPTIONS,
  });
}

/** Fider bo'ylab TP balans hisoblagichi trendi - kunlik/haftalik/oylik. */
export function useMfyTpLossSeries(
  id: number, params: { from?: string; to?: string; bucket?: 'day' | 'week' | 'month'; last?: number } = {},
) {
  return useQuery({
    queryKey: keys.mfy(id, 'tp-loss-series', params),
    queryFn: ({ signal }) => api.get<TimeSeriesPoint[]>(`/dash/mfy/${id}/tp-loss-series${qs(params)}`, signal),
    ...DASH_OPTIONS,
  });
}

export function useMfyTpLossAnomalies(id: number) {
  return useQuery({
    queryKey: keys.mfy(id, 'tp-loss-anomalies'),
    queryFn: ({ signal }) => api.get<TpLossAnomalyReport>(`/dash/mfy/${id}/tp-loss-anomalies`, signal),
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

/** Fider bo'yicha ma'sul shaxs - belgilanmagan bo'lsa `null`. */
export function useMfyResponsible(id: number) {
  return useQuery({
    queryKey: keys.mfy(id, 'responsible'),
    queryFn: ({ signal }) => api.get<MfyResponsible | null>(`/ref/mfy/${id}/responsible`, signal),
    enabled: id > 0,
    staleTime: 60_000,
  });
}

/** Ma'sul shaxsni belgilash / o'zgartirish - sozlamalar sahifasida ishlatiladi. */
export function useUpdateMfyResponsible(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { fullName: string; position: string | null; phone: string | null }) =>
      api.patch<MfyResponsible>(`/ref/mfy/${id}/responsible`, input),
    onSuccess: (data) => {
      qc.setQueryData(keys.mfy(id, 'responsible'), data);
    },
  });
}

// ─── Pasport ────────────────────────────────────────────────────────────────

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

/**
 * TP kunlik yo'qotish faylini OLDINDAN KO'RISH - hech narsa yozmaydi, faqat
 * qaysi qatorlar saqlanishini va qaysi TP kodlari topilmaganini ko'rsatadi.
 */
export function usePreviewTpLoss() {
  return useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('file', file);
      const res = await apiFetchRaw('/entry/tp-daily-loss/preview', { method: 'POST', body: form });
      return (await res.json()) as TpLossPreviewResponse;
    },
  });
}

/** TP kunlik yo'qotish faylini TASDIQLAYDI - haqiqatan UPSERT qiladi. */
export function useConfirmTpLoss() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('file', file);
      const res = await apiFetchRaw('/entry/tp-daily-loss/confirm', { method: 'POST', body: form });
      return (await res.json()) as TpLossConfirmResponse;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['dash'] });
    },
  });
}
