/**
 * Energiya balansi - Sankey diagrammasi.
 *
 * RANG QARORI: bu KATEGORIK emas, STATUS diagrammasi. Shu sababli
 * kategorik palitra o'rniga ma'noli ranglar ishlatiladi:
 *   Foydali oqim → accent   (asosiy, yaxshi)
 *   Yo'qotish    → critical (kamaytirish kerak)
 *
 * Har bir tugun TO'G'RIDAN-TO'G'RI belgilanadi (nom + qiymat + %), shuning
 * uchun rang yolg'iz ma'no tashimaydi.
 */
import type { EnergyBalanceNode } from '@beap/shared';
import { energy, pct } from '@beap/shared';
import { ResponsiveSankey } from '@nivo/sankey';
import { useMemo } from 'react';

import { nivoTheme, useVizTokens } from '../../lib/chart-theme.ts';
import { ChartFrame, type TableColumn } from './ChartFrame.tsx';

interface EnergyFlowProps {
  nodes: EnergyBalanceNode[];
  height?: number;
}

export function EnergyFlow({ nodes, height = 260 }: EnergyFlowProps) {
  const t = useVizTokens();

  const colorByKey = useMemo<Record<string, string>>(
    () => ({
      in: t.series[0]!,
      sold: t.series[0]!,
      loss: t.status.critical,
    }),
    [t],
  );

  const data = useMemo(() => {
    const source = nodes.find((n) => n.key === 'in');
    const targets = nodes.filter((n) => n.key !== 'in' && n.kwh > 0);
    if (!source || targets.length === 0) return null;

    return {
      nodes: [source, ...targets].map((n) => ({
        id: n.labelUz,
        nodeColor: colorByKey[n.key] ?? t.series[0]!,
      })),
      links: targets.map((n) => ({
        source: source.labelUz,
        target: n.labelUz,
        value: Math.max(0.01, Number(n.kwh.toFixed(0))),
      })),
    };
  }, [nodes, colorByKey, t]);

  const columns: TableColumn<EnergyBalanceNode>[] = [
    {
      key: 'label', label: 'Ko‘rsatkich',
      render: (r) => r.labelUz, raw: (r) => r.labelUz,
    },
    {
      key: 'kwh', label: 'Miqdor', align: 'right',
      render: (r) => energy(r.kwh).text, raw: (r) => Math.round(r.kwh),
    },
    {
      key: 'pct', label: 'Ulushi', align: 'right',
      render: (r) => pct(r.pct, 2), raw: (r) => r.pct,
    },
  ];

  if (!data) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-muted">
        Ma’lumot yo‘q
      </div>
    );
  }

  return (
    <ChartFrame
      csvName="energiya-balansi"
      height={height}
      legend={nodes
        .filter((n) => n.key !== 'in')
        .map((n) => ({ label: n.labelUz, color: colorByKey[n.key] ?? t.muted }))}
      tableColumns={columns}
      tableData={nodes}
    >
      <ResponsiveSankey
        data={data}
        align="justify"
        colors={(node: { nodeColor?: string }) => node.nodeColor ?? t.series[0]!}
        enableLinkGradient
        label={(node: { id: string | number }) => String(node.id)}
        labelPadding={10}
        labelPosition="outside"
        labelTextColor={t.ink2}
        linkBlendMode="normal"
        linkContract={2}
        linkOpacity={0.42}
        linkHoverOpacity={0.7}
        margin={{ top: 8, right: 168, bottom: 8, left: 130 }}
        nodeBorderWidth={0}
        nodeOpacity={1}
        nodeSpacing={16}
        nodeThickness={16}
        theme={nivoTheme(t)}
        nodeTooltip={({ node }: { node: { id: string | number; value: number } }) => (
          <div className="chart-tooltip">
            <span className="chart-tooltip__title">{node.id}</span>
            <div className="chart-tooltip__row">
              <span className="chart-tooltip__label">Miqdor</span>
              <span className="chart-tooltip__value">{energy(node.value).text}</span>
            </div>
          </div>
        )}
        linkTooltip={({ link }: { link: { target: { id: string | number }; value: number } }) => (
          <div className="chart-tooltip">
            <span className="chart-tooltip__title">{link.target.id}</span>
            <div className="chart-tooltip__row">
              <span className="chart-tooltip__label">Miqdor</span>
              <span className="chart-tooltip__value">{energy(link.value).text}</span>
            </div>
          </div>
        )}
      />
    </ChartFrame>
  );
}

/**
 * Sankey uchun ixcham muqobil: gorizontal "waterfall" qatorlari.
 * Tor panellarda (MFY paneli) ishlatiladi.
 */
export function EnergyBalanceBars({ nodes }: { nodes: EnergyBalanceNode[] }) {
  const t = useVizTokens();
  const source = nodes.find((n) => n.key === 'in');
  if (!source) return null;

  const colorByKey: Record<string, string> = {
    sold: t.series[0]!,
    loss: t.status.critical,
  };

  return (
    <ul className="flex flex-col gap-2.5">
      {nodes.map((n) => {
        const isSource = n.key === 'in';
        const width = Math.max(1, n.pct);
        return (
          <li key={n.key} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className={isSource ? 'font-semibold' : 'text-muted'}>{n.labelUz}</span>
              <span className="tabular shrink-0 font-medium">
                {energy(n.kwh).text}
                {!isSource && (
                  <span className="ml-1.5 text-[11px] text-muted">({pct(n.pct, 1)})</span>
                )}
              </span>
            </div>
            <div className="loadbar">
              <span
                className="loadbar__fill"
                style={{
                  width: `${width}%`,
                  background: isSource ? t.ink2 : (colorByKey[n.key] ?? t.muted),
                }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
