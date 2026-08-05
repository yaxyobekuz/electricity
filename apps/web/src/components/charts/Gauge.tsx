/**
 * Gauge - ECharts.
 *
 * Nivo da gauge YO'Q (`radial-bar` - radial ustun, gauge emas). Shu sababli
 * ECharts faqat ikki holat uchun ishlatiladi: gauge va juda uzun vaqt qatorlari.
 * `echarts/core` dan faqat kerakli modullar ro'yxatdan o'tkaziladi (~150 KB),
 * 1 MB lik umumiy build EMAS.
 */
import { GaugeChart } from 'echarts/charts';
import { TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { useEffect, useMemo, useRef, useState } from 'react';

import { CHART_FONT, useVizTokens } from '../../lib/chart-theme.ts';

echarts.use([GaugeChart, TooltipComponent, CanvasRenderer]);

interface GaugeProps {
  value: number;
  min?: number;
  max?: number;
  /** Markazdagi katta matn ostidagi izoh. */
  label?: string;
  /** Foiz belgisi yoki boshqa birlik. */
  suffix?: string;
  height?: number;
  /**
   * Rang bandlari: [chegara (0..1), rang] juftliklari.
   * Berilmasa samaradorlik shkalasi ishlatiladi.
   */
  bands?: [number, string][];
  /** Qiymat kattaroq bo'lgani yaxshimi (samaradorlik) yoki yomonmi (yuklama). */
  higherIsBetter?: boolean;
}

export function Gauge({
  value, min = 0, max = 100, label, suffix = '', height = 190, bands, higherIsBetter = true,
}: GaugeProps) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const t = useVizTokens();
  const [box, setBox] = useState({ w: 0, h: 0 });

  const resolvedBands = useMemo<[number, string][]>(() => {
    if (bands) return bands;
    return higherIsBetter
      ? [
          [0.4, t.status.critical],
          [0.6, t.status.serious],
          [0.8, t.status.warning],
          [1, t.status.good],
        ]
      : [
          [0.6, t.status.good],
          [0.75, t.status.warning],
          [0.9, t.status.serious],
          [1, t.status.critical],
        ];
  }, [bands, higherIsBetter, t]);

  const activeColor = useMemo(() => {
    const ratio = (value - min) / (max - min || 1);
    for (const [limit, color] of resolvedBands) {
      if (ratio <= limit) return color;
    }
    return resolvedBands.at(-1)?.[1] ?? t.series[0]!;
  }, [value, min, max, resolvedBands, t]);

  /*
   * O'LCHAMGA BOG'LIQ TIPOGRAFIYA - bu yerda majburiy.
   *
   * ECharts gauge radiusini konteynerning KICHIK tomonidan hisoblaydi,
   * matn o'lchami esa qat'iy piksel edi. Natijada past panelda halqa
   * kichrayib, "57.9%" o'sha halqani bosib ketardi. Endi halqa qalinligi
   * ham, matn ham radiusdan kelib chiqadi.
   */
  const geom = useMemo(() => {
    const base = Math.min(box.w || height, box.h || height);
    const r = (base / 2) * 0.92;
    return {
      ring: Math.max(7, Math.round(r * 0.2)),
      detail: Math.max(13, Math.round(r * 0.4)),
      title: Math.max(9, Math.round(r * 0.15)),
      /** Yorliq faqat joy yetganda - aks holda raqamga tegib ketadi. */
      showTitle: Boolean(label) && r >= 46,
    };
  }, [box, height, label]);

  useEffect(() => {
    if (!ref.current) return;
    chartRef.current ??= echarts.init(ref.current, undefined, { renderer: 'canvas' });
    const chart = chartRef.current;

    chart.setOption(
      {
        backgroundColor: 'transparent',
        // Canvas CSS shriftini meros qilmaydi - aniq berish SHART.
        textStyle: { fontFamily: CHART_FONT },
        series: [
          {
            type: 'gauge',
            startAngle: 210,
            endAngle: -30,
            min,
            max,
            radius: '92%',
            // 240° yoy: pastda bo'shliq bor, shuning uchun markaz tepada.
            center: ['50%', '57%'],
            // Ignasiz "progress" ko'rinishi - o'qish osonroq.
            pointer: { show: false },
            progress: {
              show: true,
              width: geom.ring,
              roundCap: true,
              itemStyle: { color: activeColor },
            },
            axisLine: {
              lineStyle: {
                width: geom.ring,
                color: [[1, t.grid]],
              },
            },
            /*
             * Bo'linish chiziqlari va o'q yorliqlari O'CHIRILGAN.
             * Kichik o'lchamda ular halqa ichida uzuq-yuluq shtrixlarga
             * aylanib, "buzilgan" ko'rinish berardi. Aniq qiymat markazda
             * raqam bilan, chegaralari esa yon jadvalda ko'rsatiladi.
             */
            axisTick: { show: false },
            splitLine: { show: false },
            axisLabel: { show: false },
            anchor: { show: false },
            title: {
              show: geom.showTitle,
              offsetCenter: [0, '36%'],
              color: t.muted,
              fontSize: geom.title,
              fontFamily: CHART_FONT,
            },
            detail: {
              valueAnimation: true,
              offsetCenter: [0, geom.showTitle ? '2%' : '10%'],
              formatter: (v: number) => `${Math.round(v * 10) / 10}${suffix}`,
              color: t.ink,
              fontSize: geom.detail,
              fontWeight: 600,
              fontFamily: CHART_FONT,
            },
            data: [{ value, name: label ?? '' }],
          },
        ],
      },
      { notMerge: true },
    );

    return undefined;
  }, [value, min, max, label, suffix, activeColor, geom, t]);

  // O'lcham o'zgarishini kuzatish - tipografiya ham shundan qayta hisoblanadi.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r && r.width > 0) setBox({ w: r.width, h: r.height });
      chartRef.current?.resize();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Komponent yo'q qilinganda ECharts nusxasini tozalash
  useEffect(
    () => () => {
      chartRef.current?.dispose();
      chartRef.current = null;
    },
    [],
  );

  return (
    <div
      ref={ref}
      style={{ height, width: '100%' }}
      role="img"
      aria-label={`${label ?? 'Ko‘rsatkich'}: ${value}${suffix}`}
    />
  );
}
