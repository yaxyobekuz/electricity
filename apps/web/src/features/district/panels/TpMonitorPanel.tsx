/**
 * Transformatorlar holati - fiderning TP kesimi.
 *
 * USTUNLAR MANBA HISOBOTIDAN kelib chiqadi. Ilgari bu yerda quvvat (kVA),
 * yuklama foizi va masofa turardi - bu ma'lumotlar TP pasportidan keladi va
 * hozircha tizimda yo'q. Ularni bo'sh («-») ko'rsatib turishdan ko'ra,
 * hisobotda HAQIQATAN bor raqamlarni ko'rsatgan foydaliroq: har bir TP ning
 * iste'molchilari, o'rtacha yuklamasi va oylik iste'moli.
 *
 * O'rtacha yuklama = oylik energiya ÷ (kun × 24). Bu CHO'QQI yuklama emas -
 * cho'qqini bilish uchun soatlik profil kerak, u hisobotda yo'q. Shuning
 * uchun ustun ham aynan «o'rtacha» deb nomlangan.
 */
import type { TpMonthlyRow } from '@beap/shared';
import { num, pct } from '@beap/shared';
import { Chip } from '@heroui/react';

import { useVizTokens } from '../../../lib/chart-theme.ts';
import { EmptyPanel } from '../../../components/ui/Panel.tsx';

export function TpMonitorPanel({
  rows, days = 31, totalKwh,
}: {
  rows: TpMonthlyRow[];
  /** Davrdagi kunlar soni - o'rtacha yuklama shundan hisoblanadi. */
  days?: number;
  /** Fider bo'yicha jami - ulush ustuni uchun. */
  totalKwh?: number;
}) {
  const t = useVizTokens();

  if (rows.length === 0) return <EmptyPanel message="Ma’lumot yo‘q" />;

  const total = totalKwh ?? rows.reduce((a, r) => a + r.kwhMonth, 0);

  return (
    <div className="scroll-y max-h-75 overflow-x-auto">
      <table className="dt dt--compact dt--center min-w-md table-fixed">
        <thead>
          <tr>
            <th className="w-[5%]">№</th>
            <th className="w-[16%]">Transformator</th>
            <th className="w-[13%]">Iste’molchi</th>
            <th className="w-[15%]">O‘rt. yuklama (kW)</th>
            <th className="w-[14%]">Aloqada emas</th>
            <th className="w-[19%]">Oylik iste’mol (kWh)</th>
            <th className="w-[13%]">Ulushi</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const avgKw = r.kwhMonth / (days * 24);
            const offShare = r.consumersTotal > 0
              ? (r.consumersDisconnected / r.consumersTotal) * 100
              : 0;
            /*
              Rang - ALOQADAN CHIQQAN abonentlar ulushiga qarab. Bu hisobotda
              bor yagona "muammo" signali: hisoblagichi aloqaga chiqmagan
              abonent - yo'qotishning bevosita manbai.
            */
            const offColor = offShare >= 10 ? t.status.critical
              : offShare >= 5 ? t.status.warning
                : undefined;

            return (
              <tr key={r.tpId}>
                <td className="num text-[10.5px] text-muted">{i + 1}</td>
                <td className="truncate font-semibold text-accent" title={r.meterNo ?? ''}>
                  {r.code}
                </td>
                <td className="num">{num(r.consumersTotal)}</td>
                <td className="num font-semibold">{num(avgKw, 1)}</td>
                <td>
                  {r.consumersDisconnected === 0 ? (
                    <span className="text-muted">-</span>
                  ) : (
                    <Chip
                      className="whitespace-nowrap"
                      color={offShare >= 10 ? 'danger' : offShare >= 5 ? 'warning' : 'success'}
                      size="sm"
                      title={`${num(r.consumersDisconnected)} ta - ${pct(offShare, 1)}`}
                      variant="soft"
                    >
                      <Chip.Label className="text-[9.5px]">
                        {num(r.consumersDisconnected)} ta
                      </Chip.Label>
                    </Chip>
                  )}
                </td>
                <td className="num font-semibold" style={offColor ? { color: offColor } : undefined}>
                  {num(r.kwhMonth)}
                </td>
                <td className="num text-muted">
                  {total > 0 ? pct((r.kwhMonth / total) * 100, 1) : '-'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
