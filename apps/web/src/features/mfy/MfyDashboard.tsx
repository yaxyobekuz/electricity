/**
 * MFY boshqaruv paneli.
 *
 * JOYLASHUV — mijoz bergan maketning aynan o'zi:
 *
 *   yuqori chiziq │ sarlavha + yo'l ····· davr tanlagich · hisobot · global
 *   1-qator       │ 8 ta KPI kartasi (bir xil o'lchamda, rangli fon bilan)
 *   2-qator       │ Dinamika (4) │ Quvvat (3) │ Abonentlar (3) │ 4 ko'rsatkich (2)
 *   3-qator       │ Transformatorlar (4) │ Yo'qotish (3) │ Qarzdorlik (3) │ Tezkor (2)
 *   4-qator       │ Bajarilgan (3) │ Reja (3) │ Natijadorlik (3) │ Hisobotlar (3)
 *
 * ZICHLIK QOIDASI: har bir panel o'z mazmuniga yetadigan balandlikda —
 * bo'sh joyni to'ldirish uchun cho'zilmaydi. Shu sababli panellar soni ko'p,
 * balandligi past.
 */
import { energy, kva, kw, money, monthShort, num, pct, pieces, volts } from '@beap/shared';
import { Chip, ListBox, Select } from '@heroui/react';
import {
  Activity, ArrowRight, Building2, CircleDollarSign, Gauge as GaugeIcon, Leaf, PowerOff,
  TrendingDown, Users, Zap, ZapOff,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';

import { Donut } from '../../components/charts/Donut.tsx';
import { Gauge } from '../../components/charts/Gauge.tsx';
import { TrendLine, type TrendBucket } from '../../components/charts/TrendLine.tsx';
import { ErrorState, FooterNote, LoadingState, PageHeader } from '../../components/layout/AppShell.tsx';
import { CountUp } from '../../components/ui/CountUp.tsx';
import { MotionStage } from '../../components/ui/MotionStage.tsx';
import { EmptyPanel, Panel } from '../../components/ui/Panel.tsx';
import { ReportMenu } from '../../components/ui/ReportMenu.tsx';
import { ReportShortcuts } from '../../components/ui/ReportShortcuts.tsx';
import {
  MiniStat, QuickMetric, StatTile, type Tone,
} from '../../components/ui/StatTile.tsx';
import { PeriodPicker } from '../district/panels/PeriodPicker.tsx';
import { TpMonitorPanel } from '../district/panels/TpMonitorPanel.tsx';
import {
  useMfyCapacity, useMfyConsumers, useMfyDebt, useMfyDynamics,
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
  const [bucket, setBucket] = useState<TrendBucket>('day');

  const overview = useMfyOverview(mfyId, period ?? undefined);
  const dynamics = useMfyDynamics(mfyId, { bucket, last: 7 });
  const capacity = useMfyCapacity(mfyId, period ?? undefined);
  const consumers = useMfyConsumers(mfyId, period ?? undefined);
  const tp = useMfyTp(mfyId, period ?? undefined);
  const lossStructure = useMfyLossStructure(mfyId, period ?? undefined);
  const debt = useMfyDebt(mfyId, period ?? undefined);
  const works = useMfyWorks(mfyId);
  const results = useMfyResults(mfyId, period ?? undefined);
  const operational = useMfyOperational(mfyId, period ?? undefined);

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

  // Yon xulosa qutilarining sarlavhasi tanlangan davrga ergashadi —
  // oylik ko'rinishda "Bugun" deb yozish noto'g'ri bo'lardi.
  const periodWord = bucket === 'day' ? 'Bugun' : bucket === 'week' ? 'Shu hafta' : 'Shu oy';
  const prevWord = bucket === 'day' ? 'Kecha' : bucket === 'week' ? 'O‘tgan hafta' : 'O‘tgan oy';

  const daysInMonth = 30;
  // Taxminiy tarif — "tejalgan energiya" ni so'mga o'girish uchun.
  const TARIFF_SUM_PER_KWH = 1000;
  const avgPerConsumer =
    totals.consumersActive > 0 ? totals.kwhSold / totals.consumersActive / daysInMonth : 0;
  // Taxminiy tarif — hisob-kitob markazidan aniq tarif kelguncha.
  const avgBillSum = avgPerConsumer * daysInMonth * 450;
  const naturalKwh = lossStructure.data?.parts.find((p) => p.key === 'natural')?.kwh ?? 0;

  const completed = (works.data ?? []).filter((w) => w.status === 'COMPLETED');
  /*
   * Reja ro'yxati YAQIN sanadan boshlanadi.
   *
   * Server javobi eng yangi sanadan beradi — bajarilgan ishlar uchun to'g'ri
   * ("oxirgi nima qilindi"), reja uchun teskari: birinchi navbatda eng uzoq
   * muddat ko'rinib qolardi.
   */
  const planned = (works.data ?? [])
    .filter((w) => w.status !== 'COMPLETED')
    .sort((a, b) => (a.plannedEnd ?? '9999').localeCompare(b.plannedEnd ?? '9999'));

  /*
   * Kuchlanish rangi NOMINALDAN chetlanishga qarab beriladi: 220 V ning
   * o'zi "yaxshi" ham, "yomon" ham emas — me'yor MFY bo'yicha boshqacha
   * bo'lishi mumkin, shuning uchun normativ qiymat serverdan keladi.
   */
  const voltageDeviation =
    operational.data && operational.data.avgVoltageV !== null && operational.data.nominalVoltageV > 0
      ? Math.abs(operational.data.avgVoltageV - operational.data.nominalVoltageV) /
        operational.data.nominalVoltageV
      : null;
  const voltageTone =
    voltageDeviation === null ? 'accent'
      : voltageDeviation > 0.1 ? 'critical'
        : voltageDeviation > 0.05 ? 'warning'
          : 'good';

  return (
    <MotionStage className={overview.isFetching ? 'opacity-70 transition-opacity' : ''}>
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

      {/* ═══ 1-QATOR: 8 ta KPI kartasi ═══════════════════════════════════ */}
      <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        {overview.data.tiles.map((tile) => (
          <StatTile
            key={tile.key}
            icon={TILE_ICONS[tile.key]}
            tile={tile}
            tone={TILE_TONES[tile.key] ?? 'blue'}
          />
        ))}
      </div>

      {/* ═══ 2-QATOR: dinamika · quvvat · abonentlar · ko'rsatkichlar ═══ */}
      <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-12">
        <Panel
          actions={<BucketPicker onChange={setBucket} value={bucket} />}
          className="md:col-span-2 xl:col-span-4"
          title="Iste’mol va yo‘qotish dinamikasi"
        >
          {series.length > 0 ? (
            <div className="flex flex-col gap-3 lg:flex-row">
              <div className="min-w-0 flex-1">
                <TrendLine
                  bucket={bucket}
                  csvName={`${mfy.code}-dinamika`}
                  height={214}
                  points={series}
                />
              </div>

              {/* Maketdagi yon xulosa ustuni */}
              <div className="grid shrink-0 grid-cols-2 gap-2 lg:w-36 lg:grid-cols-1">
                <SummaryBox
                  label={`${periodWord} tarmoqqa kirgan`}
                  tone="var(--viz-1)"
                  value={num(today?.kwhIn ?? 0, 0)}
                />
                <SummaryBox
                  label={`${periodWord} sotilgan`}
                  tone="var(--viz-3)"
                  value={num(today?.kwhSold ?? 0, 0)}
                />
                <SummaryBox
                  extra={`${(today?.lossPct ?? 0).toFixed(1)}%`}
                  label={`${periodWord} yo‘qotish`}
                  tone="var(--viz-5)"
                  value={num(today?.kwhLoss ?? 0, 0)}
                />
                <SummaryBox
                  extra={`${(yesterday?.lossPct ?? 0).toFixed(1)}%`}
                  label={`${prevWord} yo‘qotish`}
                  muted
                  value={num(yesterday?.kwhLoss ?? 0, 0)}
                />
              </div>
            </div>
          ) : (
            <EmptyPanel message={t('common.noData')} />
          )}
        </Panel>

        <Panel className="xl:col-span-3" title="Tarmoq quvvati">
          {capacity.data ? (
            <div className="flex h-full flex-col gap-3">
              <Gauge
                height={158}
                higherIsBetter={false}
                label="Joriy yuklama"
                suffix="%"
                value={capacity.data.loadPct}
              />

              <dl className="grid grid-cols-2 gap-2 text-center">
                <CapacityCell label="Texnik quvvat" value={capacity.data.capacityKva} />
                <CapacityCell label="Joriy sarf" value={capacity.data.currentKva} />
              </dl>

              {/* Zaxira quvvat — alohida, pastda: bu xulosa qiymat */}
              <div
                className="mt-auto flex items-baseline justify-center gap-2 rounded-lg px-3 py-3"
                style={{
                  background: 'color-mix(in oklab, var(--viz-good) 10%, transparent)',
                  color: 'var(--viz-good)',
                }}
              >
                <span className="text-[11px] font-medium">Zaxira</span>
                <CountUp
                  className="tabular text-[19px] font-bold leading-none"
                  format={(v) => kva(v)}
                  value={capacity.data.reserveKva}
                />
                {capacity.data.capacityKva > 0 && (
                  <span className="text-[11px] font-semibold">
                    ({((capacity.data.reserveKva / capacity.data.capacityKva) * 100).toFixed(0)}%)
                  </span>
                )}
              </div>
            </div>
          ) : (
            <EmptyPanel message={t('common.noData')} />
          )}
        </Panel>

        <Panel className="xl:col-span-3" title="Abonentlar holati">
          {consumers.data ? (
            <Donut
              centerLabel="Jami abonent"
              centerValue={num(consumers.data.total)}
              csvName={`${mfy.code}-abonentlar`}
              height={214}
              legendSide
              slices={[
                {
                  id: 'active', label: 'Faol abonentlar',
                  value: consumers.data.active, color: 'var(--viz-3)',
                  display: `${num(consumers.data.active)} ta`,
                },
                {
                  id: 'disconnected', label: 'Uzilgan abonentlar',
                  value: consumers.data.disconnected, color: 'var(--viz-5)',
                  display: `${num(consumers.data.disconnected)} ta`,
                },
                {
                  id: 'new', label: 'Yangi ulangan (bugun)',
                  value: consumers.data.new, color: 'var(--viz-2)',
                  display: `${num(consumers.data.new)} ta`, noShare: true,
                },
                {
                  id: 'disconnectedNew', label: 'Uzilgan (bugun)',
                  value: consumers.data.disconnectedNew, color: 'var(--viz-1)',
                  display: `${num(consumers.data.disconnectedNew)} ta`, noShare: true,
                },
              ]}
            />
          ) : (
            <EmptyPanel message={t('common.noData')} />
          )}
        </Panel>

        {/*
          4 ta ko'rsatkich — BITTA USTUNDA, to'rt qator.
          `flex-1` bilan har biri teng balandlikda va ustun qatordagi
          boshqa panellar bilan bir xil bo'yga yetadi.
        */}
        <div className="flex flex-col gap-3 md:col-span-2 xl:col-span-2">
          <MiniStat
            className="flex-1"
            compact
            delta={`${num(consumers.data?.new ?? 0)} ta`}
            deltaGood
            hint={`Jami: ${num(totals.consumersTotal)} ta`}
            icon={<Building2 className="size-4" />}
            label="Yuridik iste’molchilar"
            unit="ta"
            value={num(consumers.data?.legal ?? 0)}
          />
          <MiniStat
            className="flex-1"
            compact
            hint={`Faol: ${num(totals.consumersActive)} ta`}
            icon={<Activity className="size-4" />}
            label="O‘rtacha iste’mol"
            unit="kWh/kun"
            value={num(avgPerConsumer, 1)}
          />
          <MiniStat
            className="flex-1"
            compact
            hint="taxminiy tarif bo‘yicha"
            icon={<CircleDollarSign className="size-4" />}
            label="O‘rtacha hisob"
            unit="so‘m"
            value={num(avgBillSum, 0)}
          />
          <MiniStat
            className="flex-1"
            compact
            hint={`Ulushi: ${pct(lossStructure.data?.parts[0]?.pct ?? 0, 1)}`}
            icon={<Leaf className="size-4" />}
            label="Tabiiy yo‘qotish"
            tone="good"
            unit={energy(naturalKwh).unit}
            value={num(energy(naturalKwh).value, 1)}
          />
        </div>
      </div>

      {/* ═══ 3-QATOR: transformatorlar · yo'qotish · qarzdorlik ══════════ */}
      <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-12">
        <Panel
          actions={
            <Link
              className="text-[11.5px] font-semibold text-accent hover:underline"
              to="/transformers"
            >
              Barchasi ({num(tp.data?.length ?? 0)})
            </Link>
          }
          className="md:col-span-2 xl:col-span-4"
          flush
          footerAction={{ label: 'Barcha transformatorlar', to: '/transformers' }}
          title="Transformatorlar holati"
        >
          {/* 5 qator — qatordagi qo'shni kartalar bilan bir xil balandlik. */}
          <TpMonitorPanel rows={(tp.data ?? []).slice(0, 5)} />
        </Panel>

        <Panel
          className="xl:col-span-3"
          footerAction={{ label: 'Batafsil tahlil', to: '/losses' }}
          title="Yo‘qotishlar tuzilmasi"
        >
          {lossStructure.data ? (
            <Donut
              centerLabel="jami"
              centerUnit={energy(lossStructure.data.totalKwh).unit}
              centerValue={num(energy(lossStructure.data.totalKwh).value, 1)}
              csvName={`${mfy.code}-yoqotish`}
              formatValue={(v) => energy(v).text}
              height={172}
              legendSide
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

        <Panel
          className="xl:col-span-3"
          footerAction={{ label: 'Qarzdorlar ro‘yxati', to: '/debt' }}
          title="Qarzdorlik tuzilmasi"
        >
          {debt.data ? (
            <Donut
              centerLabel="jami"
              centerUnit={money(debt.data.totalMln).unit}
              centerValue={num(money(debt.data.totalMln).value, 1)}
              csvName={`${mfy.code}-qarzdorlik`}
              formatValue={(v) => money(v).text}
              height={172}
              legendSide
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
          className="xl:col-span-2"
          footerAction={{
            label: 'Batafsil texnik ma’lumot',
            to: `/passport/mfy/${mfyId}/${period ?? 'latest'}`,
          }}
          title="Tezkor ko‘rsatkichlar"
        >
          {operational.data ? (
            /* Bitta ustun — karta tor (2/12), yorliqlar to'liq ko'rinadi. */
            <div className="flex flex-col gap-3.5">
              <QuickMetric
                icon={<Zap className="size-3.5" />}
                label="Maksimal yuklama"
                tone="warning"
                value={kw(operational.data.maxLoadKw)}
              />
              <QuickMetric
                icon={<TrendingDown className="size-3.5" />}
                label="Minimal yuklama"
                value={kw(operational.data.minLoadKw)}
              />
              <QuickMetric
                icon={<GaugeIcon className="size-3.5" />}
                label="O‘rtacha kuchlanish"
                tone={voltageTone}
                value={volts(operational.data.avgVoltageV)}
              />
              <QuickMetric
                icon={<PowerOff className="size-3.5" />}
                label="O‘chirishlar soni"
                tone={(operational.data.outageCount ?? 0) > 0 ? 'critical' : 'good'}
                value={pieces(operational.data.outageCount)}
              />
            </div>
          ) : (
            <EmptyPanel message={t('common.noData')} />
          )}
        </Panel>
      </div>

      {/* ═══ 4-QATOR: ishlar · natijadorlik · hisobotlar ═════════════════ */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-12">
        {/*
          Bajarilgan va rejadagi ishlar ALOHIDA kartalarda: ilgari ular bitta
          panelning ikki ustuni edi va qaysi ro'yxat qayerda tugashi
          ko'rinmasdi.
        */}
        <Panel
          actions={
            <Link className="text-[11.5px] font-semibold text-accent hover:underline" to="/works">
              Barchasi ({completed.length})
            </Link>
          }
          className="xl:col-span-3"
          flush
          title="Amalga oshirilgan ishlar"
        >
          <WorkTimeline limit={4} rows={completed} />
        </Panel>

        <Panel
          actions={
            <Link className="text-[11.5px] font-semibold text-accent hover:underline" to="/works">
              Barchasi ({planned.length})
            </Link>
          }
          className="xl:col-span-3"
          flush
          title="Rejalashtirilgan ishlar"
        >
          <WorkTimeline limit={4} planned rows={planned} />
        </Panel>

        <Panel className="xl:col-span-3" title="Natijadorlik ko‘rsatkichlari">
          {results.data ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:divide-x sm:divide-separator">
              {/* Chap ustun — yo'qotish darajasining davr boshi va oxiri */}
              <div className="min-w-0 sm:pr-4">
                <p className="text-[11px] font-medium leading-tight text-muted">
                  Yo‘qotish darajasi
                </p>

                {/*
                  Davr belgisi qiymatdan AJRATIB, o'ng chekkaga qo'yiladi:
                  ikki qatorda ham bir vertikalda turadi va katta raqamlarni
                  o'qishga xalaqit bermaydi.
                */}
                <p className="mt-2.5 flex items-baseline justify-between gap-2">
                  <span className="tabular text-[17px] font-bold leading-none">
                    {pct(results.data.lossPctStart ?? 0, 1)}
                  </span>
                  <span className="text-[11px] font-medium text-accent">
                    ({monthShort(results.data.periodFrom)})
                  </span>
                </p>

                <p className="mt-2 flex items-baseline justify-between gap-2">
                  <span className="flex items-baseline gap-1.5">
                    <ArrowRight
                      aria-hidden="true"
                      className="size-3.5 shrink-0 self-center"
                      style={{ color: 'var(--viz-good)' }}
                    />
                    <span
                      className="tabular text-[19px] font-bold leading-none"
                      style={{ color: 'var(--viz-good)' }}
                    >
                      {pct(results.data.lossPctEnd ?? 0, 1)}
                    </span>
                  </span>
                  <span className="text-[11px] font-medium text-accent">
                    ({monthShort(results.data.periodTo)})
                  </span>
                </p>

                {results.data.improvementPp !== null && (
                  /*
                    "p.p." — FOIZ PUNKTI. 11.2% dan 5.0% ga tushish "6.2%"
                    emas: foizda o'lchansa bu 55% bo'lardi. Maketda "%" yozilgan,
                    lekin raqamning ma'nosi p.p.
                  */
                  <p
                    className="mt-3 rounded-lg px-2.5 py-1.5 text-center text-[11.5px] font-semibold"
                    style={{
                      background: `color-mix(in oklab, var(--viz-${
                        results.data.improvementPp > 0 ? 'good' : 'critical'
                      }) 10%, transparent)`,
                      color: `var(--viz-${results.data.improvementPp > 0 ? 'good' : 'critical'})`,
                    }}
                  >
                    Yaxshilanish: {Math.abs(results.data.improvementPp).toFixed(1)} p.p.
                  </p>
                )}
              </div>

              {/* O'ng ustun — o'sha ishlarning natijasi: tejalgan energiya */}
              <div className="min-w-0 sm:pl-4">
                <p className="text-[11px] font-medium leading-tight text-muted">
                  Iqtisod qilingan energiya
                </p>

                <div className="mt-3.5 flex items-center gap-2.5">
                  <Zap
                    aria-hidden="true"
                    className="size-6 shrink-0"
                    style={{ color: 'var(--viz-good)', fill: 'currentColor' }}
                  />
                  {/*
                    To'liq raqam — `energy()` uni "128.6 ming kWh" ga
                    yaxlitlardi, bu yerda esa aniq qiymat muhim.
                  */}
                  <span className="tabular min-w-0 truncate text-[15px] font-bold leading-tight">
                    {num(results.data.savedKwh)}
                    <span className="ml-1 text-[10.5px] font-medium text-muted">kWh</span>
                  </span>
                </div>

                {/*
                  Pul ekvivalenti — TAXMINIY: 1 kWh = 1000 so'm.
                  Aniq tarif toifaga qarab farq qiladi, shuning uchun raqam
                  "≈" bilan beriladi va tarif ochiq yoziladi: hokim "bu qayerdan
                  chiqdi?" deb so'raganda javob kartaning o'zida turadi.
                */}
                <p className="mt-1.5 pl-8.5 text-[12.5px] font-semibold leading-tight">
                  ≈ {money((results.data.savedKwh * TARIFF_SUM_PER_KWH) / 1e6).text}
                </p>

                <p
                  className="mt-1.5 pl-8.5 text-[10.5px] leading-tight"
                  style={{ color: 'var(--viz-good)' }}
                >
                  (so‘nggi 12 oy · {num(TARIFF_SUM_PER_KWH)} so‘m/kWh)
                </p>
              </div>
            </div>
          ) : (
            <EmptyPanel message={t('common.noData')} />
          )}
        </Panel>

        <Panel className="xl:col-span-3" title="Hisobotlar">
          <ReportShortcuts />
        </Panel>
      </div>

      {/* Izoh sahifa oxirida emas, PASTKI CHIZIQDA — bitta qatorda. */}
      <FooterNote>
        <Activity className="size-3.5 shrink-0" />
        Ma’lumotlar har 10 daqiqada avtomatik yangilanadi ·{' '}
        <button
          className="font-semibold text-accent hover:underline"
          type="button"
          onClick={() => void navigate(`/passport/mfy/${mfyId}/${period ?? 'latest'}`)}
        >
          Pasportni ochish
        </button>
      </FooterNote>
    </MotionStage>
  );
}

/**
 * Chiziqli grafik yonidagi xulosa qutisi — maketdagi ko'rinish.
 *
 * Joriy davr qiymatlari fonsiz va o'z rangida; solishtirish qatori
 * (o'tgan davr) kulrang fon ustida, ya'ni u boshqa toifadagi ma'lumot
 * ekani bir qarashda ko'rinadi.
 */
function SummaryBox({
  label, value, extra, tone, muted,
}: {
  label: string;
  value: string;
  extra?: string;
  tone?: string;
  muted?: boolean;
}) {
  return (
    <div className={muted ? 'rounded-lg bg-surface-secondary px-3 py-2' : 'px-1 py-1'}>
      <p className="truncate text-[10.5px] leading-tight text-muted">{label}</p>
      <p className="mt-1 flex items-baseline gap-1">
        <span
          className="truncate text-[15px] font-bold leading-none"
          style={{ fontVariantNumeric: 'tabular-nums', color: muted ? undefined : tone }}
        >
          {value}
        </span>
        <span className="shrink-0 text-[10px] font-medium text-muted">kWh</span>
        {extra && (
          <span
            className="shrink-0 text-[10.5px] font-semibold"
            style={{ color: muted ? 'var(--viz-muted)' : tone }}
          >
            ({extra})
          </span>
        )}
      </p>
    </div>
  );
}

/** Diagramma davri — Kunlik / Haftalik / Oylik. */
export function BucketPicker({
  value, onChange,
}: {
  value: TrendBucket;
  onChange: (v: TrendBucket) => void;
}) {
  return (
    <Select
      aria-label="Diagramma davri"
      className="w-28"
      selectedKey={value}
      onSelectionChange={(k) => onChange(k as TrendBucket)}
    >
      <Select.Trigger className="h-8">
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          <ListBox.Item id="day" textValue="Kunlik">
            Kunlik
            <ListBox.ItemIndicator />
          </ListBox.Item>
          <ListBox.Item id="week" textValue="Haftalik">
            Haftalik
            <ListBox.ItemIndicator />
          </ListBox.Item>
          <ListBox.Item id="month" textValue="Oylik">
            Oylik
            <ListBox.ItemIndicator />
          </ListBox.Item>
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

/** Quvvat panelidagi uchta ustunli qiymat. */
function CapacityCell({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[11px] leading-tight text-muted">{label}</dt>
      <dd className="truncate leading-tight" style={{ color: tone }}>
        <CountUp
          className="tabular text-[19px] font-bold"
          format={(v) => kva(v)}
          value={value}
        />
      </dd>
    </div>
  );
}
