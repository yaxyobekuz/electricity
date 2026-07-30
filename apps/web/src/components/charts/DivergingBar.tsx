/**
 * Diverging ustunli diagramma — standart va amaldagi qiymat farqi.
 *
 * Nol chizig'i markazda: chapga (ko'k) = standartdan yaxshi,
 * o'ngga (qizil) = standartdan yomon.
 */
import type { TechnicalLossRow } from '@beap/shared';
import { pct } from '@beap/shared';
import { ResponsiveBar } from '@nivo/bar';
import { useMemo } from 'react';

import { nivoTheme, statusColor, useVizTokens } from '../../lib/chart-theme.ts';
import { ChartFrame, type TableColumn } from './ChartFrame.tsx';

interface DivergingBarProps {
  rows: TechnicalLossRow[];
  height?: number;
  onSelect?: (mfyId: number) => void;
}

export function DivergingBar({ rows, height = 300, onSelect }: DivergingBarProps) {
  const t = useVizTokens();

  const data = useMemo(
    () =>
      [...rows]
        .sort((a, b) => a.gapPp - b.gapPp)
        .map((r) => ({
          mfy: r.nameUz.replace(/ MFY$/, ''),
          mfyId: r.mfyId,
          gap: r.gapPp,
          color: statusColor(t, r.status),
        })),
    [rows, t],
  );

  const columns: TableColumn<TechnicalLossRow>[] = [
    { key: 'name', label: 'Mahalla', render: (r) => r.nameUz, raw: (r) => r.nameUz },
    { key: 'std', label: 'Standart', align: 'right', render: (r) => pct(r.standardPct, 1), raw: (r) => r.standardPct },
    { key: 'act', label: 'Amaldagi', align: 'right', render: (r) => pct(r.actualPct, 2), raw: (r) => r.actualPct },
    {
      key: 'gap', label: 'Farq (p.p.)', align: 'right',
      render: (r) => (r.gapPp > 0 ? `+${r.gapPp.toFixed(2)}` : r.gapPp.toFixed(2)),
      raw: (r) => r.gapPp,
    },
    {
      key: 'status', label: 'Holat',
      render: (r) => ({ good: 'Yaxshi', warning: 'Diqqat', serious: 'Jiddiy', critical: 'Tanqidiy' }[r.status]),
      raw: (r) => r.status,
    },
  ];

  if (rows.length === 0) {
    return <div className="flex h-40 items-center justify-center text-sm text-muted">Ma’lumot yo‘q</div>;
  }

  return (
    <ChartFrame
      csvName="texnik-yoqotish"
      height={height}
      tableColumns={columns}
      tableData={rows}
      legend={[
        { label: 'Standart doirasida', color: t.status.good },
        { label: 'Diqqat', color: t.status.warning },
        { label: 'Jiddiy', color: t.status.serious },
        { label: 'Tanqidiy', color: t.status.critical },
      ]}
    >
      <ResponsiveBar
        animate={false}
        axisBottom={{
          tickSize: 0,
          tickPadding: 6,
          format: (v: number) => `${v > 0 ? '+' : ''}${v}`,
        }}
        axisLeft={{ tickSize: 0, tickPadding: 6 }}
        borderRadius={3}
        colors={(d: { data: { color: string } }) => d.data.color}
        data={data}
        enableGridX
        enableGridY={false}
        indexBy="mfy"
        keys={['gap']}
        labelSkipWidth={9999}
        layout="horizontal"
        margin={{ top: 4, right: 20, bottom: 28, left: 92 }}
        markers={[
          {
            axis: 'x',
            value: 0,
            lineStyle: { stroke: t.ink2, strokeWidth: 1.5 },
            legend: '',
          },
        ]}
        padding={0.28}
        theme={nivoTheme(t)}
        valueScale={{ type: 'linear' }}
        onClick={(d: { data: { mfyId: number } }) => onSelect?.(d.data.mfyId)}
        tooltip={({ data }: { data: { mfy: string; gap: number } }) => {
          const row = rows.find((r) => r.nameUz.replace(/ MFY$/, '') === data.mfy);
          return (
            <div className="chart-tooltip">
              <span className="chart-tooltip__title">{data.mfy}</span>
              <dl className="flex flex-col gap-0.5">
                <div className="chart-tooltip__row">
                  <dt>Standart</dt>
                  <dd>{pct(row?.standardPct ?? 0, 1)}</dd>
                </div>
                <div className="chart-tooltip__row">
                  <dt>Amaldagi</dt>
                  <dd>{pct(row?.actualPct ?? 0, 2)}</dd>
                </div>
                <div className="chart-tooltip__row">
                  <dt>Farq</dt>
                  <dd style={{ color: data.gap > 0 ? t.status.critical : t.status.good }}>
                    {data.gap > 0 ? '+' : ''}
                    {data.gap.toFixed(2)} p.p.
                  </dd>
                </div>
              </dl>
            </div>
          );
        }}
      />
    </ChartFrame>
  );
}
