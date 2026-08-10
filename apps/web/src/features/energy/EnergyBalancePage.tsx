/**
 * Energiya balansi sahifasi.
 *
 * Savol: "fiderga kirgan energiya QAYERGA ketdi?" - sankey oqimi va davr
 * bo'yicha dinamika bitta ekranda.
 *
 * Barcha "jami" qiymatlar HISOBLANADI: sahifada kiritiladigan maydon yo'q.
 */
import { energy, pct } from '@beap/shared';
import { ToggleButton, ToggleButtonGroup } from '@heroui/react';
import { ArrowRight, ShoppingCart, TrendingDown, Zap } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { EnergyFlow } from '../../components/charts/EnergyFlow.tsx';
import { TrendLine } from '../../components/charts/TrendLine.tsx';
import { LoadingState, PageHeader } from '../../components/layout/AppShell.tsx';
import { EmptyPanel, Panel } from '../../components/ui/Panel.tsx';
import { MiniStat } from '../../components/ui/StatTile.tsx';
import { ReportMenu } from '../../components/ui/ReportMenu.tsx';
import {
  useDistrictOverview, useDistrictSeries, useEnergyBalance,
} from '../../lib/queries.ts';
import { useUi } from '../../lib/ui-store.ts';
import { PeriodPicker } from '../district/panels/PeriodPicker.tsx';

const BUCKETS = [
  { id: 'day', label: 'Kunlik' },
  { id: 'week', label: 'Haftalik' },
  { id: 'month', label: 'Oylik' },
] as const;

export default function EnergyBalancePage() {
  const { t } = useTranslation();
  const period = useUi((s) => s.period);
  const [bucket, setBucket] = useState<'day' | 'week' | 'month'>('day');

  const overview = useDistrictOverview(period ?? undefined);
  const balance = useEnergyBalance(period ?? undefined);
  const series = useDistrictSeries({ bucket });

  if (overview.isLoading) {
    return (
      <>
        <PageHeader title={t('nav.energyBalance')} />
        <LoadingState rows={5} />
      </>
    );
  }

  const totals = overview.data?.totals;
  const nodes = balance.data ?? [];
  const inNode = nodes.find((n) => n.key === 'in');
  const soldNode = nodes.find((n) => n.key === 'sold');


  return (
    <div className={overview.isFetching ? 'opacity-70 transition-opacity' : ''}>
      <PageHeader
        actions={
          <>
            <PeriodPicker />
            <ReportMenu />
          </>
        }
        subtitle="tarmoqqa kirgan energiya taqsimoti"
        title={t('nav.energyBalance')}
      />

      {/* ── 4 ta xulosa ──────────────────────────────────────────────── */}
      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MiniStat
          hint="fider hisoblagichi bo‘yicha"
          icon={<Zap className="size-4.5" />}
          label="Tarmoqqa kirgan"
          value={energy(totals?.kwhIn ?? 0).text}
        />
        <MiniStat
          hint={inNode && soldNode ? `Ulushi: ${pct(soldNode.pct, 1)}` : ''}
          icon={<ShoppingCart className="size-4.5" />}
          label="Foydali oqim"
          tone="good"
          value={energy(totals?.kwhSold ?? 0).text}
        />
        <MiniStat
          hint={`Yo‘qotish darajasi: ${pct(totals?.lossPct ?? 0, 2)}`}
          icon={<TrendingDown className="size-4.5" />}
          label="Jami yo‘qotish"
          tone="critical"
          value={energy(totals?.kwhLossTotal ?? 0).text}
        />
        <MiniStat
          hint="tarmoqqa kirgan energiyaga nisbatan"
          icon={<ArrowRight className="size-4.5" />}
          label="Foydali uzatish"
          tone="good"
          unit="%"
          value={
            totals && totals.kwhIn > 0
              ? ((totals.kwhSold / totals.kwhIn) * 100).toFixed(2)
              : '-'
          }
        />
      </div>

      {/* ── Sankey + tarkib jadvali ──────────────────────────────────── */}
      <div className="mb-3 grid grid-cols-1 gap-3 xl:grid-cols-12">
        <Panel
          className="xl:col-span-8"
          subtitle="manbadan iste’molchigacha bo‘lgan oqim"
          title="Energiya oqimi"
        >
          {nodes.length > 0 ? (
            <EnergyFlow height={306} nodes={nodes} />
          ) : (
            <EmptyPanel message={t('common.noData')} />
          )}
        </Panel>

        <Panel className="xl:col-span-4" flush title="Balans tarkibi">
          {nodes.length > 0 ? (
            <table className="dt">
              <thead>
                <tr>
                  <th>Modda</th>
                  <th className="w-28 text-right">Energiya</th>
                  <th className="w-16 text-right">Ulushi</th>
                </tr>
              </thead>
              <tbody>
                {nodes.map((n) => (
                  <tr key={n.key}>
                    <td className={n.key === 'in' ? 'font-semibold' : ''}>
                      {n.key !== 'in' && n.key !== 'sold' && (
                        <span aria-hidden="true" className="mr-1 text-muted">└</span>
                      )}
                      {n.labelUz}
                    </td>
                    <td className="num whitespace-nowrap font-medium">{energy(n.kwh).text}</td>
                    <td className="num whitespace-nowrap text-muted">{pct(n.pct, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyPanel message={t('common.noData')} />
          )}
        </Panel>
      </div>

      {/* ── Dinamika ─────────────────────────────────────────────────── */}
      <Panel
        actions={
          <ToggleButtonGroup
            aria-label="Guruhlash"
            selectedKeys={new Set([bucket])}
            selectionMode="single"
            size="sm"
            onSelectionChange={(keys) => {
              const next = [...keys][0];
              if (next === 'day' || next === 'week' || next === 'month') setBucket(next);
            }}
          >
            {BUCKETS.map((b) => (
              <ToggleButton key={b.id} id={b.id}>
                {b.label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        }
        className="mb-3"
        subtitle="oxirgi 90 kun"
        title="Balans dinamikasi"
      >
        {series.data && series.data.length > 0 ? (
          <TrendLine csvName="balans-dinamika" height={252} points={series.data} />
        ) : (
          <EmptyPanel message={t('common.noData')} />
        )}
      </Panel>

    </div>
  );
}
