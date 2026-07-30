/**
 * Diagramma temasi — CSS o'zgaruvchilaridan quriladi.
 *
 * Nivo ham, ECharts ham AYNAN shu manbadan rang oladi, shuning uchun tema
 * almashganda ikkalasi ham birga o'zgaradi. Rang qiymatlari hech qayerda
 * takrorlanmaydi — faqat `theme-gov.css` da.
 */
import { useSyncExternalStore } from 'react';

export interface VizTokens {
  surface: string;
  ink: string;
  ink2: string;
  muted: string;
  grid: string;
  axis: string;
  /** 8 ta kategorik slot. */
  series: string[];
  /** 5 pog'onali ko'k ketma-ketlik. */
  seq: string[];
  /** [manfiy, markaz, musbat] */
  diverging: [string, string, string];
  status: { good: string; warning: string; serious: string; critical: string };
  delta: { good: string; bad: string };
}

/**
 * Diagrammalar uchun shrift stek.
 *
 * DIQQAT: Nivo SVG ga render qiladi va `inherit` ni tushunadi, lekin ECharts
 * CANVAS ga chizadi — u CSS shriftini MEROS QILIB OLMAYDI va `inherit` ni
 * qabul qilmaydi. Shu sababli aniq stek kerak, aks holda gauge'dagi katta
 * raqam boshqa shriftda chiqadi.
 */
export const CHART_FONT =
  '"Inter Variable", "Inter", "Segoe UI", system-ui, -apple-system, Arial, sans-serif';

function read(el: HTMLElement, name: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim();
}

export function readVizTokens(el: HTMLElement = document.documentElement): VizTokens {
  const v = (n: string): string => read(el, n);
  return {
    surface: v('--viz-surface') || '#ffffff',
    ink: v('--viz-ink') || '#000000',
    ink2: v('--viz-ink-2') || '#52514e',
    muted: v('--viz-muted') || '#898781',
    grid: v('--viz-grid') || '#e1e0d9',
    axis: v('--viz-axis') || '#c3c2b7',
    series: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => v(`--viz-${i}`)),
    seq: [1, 2, 3, 4, 5].map((i) => v(`--viz-seq-${i}`)),
    diverging: [v('--viz-div-neg'), v('--viz-div-mid'), v('--viz-div-pos')],
    status: {
      good: v('--viz-good'),
      warning: v('--viz-warning'),
      serious: v('--viz-serious'),
      critical: v('--viz-critical'),
    },
    delta: { good: v('--viz-delta-good'), bad: v('--viz-delta-bad') },
  };
}

// ─── Tema o'zgarishini kuzatish ─────────────────────────────────────────────

let cachedSnapshot = '';
const listeners = new Set<() => void>();
let observer: MutationObserver | null = null;

function currentKey(): string {
  const root = document.documentElement;
  return `${root.getAttribute('data-theme') ?? ''}|${root.className}`;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  if (!observer) {
    cachedSnapshot = currentKey();
    observer = new MutationObserver(() => {
      const next = currentKey();
      if (next !== cachedSnapshot) {
        cachedSnapshot = next;
        for (const l of listeners) l();
      }
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'class'],
    });
  }
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0) {
      observer?.disconnect();
      observer = null;
    }
  };
}

const getSnapshot = (): string => cachedSnapshot || currentKey();

let tokenCache: { key: string; tokens: VizTokens } | null = null;

/** Joriy temaning diagramma tokenlarini qaytaradi va tema o'zgarsa yangilanadi. */
export function useVizTokens(): VizTokens {
  const key = useSyncExternalStore(subscribe, getSnapshot, () => 'ssr');
  if (!tokenCache || tokenCache.key !== key) {
    tokenCache = { key, tokens: readVizTokens() };
  }
  return tokenCache.tokens;
}

// ─── Nivo temasi ────────────────────────────────────────────────────────────

/**
 * Mark spetsifikatsiyasi bir marta shu yerda belgilanadi.
 * Har bir diagramma o'zi qaytadan hal qilmaydi.
 */
export function nivoTheme(t: VizTokens) {
  return {
    background: 'transparent',
    text: { fontSize: 11, fill: t.ink2, fontFamily: CHART_FONT },
    axis: {
      domain: { line: { stroke: t.axis, strokeWidth: 1 } },
      ticks: {
        line: { stroke: t.axis, strokeWidth: 1 },
        text: { fontSize: 11, fill: t.muted },
      },
      legend: { text: { fontSize: 11, fill: t.ink2, fontWeight: 500 } },
    },
    grid: {
      // Panjara chizig'i doim yupqa va TUTASH — hech qachon punktir.
      line: { stroke: t.grid, strokeWidth: 1 },
    },
    legends: {
      text: { fontSize: 11, fill: t.ink2 },
      ticks: { text: { fontSize: 10, fill: t.muted } },
    },
    labels: { text: { fontSize: 11, fill: t.ink, fontWeight: 500 } },
    tooltip: {
      /*
       * Nivo konteyneri FAQAT pozitsiyalash uchun — ko'rinishni
       * `.chart-tooltip` sinfi beradi. Aks holda ikki qavat quti hosil
       * bo'ladi va ichkidagi matn tor ustunga siqiladi.
       */
      container: {
        background: 'transparent',
        padding: 0,
        boxShadow: 'none',
        borderRadius: 0,
        color: t.ink,
      },
      basic: { whiteSpace: 'nowrap' },
    },
    crosshair: { line: { stroke: t.muted, strokeWidth: 1, strokeOpacity: 0.6 } },
    annotations: {
      text: { fill: t.ink, fontSize: 11 },
      link: { stroke: t.muted, strokeWidth: 1 },
      outline: { stroke: t.muted, strokeWidth: 1 },
    },
  };
}

// ─── ECharts temasi (gauge uchun) ───────────────────────────────────────────

export function echartsTheme(t: VizTokens): Record<string, unknown> {
  return {
    backgroundColor: 'transparent',
    textStyle: { color: t.ink2, fontFamily: CHART_FONT },
    color: t.series,
    tooltip: {
      backgroundColor: t.surface,
      borderColor: t.grid,
      textStyle: { color: t.ink, fontSize: 12 },
    },
  };
}

// ─── Status → rang ──────────────────────────────────────────────────────────

export type StatusKey = 'good' | 'warning' | 'serious' | 'critical';

export function statusColor(t: VizTokens, status: StatusKey): string {
  return t.status[status];
}

/**
 * Diverging rang: `value` normadan farq (p.p.).
 * Manfiy = normadan yaxshi (ko'k), musbat = yomon (qizil).
 */
export function divergingColor(t: VizTokens, value: number, maxAbs: number): string {
  const clamped = Math.max(-1, Math.min(1, value / (maxAbs || 1)));
  const [neg, mid, pos] = t.diverging;
  const target = clamped < 0 ? neg : pos;
  const ratio = Math.abs(clamped);
  return mixHex(mid, target, ratio);
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = Number.parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mixHex(a: string, b: string, ratio: number): string {
  if (!a.startsWith('#') || !b.startsWith('#')) return b;
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  const m = (x: number, y: number): number => Math.round(x + (y - x) * ratio);
  const hex = (n: number): string => n.toString(16).padStart(2, '0');
  return `#${hex(m(r1, r2))}${hex(m(g1, g2))}${hex(m(b1, b2))}`;
}
