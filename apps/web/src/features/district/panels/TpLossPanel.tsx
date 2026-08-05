/**
 * TP darajasidagi kunlik chiziqli yo'qotish - balans hisoblagichi vs
 * bириктирилган iste'molchilar, har bir TP uchun eng so'nggi o'qish.
 *
 * Fider (oylik) balansidan FARQLI: bu yerdagi ma'lumot 51 TP dan faqat
 * balans hisoblagichi ishlaydiganlari uchun, elektroset yuboradigan kunlik
 * hisobotdan keladi. Manfiy yo'qotish - iste'molchilar yig'indisi balansdan
 * ko'p - fizik jihatdan mumkin emas, shuning uchun rangli belgi bilan
 * ajratiladi (`analytics.detectTpLossAnomalies()` natijasi).
 */
import type { TpLossAnomalyItem, TpLossDailyRow } from '@beap/shared';
import { num, pct } from '@beap/shared';
import { Chip } from '@heroui/react';

import { EmptyPanel } from '../../../components/ui/Panel.tsx';

export function TpLossPanel({
  rows, anomalies,
}: {
  rows: TpLossDailyRow[];
  anomalies: TpLossAnomalyItem[];
}) {
  if (rows.length === 0) {
    return <EmptyPanel message="Kunlik TP yo‘qotish ma’lumoti hali yuklanmagan" />;
  }

  const severityByTp = new Map(anomalies.map((a) => [a.tpId, a.severity]));

  return (
    <div className="scroll-y max-h-75 overflow-x-auto">
      <table className="dt dt--compact dt--center min-w-md table-fixed">
        <thead>
          <tr>
            <th className="w-[14%]">Transformator</th>
            <th className="w-[16%]">Sana</th>
            <th className="w-[18%]">Balans (kWh)</th>
            <th className="w-[18%]">Iste’molchi (kWh)</th>
            <th className="w-[18%]">Yo‘qotish (kWh)</th>
            <th className="w-[16%]">Holat</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const severity = severityByTp.get(r.tpId);
            return (
              <tr key={r.tpId}>
                <td className="truncate font-semibold text-accent">{r.code}</td>
                <td className="text-muted">{r.bizDate}</td>
                <td className="num">{num(r.kwhBalanceMeter)}</td>
                <td className="num">{num(r.kwhConsumersAttached)}</td>
                <td className="num font-semibold">{num(r.kwhLoss)}</td>
                <td>
                  {severity ? (
                    <Chip
                      className="whitespace-nowrap"
                      color={severity === 'high' ? 'danger' : 'warning'}
                      size="sm"
                      title={r.lossPct !== null ? pct(r.lossPct, 1) : undefined}
                      variant="soft"
                    >
                      <Chip.Label className="text-[9.5px]">
                        {severity === 'high' ? 'Anomaliya' : 'Diqqat'}
                      </Chip.Label>
                    </Chip>
                  ) : (
                    <span className="text-muted">
                      {r.lossPct !== null ? pct(r.lossPct, 1) : '-'}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
