/**
 * Vaqt qatori — ko'p seriyali chiziqli diagramma.
 *
 * Mark spetsifikatsiyasi (bir marta, `nivoTheme` bilan birga):
 *   • chiziq 2px, yumaloq uchli
 *   • maydon to'ldirish 10% shaffoflik
 *   • nuqta faqat hover'da (365 nuqtada har biri ko'rinsa shovqin bo'ladi)
 *   • panjara faqat gorizontal, yupqa, TUTASH
 */
import type { TimeSeriesPoint } from '@beap/shared';
import { dateShort, energy, num, pct } from '@beap/shared';
import { ResponsiveLine } from '@nivo/line';
import { useMemo } from 'react';

import { nivoTheme, useVizTokens } from '../../lib/chart-theme.ts';
import { ChartFrame, type TableColumn } from './ChartFrame.tsx';

interface TrendLineProps {
  points: TimeSeriesPoint[];
  height?: number;
  /** Qaysi seriyalar ko'rsatilsin. */
  series?: ('kwhIn' | 'kwhSold' | 'kwhLoss' | 'lossPct')[];
  title?: string;
  subtitle?: string;
  csvName?: string;
}

const SERIES_META = {
  kwhIn: { label: 'Tarmoqqa kirgan', slot: 0 },
  kwhSold: { label: 'Sotilgan', slot: 2 },
  kwhLoss: { label: 'Yo‘qotish', slot: 1 },
  lossPct: { label: 'Yo‘qotish darajasi', slot: 1 },
} as const;

export function TrendLine({
  points, height = 260, series = ['kwhIn', 'kwhSold', 'kwhLoss'],
  title, subtitle, csvName = 'dinamika',
}: TrendLineProps) {
  const t = useVizTokens();

  const { data, colors, legend } = useMemo(() => {
    const cols: string[] = [];
    const leg: { label: string; color: string }[] = [];

    const d = series.map((key) => {
      const meta = SERIES_META[key];
      const color = t.series[meta.slot]!;
      cols.push(color);
      leg.push({ label: meta.label, color });
      return {
        id: meta.label,
        color,
        data: points.map((p) => ({ x: p.date, y: p[key] })),
      };
    });

    return { data: d, colors: cols, legend: leg };
  }, [points, series, t]);

  const isPct = series.length === 1 && series[0] === 'lossPct';

  const columns: TableColumn<TimeSeriesPoint>[] = [
    { key: 'date', label: 'Sana', render: (r) => r.date, raw: (r) => r.date },
    { key: 'in', label: 'Kirgan (kWh)', align: 'right', render: (r) => num(r.kwhIn, 0), raw: (r) => r.kwhIn },
    { key: 'sold', label: 'Sotilgan (kWh)', align: 'right', render: (r) => num(r.kwhSold, 0), raw: (r) => r.kwhSold },
    { key: 'loss', label: 'Yo‘qotish (kWh)', align: 'right', render: (r) => num(r.kwhLoss, 0), raw: (r) => r.kwhLoss },
    { key: 'pct', label: 'Yo‘qotish %', align: 'right', render: (r) => pct(r.lossPct, 2), raw: (r) => r.lossPct },
  ];

  if (points.length === 0) {
    return <div className="flex h-40 items-center justify-center text-sm text-muted">Ma’lumot yo‘q</div>;
  }

  // O'q belgilarini siyraklashtirish — 90 kunda har 10-kun.
  const tickStep = Math.max(1, Math.ceil(points.length / 9));
  const tickValues = points.filter((_, i) => i % tickStep === 0).map((p) => p.date);

  return (
    <ChartFrame
      csvName={csvName}
      height={height}
      legend={legend}
      subtitle={subtitle}
      tableColumns={columns}
      tableData={points}
      title={title}
    >
      <ResponsiveLine
        animate={false}
        axisBottom={{
          tickSize: 0,
          tickPadding: 8,
          tickValues,
          format: (v: string) => dateShort(v),
        }}
        axisLeft={{
          tickSize: 0,
          tickPadding: 8,
          tickValues: 5,
          format: (v: number) => (isPct ? `${v}%` : energy(v).value.toFixed(0)),
        }}
        axisRight={null}
        axisTop={null}
        colors={colors}
        curve="monotoneX"
        data={data}
        enableArea={series.length === 1}
        areaOpacity={0.1}
        enableGridX={false}
        enableGridY
        enablePoints={false}
        enableSlices="x"
        lineWidth={2}
        margin={{ top: 12, right: 18, bottom: 32, left: 52 }}
        pointBorderWidth={2}
        pointSize={8}
        theme={nivoTheme(t)}
        useMesh
        xScale={{ type: 'point' }}
        yScale={{ type: 'linear', min: 'auto', max: 'auto', stacked: false }}
        sliceTooltip={({ slice }) => (
          <div className="chart-tooltip">
            <p className="mb-1 font-semibold">{String(slice.points[0]?.data.x ?? '')}</p>
            {slice.points.map((p) => (
              <p key={p.id} className="flex items-center gap-2">
                <span
                  className="inline-block size-2 rounded-[2px]"
                  style={{ background: p.seriesColor }}
                />
                <span className="text-muted">{p.seriesId}:</span>
                <span className="tabular font-medium">
                  {isPct ? pct(Number(p.data.y), 2) : energy(Number(p.data.y)).text}
                </span>
              </p>
            ))}
          </div>
        )}
      />
    </ChartFrame>
  );
}
