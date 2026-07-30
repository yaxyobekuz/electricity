/**
 * Sparkline — qo'lda yozilgan inline SVG.
 *
 * Nima uchun Nivo emas: bir ekranda 8 ta KPI kartasi bor. 8 ta
 * `ResponsiveLine` = 8 ta ResizeObserver + 8 ta layout hisobi, atigi
 * 30 nuqta uchun. Bu isrof.
 *
 * Ikki ko'rinish:
 *   bars — mockupdagi asosiy variant (KPI kartalarida)
 *   line — uzluksiz kattaliklar uchun
 */
import { useId, useMemo } from 'react';
export function Sparkline({ values, color, accent, width = 120, height = 32, fill = true, className, variant = 'line', }) {
    return variant === 'bars' ? (<SparkBars className={className} color={color} height={height} values={values} width={width}/>) : (<SparkLine accent={accent} className={className} color={color} fill={fill} height={height} values={values} width={width}/>);
}
/** Ustunli variant — KPI kartalarida. Oxirgi ustunlar to'yingan rangda. */
function SparkBars({ values, color, width, height, className, }) {
    const bars = useMemo(() => {
        if (values.length === 0)
            return null;
        // Ko'rinish uchun oxirgi 24 nuqta yetarli — ustunlar juda ingichka bo'lmaydi.
        const data = values.slice(-24);
        const max = Math.max(...data);
        const min = Math.min(...data);
        const span = max - min || 1;
        const gap = 2;
        const barW = Math.max(2, (width - gap * (data.length - 1)) / data.length);
        return data.map((v, i) => {
            // Eng past ustun ham ko'rinib tursin (30% dan boshlanadi).
            const norm = 0.3 + ((v - min) / span) * 0.7;
            const h = Math.max(2, norm * height);
            return {
                x: i * (barW + gap),
                y: height - h,
                w: barW,
                h,
                // Oxirgi 4 ta ustun — to'liq to'yingan, qolganlari shaffofroq.
                opacity: i >= data.length - 4 ? 1 : 0.42,
            };
        });
    }, [values, width, height]);
    // Ma'lumot bo'lmasa ham JOY BAND QILINADI (className bilan birga) — aks
    // holda ma'lumotsiz karta qo'shnisidan past bo'lib, qator notekis chiqadi.
    if (!bars)
        return <div aria-hidden="true" className={className} style={{ height }}/>;
    const c = color ?? 'var(--tone-solid, var(--accent))';
    return (<svg aria-label="Oxirgi kunlar dinamikasi" className={className} height={height} role="img" viewBox={`0 0 ${width} ${height}`} width={width}>
      {bars.map((b, i) => (<rect key={i} fill={c} height={b.h} opacity={b.opacity} rx={1.5} width={b.w} x={b.x} y={b.y}/>))}
    </svg>);
}
/** Chiziqli variant — maydon to'ldirishi bilan. */
function SparkLine({ values, color, accent, width, height, fill, className, }) {
    const gradientId = useId();
    const geometry = useMemo(() => {
        if (values.length < 2)
            return null;
        const min = Math.min(...values);
        const max = Math.max(...values);
        const span = max - min || 1;
        const pad = 2;
        const points = values.map((v, i) => {
            const x = pad + (i / (values.length - 1)) * (width - pad * 2);
            const y = height - pad - ((v - min) / span) * (height - pad * 2);
            return [x, y];
        });
        const line = points
            .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`)
            .join(' ');
        const area = `${line} L${points.at(-1)[0].toFixed(1)},${height} L${points[0][0].toFixed(1)},${height} Z`;
        return { line, area, last: points.at(-1) };
    }, [values, width, height]);
    if (!geometry)
        return <div aria-hidden="true" className={className} style={{ height }}/>;
    const stroke = color ?? 'var(--viz-muted)';
    const dot = accent ?? color ?? 'var(--viz-1)';
    return (<svg aria-label="Oxirgi kunlar dinamikasi" className={className} height={height} preserveAspectRatio="none" role="img" viewBox={`0 0 ${width} ${height}`} width={width}>
      {fill && (<>
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity="0.25"/>
              <stop offset="100%" stopColor={stroke} stopOpacity="0"/>
            </linearGradient>
          </defs>
          <path d={geometry.area} fill={`url(#${gradientId})`}/>
        </>)}
      <path d={geometry.line} fill="none" stroke={stroke} strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}/>
      <circle cx={geometry.last[0]} cy={geometry.last[1]} fill={dot} r={2.6}/>
    </svg>);
}
