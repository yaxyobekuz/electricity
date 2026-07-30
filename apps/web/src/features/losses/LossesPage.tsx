/**
 * Yo'qotishlar tahlili sahifasi.
 *
 * Uchta savolga javob beradi:
 *   1. Yo'qotish NIMADAN iborat?      → tuzilma donuti
 *   2. QAYERDA eng ko'p?              → treemap (plitka = energiya oqimi)
 *   3. Standartdan CHETLASHGANI kim?  → diverging bar + jadval
 *
 * Yo'qotish tarkibi (tabiiy / texnik / noqonuniy) kiritiladi, jami esa
 * DOIM hisoblanadi — bu ma'lumot butunligining asosiy qoidasi.
 */
import { energy, num, pct } from '@beap/shared';
import { Chip } from '@heroui/react';
import { Activity, Leaf, ShieldAlert, TrendingDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { DivergingBar } from '../../components/charts/DivergingBar.tsx';
import { Donut } from '../../components/charts/Donut.tsx';
import { LossTreemap } from '../../components/charts/LossTreemap.tsx';
import { LoadingState, PageHeader } from '../../components/layout/AppShell.tsx';
import { EmptyPanel, Panel } from '../../components/ui/Panel.tsx';
import { MiniStat } from '../../components/ui/StatTile.tsx';
import { ReportMenu } from '../../components/ui/ReportMenu.tsx';
import {
  useDistrictLossStructure, useDistrictOverview, useDistrictResults, useLossMap,
  useTechnicalLoss,
} from '../../lib/queries.ts';
import { useUi } from '../../lib/ui-store.ts';
import { PeriodPicker } from '../district/panels/PeriodPicker.tsx';

const STATUS_LABEL: Record<string, string> = {
  good: 'Standart doirasida', warning: 'Diqqat', serious: 'Jiddiy', critical: 'Tanqidiy',
};

export default function LossesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const period = useUi((s) => s.period);

  const overview = useDistrictOverview(period ?? undefined);
  const structure = useDistrictLossStructure(period ?? undefined);
  const lossMap = useLossMap(period ?? undefined);
  const technical = useTechnicalLoss(period ?? undefined);
  const results = useDistrictResults(period ?? undefined);

  const goMfy = (id: number): void => {
    void navigate(`/dashboard/mfy/${id}`);
  };

  if (overview.isLoading) {
    return (
      <>
        <PageHeader title={t('nav.losses')} />
        <LoadingState rows={5} />
      </>
    );
  }

  const totals = overview.data?.totals;
  const parts = structure.data?.parts ?? [];
  const part = (k: string) => parts.find((p) => p.key === k);
  const overNorm = (technical.data ?? []).filter((r) => r.gapPp > 0);
  const ranked = [...(technical.data ?? [])].sort((a, b) => b.gapPp - a.gapPp);

  return (
    <div className={overview.isFetching ? 'opacity-70 transition-opacity' : ''}>
      <PageHeader
        actions={
          <>
            <PeriodPicker />
            <ReportMenu />
          </>
        }
        subtitle="tabiiy · texnik · noqonuniy foydalanish"
        title={t('nav.losses')}
      />

      {/* ── 4 ta xulosa ──────────────────────────────────────────────── */}
      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MiniStat
          hint={`Tarmoqqa kirgan: ${energy(totals?.kwhIn ?? 0).text}`}
          icon={<TrendingDown className="size-4.5" />}
          label="Jami yo‘qotish"
          tone="critical"
          unit={pct(totals?.lossPct ?? 0, 2)}
          value={energy(totals?.kwhLossTotal ?? 0).text}
        />
        <MiniStat
          hint={`Ulushi: ${pct(part('natural')?.pct ?? 0, 1)}`}
          icon={<Leaf className="size-4.5" />}
          label="Tabiiy yo‘qotish"
          tone="good"
          value={energy(part('natural')?.kwh ?? 0).text}
        />
        <MiniStat
          hint={`Ulushi: ${pct(part('technical')?.pct ?? 0, 1)}`}
          icon={<Activity className="size-4.5" />}
          label="Texnik yo‘qotish"
          tone="warning"
          value={energy(part('technical')?.kwh ?? 0).text}
        />
        <MiniStat
          hint={`Ulushi: ${pct(part('illegal')?.pct ?? 0, 1)}`}
          icon={<ShieldAlert className="size-4.5" />}
          label="Noqonuniy foydalanish"
          tone="critical"
          value={energy(part('illegal')?.kwh ?? 0).text}
        />
      </div>

      {/* ── Tuzilma · xarita · natijadorlik ──────────────────────────── */}
      <div className="mb-3 grid grid-cols-1 gap-3 xl:grid-cols-12">
        <Panel className="xl:col-span-3" title="Yo‘qotish tuzilmasi">
          {structure.data ? (
            <Donut
              centerLabel="jami yo‘qotish"
              centerUnit={energy(structure.data.totalKwh).unit}
              centerValue={num(energy(structure.data.totalKwh).value, 1)}
              csvName="yoqotish-tuzilmasi"
              formatValue={(v) => energy(v).text}
              height={214}
              slices={parts.map((p) => ({
                id: p.key, label: p.labelUz, value: p.kwh, display: energy(p.kwh).text,
              }))}
            />
          ) : (
            <EmptyPanel message={t('common.noData')} />
          )}
        </Panel>

        <Panel
          className="xl:col-span-6"
          subtitle="plitka o‘lchami — energiya oqimi, rangi — normadan farq"
          title="Yo‘qotish taqsimoti"
        >
          {lossMap.data && lossMap.data.length > 0 ? (
            <LossTreemap cells={lossMap.data} height={266} onSelect={goMfy} />
          ) : (
            <EmptyPanel message={t('common.noData')} />
          )}
        </Panel>

        <Panel className="xl:col-span-3" title="Natijadorlik">
          {results.data ? (
            <div className="flex flex-col gap-3">
              <div>
                <p className="text-[10.5px] leading-tight text-muted">
                  Yo‘qotish darajasi ({results.data.periodFrom} → {results.data.periodTo})
                </p>
                <p className="mt-1.5 flex items-center gap-2">
                  <span
                    className="text-[21px] font-bold leading-none"
                    style={{ fontVariantNumeric: 'tabular-nums' }}
                  >
                    {pct(results.data.lossPctStart ?? 0, 1)}
                  </span>
                  <TrendingDown aria-hidden="true" className="size-4 text-muted" />
                  <span
                    className="text-[21px] font-bold leading-none"
                    style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--viz-good)' }}
                  >
                    {pct(results.data.lossPctEnd ?? 0, 1)}
                  </span>
                </p>
              </div>

              {results.data.improvementPp !== null && (
                <p
                  className="text-[12px] font-semibold"
                  style={{
                    color:
                      results.data.improvementPp > 0
                        ? 'var(--viz-delta-good)'
                        : 'var(--viz-delta-bad)',
                  }}
                >
                  {results.data.improvementPp > 0 ? 'Yaxshilanish' : 'Yomonlashuv'}:{' '}
                  {Math.abs(results.data.improvementPp).toFixed(2)} p.p.
                </p>
              )}

              <div className="border-t border-separator pt-2.5">
                <p className="text-[10.5px] leading-tight text-muted">
                  Bajarilgan ishlar hisobiga tejalgan
                </p>
                <p
                  className="mt-1 text-[17px] font-bold leading-tight"
                  style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--viz-good)' }}
                >
                  {energy(results.data.savedKwh).text}
                </p>
              </div>

              <div className="border-t border-separator pt-2.5">
                <p className="text-[10.5px] leading-tight text-muted">
                  Standartdan chetlashgan mahallalar
                </p>
                <p
                  className="mt-1 text-[17px] font-bold leading-tight"
                  style={{
                    fontVariantNumeric: 'tabular-nums',
                    color: overNorm.length > 0 ? 'var(--viz-critical)' : 'var(--viz-good)',
                  }}
                >
                  {num(overNorm.length)}{' '}
                  <span className="text-[11px] font-medium text-muted">
                    / {num(technical.data?.length ?? 0)} ta
                  </span>
                </p>
              </div>
            </div>
          ) : (
            <EmptyPanel message={t('common.noData')} />
          )}
        </Panel>
      </div>

      {/* ── Standart bilan solishtirish ──────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-12">
        <Panel
          className="xl:col-span-5"
          subtitle="amaldagi va standart texnik yo‘qotish farqi"
          title="Standartdan chetlashish"
        >
          {technical.data && technical.data.length > 0 ? (
            <DivergingBar height={430} onSelect={goMfy} rows={technical.data} />
          ) : (
            <EmptyPanel message={t('common.noData')} />
          )}
        </Panel>

        <Panel
          actions={
            <Chip size="sm" variant="soft">
              <Chip.Label>{num(ranked.length)} ta mahalla</Chip.Label>
            </Chip>
          }
          className="xl:col-span-7"
          flush
          footerAction={{ label: 'Barcha mahallalar', to: '/mahallalar' }}
          title="Mahallalar bo‘yicha"
        >
          <div className="scroll-y max-h-115 overflow-x-auto">
            <table className="dt min-w-125">
              <thead>
                <tr>
                  <th className="w-9 text-center">№</th>
                  <th>Mahalla</th>
                  <th className="w-22 text-right">Standart</th>
                  <th className="w-22 text-right">Amaldagi</th>
                  <th className="w-24 text-right">Farq</th>
                  <th className="w-38">Holat</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((r, i) => (
                  <tr
                    key={r.mfyId}
                    className="cursor-pointer"
                    onClick={() => goMfy(r.mfyId)}
                  >
                    <td className="num text-center text-muted">{i + 1}</td>
                    <td className="truncate font-medium">{r.nameUz}</td>
                    <td className="num whitespace-nowrap text-muted">{pct(r.standardPct, 1)}</td>
                    <td className="num whitespace-nowrap font-semibold">{pct(r.actualPct, 2)}</td>
                    <td
                      className="num whitespace-nowrap font-medium"
                      style={{ color: r.gapPp > 0 ? 'var(--viz-critical)' : 'var(--viz-good)' }}
                    >
                      {r.gapPp > 0 ? '+' : ''}
                      {r.gapPp.toFixed(2)} p.p.
                    </td>
                    <td>
                      <Chip
                        className="whitespace-nowrap"
                        color={
                          r.status === 'good' ? 'success'
                            : r.status === 'warning' ? 'warning' : 'danger'
                        }
                        size="sm"
                        variant="soft"
                      >
                        <span aria-hidden="true" className={`dot dot--${r.status}`} />
                        <Chip.Label>{STATUS_LABEL[r.status]}</Chip.Label>
                      </Chip>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </div>
  );
}
