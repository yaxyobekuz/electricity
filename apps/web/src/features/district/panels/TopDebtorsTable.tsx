/** TOP-5 yuridik qarzdorlar. */
import type { DebtBreakdown } from '@beap/shared';
import { money } from '@beap/shared';

import { EmptyPanel } from '../../../components/ui/Panel.tsx';

export function TopDebtorsTable({ rows }: { rows: DebtBreakdown['topDebtors'] }) {
  if (rows.length === 0) return <EmptyPanel message="Qarzdorlar ro‘yxati bo‘sh" />;

  const max = Math.max(...rows.map((r) => r.amountMln), 1);

  return (
    <div className="scroll-y max-h-[280px]">
      <table className="dt">
        <thead>
          <tr>
            <th className="w-8">№</th>
            <th>Tashkilot</th>
            <th>Mahalla</th>
            <th className="text-right">Summa</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.rank}-${r.debtorName}`}>
              <td className="tabular text-muted">{r.rank}</td>
              <td className="font-medium">
                {r.debtorName}
                {/* Nisbiy hajm chizig'i — raqamni ko'z bilan solishtirish uchun */}
                <span className="mt-1 block h-1 w-full overflow-hidden rounded-full bg-surface-tertiary">
                  <span
                    className="block h-full rounded-full"
                    style={{
                      width: `${(r.amountMln / max) * 100}%`,
                      background: 'var(--viz-5)',
                    }}
                  />
                </span>
              </td>
              <td className="text-muted">{r.mfyName.replace(/ MFY$/, '')}</td>
              <td className="num font-semibold">{money(r.amountMln).text}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
