/**
 * Tuman boshqaruv paneli — hokimiyat uchun asosiy ekran.
 *
 * Panel guruhlari mustaqil yuklanadi (har biri o'z so'rovi), shuning uchun
 * bitta sekin panel butun sahifani ushlab turmaydi.
 */
import { energy, money, num, pct } from '@beap/shared';
import { Button, Chip } from '@heroui/react';
import {
  BatteryWarning, CircleDollarSign, Gauge as GaugeIcon, PlugZap, ShoppingCart,
  TrendingDown, Users, Zap,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { DivergingBar } from '../../components/charts/DivergingBar.tsx';
import { Donut } from '../../components/charts/Donut.tsx';
import { EnergyFlow } from '../../components/charts/EnergyFlow.tsx';
import { Gauge } from '../../components/charts/Gauge.tsx';
import { LossTreemap } from '../../components/charts/LossTreemap.tsx';
import { TrendLine } from '../../components/charts/TrendLine.tsx';
import { ErrorState, LoadingState, PageHeader } from '../../components/layout/AppShell.tsx';
import { EmptyPanel, Panel } from '../../components/ui/Panel.tsx';
import { StatTile , type Tone } from '../../components/ui/StatTile.tsx';
import {
  useAlerts, useDebt, useDistrictOverview, useDistrictSeries, useDistance,
  useEfficiency, useEnergyBalance, useLossMap, useMfyRanking, useTechnicalLoss,
  useTpMonitoring, useWorks,
} from '../../lib/queries.ts';
import { useUi } from '../../lib/ui-store.ts';
import { AlertsPanel } from './panels/AlertsPanel.tsx';
import { DistancePanel } from './panels/DistancePanel.tsx';
import { EfficiencyPanel } from './panels/EfficiencyPanel.tsx';
import { MfyRankingPanel } from './panels/MfyRankingPanel.tsx';
import { PeriodPicker } from './panels/PeriodPicker.tsx';
import { ReportCentre } from './panels/ReportCentre.tsx';
import { TopDebtorsTable } from './panels/TopDebtorsTable.tsx';
import { TpMonitorPanel } from './panels/TpMonitorPanel.tsx';
import { WorksPanel } from './panels/WorksPanel.tsx';

const TILE_ICONS: Record<string, React.ReactNode> = {
  kwhIn: <Zap className="size-4" />,
  kwhSold: <ShoppingCart className="size-4" />,
  lossPct: <TrendingDown className="size-4" />,
  naturalPct: <GaugeIcon className="size-4" />,
  debt: <CircleDollarSign className="size-4" />,
  consumersActive: <Users className="size-4" />,
  consumersDisconnected: <PlugZap className="size-4" />,
  tpCount: <BatteryWarning className="size-4" />,
};

const TILE_TONES: Record<string, Tone> = {
  kwhIn: 'blue',
  kwhSold: 'green',
  lossPct: 'orange',
  naturalPct: 'purple',
  debt: 'pink',
  consumersActive: 'sky',
  consumersDisconnected: 'amber',
  tpCount: 'cyan',
};

export default function DistrictDashboard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const period = useUi((s) => s.period);

  const overview = useDistrictOverview(period ?? undefined);
  const balance = useEnergyBalance(period ?? undefined);
  const efficiency = useEfficiency(period ?? undefined);
  const tp = useTpMonitoring(period ?? undefined, 40);
  const ranking = useMfyRanking();
  const technical = useTechnicalLoss(period ?? undefined);
  const distance = useDistance(period ?? undefined);
  const debt = useDebt(period ?? undefined);
  const lossMap = useLossMap(period ?? undefined);
  const works = useWorks();
  const alerts = useAlerts(period ?? undefined);
  const series = useDistrictSeries({ bucket: 'day' });

  const goMfy = (id: number): void => {
    void navigate(`/dashboard/mfy/${id}`);
  };

  if (overview.isLoading) {
    return (
      <>
        <PageHeader title={t('nav.dashboard')} />
        <LoadingState rows={6} />
      </>
    );
  }

  if (overview.isError) {
    return (
      <>
        <PageHeader title={t('nav.dashboard')} />
        <ErrorState
          message={overview.error instanceof Error ? overview.error.message : 'Noma’lum xatolik'}
          onRetry={() => void overview.refetch()}
        />
      </>
    );
  }

  const data = overview.data;

  return (
    <div className={overview.isFetching ? 'opacity-70 transition-opacity' : 'transition-opacity'}>
      <PageHeader
        actions={<PeriodPicker />}
        subtitle={t('app.subtitle')}
        title={t('nav.dashboard')}
      />

      {/* ── 8 ta KPI kartasi ──────────────────────────────────────────── */}
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        {data?.tiles.map((tile) => (
          <StatTile
            key={tile.key}
            tone={TILE_TONES[tile.key] ?? 'blue'}
            icon={TILE_ICONS[tile.key]}
            tile={tile}
          />
        ))}
      </div>

      {/* ── 1-qator: xarita o'rnini bosuvchi treemap + balans + indeks ── */}
      <div className="mb-4 grid grid-cols-1 gap-3 xl:grid-cols-12">
        <Panel
          className="xl:col-span-5"
          subtitle={t('panel.lossMapSub')}
          title={t('panel.lossMap')}
        >
          {lossMap.data && lossMap.data.length > 0 ? (
            <LossTreemap cells={lossMap.data} height={296} onSelect={goMfy} />
          ) : (
            <EmptyPanel message={t('common.noData')} />
          )}
        </Panel>

        <Panel className="xl:col-span-4" title={t('panel.energyBalance')}>
          {balance.data && balance.data.length > 0 ? (
            <EnergyFlow height={296} nodes={balance.data} />
          ) : (
            <EmptyPanel message={t('common.noData')} />
          )}
        </Panel>

        <Panel className="xl:col-span-3" title={t('panel.efficiency')}>
          {efficiency.data ? (
            <EfficiencyPanel data={efficiency.data} />
          ) : (
            <EmptyPanel message={t('common.noData')} />
          )}
        </Panel>
      </div>

      {/* ── 2-qator: dinamika + ogohlantirishlar ──────────────────────── */}
      <div className="mb-4 grid grid-cols-1 gap-3 xl:grid-cols-12">
        <Panel
          className="xl:col-span-8"
          subtitle="oxirgi 90 kun"
          title={t('panel.dynamics')}
        >
          {series.data && series.data.length > 0 ? (
            <TrendLine csvName="tuman-dinamika" height={250} points={series.data} />
          ) : (
            <EmptyPanel message={t('common.noData')} />
          )}
        </Panel>

        <Panel
          className="xl:col-span-4"
          subtitle={t('panel.alertsSub')}
          title={t('panel.alerts')}
          flush
        >
          <AlertsPanel items={alerts.data ?? []} />
        </Panel>
      </div>

      {/* ── 3-qator: TP monitoring + MFY reytingi + texnik yo'qotish ──── */}
      <div className="mb-4 grid grid-cols-1 gap-3 xl:grid-cols-12">
        <Panel
          className="xl:col-span-4"
          actions={
            <Chip size="sm" variant="soft">
              <Chip.Label>{num(data?.totals.tpCount ?? 0)} ta</Chip.Label>
            </Chip>
          }
          title={t('panel.tpMonitoring')}
          flush
          footerAction={{ label: "Barcha transformatorlar", to: "/transformers" }}
        >
          <TpMonitorPanel rows={tp.data ?? []} />
        </Panel>

        <Panel
          className="xl:col-span-4"
          subtitle={t('panel.mfyRankingSub')}
          title={t('panel.mfyRanking')}
          flush
          footerAction={{ label: "Barcha mahallalar", to: "/mahallalar" }}
        >
          <MfyRankingPanel onSelect={goMfy} rows={ranking.data ?? []} />
        </Panel>

        <Panel
          className="xl:col-span-4"
          subtitle={t('panel.technicalLossSub')}
          title={t('panel.technicalLoss')}
        >
          {technical.data && technical.data.length > 0 ? (
            <DivergingBar height={300} onSelect={goMfy} rows={technical.data} />
          ) : (
            <EmptyPanel message={t('common.noData')} />
          )}
        </Panel>
      </div>

      {/* ── 4-qator: masofa + qarzdorlik ─────────────────────────────── */}
      <div className="mb-4 grid grid-cols-1 gap-3 xl:grid-cols-12">
        <Panel
          className="xl:col-span-5"
          subtitle={t('panel.distanceSub')}
          title={t('panel.distance')}
          flush
        >
          <DistancePanel rows={distance.data ?? []} onSelect={goMfy} />
        </Panel>

        <Panel className="xl:col-span-3" title={t('panel.debt')}>
          {debt.data ? (
            <Donut
              centerLabel="jami qarzdorlik"
              centerValue={money(debt.data.totalMln).text}
              csvName="qarzdorlik"
              formatValue={(v) => money(v).text}
              height={218}
              slices={debt.data.byCategory.map((c) => ({
                id: c.category,
                label: c.labelUz,
                value: c.amountMln,
                display: money(c.amountMln).text,
              }))}
            />
          ) : (
            <EmptyPanel message={t('common.noData')} />
          )}
        </Panel>

        <Panel className="xl:col-span-4" title={t('panel.topDebtors')} flush footerAction={{ label: "Barcha qarzdorlar", to: "/debt" }}>
          <TopDebtorsTable rows={debt.data?.topDebtors ?? []} />
        </Panel>
      </div>

      {/* ── 5-qator: ishlar + hisobot markazi ────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-12">
        <Panel
          className="xl:col-span-4"
          actions={
            <Button size="sm" variant="ghost" onPress={() => void navigate('/works')}>
              {t('common.showAll')}
            </Button>
          }
          title={t('panel.plannedWorks')}
          flush
        >
          <WorksPanel rows={(works.data ?? []).filter((w) => w.status !== 'COMPLETED')} mode="planned" />
        </Panel>

        <Panel className="xl:col-span-4" title={t('panel.completedWorks')} flush>
          <WorksPanel rows={(works.data ?? []).filter((w) => w.status === 'COMPLETED')} mode="completed" />
        </Panel>

        <Panel className="xl:col-span-4" title={t('panel.reportCentre')}>
          <ReportCentre />
        </Panel>
      </div>
    </div>
  );
}

/** Dashboard sarlavhasida ko'rsatiladigan qisqa jami. */
export function DistrictSummaryLine({
  kwhIn, lossPct, debtMln,
}: {
  kwhIn: number;
  lossPct: number | null;
  debtMln: number;
}) {
  return (
    <p className="text-xs text-muted">
      {energy(kwhIn).text} · yo‘qotish {pct(lossPct ?? 0, 2)} · qarzdorlik {money(debtMln).text}
    </p>
  );
}
