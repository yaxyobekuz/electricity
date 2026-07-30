/** Transformatorlar holati — raqamli jadval: yuklama foizi, holat va standart chipi. */
import type { TpMonitorRow } from '@beap/shared';
import { num } from '@beap/shared';
import { Chip } from '@heroui/react';
import { Link } from 'react-router';

import { useVizTokens } from '../../../lib/chart-theme.ts';
import { EmptyPanel } from '../../../components/ui/Panel.tsx';

type StatusKey = 'good' | 'warning' | 'serious' | 'critical';

/** Jadvaldagi qisqa yorliq — ustun tor, shuning uchun bir so'z. */
const CONDITION_LABEL: Record<string, string> = {
  GOOD: 'Yaxshi',
  ATTENTION: 'Diqqat',
  OVERLOAD: 'Ogohlantirish',
  FAULT: 'Nosozlik',
};

/** To'liq ma'no — `title` sifatida, qisqa yorliq noaniq qolmasligi uchun. */
const CONDITION_HINT: Record<string, string> = {
  GOOD: 'Yaxshi — yuklama me’yorda',
  ATTENTION: 'Diqqat talab qiladi',
  OVERLOAD: 'Ortiqcha yuklama',
  FAULT: 'Nosozlik',
};

const CONDITION_STATUS: Record<string, StatusKey> = {
  GOOD: 'good',
  ATTENTION: 'warning',
  OVERLOAD: 'critical',
  FAULT: 'serious',
};

const CHIP_COLOR: Record<StatusKey, 'success' | 'warning' | 'danger'> = {
  good: 'success',
  warning: 'warning',
  serious: 'danger',
  critical: 'danger',
};

export function TpMonitorPanel({ rows, showMfy = false }: { rows: TpMonitorRow[]; showMfy?: boolean }) {
  const t = useVizTokens();

  if (rows.length === 0) return <EmptyPanel message="Ma’lumot yo‘q" />;

  return (
    <div className="scroll-y max-h-75 overflow-x-auto">
      {/*
        `table-fixed` + NISBIY (foizli) kengliklar.

        Piksellarda berilganda ortiqcha kenglikning HAMMASI birinchi
        ustunga tushardi: keng panelda "TR-0108" yonida katta bo'shliq
        qolib, yuklama va holat ustunlari siqilib turardi. Foiz bilan
        ortiqcha joy hamma ustunga taqsimlanadi.

        `min-w` — tor panelda jadval siqilmaydi, gorizontal siljiydi.
      */}
      <table className="dt dt--compact min-w-md table-fixed">
        <thead>
          <tr>
            <th className="w-[5%] text-center">№</th>
            <th className="w-[19%]">Transformator</th>
            <th className="w-[15%] text-right">Quvvat (kVA)</th>
            <th className="w-[14%] text-right">Yuklama (%)</th>
            <th className="w-[19%]">Holat</th>
            <th className="w-[14%] text-right">Masofa (m)</th>
            <th className="w-[14%]">Standart</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const status = CONDITION_STATUS[r.condition] ?? 'good';
            const color = t.status[status];
            return (
              <tr key={r.tpId}>
                <td className="num text-center! text-[10.5px] text-muted">{i + 1}</td>
                <td className="truncate">
                  <Link
                    to={`/dashboard/mfy/${r.mfyId}`}
                    className="block truncate font-semibold text-accent hover:underline"
                  >
                    {r.code}
                  </Link>
                  {showMfy && (
                    <span className="block truncate text-[10px] leading-tight text-muted">
                      {r.mfyName.replace(/ MFY$/, '')}
                    </span>
                  )}
                </td>
                <td className="num whitespace-nowrap">{num(r.ratedKva)}</td>
                {/*
                  Foiz rangi holat rangi bilan BIR XIL manbadan olinadi —
                  chip bilan raqam hech qachon boshqa-boshqa signal bermaydi.
                */}
                <td
                  className="num whitespace-nowrap font-semibold"
                  style={{ color }}
                  title={`Optimal: ${num(r.optimalPct)}%`}
                >
                  {r.loadPct.toFixed(0)}%
                </td>
                <td>
                  <Chip
                    className="whitespace-nowrap"
                    color={CHIP_COLOR[status]}
                    size="sm"
                    title={CONDITION_HINT[r.condition] ?? r.condition}
                    variant="soft"
                  >
                    <Chip.Label className="text-[9.5px]">
                      {CONDITION_LABEL[r.condition] ?? r.condition}
                    </Chip.Label>
                  </Chip>
                </td>
                <td className="num whitespace-nowrap">{num(r.avgDistanceM)}</td>
                <td>
                  {r.distanceCompliant == null ? (
                    <span className="text-muted">—</span>
                  ) : (
                    <Chip
                      className="whitespace-nowrap"
                      color={r.distanceCompliant ? 'success' : 'danger'}
                      size="sm"
                      title={
                        r.distanceCompliant
                          ? 'Masofa normaga mos'
                          : 'Masofa normadan uzoq'
                      }
                      variant="soft"
                    >
                      <Chip.Label className="text-[9.5px]">
                        {r.distanceCompliant ? 'Mos' : 'Mos emas'}
                      </Chip.Label>
                    </Chip>
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
