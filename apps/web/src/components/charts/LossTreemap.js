import { energy, pct } from '@beap/shared';
import { ResponsiveTreeMap } from '@nivo/treemap';
import { useMemo } from 'react';
import { divergingColor, nivoTheme, useVizTokens } from '../../lib/chart-theme.ts';
import { ChartFrame } from './ChartFrame.tsx';
export function LossTreemap({ cells, height = 300, onSelect }) {
    const t = useVizTokens();
    const { root, maxAbsGap } = useMemo(() => {
        const maxAbs = Math.max(1, ...cells.map((c) => Math.abs(c.gapPp)));
        const children = cells.map((c) => ({
            name: c.shortName,
            mfyId: c.mfyId,
            value: Math.max(1, c.kwhIn),
            gapPp: c.gapPp,
            lossPct: c.lossPct,
            normPct: c.normPct,
            color: divergingColor(t, c.gapPp, maxAbs),
        }));
        const tree = { name: 'tuman', children };
        return { root: tree, maxAbsGap: maxAbs };
    }, [cells, t]);
    const columns = [
        { key: 'name', label: 'Mahalla', render: (r) => r.nameUz, raw: (r) => r.nameUz },
        {
            key: 'kwh', label: 'Energiya', align: 'right',
            render: (r) => energy(r.kwhIn).text, raw: (r) => Math.round(r.kwhIn),
        },
        {
            key: 'loss', label: 'Yo‘qotish', align: 'right',
            render: (r) => pct(r.lossPct, 2), raw: (r) => r.lossPct,
        },
        {
            key: 'norm', label: 'Norma', align: 'right',
            render: (r) => pct(r.normPct, 1), raw: (r) => r.normPct,
        },
        {
            key: 'gap', label: 'Farq (p.p.)', align: 'right',
            render: (r) => (r.gapPp > 0 ? `+${r.gapPp.toFixed(2)}` : r.gapPp.toFixed(2)),
            raw: (r) => r.gapPp,
        },
    ];
    if (cells.length === 0) {
        return <div className="flex h-40 items-center justify-center text-sm text-muted">Ma’lumot yo‘q</div>;
    }
    return (<ChartFrame csvName="hududiy-yoqotish" height={height} tableColumns={columns} tableData={cells} actions={<DivergingLegend maxAbs={maxAbsGap}/>}>
      <ResponsiveTreeMap animate={false} borderColor={t.surface} borderWidth={2} colors={(node) => node.data.color ?? t.muted} data={root} enableParentLabel={false} identity="name" innerPadding={2} label={(node) => node.data.name} labelSkipSize={26} labelTextColor={{ from: 'color', modifiers: [['darker', 3]] }} leavesOnly margin={{ top: 0, right: 0, bottom: 0, left: 0 }} nodeOpacity={1} outerPadding={0} theme={nivoTheme(t)} value="value" onClick={(node) => {
            if (node.data.mfyId !== undefined)
                onSelect?.(node.data.mfyId);
        }} tooltip={({ node }) => {
            const gap = node.data.gapPp ?? 0;
            return (<div className="chart-tooltip">
              <span className="chart-tooltip__title">{node.data.name}</span>
              <dl className="flex flex-col gap-0.5">
                <div className="chart-tooltip__row">
                  <dt>Energiya</dt>
                  <dd>{energy(node.data.value ?? 0).text}</dd>
                </div>
                <div className="chart-tooltip__row">
                  <dt>Yo‘qotish</dt>
                  <dd>{pct(node.data.lossPct ?? 0, 2)}</dd>
                </div>
                <div className="chart-tooltip__row">
                  <dt>Norma</dt>
                  <dd>{pct(node.data.normPct ?? 0, 1)}</dd>
                </div>
                <div className="chart-tooltip__row">
                  <dt>Normadan farq</dt>
                  <dd style={{ color: gap > 0 ? t.status.critical : t.status.good }}>
                    {gap > 0 ? '+' : ''}
                    {gap.toFixed(2)} p.p.
                  </dd>
                </div>
              </dl>
            </div>);
        }}/>
    </ChartFrame>);
}
/** Diverging shkala legendasi — normadan past/yuqori. */
function DivergingLegend({ maxAbs }) {
    const t = useVizTokens();
    return (<div className="flex items-center gap-2 text-[10px] text-muted">
      <span>−{maxAbs.toFixed(0)} p.p.</span>
      <span aria-hidden="true" className="h-2 w-20 rounded-full" style={{
            background: `linear-gradient(90deg, ${t.diverging[0]}, ${t.diverging[1]}, ${t.diverging[2]})`,
        }}/>
      <span>+{maxAbs.toFixed(0)} p.p.</span>
    </div>);
}
