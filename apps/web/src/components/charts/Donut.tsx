/**
 * Donut diagramma.
 *
 * QOIDA: 3 ta kategorik rangdan OSHMAYDI (palitra validatsiyasidan kelib
 * chiqadi — 3 slotli to'plam barcha juftliklar bo'yicha CVD ΔE ≥ 9 beradi).
 * Ko'proq bo'lsa, qolganlari "Boshqa" ga yig'iladi.
 *
 * Segmentlar orasidagi ajratish — 2px SURFACE RANGLI bo'shliq (`borderColor`),
 * hech qachon kontur (stroke) emas.
 */
import { ResponsivePie } from '@nivo/pie';
import { useMemo } from 'react';

import { useVizTokens, nivoTheme } from '../../lib/chart-theme.ts';
import { ChartFrame, type TableColumn } from './ChartFrame.tsx';

export interface DonutSlice {
  id: string;
  label: string;
  value: number;
  /** Ixtiyoriy — belgilanmasa palitradan olinadi. */
  color?: string;
  /** Formatlanган ko'rinish (tooltip va jadval uchun). */
  display?: string;
}

interface DonutProps {
  slices: DonutSlice[];
  /** Markazdagi katta raqam. */
  centerValue?: string;
  centerLabel?: string;
  height?: number;
  csvName?: string;
  title?: string;
  /** Nechta kategorik rang ishlatilsin (maks 3). */
  maxColors?: number;
  formatValue?: (v: number) => string;
}

export function Donut({
  slices, centerValue, centerLabel, height = 220,
  csvName = 'donut', title, maxColors = 3, formatValue,
}: DonutProps) {
  const t = useVizTokens();

  const prepared = useMemo(() => {
    const palette = t.series.slice(0, Math.min(maxColors, 3));
    const sorted = [...slices].filter((s) => s.value > 0);

    if (sorted.length <= palette.length) {
      return sorted.map((s, i) => ({ ...s, color: s.color ?? palette[i] ?? t.muted }));
    }

    // 3 tadan ko'p bo'lsa — qolganlarini "Boshqa" ga yig'amiz.
    const head = sorted.slice(0, palette.length - 1);
    const tail = sorted.slice(palette.length - 1);
    const rest = tail.reduce((a, s) => a + s.value, 0);

    return [
      ...head.map((s, i) => ({ ...s, color: s.color ?? palette[i] ?? t.muted })),
      { id: '__other', label: 'Boshqa', value: rest, color: t.muted },
    ];
  }, [slices, t, maxColors]);

  const total = prepared.reduce((a, s) => a + s.value, 0);
  const fmt = formatValue ?? ((v: number) => v.toLocaleString('uz-Latn-UZ'));

  const columns: TableColumn<DonutSlice>[] = [
    { key: 'label', label: 'Toifa', render: (r) => r.label, raw: (r) => r.label },
    {
      key: 'value', label: 'Qiymat', align: 'right',
      render: (r) => r.display ?? fmt(r.value), raw: (r) => r.value,
    },
    {
      key: 'pct', label: 'Ulushi', align: 'right',
      render: (r) => `${total > 0 ? ((r.value / total) * 100).toFixed(1) : '0'}%`,
      raw: (r) => (total > 0 ? Number(((r.value / total) * 100).toFixed(1)) : 0),
    },
  ];

  if (prepared.length === 0) {
    return <div className="flex h-32 items-center justify-center text-sm text-muted">Ma’lumot yo‘q</div>;
  }

  return (
    <ChartFrame
      csvName={csvName}
      height={height}
      legend={prepared.map((s) => ({ label: s.label, color: s.color! }))}
      tableColumns={columns}
      tableData={prepared}
      title={title}
    >
      <div className="relative h-full">
        <ResponsivePie
          activeOuterRadiusOffset={5}
          arcLabel={() => ''}
          borderColor={t.surface}
          /* 2px surface rangli bo'shliq — kontur EMAS */
          borderWidth={2}
          colors={{ datum: 'data.color' }}
          cornerRadius={2}
          data={prepared.map((s) => ({
            id: s.id, label: s.label, value: s.value, color: s.color,
          }))}
          enableArcLabels={false}
          enableArcLinkLabels={false}
          innerRadius={0.68}
          margin={{ top: 6, right: 6, bottom: 6, left: 6 }}
          padAngle={0.6}
          theme={nivoTheme(t)}
          tooltip={({ datum }) => (
            <div className="chart-tooltip">
              <span className="chart-tooltip__title">{datum.label}</span>
              <div className="chart-tooltip__row">
                <span className="chart-tooltip__label">Qiymat</span>
                <span className="chart-tooltip__value">
                  {prepared.find((s) => s.id === datum.id)?.display ?? fmt(datum.value)}
                </span>
              </div>
              {total > 0 && (
                <div className="chart-tooltip__row">
                  <span className="chart-tooltip__label">Ulushi</span>
                  <span className="chart-tooltip__value">
                    {((datum.value / total) * 100).toFixed(1)}%
                  </span>
                </div>
              )}
            </div>
          )}
        />
        {(centerValue || centerLabel) && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            {centerValue && (
              <span className="tabular text-xl font-semibold leading-none">{centerValue}</span>
            )}
            {centerLabel && (
              <span className="mt-1 max-w-[70%] text-center text-[10px] leading-tight text-muted">
                {centerLabel}
              </span>
            )}
          </div>
        )}
      </div>
    </ChartFrame>
  );
}
