/** Mahallalar reytingi — yo'qotish bo'yicha, kunlik o'zgarish bilan. */
import type { MfyRankRow } from '@beap/shared';
import { pct } from '@beap/shared';
import { ArrowDown, ArrowUp, Minus } from 'lucide-react';

import { EmptyPanel } from '../../../components/ui/Panel.tsx';

export function MfyRankingPanel({
  rows, onSelect, limit = 10,
}: {
  rows: MfyRankRow[];
  onSelect?: (mfyId: number) => void;
  limit?: number;
}) {
  if (rows.length === 0) return <EmptyPanel message="Ma’lumot yo‘q" />;

  return (
    <div className="scroll-y max-h-[340px]">
      <table className="dt">
        <thead>
          <tr>
            <th className="w-8">№</th>
            <th>Mahalla</th>
            <th className="text-right">Yo‘qotish</th>
            <th className="text-right">Kecha</th>
            <th className="w-16 text-right">Trend</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, limit).map((r) => {
            const TrendIcon = r.trend === 'up' ? ArrowUp : r.trend === 'down' ? ArrowDown : Minus;
            const trendColor =
              r.trend === 'up' ? 'var(--viz-delta-bad)'
                : r.trend === 'down' ? 'var(--viz-delta-good)'
                  : 'var(--viz-muted)';

            return (
              <tr
                key={r.mfyId}
                className={onSelect ? 'cursor-pointer' : undefined}
                onClick={() => onSelect?.(r.mfyId)}
              >
                <td className="tabular text-muted">{r.rank}</td>
                <td className="font-medium">{r.nameUz.replace(/ MFY$/, '')}</td>
                <td className="num font-semibold">{pct(r.lossPct, 2)}</td>
                <td className="num text-muted">{r.prevLossPct === null ? '—' : pct(r.prevLossPct, 2)}</td>
                <td className="num">
                  <span
                    className="inline-flex items-center gap-0.5 text-[11px] font-medium"
                    style={{ color: trendColor }}
                  >
                    <TrendIcon className="size-3" aria-hidden="true" />
                    {r.deltaPp === null ? '—' : Math.abs(r.deltaPp).toFixed(2)}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
