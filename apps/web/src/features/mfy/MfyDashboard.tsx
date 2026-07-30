/**
 * MFY boshqaruv paneli — mahalla darajasidagi tafsilot.
 *
 * Tuman panelidan farqi: bu yerda YORUG' tema (mockupdagidek) va
 * operatsion ko'rsatkichlar ustunlik qiladi.
 */
import { energy, kva, kw, money, num, pct, volts } from '@beap/shared';
import { Button, Chip } from '@heroui/react';
import {
  Activity, BatteryWarning, CircleDollarSign, Gauge as GaugeIcon, PlugZap,
  Power, ShoppingCart, TrendingDown, Users, Zap,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';

import { Donut } from '../../components/charts/Donut.tsx';
import { EnergyBalanceBars } from '../../components/charts/EnergyFlow.tsx';
import { Gauge } from '../../components/charts/Gauge.tsx';
import { TrendLine } from '../../components/charts/TrendLine.tsx';
import { ErrorState, LoadingState, PageHeader } from '../../components/layout/AppShell.tsx';
import { EmptyPanel, Panel } from '../../components/ui/Panel.tsx';
import { MiniStat, StatTile , type Tone } from '../../components/ui/StatTile.tsx';
import { PeriodPicker } from '../district/panels/PeriodPicker.tsx';
import { TpMonitorPanel } from '../district/panels/TpMonitorPanel.tsx';
import { WorksPanel } from '../district/panels/WorksPanel.tsx';
import {
  useMfyCapacity, useMfyConsumers, useMfyDebt, useMfyDynamics, useMfyEfficiency,
  useMfyLossStructure, useMfyOperational, useMfyOverview, useMfyResults, useMfyTp,
  useMfyWorks,
} from '../../lib/queries.ts';
import { useUi } from '../../lib/ui-store.ts';

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

export default function MfyDashboard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const params = useParams();
  const mfyId = Number(params['mfyId']);
  const period = useUi((s) => s.period);


  const overview = useMfyOverview(mfyId, period ?? undefined);
  const dynamics = useMfyDynamics(mfyId, { bucket: 'day' });
  const capacity = useMfyCapacity(mfyId, period ?? undefined);
  const consumers = useMfyConsumers(mfyId, period ?? undefined);
  const tp = useMfyTp(mfyId, period ?? undefined);
  const lossStructure = useMfyLossStructure(mfyId, period ?? undefined);
  const debt = useMfyDebt(mfyId, period ?? undefined);
  const operational = useMfyOperational(mfyId, period ?? undefined);
  const works = useMfyWorks(mfyId);
  const results = useMfyResults(mfyId, period ?? undefined);
  const efficiency = useMfyEfficiency(mfyId, period ?? undefined);

  if (!Number.isFinite(mfyId)) {
    return <ErrorState message="MFY identifikatori noto‘g‘ri" />;
  }
  if (overview.isLoading) return <LoadingState rows={6} />;
  if (overview.isError || !overview.data) {
    return (
      <ErrorState
        message={overview.error instanceof Error ? overview.error.message : 'Ma’lumot topilmadi'}
        onRetry={() => void overview.refetch()}
      />
    );
  }

  const { mfy, totals } = overview.data;
  const daysInMonth = 30;
  const avgPerConsumer =
    totals.consumersActive > 0 ? totals.kwhSold / totals.consumersActive / daysInMonth : 0;

  return (
    <div className={overview.isFetching ? 'opacity-70 transition-opacity' : ''}>
      <PageHeader
        actions={
          <div className="flex items-center gap-2">
            <PeriodPicker />
            <Button
              size="sm"
              variant="secondary"
              onPress={() => void navigate(`/passport/mfy/${mfyId}/${period ?? 'latest'}`)}
            >
              Pasport
            </Button>
          </div>
        }
        breadcrumbs={[
          { label: 'Baliqchi tumani', to: '/dashboard' },
          { label: mfy.elektrosetName },
          { label: mfy.nameUz },
        ]}
        subtitle={`${mfy.elektrosetName} · ${num(totals.tpCount)} ta transformator`}
        title={`${mfy.nameUz} boshqaruv paneli`}
      />

      {/* ── KPI kartalari ─────────────────────────────────────────────── */}
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        {overview.data.tiles.map((tile) => (
          <StatTile
            key={tile.key}
            tone={TILE_TONES[tile.key] ?? 'blue'}
            icon={TILE_ICONS[tile.key]}
            tile={tile}
          />
        ))}
      </div>

      {/* ── 1-qator: dinamika + quvvat + abonentlar ───────────────────── */}
      <div className="mb-4 grid grid-cols-1 gap-3 xl:grid-cols-12">
        <Panel className="xl:col-span-6" subtitle="oxirgi 90 kun" title={t('panel.dynamics')}>
          {dynamics.data && dynamics.data.length > 0 ? (
            <TrendLine csvName={`${mfy.code}-dinamika`} height={252} points={dynamics.data} />
          ) : (
            <EmptyPanel message={t('common.noData')} />
          )}
        </Panel>

        <Panel className="xl:col-span-3" title={t('panel.capacity')}>
          {capacity.data ? (
            <div className="flex flex-col gap-3">
              <Gauge
                height={168}
                higherIsBetter={false}
                label={t('tp.currentLoad')}
                suffix="%"
                value={capacity.data.loadPct}
              />
              <dl className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <dt className="text-[10px] uppercase text-muted">{t('tp.capacity')}</dt>
                  <dd className="tabular text-xs font-semibold">{kva(capacity.data.capacityKva)}</dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase text-muted">{t('tp.current')}</dt>
                  <dd className="tabular text-xs font-semibold">{kva(capacity.data.currentKva)}</dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase text-muted">{t('tp.reserve')}</dt>
                  <dd className="tabular text-xs font-semibold text-viz-good">
                    {kva(capacity.data.reserveKva)}
                  </dd>
                </div>
              </dl>
            </div>
          ) : (
            <EmptyPanel message={t('common.noData')} />
          )}
        </Panel>

        <Panel className="xl:col-span-3" title={t('panel.consumers')}>
          {consumers.data ? (
            <Donut
              centerLabel="jami abonent"
              centerValue={num(consumers.data.total)}
              csvName={`${mfy.code}-abonentlar`}
              height={214}
              slices={[
                { id: 'active', label: t('consumer.active'), value: consumers.data.active },
                { id: 'disconnected', label: t('consumer.disconnected'), value: consumers.data.disconnected },
                { id: 'new', label: t('consumer.new'), value: consumers.data.new },
              ]}
            />
          ) : (
            <EmptyPanel message={t('common.noData')} />
          )}
        </Panel>
      </div>

      {/* ── 2-qator: 4 ta kichik ko'rsatkich ──────────────────────────── */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MiniStat
          hint={`jami ${num(totals.consumersTotal)} ta`}
          icon={<Users className="size-4" />}
          label="Yuridik iste’molchilar"
          value={num(consumers.data?.legal ?? 0)}
          unit="ta"
        />
        <MiniStat
          hint="1 abonentga"
          icon={<Activity className="size-4" />}
          label="O‘rtacha iste’mol"
          value={num(avgPerConsumer, 1)}
          unit="kWh/kun"
        />
        <MiniStat
          hint="oylik"
          icon={<CircleDollarSign className="size-4" />}
          label="Qarzdorlik"
          tone={totals.debtTotalMln > 300 ? 'warning' : 'good'}
          value={money(totals.debtTotalMln).value.toFixed(1)}
          unit={money(totals.debtTotalMln).unit}
        />
        <MiniStat
          hint={`${pct(lossStructure.data?.parts[0]?.pct ?? 0, 1)} yo‘qotishdan`}
          icon={<GaugeIcon className="size-4" />}
          label="Tabiiy yo‘qotish"
          value={energy(lossStructure.data?.parts[0]?.kwh ?? 0).value.toFixed(1)}
          unit={energy(lossStructure.data?.parts[0]?.kwh ?? 0).unit}
        />
      </div>

      {/* ── 3-qator: TP + yo'qotish tuzilmasi + qarzdorlik tuzilmasi ─── */}
      <div className="mb-4 grid grid-cols-1 gap-3 xl:grid-cols-12">
        <Panel
          className="xl:col-span-6"
          actions={<Chip size="sm" variant="soft"><Chip.Label>{tp.data?.length ?? 0} ta</Chip.Label></Chip>}
          title="Transformatorlar holati"
          flush
        >
          <TpMonitorPanel rows={tp.data ?? []} showMfy={false} />
        </Panel>

        <Panel className="xl:col-span-3" title={t('panel.lossStructure')}>
          {lossStructure.data ? (
            <Donut
              centerLabel="jami yo‘qotish"
              centerValue={energy(lossStructure.data.totalKwh).text}
              csvName={`${mfy.code}-yoqotish`}
              formatValue={(v) => energy(v).text}
              height={214}
              slices={lossStructure.data.parts.map((p) => ({
                id: p.key,
                label: p.labelUz,
                value: p.kwh,
                display: energy(p.kwh).text,
              }))}
            />
          ) : (
            <EmptyPanel message={t('common.noData')} />
          )}
        </Panel>

        <Panel className="xl:col-span-3" title={t('panel.debtStructure')}>
          {debt.data ? (
            <Donut
              centerLabel="jami qarzdorlik"
              centerValue={money(debt.data.totalMln).text}
              csvName={`${mfy.code}-qarzdorlik`}
              formatValue={(v) => money(v).text}
              height={214}
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

      {/* ── 4-qator: energiya balansi + tezkor ko'rsatkichlar + natija ─ */}
      <div className="mb-4 grid grid-cols-1 gap-3 xl:grid-cols-12">
        <Panel className="xl:col-span-4" title={t('panel.energyBalance')}>
          <EnergyBalanceBars
            nodes={[
              { key: 'in', labelUz: t('energy.in'), kwh: totals.kwhIn, pct: 100 },
              {
                key: 'sold', labelUz: t('energy.sold'), kwh: totals.kwhSold,
                pct: totals.kwhIn > 0 ? (totals.kwhSold / totals.kwhIn) * 100 : 0,
              },
              ...(lossStructure.data?.parts ?? []).map((p) => ({
                key: p.key,
                labelUz: p.labelUz,
                kwh: p.kwh,
                pct: totals.kwhIn > 0 ? (p.kwh / totals.kwhIn) * 100 : 0,
              })),
            ]}
          />
        </Panel>

        <Panel className="xl:col-span-4" title={t('panel.operational')}>
          {operational.data ? (
            <div className="grid grid-cols-2 gap-3">
              <MiniStat
                icon={<Zap className="size-4" />}
                label="Maksimal yuklama"
                value={kw(operational.data.maxLoadKw)}
              />
              <MiniStat
                icon={<Activity className="size-4" />}
                label="Minimal yuklama"
                value={kw(operational.data.minLoadKw)}
              />
              <MiniStat
                hint={`nominal ${volts(operational.data.nominalVoltageV)}`}
                icon={<GaugeIcon className="size-4" />}
                label="O‘rtacha kuchlanish"
                tone={
                  operational.data.avgVoltageV !== null &&
                  Math.abs(operational.data.avgVoltageV - operational.data.nominalVoltageV) >
                    operational.data.nominalVoltageV * 0.1
                    ? 'warning'
                    : 'good'
                }
                value={volts(operational.data.avgVoltageV)}
              />
              <MiniStat
                hint={`${num(operational.data.outageMinutes ?? 0)} daqiqa`}
                icon={<Power className="size-4" />}
                label="O‘chirishlar soni"
                tone={(operational.data.outageCount ?? 0) > 10 ? 'warning' : 'good'}
                value={num(operational.data.outageCount ?? 0)}
                unit="ta"
              />
            </div>
          ) : (
            <EmptyPanel message={t('common.noData')} />
          )}
        </Panel>

        <Panel className="xl:col-span-4" title={t('panel.results')}>
          {results.data ? (
            <div className="flex flex-col gap-4">
              <div>
                <p className="mb-1 text-[11px] uppercase tracking-wide text-muted">
                  Yo‘qotish darajasi
                </p>
                <div className="flex items-center gap-3">
                  <span className="tabular text-lg font-semibold text-muted line-through">
                    {pct(results.data.lossPctStart ?? 0, 1)}
                  </span>
                  <span aria-hidden="true" className="text-muted">→</span>
                  <span
                    className="tabular text-2xl font-bold"
                    style={{
                      color:
                        (results.data.improvementPp ?? 0) > 0
                          ? 'var(--viz-good)'
                          : 'var(--viz-critical)',
                    }}
                  >
                    {pct(results.data.lossPctEnd ?? 0, 1)}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-muted">
                  {results.data.periodFrom} … {results.data.periodTo}
                  {results.data.improvementPp !== null && (
                    <span
                      className="ml-2 font-medium"
                      style={{
                        color:
                          results.data.improvementPp > 0
                            ? 'var(--viz-delta-good)'
                            : 'var(--viz-delta-bad)',
                      }}
                    >
                      {results.data.improvementPp > 0 ? '↓' : '↑'}{' '}
                      {Math.abs(results.data.improvementPp).toFixed(1)} p.p.
                    </span>
                  )}
                </p>
              </div>

              <div>
                <p className="mb-1 text-[11px] uppercase tracking-wide text-muted">
                  Iqtisod qilingan energiya
                </p>
                <p className="tabular text-xl font-bold text-viz-good">
                  {energy(results.data.savedKwh).text}
                </p>
                <p className="text-[11px] text-muted">bajarilgan ishlar hisobiga, oyiga</p>
              </div>

              {efficiency.data && (
                <div className="rounded-lg border border-border/70 bg-surface-secondary p-2.5">
                  <p className="text-[11px] uppercase tracking-wide text-muted">
                    Samaradorlik indeksi
                  </p>
                  <p className="tabular text-lg font-bold">
                    {efficiency.data.score.toFixed(1)}
                    <span className="ml-1 text-xs font-normal text-muted">/ 100</span>
                  </p>
                </div>
              )}
            </div>
          ) : (
            <EmptyPanel message={t('common.noData')} />
          )}
        </Panel>
      </div>

      {/* ── 5-qator: ishlar ──────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Panel title={t('panel.plannedWorks')} flush>
          <WorksPanel
            mode="planned"
            rows={(works.data ?? []).filter((w) => w.status !== 'COMPLETED')}
          />
        </Panel>
        <Panel title={t('panel.completedWorks')} flush>
          <WorksPanel
            mode="completed"
            rows={(works.data ?? []).filter((w) => w.status === 'COMPLETED')}
          />
        </Panel>
      </div>
    </div>
  );
}
