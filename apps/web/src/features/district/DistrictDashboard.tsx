/**
 * Tuman boshqaruv paneli — hokimiyat uchun asosiy ekran.
 *
 * JOYLASHUV maketdagidek: KPI qatori (5 + 1 keng), so'ng har biri
 * 5/4/3 yoki 4/4/4 nisbatdagi qatorlar va bitta PAST bo'yli 4 talik qator.
 * Panel guruhlari mustaqil yuklanadi, shuning uchun bitta sekin panel
 * butun sahifani ushlab turmaydi.
 */
import { energy, money, num, pct } from '@beap/shared';
import { Chip } from '@heroui/react';
import {
  BatteryWarning, CircleDollarSign, Gauge as GaugeIcon, PlugZap, Ruler,
  ShoppingCart, TrendingDown, TriangleAlert, Users, Zap,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { DivergingBar } from '../../components/charts/DivergingBar.tsx';
import { Donut } from '../../components/charts/Donut.tsx';
import { EnergyFlow } from '../../components/charts/EnergyFlow.tsx';
import { LossTreemap } from '../../components/charts/LossTreemap.tsx';
import { TrendLine } from '../../components/charts/TrendLine.tsx';
import { ErrorState, LoadingState, PageHeader } from '../../components/layout/AppShell.tsx';
import { EmptyPanel, Panel } from '../../components/ui/Panel.tsx';
import { ReportMenu } from '../../components/ui/ReportMenu.tsx';
import { MiniStat, StatStrip, StatTile, type Tone } from '../../components/ui/StatTile.tsx';
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

const STRIP_ICONS: Record<string, React.ReactNode> = {
  naturalPct: <GaugeIcon className="size-3.5" />,
  consumersDisconnected: <PlugZap className="size-3.5" />,
  tpCount: <BatteryWarning className="size-3.5" />,
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
  const tiles = data?.tiles ?? [];
  const mainTiles = tiles.slice(0, 5);
  const stripTiles = tiles.slice(5);

  // ── 3-qator uchun hisoblangan xulosalar ────────────────────────────────
  const worst = [...(ranking.data ?? [])].sort((a, b) => b.lossPct - a.lossPct)[0];
  const overNorm = (technical.data ?? []).filter((r) => r.gapPp > 0);
  const tpOverDistance = (distance.data ?? []).reduce((a, r) => a + r.tpOverStandard, 0);
  const tpTotalCounted = (distance.data ?? []).reduce((a, r) => a + r.tpCount, 0);
  const alertItems = alerts.data ?? [];
  const urgent = alertItems.filter(
    (a) => a.severity === 'critical' || a.severity === 'serious',
  ).length;
  const plannedWorks = (works.data ?? []).filter((w) => w.status !== 'COMPLETED');
  const completedWorks = (works.data ?? []).filter((w) => w.status === 'COMPLETED');

  return (
    <div className={overview.isFetching ? 'opacity-70 transition-opacity' : 'transition-opacity'}>
      <PageHeader
        actions={
          <>
            <PeriodPicker />
            <ReportMenu />
          </>
        }
        subtitle={t('app.subtitle')}
        title={t('nav.dashboard')}
      />

      {/* ═══ 1-QATOR: 5 ta KPI + keng quti ═══════════════════════════════ */}
      <div className="mb-2.5 grid grid-cols-2 gap-2.5 md:grid-cols-4 xl:grid-cols-8">
        {mainTiles.map((tile) => (
          <StatTile
            key={tile.key}
            icon={TILE_ICONS[tile.key]}
            tile={tile}
            tone={TILE_TONES[tile.key] ?? 'blue'}
          />
        ))}
        <div className="col-span-2 md:col-span-4 xl:col-span-3">
          <StatStrip icons={STRIP_ICONS} tiles={stripTiles} />
        </div>
      </div>

      {/* ═══ 2-QATOR: yo'qotish xaritasi · balans · samaradorlik ═════════ */}
      <div className="mb-2.5 grid grid-cols-1 gap-2.5 xl:grid-cols-12">
        <Panel
          className="xl:col-span-5"
          subtitle={t('panel.lossMapSub')}
          title={t('panel.lossMap')}
        >
          {lossMap.data && lossMap.data.length > 0 ? (
            <LossTreemap cells={lossMap.data} height={244} onSelect={goMfy} />
          ) : (
            <EmptyPanel message={t('common.noData')} />
          )}
        </Panel>

        <Panel className="xl:col-span-4" title={t('panel.energyBalance')}>
          {balance.data && balance.data.length > 0 ? (
            <EnergyFlow height={244} nodes={balance.data} />
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

      {/* ═══ 3-QATOR: 4 ta past bo'yli xulosa ════════════════════════════ */}
      <div className="mb-2.5 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <MiniStat
          hint={
            worst
              ? `${worst.nameUz.replace(/ MFY$/, '')} · tuman o‘rt. ${pct(data?.totals.lossPct ?? 0, 2)}`
              : '—'
          }
          icon={<TrendingDown className="size-4.5" />}
          label="Eng yuqori yo‘qotish"
          tone="critical"
          value={worst ? pct(worst.lossPct, 2) : '—'}
        />
        <MiniStat
          hint={`Jami ${num(technical.data?.length ?? 0)} ta mahalladan`}
          icon={<GaugeIcon className="size-4.5" />}
          label="Standartdan chetlashgan"
          tone={overNorm.length > 0 ? 'warning' : 'good'}
          unit="ta"
          value={num(overNorm.length)}
        />
        <MiniStat
          hint={`Jami ${num(tpTotalCounted)} ta TP · norma 300 m`}
          icon={<Ruler className="size-4.5" />}
          label="Normadan uzoq TP"
          tone={tpOverDistance > 0 ? 'warning' : 'good'}
          unit="ta"
          value={num(tpOverDistance)}
        />
        <MiniStat
          hint={`Jami ${num(alertItems.length)} ta ogohlantirish`}
          icon={<TriangleAlert className="size-4.5" />}
          label="Shoshilinch chora"
          tone={urgent > 0 ? 'critical' : 'good'}
          unit="ta"
          value={num(urgent)}
        />
      </div>

      {/* ═══ 4-QATOR: dinamika · ogohlantirish · qarzdorlik ══════════════ */}
      <div className="mb-2.5 grid grid-cols-1 gap-2.5 xl:grid-cols-12">
        <Panel className="xl:col-span-5" subtitle="oxirgi 90 kun" title={t('panel.dynamics')}>
          {series.data && series.data.length > 0 ? (
            <TrendLine csvName="tuman-dinamika" height={214} points={series.data} />
          ) : (
            <EmptyPanel message={t('common.noData')} />
          )}
        </Panel>

        <Panel
          className="xl:col-span-4"
          flush
          subtitle={t('panel.alertsSub')}
          title={t('panel.alerts')}
        >
          <AlertsPanel items={alertItems} />
        </Panel>

        <Panel className="xl:col-span-3" title={t('panel.debt')}>
          {debt.data ? (
            <Donut
              centerLabel="jami qarzdorlik"
              centerValue={money(debt.data.totalMln).text}
              csvName="qarzdorlik"
              formatValue={(v) => money(v).text}
              height={190}
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
      </div>

      {/* ═══ 5-QATOR: TP · reyting · texnik yo'qotish ════════════════════ */}
      <div className="mb-2.5 grid grid-cols-1 gap-2.5 lg:grid-cols-2 xl:grid-cols-12">
        <Panel
          actions={
            <Chip size="sm" variant="soft">
              <Chip.Label>{num(data?.totals.tpCount ?? 0)} ta</Chip.Label>
            </Chip>
          }
          className="xl:col-span-4"
          flush
          footerAction={{ label: 'Barcha transformatorlar', to: '/transformers' }}
          title={t('panel.tpMonitoring')}
        >
          <TpMonitorPanel rows={tp.data ?? []} />
        </Panel>

        <Panel
          className="xl:col-span-4"
          flush
          footerAction={{ label: 'Barcha mahallalar', to: '/mahallalar' }}
          subtitle={t('panel.mfyRankingSub')}
          title={t('panel.mfyRanking')}
        >
          <MfyRankingPanel onSelect={goMfy} rows={ranking.data ?? []} />
        </Panel>

        <Panel
          className="lg:col-span-2 xl:col-span-4"
          subtitle={t('panel.technicalLossSub')}
          title={t('panel.technicalLoss')}
        >
          {technical.data && technical.data.length > 0 ? (
            <DivergingBar height={272} onSelect={goMfy} rows={technical.data} />
          ) : (
            <EmptyPanel message={t('common.noData')} />
          )}
        </Panel>
      </div>

      {/* ═══ 6-QATOR: masofa · TOP qarzdorlar · ishlar ═══════════════════ */}
      <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2 xl:grid-cols-12">
        <Panel
          className="xl:col-span-5"
          flush
          subtitle={t('panel.distanceSub')}
          title={t('panel.distance')}
        >
          <DistancePanel rows={distance.data ?? []} onSelect={goMfy} />
        </Panel>

        <Panel
          className="xl:col-span-3"
          flush
          footerAction={{ label: 'Barcha qarzdorlar', to: '/debt' }}
          title={t('panel.topDebtors')}
        >
          <TopDebtorsTable rows={debt.data?.topDebtors ?? []} />
        </Panel>

        <Panel
          actions={
            <Chip size="sm" variant="soft">
              <Chip.Label>
                {completedWorks.length} / {completedWorks.length + plannedWorks.length} bajarildi
              </Chip.Label>
            </Chip>
          }
          className="lg:col-span-2 xl:col-span-4"
          flush
          footerAction={{ label: t('common.showAll'), to: '/works' }}
          title={t('panel.plannedWorks')}
        >
          <WorksPanel mode="planned" rows={plannedWorks} />
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
