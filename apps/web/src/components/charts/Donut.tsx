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
  /**
   * Legendani diagramma YONIDA (o'ngda) ko'rsatish — mockupdagi ko'rinish.
   * Har bir band: rangli nuqta, yorliq, qiymat va ulush.
   */
  legendSide?: boolean;
}

export function Donut({
  slices, centerValue, centerLabel, height = 220,
  csvName = 'donut', title, maxColors = 3, formatValue, legendSide = false,
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

  /** Yon legenda — rangli nuqta + yorliq + qiymat + ulush. */
  const sideLegend = legendSide ? (
    <ul className="flex min-w-0 flex-1 flex-col justify-center gap-2.5">
      {prepared.map((s) => (
        <li key={s.id} className="flex items-start gap-2">
          <span
            aria-hidden="true"
            className="mt-1 inline-block size-2 shrink-0 rounded-full"
            style={{ background: s.color }}
          />
          <div className="min-w-0">
            <p className="truncate text-[11px] leading-tight text-muted">{s.label}</p>
            <p
              className="text-[12.5px] font-semibold leading-tight"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {s.display ?? fmt(s.value)}
              {total > 0 && (
                <span className="ml-1 font-normal text-muted">
                  ({((s.value / total) * 100).toFixed(1)}%)
                </span>
              )}
            </p>
          </div>
        </li>
      ))}
    </ul>
  ) : null;

  return (
    <ChartFrame
      csvName={csvName}
      height={height}
      legend={legendSide ? undefined : prepared.map((s) => ({ label: s.label, color: s.color! }))}
      tableColumns={columns}
      tableData={prepared}
      title={title}
    >
      <div className={legendSide ? 'flex h-full items-center gap-3' : 'relative h-full'}>
        <div className={legendSide ? 'relative h-full w-[46%] shrink-0' : 'contents'}>
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
                <span className="tabular text-lg font-bold leading-none">{centerValue}</span>
              )}
              {centerLabel && (
                <span className="mt-1 max-w-[80%] text-center text-[10px] leading-tight text-muted">
                  {centerLabel}
                </span>
              )}
            </div>
          )}
        </div>
        {sideLegend}
      </div>
    </ChartFrame>
  );
}
