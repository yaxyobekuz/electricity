/**
 * MFY boshqaruv paneli.
 *
 * JOYLASHUV — mijoz bergan maketning aynan o'zi:
 *
 *   yuqori chiziq │ sarlavha + yo'l ····· davr tanlagich · hisobot · global
 *   1-qator       │ 5 ta KPI kartasi + 1 ta KENG quti (yana 3 ta ko'rsatkich)
 *   2-qator       │ Dinamika (5) │ Diqqat talab qiladigan (4) │ Quvvat (3)
 *   3-qator       │ 4 ta PAST bo'yli ko'rsatkich (3+3+3+3)
 *   4-qator       │ Abonentlar (3) │ Transformatorlar (6) │ Yo'qotish (3)
 *   5-qator       │ Qarzdorlik (3) │ Ishlar (6)            │ Natijadorlik (3)
 *
 * ZICHLIK QOIDASI: har bir panel o'z mazmuniga yetadigan balandlikda —
 * bo'sh joyni to'ldirish uchun cho'zilmaydi. Shu sababli panellar soni ko'p,
 * balandligi past.
 */
import { energy, kva, kw, money, num, pct, volts } from '@beap/shared';
import { Chip } from '@heroui/react';
import {
  Activity, Building2, CircleDollarSign, Gauge as GaugeIcon, Leaf, Power,
  TrendingDown, Users, Zap, ZapOff,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';

import { Donut } from '../../components/charts/Donut.tsx';
import { Gauge } from '../../components/charts/Gauge.tsx';
import { TrendLine } from '../../components/charts/TrendLine.tsx';
import { ErrorState, LoadingState, PageHeader } from '../../components/layout/AppShell.tsx';
import { EmptyPanel, Panel } from '../../components/ui/Panel.tsx';
import { ReportMenu } from '../../components/ui/ReportMenu.tsx';
import {
  MiniStat, QuickMetric, StatStrip, StatTile, type Tone,
} from '../../components/ui/StatTile.tsx';
import { AlertsPanel } from '../district/panels/AlertsPanel.tsx';
import { PeriodPicker } from '../district/panels/PeriodPicker.tsx';
import { TpMonitorPanel } from '../district/panels/TpMonitorPanel.tsx';
import {
  useAlerts, useMfyCapacity, useMfyConsumers, useMfyDebt, useMfyDynamics,
  useMfyLossStructure, useMfyOperational, useMfyOverview, useMfyResults, useMfyTp,
  useMfyWorks,
} from '../../lib/queries.ts';
import { useUi } from '../../lib/ui-store.ts';
import { WorkTimeline } from './WorkTimeline.tsx';

const TILE_ICONS: Record<string, React.ReactNode> = {
  kwhIn: <Zap className="size-4" />,
  kwhSold: <CircleDollarSign className="size-4" />,
  lossPct: <Activity className="size-4" />,
  naturalPct: <Leaf className="size-4" />,
  debt: <CircleDollarSign className="size-4" />,
  consumersActive: <Users className="size-4" />,
  consumersDisconnected: <ZapOff className="size-4" />,
  tpCount: <Building2 className="size-4" />,
};

const STRIP_ICONS: Record<string, React.ReactNode> = {
  naturalPct: <Leaf className="size-3.5" />,
  consumersDisconnected: <ZapOff className="size-3.5" />,
  tpCount: <Building2 className="size-3.5" />,
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
  const alerts = useAlerts(period ?? undefined);

  if (!Number.isFinite(mfyId)) return <ErrorState message="MFY identifikatori noto‘g‘ri" />;
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
  const series = dynamics.data ?? [];
  const today = series.at(-1);
  const yesterday = series.at(-2);

  // Maket: 5 ta karta + oxirida bitta KENG quti (qolgan 3 ta ko'rsatkich).
  const tiles = overview.data.tiles;
  const mainTiles = tiles.slice(0, 5);
  const stripTiles = tiles.slice(5);

  const daysInMonth = 30;
  const avgPerConsumer =
    totals.consumersActive > 0 ? totals.kwhSold / totals.consumersActive / daysInMonth : 0;
  // Taxminiy tarif — hisob-kitob markazidan aniq tarif kelguncha.
  const avgBillSum = avgPerConsumer * daysInMonth * 450;
  const naturalKwh = lossStructure.data?.parts.find((p) => p.key === 'natural')?.kwh ?? 0;

  const mfyAlerts = (alerts.data ?? []).filter((a) => a.mfyId === null || a.mfyId === mfyId);
  const completed = (works.data ?? []).filter((w) => w.status === 'COMPLETED');
  const planned = (works.data ?? []).filter((w) => w.status !== 'COMPLETED');

  return (
    <div className={overview.isFetching ? 'opacity-70 transition-opacity' : ''}>
      <PageHeader
        actions={
          <>
            <PeriodPicker />
            <ReportMenu mfyId={mfyId} printScope="mfy" />
          </>
        }
        breadcrumbs={[
          { label: 'Baliqchi tumani', to: '/dashboard' },
          { label: mfy.elektrosetName },
          { label: mfy.nameUz },
        ]}
        title={mfy.nameUz}
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

      {/* ═══ 2-QATOR: dinamika · ogohlantirish · quvvat ══════════════════ */}
      <div className="mb-2.5 grid grid-cols-1 gap-2.5 xl:grid-cols-12">
        <Panel
          className="xl:col-span-5"
          subtitle="oxirgi 90 kun"
          title="Iste’mol va yo‘qotish dinamikasi"
        >
          {series.length > 0 ? (
            <div className="flex flex-col gap-2.5 lg:flex-row">
              <div className="min-w-0 flex-1">
                <TrendLine csvName={`${mfy.code}-dinamika`} height={196} points={series} />
              </div>
              <div className="grid shrink-0 grid-cols-2 gap-1.5 lg:w-34 lg:grid-cols-1">
                <SummaryBox
                  label="Bugun tarmoqqa kirgan"
                  tone="var(--viz-1)"
                  value={`${num(today?.kwhIn ?? 0, 0)} kWh`}
                />
                <SummaryBox
                  label="Bugun sotilgan"
                  tone="var(--viz-3)"
                  value={`${num(today?.kwhSold ?? 0, 0)} kWh`}
                />
                <SummaryBox
                  extra={`${(today?.lossPct ?? 0).toFixed(1)}%`}
                  label="Bugun yo‘qotish"
                  tone="var(--viz-5)"
                  value={`${num(today?.kwhLoss ?? 0, 0)} kWh`}
                />
                <SummaryBox
                  extra={`${(yesterday?.lossPct ?? 0).toFixed(1)}%`}
                  label="Kecha yo‘qotish"
                  tone="var(--viz-muted)"
                  value={`${num(yesterday?.kwhLoss ?? 0, 0)} kWh`}
                />
              </div>
            </div>
          ) : (
            <EmptyPanel message={t('common.noData')} />
          )}
        </Panel>

        <Panel
          className="xl:col-span-4"
          flush
          subtitle="qoidalarga asoslangan tahlil"
          title="Diqqat talab qiladigan holatlar"
        >
          <AlertsPanel items={mfyAlerts} />
        </Panel>

        <Panel className="xl:col-span-3" title="Tarmoq quvvati">
          {capacity.data ? (
            <div className="flex flex-col gap-2">
              <Gauge
                height={124}
                higherIsBetter={false}
                label="Joriy yuklama"
                suffix="%"
                value={capacity.data.loadPct}
              />

              <dl className="grid grid-cols-3 gap-1 text-center">
                <CapacityCell label="Texnik" value={kva(capacity.data.capacityKva)} />
                <CapacityCell label="Joriy" value={kva(capacity.data.currentKva)} />
                <CapacityCell
                  label="Zaxira"
                  tone="var(--viz-good)"
                  value={kva(capacity.data.reserveKva)}
                />
              </dl>

              {operational.data && (
                <div className="grid grid-cols-2 gap-x-2 gap-y-2.5 border-t border-separator pt-2.5">
                  <QuickMetric
                    icon={<Zap className="size-3.5" />}
                    label="Maks. yuklama"
                    value={kw(operational.data.maxLoadKw)}
                  />
                  <QuickMetric
                    icon={<Activity className="size-3.5" />}
                    label="Min. yuklama"
                    tone="good"
                    value={kw(operational.data.minLoadKw)}
                  />
                  <QuickMetric
                    icon={<GaugeIcon className="size-3.5" />}
                    label="O‘rt. kuchlanish"
                    tone={
                      operational.data.avgVoltageV !== null &&
                      Math.abs(operational.data.avgVoltageV - operational.data.nominalVoltageV) >
                        operational.data.nominalVoltageV * 0.1
                        ? 'warning'
                        : 'accent'
                    }
                    value={volts(operational.data.avgVoltageV)}
                  />
                  <QuickMetric
                    icon={<Power className="size-3.5" />}
                    label="O‘chirishlar"
                    tone={(operational.data.outageCount ?? 0) > 10 ? 'warning' : 'good'}
                    value={`${num(operational.data.outageCount ?? 0)} ta`}
                  />
                </div>
              )}
            </div>
          ) : (
            <EmptyPanel message={t('common.noData')} />
          )}
        </Panel>
      </div>

      {/* ═══ 3-QATOR: 4 ta past bo'yli ko'rsatkich ═══════════════════════ */}
      <div className="mb-2.5 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <MiniStat
          delta={`${num(consumers.data?.new ?? 0)} ta`}
          deltaGood
          hint={`Jami: ${num(totals.consumersTotal)} ta`}
          icon={<Building2 className="size-4.5" />}
          label="Yuridik iste’molchilar"
          unit="ta"
          value={num(consumers.data?.legal ?? 0)}
        />
        <MiniStat
          hint={`Faol abonent: ${num(totals.consumersActive)} ta`}
          icon={<Activity className="size-4.5" />}
          label="O‘rtacha iste’mol (1 abonent)"
          unit="kWh/kun"
          value={num(avgPerConsumer, 1)}
        />
        <MiniStat
          hint="taxminiy tarif bo‘yicha"
          icon={<CircleDollarSign className="size-4.5" />}
          label="O‘rtacha hisob (1 abonent)"
          unit="so‘m"
          value={num(avgBillSum, 0)}
        />
        <MiniStat
          hint={`Yo‘qotishdagi ulushi: ${pct(lossStructure.data?.parts[0]?.pct ?? 0, 1)}`}
          icon={<Leaf className="size-4.5" />}
          label="Tabiiy yo‘qotish"
          tone="good"
          unit={energy(naturalKwh).unit}
          value={num(energy(naturalKwh).value, 1)}
        />
      </div>

      {/* ═══ 4-QATOR: abonentlar · transformatorlar · yo'qotish ══════════ */}
      <div className="mb-2.5 grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-12">
        <Panel className="xl:col-span-3" title="Abonentlar holati">
          {consumers.data ? (
            <Donut
              centerLabel="jami abonent"
              centerValue={num(consumers.data.total)}
              csvName={`${mfy.code}-abonentlar`}
              height={166}
              slices={[
                { id: 'active', label: 'Faol', value: consumers.data.active },
                { id: 'disconnected', label: 'Uzilgan', value: consumers.data.disconnected },
                { id: 'new', label: 'Yangi ulangan', value: consumers.data.new },
              ]}
            />
          ) : (
            <EmptyPanel message={t('common.noData')} />
          )}
        </Panel>

        <Panel
          actions={
            <Chip size="sm" variant="soft">
              <Chip.Label>{num(tp.data?.length ?? 0)} ta</Chip.Label>
            </Chip>
          }
          className="md:col-span-2 xl:col-span-6"
          flush
          footerAction={{ label: 'Barcha transformatorlar', to: '/transformers' }}
          title="Transformatorlar holati"
        >
          <TpMonitorPanel rows={(tp.data ?? []).slice(0, 6)} showMfy={false} />
        </Panel>

        <Panel className="xl:col-span-3" title="Yo‘qotishlar tuzilmasi">
          {lossStructure.data ? (
            <Donut
              centerLabel="jami yo‘qotish"
              centerValue={energy(lossStructure.data.totalKwh).text}
              csvName={`${mfy.code}-yoqotish`}
              formatValue={(v) => energy(v).text}
              height={166}
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
      </div>

      {/* ═══ 5-QATOR: qarzdorlik · ishlar · natijadorlik ═════════════════ */}
      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-12">
        <Panel
          className="xl:col-span-3"
          footerAction={{ label: 'Qarzdorlar ro‘yxati', to: '/debt' }}
          title="Qarzdorlik tuzilmasi"
        >
          {debt.data ? (
            <Donut
              centerLabel="jami qarzdorlik"
              centerValue={money(debt.data.totalMln).text}
              csvName={`${mfy.code}-qarzdorlik`}
              formatValue={(v) => money(v).text}
              height={166}
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

        <Panel
          actions={
            <Chip size="sm" variant="soft">
              <Chip.Label>{completed.length} / {completed.length + planned.length}</Chip.Label>
            </Chip>
          }
          className="md:col-span-2 xl:col-span-6"
          flush
          footerAction={{ label: 'Barcha ishlar', to: '/works' }}
          title="Ishlar"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 md:divide-x md:divide-separator">
            <div>
              <p className="px-4 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted">
                Amalga oshirilgan
              </p>
              <WorkTimeline limit={3} rows={completed} />
            </div>
            <div className="border-t border-separator md:border-t-0">
              <p className="px-4 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted">
                Rejalashtirilgan
              </p>
              <WorkTimeline limit={3} planned rows={planned} />
            </div>
          </div>
        </Panel>

        <Panel className="xl:col-span-3" title="Natijadorlik">
          {results.data ? (
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center gap-2">
                <span
                  className="text-[19px] font-bold leading-none"
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {pct(results.data.lossPctStart ?? 0, 1)}
                </span>
                <TrendingDown aria-hidden="true" className="size-4 text-muted" />
                <span
                  className="text-[19px] font-bold leading-none"
                  style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--viz-good)' }}
                >
                  {pct(results.data.lossPctEnd ?? 0, 1)}
                </span>
              </div>
              <p className="text-[10.5px] leading-tight text-muted">
                {results.data.periodFrom} → {results.data.periodTo} · yo‘qotish darajasi
              </p>

              {results.data.improvementPp !== null && (
                <p
                  className="text-[11.5px] font-semibold"
                  style={{
                    color:
                      results.data.improvementPp > 0
                        ? 'var(--viz-delta-good)'
                        : 'var(--viz-delta-bad)',
                  }}
                >
                  Yaxshilanish: {Math.abs(results.data.improvementPp).toFixed(1)} p.p.
                </p>
              )}

              <div className="flex items-start gap-2 border-t border-separator pt-2.5">
                <Zap className="mt-0.5 size-4 shrink-0" style={{ color: 'var(--viz-good)' }} />
                <span className="min-w-0">
                  <span
                    className="block text-[15px] font-bold leading-tight"
                    style={{ fontVariantNumeric: 'tabular-nums' }}
                  >
                    {energy(results.data.savedKwh).text}
                  </span>
                  <span className="block text-[10px] leading-tight text-muted">
                    bajarilgan ishlar hisobiga tejalgan
                  </span>
                </span>
              </div>
            </div>
          ) : (
            <EmptyPanel message={t('common.noData')} />
          )}
        </Panel>
      </div>

      <p className="mt-2.5 flex items-center gap-1.5 text-[10.5px] text-muted">
        <Activity className="size-3.5" />
        Ma’lumotlar har 10 daqiqada avtomatik yangilanadi ·{' '}
        <button
          className="font-semibold text-accent hover:underline"
          type="button"
          onClick={() => void navigate(`/passport/mfy/${mfyId}/${period ?? 'latest'}`)}
        >
          Pasportni ochish
        </button>
      </p>
    </div>
  );
}

/** Chiziqli grafik yonidagi xulosa qutisi. */
function SummaryBox({
  label, value, extra, tone,
}: {
  label: string;
  value: string;
  extra?: string;
  tone: string;
}) {
  return (
    <div className="rounded-lg bg-surface-secondary px-2.5 py-1.5">
      <p className="truncate text-[10px] leading-tight text-muted">{label}</p>
      <p
        className="truncate text-[12.5px] font-bold leading-tight"
        style={{ fontVariantNumeric: 'tabular-nums', color: tone }}
      >
        {value}
        {extra && <span className="ml-1 text-[10px] font-medium">({extra})</span>}
      </p>
    </div>
  );
}

/** Quvvat panelidagi uchta ustunli qiymat. */
function CapacityCell({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <dt className="truncate text-[9.5px] leading-tight text-muted">{label}</dt>
      <dd
        className="truncate text-[12px] font-bold leading-tight"
        style={{ fontVariantNumeric: 'tabular-nums', color: tone }}
      >
        {value}
      </dd>
    </div>
  );
}
