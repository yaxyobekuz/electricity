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
 *
 * «HOLAT» ustuni oylik holat hisobotidan keladi. Nosoz transformator QIZIL
 * ko'rsatiladi va sababi tooltipda turadi - bu panel «Transformatorlar
 * holati» deb atalgani uchun nosozlik birinchi ko'zga tashlanishi kerak.
 */
import type { TpCondition, TpMonthlyRow } from '@beap/shared';
import { TP_CONDITION_LABEL_UZ, num, pct } from '@beap/shared';
import { Chip } from '@heroui/react';
import { TriangleAlert } from 'lucide-react';

/** Holat → chip rangi. `null` (hisobot kelmagan) rangsiz qoladi. */
const CONDITION_COLOR: Record<TpCondition, 'danger' | 'warning' | 'success'> = {
  FAULT: 'danger',
  OVERLOAD: 'danger',
  ATTENTION: 'warning',
  GOOD: 'success',
};

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
            <th className="w-[4%]">№</th>
            <th className="w-[15%]">Transformator</th>
            <th className="w-[17%]">Holat</th>
            <th className="w-[11%]">Iste’molchi</th>
            <th className="w-[13%]">O‘rt. yuklama (kW)</th>
            <th className="w-[12%]">Aloqada emas</th>
            <th className="w-[17%]">Oylik iste’mol (kWh)</th>
            <th className="w-[11%]">Ulushi</th>
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

            const faulty = r.condition === 'FAULT' || r.condition === 'OVERLOAD';

            return (
              <tr key={r.tpId}>
                <td className="num text-[10.5px] text-muted">{i + 1}</td>
                <td
                  className="truncate font-semibold"
                  style={faulty ? { color: t.status.critical } : undefined}
                  title={r.meterNo ?? ''}
                >
                  {!faulty && <span className="text-accent">{r.code}</span>}
                  {faulty && (
                    <span className="inline-flex items-center gap-1">
                      <TriangleAlert className="size-3.5 shrink-0" />
                      {r.code}
                    </span>
                  )}
                </td>
                <td>
                  {r.condition === null ? (
                    <span className="text-muted" title="Oylik holat hisoboti kelmagan">-</span>
                  ) : (
                    <Chip
                      className="whitespace-nowrap"
                      color={CONDITION_COLOR[r.condition]}
                      size="sm"
                      title={r.repairReason ?? TP_CONDITION_LABEL_UZ[r.condition]}
                      variant="soft"
                    >
                      <Chip.Label className="text-[9.5px]">
                        {TP_CONDITION_LABEL_UZ[r.condition]}
                      </Chip.Label>
                    </Chip>
                  )}
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
