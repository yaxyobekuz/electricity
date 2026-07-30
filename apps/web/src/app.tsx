import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nProvider, Toast } from '@heroui/react';
import { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';

import { AppShell, LoadingState } from './components/layout/AppShell.tsx';
import {
  ApiRequestError,
  api,
  apiUrl,
  setAccessToken,
  setUnauthorizedHandler,
} from './lib/api.ts';
import { useUi } from './lib/ui-store.ts';
import type { AuthUser } from '@beap/shared';

// Har bir sahifa alohida bo'lakda — `/entry` hech qachon Nivo/ECharts yuklamaydi.
const DistrictDashboard = lazy(() => import('./features/district/DistrictDashboard.tsx'));
const MfyDashboard = lazy(() => import('./features/mfy/MfyDashboard.tsx'));
const MfyList = lazy(() => import('./features/mfy/MfyList.tsx'));
const PassportPage = lazy(() => import('./features/passport/PassportPage.tsx'));
const PassportPrint = lazy(() => import('./features/passport/PassportPrint.tsx'));
const EntryPage = lazy(() => import('./features/entry/EntryPage.tsx'));
const EntryForm = lazy(() => import('./features/entry/EntryForm.tsx'));
const ReviewQueue = lazy(() => import('./features/review/ReviewQueue.tsx'));
const TpListPage = lazy(() => import('./features/tp/TpListPage.tsx'));
const WorksPage = lazy(() => import('./features/works/WorksPage.tsx'));
const EnergyBalancePage = lazy(() => import('./features/energy/EnergyBalancePage.tsx'));
const LossesPage = lazy(() => import('./features/losses/LossesPage.tsx'));
const DebtPage = lazy(() => import('./features/debt/DebtPage.tsx'));
const ReportsPage = lazy(() => import('./features/reports/ReportsPage.tsx'));
const LoginPage = lazy(() => import('./features/auth/LoginPage.tsx'));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        // 4xx xatolarni qayta urinmaymiz — ular o'z-o'zidan tuzalmaydi.
        if (error instanceof ApiRequestError && error.status < 500) return false;
        return failureCount < 2;
      },
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

/** Sessiyani tiklash — sahifa yangilanganda access token xotirada yo'qoladi. */
function useSessionRestore(): { ready: boolean } {
  const setUser = useUi((s) => s.setUser);

  useEffect(() => {
    let cancelled = false;

    setUnauthorizedHandler(() => {
      setUser(null);
    });

    void (async () => {
      try {
        const res = await fetch(apiUrl('/auth/refresh'), {
          method: 'POST',
          credentials: 'include',
        });
        if (!res.ok) return;
        const data = (await res.json()) as { accessToken: string; user: AuthUser };
        if (cancelled) return;
        setAccessToken(data.accessToken);
        setUser(data.user);
      } catch {
        /* sessiya yo'q — anonim rejimda davom etamiz */
      }
    })();

    return () => {
      cancelled = true;
      setUnauthorizedHandler(null);
    };
  }, [setUser]);

  return { ready: true };
}

export function App() {
  useSessionRestore();

  return (
    // NumberField da `locale` propi YO'Q (hujjatlar jadvalidagi yozuv noto'g'ri —
    // haqiqiy tiplarda u mavjud emas). React Aria lokalni I18nProvider dan oladi,
    // shuning uchun butun ilova uchun BIR MARTA shu yerda belgilanadi.
    <I18nProvider locale="uz-Latn-UZ">
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Toast.Provider placement="bottom" />
          <Routes>
            {/* Chop etish sahifasi — qobiqsiz */}
            <Route
              path="/passport/print/:scope/:id/:period"
              element={
                <Suspense fallback={<LoadingState />}>
                  <PassportPrint />
                </Suspense>
              }
            />

            <Route
              path="/login"
              element={
                <Suspense fallback={<LoadingState />}>
                  <LoginPage />
                </Suspense>
              }
            />

            <Route
              path="*"
              element={
                <AppShell>
                  <Suspense fallback={<LoadingState rows={5} />}>
                    <Routes>
                      <Route path="/" element={<Navigate replace to="/dashboard" />} />
                      <Route path="/dashboard" element={<DistrictDashboard />} />
                      <Route path="/dashboard/mfy/:mfyId" element={<MfyDashboard />} />
                      <Route path="/mahallalar" element={<MfyList />} />
                      <Route path="/transformers" element={<TpListPage />} />
                      <Route path="/energy-balance" element={<EnergyBalancePage />} />
                      <Route path="/losses" element={<LossesPage />} />
                      <Route path="/debt" element={<DebtPage />} />
                      <Route path="/works" element={<WorksPage />} />
                      <Route path="/reports" element={<ReportsPage />} />
                      <Route path="/passport" element={<PassportPage />} />
                      <Route path="/passport/:scope/:id/:period" element={<PassportPage />} />
                      <Route path="/entry" element={<EntryPage />} />
                      <Route path="/entry/:mfyId/:period/:domain" element={<EntryForm />} />
                      <Route path="/review" element={<ReviewQueue />} />
                      <Route path="*" element={<NotFound />} />
                  </Routes>
                </Suspense>
              </AppShell>
            }
          />
          </Routes>
        </BrowserRouter>
      </QueryClientProvider>
    </I18nProvider>
  );
}

function NotFound() {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center gap-2 text-center">
      <p className="text-3xl font-bold">404</p>
      <p className="text-sm text-muted">Bunday sahifa topilmadi</p>
    </div>
  );
}

export { api };
