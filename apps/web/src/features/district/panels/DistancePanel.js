import { meters } from '@beap/shared';
import { Check, X } from 'lucide-react';
import { useVizTokens } from '../../../lib/chart-theme.ts';
import { EmptyPanel } from '../../../components/ui/Panel.tsx';
export function DistancePanel({ rows, onSelect, }) {
    const t = useVizTokens();
    if (rows.length === 0)
        return <EmptyPanel message="Ma’lumot yo‘q"/>;
    const maxDistance = Math.max(...rows.map((r) => r.avgDistanceM), 400);
    return (<div className="scroll-y max-h-[300px]">
      <table className="dt">
        <thead>
          <tr>
            <th>Mahalla</th>
            <th className="w-40">O‘rtacha masofa</th>
            <th className="text-right">Standart</th>
            <th className="text-right">Normadan uzoq</th>
            <th className="w-16">Moslik</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const widthPct = (r.avgDistanceM / maxDistance) * 100;
            const normPct = (r.standardM / maxDistance) * 100;
            const color = r.compliant ? t.status.good : t.status.critical;
            return (<tr key={r.mfyId} className={onSelect ? 'cursor-pointer' : undefined} onClick={() => onSelect?.(r.mfyId)}>
                <td className="font-medium">{r.nameUz.replace(/ MFY$/, '')}</td>
                <td>
                  <div className="flex items-center gap-2">
                    <span className="loadbar h-2 flex-1">
                      <span className="loadbar__fill" style={{ width: `${widthPct}%`, background: color }}/>
                      {/* Norma markeri */}
                      <span className="loadbar__mark" style={{ left: `${normPct}%`, background: t.ink2, width: '2px' }} aria-hidden="true"/>
                    </span>
                    <span className="tabular w-12 shrink-0 text-right text-xs font-medium">
                      {meters(r.avgDistanceM)}
                    </span>
                  </div>
                </td>
                <td className="num text-muted">≤ {meters(r.standardM)}</td>
                <td className="num">
                  {r.tpOverStandard > 0 ? (<span className="font-medium" style={{ color: t.status.critical }}>
                      {r.tpOverStandard} / {r.tpCount} ta
                    </span>) : (<span className="text-muted">0 / {r.tpCount} ta</span>)}
                </td>
                <td>
                  {r.compliant ? (<span className="inline-flex items-center gap-1 text-[11px] font-medium text-viz-good">
                      <Check className="size-3.5"/> Mos
                    </span>) : (<span className="inline-flex items-center gap-1 text-[11px] font-medium text-viz-critical">
                      <X className="size-3.5"/> Mos emas
                    </span>)}
                </td>
              </tr>);
        })}
        </tbody>
      </table>
    </div>);
}
