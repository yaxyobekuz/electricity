/**
 * Gauge — ECharts.
 *
 * Nivo da gauge YO'Q (`radial-bar` — radial ustun, gauge emas). Shu sababli
 * ECharts faqat ikki holat uchun ishlatiladi: gauge va juda uzun vaqt qatorlari.
 * `echarts/core` dan faqat kerakli modullar ro'yxatdan o'tkaziladi (~150 KB),
 * 1 MB lik umumiy build EMAS.
 */
import { GaugeChart } from 'echarts/charts';
import { TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { useEffect, useMemo, useRef } from 'react';
import { CHART_FONT, useVizTokens } from '../../lib/chart-theme.ts';
echarts.use([GaugeChart, TooltipComponent, CanvasRenderer]);
export function Gauge({ value, min = 0, max = 100, label, suffix = '', height = 190, bands, higherIsBetter = true, }) {
    const ref = useRef(null);
    const chartRef = useRef(null);
    const t = useVizTokens();
    const resolvedBands = useMemo(() => {
        if (bands)
            return bands;
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
            if (ratio <= limit)
                return color;
        }
        return resolvedBands.at(-1)?.[1] ?? t.series[0];
    }, [value, min, max, resolvedBands, t]);
    useEffect(() => {
        if (!ref.current)
            return;
        chartRef.current ??= echarts.init(ref.current, undefined, { renderer: 'canvas' });
        const chart = chartRef.current;
        chart.setOption({
            backgroundColor: 'transparent',
            // Canvas CSS shriftini meros qilmaydi — aniq berish SHART.
            textStyle: { fontFamily: CHART_FONT },
            series: [
                {
                    type: 'gauge',
                    startAngle: 210,
                    endAngle: -30,
                    min,
                    max,
                    radius: '96%',
                    center: ['50%', '62%'],
                    // Ignasiz "progress" ko'rinishi — o'qish osonroq.
                    pointer: { show: false },
                    progress: {
                        show: true,
                        width: 14,
                        roundCap: true,
                        itemStyle: { color: activeColor },
                    },
                    axisLine: {
                        lineStyle: {
                            width: 14,
                            color: [[1, t.grid]],
                        },
                    },
                    axisTick: { show: false },
                    splitLine: {
                        distance: -16,
                        length: 6,
                        lineStyle: { color: t.axis, width: 1 },
                    },
                    axisLabel: {
                        distance: -30,
                        color: t.muted,
                        fontSize: 10,
                        fontFamily: CHART_FONT,
                        formatter: (v) => (v === min || v === max ? String(v) : ''),
                    },
                    anchor: { show: false },
                    title: {
                        show: Boolean(label),
                        offsetCenter: [0, '38%'],
                        color: t.muted,
                        fontSize: 11,
                        fontFamily: CHART_FONT,
                    },
                    detail: {
                        valueAnimation: true,
                        offsetCenter: [0, '4%'],
                        formatter: (v) => `${Math.round(v * 10) / 10}${suffix}`,
                        color: t.ink,
                        fontSize: 30,
                        fontWeight: 600,
                        fontFamily: CHART_FONT,
                    },
                    data: [{ value, name: label ?? '' }],
                },
            ],
        }, { notMerge: true });
        return undefined;
    }, [value, min, max, label, suffix, activeColor, t]);
    // O'lcham o'zgarishini kuzatish
    useEffect(() => {
        if (!ref.current)
            return;
        const ro = new ResizeObserver(() => chartRef.current?.resize());
        ro.observe(ref.current);
        return () => ro.disconnect();
    }, []);
    // Komponent yo'q qilinganda ECharts nusxasini tozalash
    useEffect(() => () => {
        chartRef.current?.dispose();
        chartRef.current = null;
    }, []);
    return (<div ref={ref} style={{ height, width: '100%' }} role="img" aria-label={`${label ?? 'Ko‘rsatkich'}: ${value}${suffix}`}/>);
}
