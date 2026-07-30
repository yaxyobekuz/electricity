/** Transformator monitoringi — yuklama chizig'i va holat chipi bilan jadval. */
import type { TpMonitorRow } from '@beap/shared';
import { kva, meters, pct } from '@beap/shared';
import { Chip } from '@heroui/react';
import { Check, X } from 'lucide-react';
import { Link } from 'react-router';

import { useVizTokens } from '../../../lib/chart-theme.ts';
import { EmptyPanel } from '../../../components/ui/Panel.tsx';

const CONDITION_LABEL: Record<string, string> = {
  GOOD: 'Yaxshi',
  ATTENTION: 'Diqqat talab qiladi',
  OVERLOAD: 'Ortiqcha yuklama',
  FAULT: 'Nosozlik',
};

const CONDITION_STATUS: Record<string, 'good' | 'warning' | 'serious' | 'critical'> = {
  GOOD: 'good',
  ATTENTION: 'warning',
  OVERLOAD: 'critical',
  FAULT: 'serious',
};

export function TpMonitorPanel({ rows, showMfy = true }: { rows: TpMonitorRow[]; showMfy?: boolean }) {
  const t = useVizTokens();

  if (rows.length === 0) return <EmptyPanel message="Ma’lumot yo‘q" />;

  return (
    <div className="scroll-y max-h-75 overflow-x-auto">
      {/*
        `table-fixed` + aniq ustun kengliklari: aks holda "Ortiqcha yuklama"
        va "448 m" kabi matnlar ikki qatorga bo'linib, qatorlar bir-biriga
        yopishib qolardi. Tor panelda jadval siqilmaydi — gorizontal siljiydi.
      */}
      <table className="dt min-w-105 table-fixed">
        <thead>
          <tr>
            <th>TP</th>
            <th className="w-18 text-right">Quvvat</th>
            <th className="w-30">Yuklama</th>
            <th className="w-20 text-right">Masofa</th>
            <th className="w-33">Holat</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const status = CONDITION_STATUS[r.condition] ?? 'good';
            const color = t.status[status];
            return (
              <tr key={r.tpId}>
                <td className="truncate">
                  <Link
                    to={`/dashboard/mfy/${r.mfyId}`}
                    className="block truncate text-[12.5px] font-medium hover:underline"
                  >
                    {r.code}
                  </Link>
                  {showMfy && (
                    <span className="block truncate text-[10px] leading-tight text-muted">
                      {r.mfyName.replace(/ MFY$/, '')}
                    </span>
                  )}
                </td>
                <td className="num whitespace-nowrap text-[12.5px]">{kva(r.ratedKva)}</td>
                <td>
                  <div className="flex items-center gap-1.5">
                    <span className="loadbar flex-1">
                      <span
                        className="loadbar__fill"
                        style={{ width: `${Math.min(100, r.loadPct)}%`, background: color }}
                      />
                      {/* Optimal chegara belgisi */}
                      <span
                        className="loadbar__mark"
                        style={{ left: `${Math.min(100, r.optimalPct)}%` }}
                        aria-hidden="true"
                      />
                    </span>
                    <span className="tabular w-9 shrink-0 text-right text-[12px] font-semibold">
                      {r.loadPct.toFixed(0)}%
                    </span>
                  </div>
                  <span className="mt-0.5 block whitespace-nowrap text-[10px] leading-none text-muted">
                    optimal {pct(r.optimalPct, 0)}
                  </span>
                </td>
                <td className="num whitespace-nowrap text-[12.5px]">
                  <span className="inline-flex items-center gap-1">
                    {meters(r.avgDistanceM)}
                    {r.distanceCompliant === true && (
                      <Check className="size-3 shrink-0 text-viz-good" aria-label="Normaga mos" />
                    )}
                    {r.distanceCompliant === false && (
                      <X className="size-3 shrink-0 text-viz-critical" aria-label="Normadan uzoq" />
                    )}
                  </span>
                </td>
                <td>
                  <Chip
                    className="whitespace-nowrap"
                    color={status === 'good' ? 'success' : status === 'warning' ? 'warning' : 'danger'}
                    size="sm"
                    variant="soft"
                  >
                    <span className={`dot dot--${status}`} aria-hidden="true" />
                    <Chip.Label>{CONDITION_LABEL[r.condition] ?? r.condition}</Chip.Label>
                  </Chip>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
