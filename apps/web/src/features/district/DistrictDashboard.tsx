/**
 * Tuman boshqaruv paneli — hokimiyat uchun asosiy ekran.
 *
 * JOYLASHUV maketdagidek: 8 talik KPI qatori, so'ng har biri
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
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';

import { DivergingBar } from '../../components/charts/DivergingBar.tsx';
import { Donut } from '../../components/charts/Donut.tsx';
import { EnergyFlow } from '../../components/charts/EnergyFlow.tsx';
import { LossTreemap } from '../../components/charts/LossTreemap.tsx';
import { TrendLine, type TrendBucket } from '../../components/charts/TrendLine.tsx';
import { ErrorState, LoadingState, PageHeader } from '../../components/layout/AppShell.tsx';
import { MotionStage } from '../../components/ui/MotionStage.tsx';
import { EmptyPanel, Panel } from '../../components/ui/Panel.tsx';
import { PulseHero } from '../../components/ui/PulseHero.tsx';
import { ReportMenu } from '../../components/ui/ReportMenu.tsx';
import { MiniStat, StatTile, type Tone } from '../../components/ui/StatTile.tsx';
import { BucketPicker } from '../mfy/MfyDashboard.tsx';
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
  // Tanlangan sana — reyting va kunlik grafik shu kunga qaraydi.
  const asOfDate = useUi((s) => s.asOfDate);
  const [bucket, setBucket] = useState<TrendBucket>('day');

  const overview = useDistrictOverview(period ?? undefined);
  const balance = useEnergyBalance(period ?? undefined);
  const efficiency = useEfficiency(period ?? undefined);
  // Kartada 5 qator ko'rinadi — ortiqchasini so'rashning hojati yo'q.
  const tp = useTpMonitoring(period ?? undefined, 5);
  const ranking = useMfyRanking(asOfDate ?? undefined);
  const technical = useTechnicalLoss(period ?? undefined);
  const distance = useDistance(period ?? undefined);
  const debt = useDebt(period ?? undefined);
  const lossMap = useLossMap(period ?? undefined);
  const works = useWorks();
  const alerts = useAlerts(period ?? undefined);
  const series = useDistrictSeries({ bucket, last: 7, ...(asOfDate ? { to: asOfDate } : {}) });

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

  /*
   * Tepadagi bandda aylanib turadigan xulosalar.
   *
   * Har biri O'ZI bir gap: hokim bandga qarab turib ham, tashlab ketib
   * qaytganda ham to'liq fikrni oladi. Ma'lumoti yo'q xulosa qatorga
   * umuman tushmaydi — "—" ko'rsatib turgandan ko'ra chiqmagani yaxshi.
   */
  const heroNotes = [
    worst
      ? `Eng yuqori yo‘qotish — ${worst.nameUz.replace(/ MFY$/, '')}: ${pct(worst.lossPct, 2)}`
      : null,
    urgent > 0
      ? `${num(urgent)} ta holat shoshilinch chora talab qiladi`
      : 'Shoshilinch chora talab qiladigan holat yo‘q',
    overNorm.length > 0
      ? `${num(overNorm.length)} ta mahallada texnik yo‘qotish standartdan yuqori`
      : null,
    tpOverDistance > 0 ? `${num(tpOverDistance)} ta transformator 300 m normadan uzoqda` : null,
    plannedWorks.length > 0
      ? `Rejadagi ${num(plannedWorks.length)} ta ish bajarilmoqda · ${num(completedWorks.length)} tasi yakunlangan`
      : null,
  ].filter((s): s is string => s !== null);

  return (
    <MotionStage
      className={overview.isFetching ? 'opacity-70 transition-opacity' : 'transition-opacity'}
    >
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

      {/* ═══ JONLI OQIM: tarmoq pulsi · balans · samaradorlik indeksi ════ */}
      {data && (
        <PulseHero
          kwhIn={data.totals.kwhIn}
          kwhLoss={data.totals.kwhLossTotal}
          kwhSold={data.totals.kwhSold}
          lossPct={data.totals.lossPct}
          notes={heroNotes}
          score={efficiency.data?.score ?? null}
        />
      )}

      {/* ═══ 1-QATOR: 8 ta KPI kartasi ═══════════════════════════════════ */}
      <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        {tiles.map((tile) => (
          <StatTile
            key={tile.key}
            icon={TILE_ICONS[tile.key]}
            tile={tile}
            tone={TILE_TONES[tile.key] ?? 'blue'}
          />
        ))}
      </div>

      {/* ═══ 2-QATOR: yo'qotish xaritasi · balans · samaradorlik ═════════ */}
      <div className="mb-3 grid grid-cols-1 gap-3 xl:grid-cols-12">
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
      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
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
      <div className="mb-3 grid grid-cols-1 gap-3 xl:grid-cols-12">
        <Panel
          actions={<BucketPicker onChange={setBucket} value={bucket} />}
          className="xl:col-span-5"
          title={t('panel.dynamics')}
        >
          {series.data && series.data.length > 0 ? (
            <TrendLine
              bucket={bucket}
              csvName="tuman-dinamika"
              height={214}
              points={series.data}
            />
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
              centerUnit={money(debt.data.totalMln).unit}
              centerValue={num(money(debt.data.totalMln).value, 1)}
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
      <div className="mb-3 grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-12">
        <Panel
          actions={
            <Link
              className="text-[11.5px] font-semibold text-accent hover:underline"
              to="/transformers"
            >
              Barchasi ({num(data?.totals.tpCount ?? 0)})
            </Link>
          }
          className="xl:col-span-4"
          flush
          footerAction={{ label: 'Barcha transformatorlar', to: '/transformers' }}
          title={t('panel.tpMonitoring')}
        >
          {/* 5 qator — qolgani "Barcha transformatorlar" sahifasida. */}
          <TpMonitorPanel rows={(tp.data ?? []).slice(0, 5)} />
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
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-12">
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
    </MotionStage>
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
