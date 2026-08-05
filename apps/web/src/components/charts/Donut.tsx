/**
 * Donut diagramma.
 *
 * QOIDA: 3 ta kategorik rangdan OSHMAYDI (palitra validatsiyasidan kelib
 * chiqadi - 3 slotli to'plam barcha juftliklar bo'yicha CVD ΔE ≥ 9 beradi).
 * Ko'proq bo'lsa, qolganlari "Boshqa" ga yig'iladi.
 *
 * Segmentlar orasidagi ajratish - 2px SURFACE RANGLI bo'shliq (`borderColor`),
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
  /** Ixtiyoriy - belgilanmasa palitradan olinadi. */
  color?: string;
  /** Formatlanган ko'rinish (tooltip va jadval uchun). */
  display?: string;
  /**
   * Bu bo'lak JAMINING qismi EMAS - legendada foizsiz ko'rsatiladi va
   * halqada chizilmaydi. Oqim ko'rsatkichlari uchun (masalan «davr
   * ichida uzilgan»), ular zaxira bilan bir shkalada emas.
   */
  noShare?: boolean;
}

interface DonutProps {
  slices: DonutSlice[];
  /** Markazdagi katta raqam - BIRLIKSIZ. */
  centerValue?: string;
  /** Birlik alohida qatorda: aks holda «17.4 ming kWh» teshikka sig'maydi. */
  centerUnit?: string;
  centerLabel?: string;
  height?: number;
  csvName?: string;
  title?: string;
  /** Nechta kategorik rang ishlatilsin (maks 3). */
  maxColors?: number;
  formatValue?: (v: number) => string;
  /**
   * Legendani diagramma YONIDA (o'ngda) ko'rsatish - mockupdagi ko'rinish.
   * Har bir band: rangli nuqta, yorliq, qiymat va ulush.
   */
  legendSide?: boolean;
  /** Legenda halqadan KEYIN, pastda va kattaroq yozuv bilan. */
  legendBelow?: boolean;
}

export function Donut({
  slices, centerValue, centerUnit, centerLabel, height = 220,
  csvName = 'donut', title, maxColors = 3, formatValue, legendSide = false, legendBelow = false,
}: DonutProps) {
  const t = useVizTokens();

  /*
   * Markazdagi matn O'LCHAMI diagramma balandligidan kelib chiqadi.
   *
   * Qat'iy `text-lg` da «17.4 ming kWh» halqaning teshigidan kengroq
   * bo'lib, segmentlar ustiga chiqib ketardi. Teshik diametri -
   * `innerRadius` 0.68, ya'ni diagrammaning ~68% i.
   */
  const valueFs = Math.max(12, Math.min(20, Math.round(height * 0.115)));

  /** Halqada chizilmaydigan, faqat legendada turadigan bandlar. */
  const extras = useMemo(() => slices.filter((s) => s.noShare), [slices]);

  const prepared = useMemo(() => {
    const palette = t.series.slice(0, Math.min(maxColors, 3));
    const sorted = [...slices].filter((s) => !s.noShare && s.value > 0);

    if (sorted.length <= palette.length) {
      return sorted.map((s, i) => ({ ...s, color: s.color ?? palette[i] ?? t.muted }));
    }

    // 3 tadan ko'p bo'lsa - qolganlarini "Boshqa" ga yig'amiz.
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
      // Oqim bandlarida ulush ma'nosiz - jamining qismi emas.
      render: (r) =>
        r.noShare || total === 0 ? '-' : `${((r.value / total) * 100).toFixed(1)}%`,
      raw: (r) => (r.noShare || total === 0 ? 0 : Number(((r.value / total) * 100).toFixed(1))),
    },
  ];

  /** Jadval-egizak va CSV - legendadagi HAMMA band, oqimlar bilan birga. */
  const tableRows: DonutSlice[] = [...prepared, ...extras];

  if (prepared.length === 0) {
    return <div className="flex h-32 items-center justify-center text-sm text-muted">Ma’lumot yo‘q</div>;
  }

  /**
   * Yon legenda - rangli nuqta + yorliq, ostida qiymat va ulush.
   *
   * Halqadagi bo'laklardan keyin `noShare` bandlari qo'shiladi: ular
   * jamining qismi emas, shuning uchun foizsiz beriladi.
   */
  const legendRows = legendSide
    ? [
        ...prepared.map((s) => ({ ...s, share: true })),
        ...extras.map((s, i) => ({
          ...s,
          color: s.color ?? t.series[(prepared.length + i) % t.series.length]!,
          share: false,
        })),
      ]
    : [];

  const sideLegend = legendSide ? (
    <ul className="flex min-w-0 flex-1 flex-col justify-center gap-3">
      {legendRows.map((s) => (
        <li key={s.id} className="min-w-0">
          <p className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-block size-2.5 shrink-0 rounded-full"
              style={{ background: s.color }}
            />
            <span className="truncate text-[12px] leading-tight text-muted">{s.label}</span>
          </p>
          <p
            className="mt-1 truncate pl-4.5 text-[14px] font-bold leading-tight"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {s.display ?? fmt(s.value)}
            {s.share && total > 0 && (
              <span className="ml-1 text-[11.5px] font-medium text-muted">
                ({((s.value / total) * 100).toFixed(1)}%)
              </span>
            )}
          </p>
        </li>
      ))}
    </ul>
  ) : null;

  return (
    <ChartFrame
      csvName={csvName}
      height={height}
      legend={legendSide ? undefined : prepared.map((s) => ({ label: s.label, color: s.color! }))}
      legendPlacement={legendBelow ? 'bottom' : 'top'}
      tableColumns={columns}
      tableData={tableRows}
      title={title}
    >
      {/*
        DIQQAT: pastdagi o'ram `display: contents` BO'LMASLIGI kerak.

        Nivo `ResponsivePie` o'z ichida `height: 100%` li div chizadi va uni
        o'lchaydi. `display: contents` li ota-elementdan foizli balandlik
        ishonchli hisoblanmaydi - o'lcham 0 chiqadi va halqa umuman
        chizilmaydi. Markazdagi raqam esa `absolute inset-0` bo'lgani uchun
        ko'rinib turaveradi: natijada "raqam bor, diagramma yo'q".
      */}
      <div className={legendSide ? 'flex h-full items-center gap-3' : 'h-full'}>
        <div className={legendSide ? 'relative h-full w-[46%] shrink-0' : 'relative h-full w-full'}>
        <ResponsivePie
          activeOuterRadiusOffset={5}
          arcLabel={() => ''}
          borderColor={t.surface}
          /* 2px surface rangli bo'shliq - kontur EMAS */
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
            /*
              `px-[17%]` - mazmun halqaning TESHIGI ichida qoladi.
              `innerRadius` 0.68 bo'lgani uchun har tomondan ~16% chetlash
              kerak; usiz uzun qiymat segmentlar ustiga chiqib ketadi.
            */
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-[17%] text-center">
              {centerValue && (
                <span
                  className="tabular font-bold leading-none"
                  style={{ fontSize: valueFs }}
                >
                  {centerValue}
                </span>
              )}
              {centerUnit && (
                <span className="mt-0.5 text-[10px] font-medium leading-none text-muted">
                  {centerUnit}
                </span>
              )}
              {centerLabel && (
                <span className="mt-1 text-[9.5px] leading-tight text-muted">{centerLabel}</span>
              )}
            </div>
          )}
        </div>
        {sideLegend}
      </div>
    </ChartFrame>
  );
}
