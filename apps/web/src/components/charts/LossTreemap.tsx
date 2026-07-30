/**
 * Hududiy yo'qotish taqsimoti — treemap.
 *
 * XARITA O'RNIGA ISHLATILADI. Mijoz talabi: ma'lumot tashqariga chiqmasin,
 * shuning uchun tile server, geokodlash va geo-ma'lumot YO'Q.
 *
 * Bu "nominal toifalarga qiymat gradienti" anti-namunasi EMAS — plitka
 * MAYDONI va RANGI ikki BOSHQA o'zgaruvchini kodlaydi:
 *   maydon = tarmoqqa kirgan energiya (kim katta)
 *   rang   = amaldagi yo'qotish % − norma % (kim yomon)
 *
 * Xarita bir vaqtda hajm va darajani ko'rsata olmaydi — treemap ko'rsatadi.
 */
import type { LossMapCell } from '@beap/shared';
import { energy, pct } from '@beap/shared';
import { ResponsiveTreeMap } from '@nivo/treemap';
import { useMemo } from 'react';

import { divergingColor, nivoTheme, useVizTokens } from '../../lib/chart-theme.ts';
import { ChartFrame, type TableColumn } from './ChartFrame.tsx';

interface LossTreemapProps {
  cells: LossMapCell[];
  height?: number;
  onSelect?: (mfyId: number) => void;
}

/**
 * Nivo treemap rekursiv datum tipini talab qiladi: `children` ixtiyoriy bo'lishi
 * shart, aks holda ildiz va barg tugunlari bir tipga sig'maydi.
 */
interface TreeNode {
  name: string;
  mfyId?: number;
  value?: number;
  gapPp?: number;
  lossPct?: number;
  normPct?: number;
  color?: string;
  children?: TreeNode[];
}

export function LossTreemap({ cells, height = 300, onSelect }: LossTreemapProps) {
  const t = useVizTokens();

  const { root, maxAbsGap } = useMemo(() => {
    const maxAbs = Math.max(1, ...cells.map((c) => Math.abs(c.gapPp)));
    const children: TreeNode[] = cells.map((c) => ({
      name: c.shortName,
      mfyId: c.mfyId,
      value: Math.max(1, c.kwhIn),
      gapPp: c.gapPp,
      lossPct: c.lossPct,
      normPct: c.normPct,
      color: divergingColor(t, c.gapPp, maxAbs),
    }));
    const tree: TreeNode = { name: 'tuman', children };
    return { root: tree, maxAbsGap: maxAbs };
  }, [cells, t]);

  const columns: TableColumn<LossMapCell>[] = [
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

  return (
    <ChartFrame
      csvName="hududiy-yoqotish"
      height={height}
      tableColumns={columns}
      tableData={cells}
      actions={<DivergingLegend maxAbs={maxAbsGap} />}
    >
      <ResponsiveTreeMap<TreeNode>
        animate={false}
        borderColor={t.surface}
        borderWidth={2}
        colors={(node) => node.data.color ?? t.muted}
        data={root}
        enableParentLabel={false}
        identity="name"
        innerPadding={2}
        label={(node) => node.data.name}
        labelSkipSize={26}
        labelTextColor={{ from: 'color', modifiers: [['darker', 3]] }}
        leavesOnly
        margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
        nodeOpacity={1}
        outerPadding={0}
        theme={nivoTheme(t)}
        value="value"
        onClick={(node) => {
          if (node.data.mfyId !== undefined) onSelect?.(node.data.mfyId);
        }}
        tooltip={({ node }) => {
          const gap = node.data.gapPp ?? 0;
          return (
            <div className="chart-tooltip">
              <strong>{node.data.name}</strong>
              <br />
              Energiya: {energy(node.data.value ?? 0).text}
              <br />
              Yo‘qotish: {pct(node.data.lossPct ?? 0, 2)}{' '}
              <span className="text-muted">(norma {pct(node.data.normPct ?? 0, 1)})</span>
              <br />
              <span style={{ color: gap > 0 ? t.status.critical : t.status.good }}>
                {gap > 0 ? '+' : ''}
                {gap.toFixed(2)} p.p.
              </span>
            </div>
          );
        }}
      />
    </ChartFrame>
  );
}

/** Diverging shkala legendasi — normadan past/yuqori. */
function DivergingLegend({ maxAbs }: { maxAbs: number }) {
  const t = useVizTokens();
  return (
    <div className="flex items-center gap-2 text-[10px] text-muted">
      <span>−{maxAbs.toFixed(0)} p.p.</span>
      <span
        aria-hidden="true"
        className="h-2 w-20 rounded-full"
        style={{
          background: `linear-gradient(90deg, ${t.diverging[0]}, ${t.diverging[1]}, ${t.diverging[2]})`,
        }}
      />
      <span>+{maxAbs.toFixed(0)} p.p.</span>
    </div>
  );
}
