/**
 * Diagramma rasmlari (PNG) — AI yordamchi va Telegram bot uchun.
 *
 * NEGA BU FAYL: chatda raqamlar ro'yxati ba'zan yetarli emas — hokim "grafik
 * ko'rsat" desa, unga rasm kerak, jadval emas. Fayl `@napi-rs/canvas` bilan
 * QO'LDA chizadi (chart.js yoki shunga o'xshash kutubxona YO'Q): bu loyiha
 * hisoblash mumkin bo'lgan narsani og'ir tashqi paketga topshirmaydi — xuddi
 * `analytics.ts` chiziqli regressiyani o'zi hisoblagani kabi.
 *
 * Bu fayl `db/queries/dashboard.ts` va `analytics.ts` dagi MAVJUD
 * funksiyalarni chaqiradi, yangi SQL yozmaydi. Rasm DOIM oq fonda: natija
 * Telegram fotosuratiga va chat pufakchasiga tushadi, ilovaning qorong'i
 * mavzusi bunga aloqasi yo'q.
 */
import { createCanvas } from '@napi-rs/canvas';
import type { Canvas, SKRSContext2D } from '@napi-rs/canvas';

import type { AppContext } from '../db/pool.ts';
import * as q from '../db/queries/dashboard.ts';
import * as analytics from './analytics.ts';

// ═══════════════════════════════════════════════════════════════════════════
// Umumiy sozlamalar
// ═══════════════════════════════════════════════════════════════════════════

const WIDTH = 960;
const HEIGHT = 540;

/** Chapda o'qlar uchun, pastda X yorliqlari uchun, tepada sarlavha uchun joy. */
const MARGIN = { left: 70, right: 30, top: 50, bottom: 60 };
const PLOT_X = MARGIN.left;
const PLOT_Y = MARGIN.top;
const PLOT_W = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_H = HEIGHT - MARGIN.top - MARGIN.bottom;

/** Barcha 4 diagramma bir xil kichik palitradan foydalanadi — vizual izchillik uchun. */
const COLORS = {
  primary: '#2563eb',
  green: '#16a34a',
  danger: '#dc2626',
  amber: '#f59e0b',
  gray: '#64748b',
  grid: '#e2e8f0',
  ink: '#0f172a',
  bg: '#ffffff',
};

/** 1048000 → "1 048 000". `ai.ts` dagi `n()` bilan bir xil — chat va rasm bir xil raqam ko'rsatishi kerak. */
function n(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return v.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).replace(/,/g, ' ');
}

/** "2026-07-23" → "23.07" — X o'qida joy tejash uchun qisqa Uzbek sana ko'rinishi. */
function formatDayLabel(dateStr: string): string {
  const [, mm, dd] = dateStr.split('-');
  return `${dd}.${mm}`;
}

/** "2026-07" → "07.26". */
function formatMonthLabel(period: string): string {
  const [yyyy, mm] = period.split('-');
  return `${mm}.${(yyyy ?? '').slice(2)}`;
}

function newCanvas(): { canvas: Canvas; ctx: SKRSContext2D } {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  return { canvas, ctx };
}

function drawTitle(ctx: SKRSContext2D, title: string): void {
  ctx.fillStyle = COLORS.ink;
  ctx.font = 'bold 20px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(title, WIDTH / 2, 18);
}

/**
 * Sarlavhani chizadi va, agar ma'lumot bo'lmasa, markazga izoh yozib
 * `true` qaytaradi — chaqiruvchi shu holda qolgan chizishni o'tkazib
 * yuboradi. Xato TASHLAMAYDI: bo'sh grafik ham to'g'ri PNG bo'lib qoladi.
 */
function tryDrawEmpty(ctx: SKRSContext2D, title: string, isEmpty: boolean, message?: string): boolean {
  drawTitle(ctx, title);
  if (!isEmpty) return false;
  ctx.fillStyle = COLORS.gray;
  ctx.font = '16px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(message ?? 'Hozircha ma\'lumot yo\'q', WIDTH / 2, PLOT_Y + PLOT_H / 2);
  return true;
}

/** "Chiroyli" (yumaloq) qadam — 1/2/5 × 10^n ko'rinishidagi qiymat. */
function niceNum(range: number, round: boolean): number {
  const exponent = Math.floor(Math.log10(range || 1));
  const fraction = range / 10 ** exponent;
  let niceFraction: number;
  if (round) {
    if (fraction < 1.5) niceFraction = 1;
    else if (fraction < 3) niceFraction = 2;
    else if (fraction < 7) niceFraction = 5;
    else niceFraction = 10;
  } else if (fraction <= 1) niceFraction = 1;
  else if (fraction <= 2) niceFraction = 2;
  else if (fraction <= 5) niceFraction = 5;
  else niceFraction = 10;
  return niceFraction * 10 ** exponent;
}

/** Y o'qi uchun bir nechta "chiroyli" nishonlar (min..max oralig'ini qamrab oladi). */
function niceTicks(min: number, max: number, tickCount = 5): number[] {
  let lo = min;
  let hi = max;
  if (lo === hi) { lo -= 1; hi += 1; }
  const range = niceNum(hi - lo, false);
  const spacing = niceNum(range / (tickCount - 1), true) || 1;
  const niceMin = Math.floor(lo / spacing) * spacing;
  const niceMax = Math.ceil(hi / spacing) * spacing;
  const ticks: number[] = [];
  for (let v = niceMin; v <= niceMax + spacing / 1e6; v += spacing) {
    ticks.push(Number(v.toFixed(6)));
  }
  return ticks;
}

// ═══════════════════════════════════════════════════════════════════════════
// (a) Chiziqli grafik — bir yoki bir nechta seriya
// ═══════════════════════════════════════════════════════════════════════════

interface LineSeries {
  labelUz: string;
  color: string;
  values: number[];
  /**
   * Shu indeksdan boshlangan segmentlar (va nuqtalar) ikkinchi uslubda
   * chiziladi — masalan yo'qotish prognozida "tarix" va "prognoz"ni
   * ajratish uchun. Berilmasa butun chiziq bir xil uslubda.
   */
  splitIndex?: number;
  /** `splitIndex`dan keyingi qism uchun rang (masalan pastelroq amber). */
  secondaryColor?: string;
}

interface LineChartConfig {
  title: string;
  categories: string[];
  series: LineSeries[];
  /** Y o'qi qiymatlariga qo'shiladigan belgi, masalan "%". Standart — yo'q (kWh raqamlar `n()` bilan). */
  valueSuffix?: string;
  /** X o'qida bir vaqtda ko'rsatiladigan yorliqlarning taxminiy chegarasi. */
  maxXLabels?: number;
  emptyMessage?: string;
}

function formatTickValue(v: number, suffix?: string): string {
  if (suffix === '%') return `${v.toFixed(v % 1 === 0 ? 0 : 1)}%`;
  return `${n(v)}${suffix ?? ''}`;
}

function drawLineChart(ctx: SKRSContext2D, cfg: LineChartConfig): void {
  const allValues = cfg.series.flatMap((s) => s.values).filter((v) => Number.isFinite(v));
  const isEmpty = allValues.length === 0 || cfg.categories.length === 0;
  if (tryDrawEmpty(ctx, cfg.title, isEmpty, cfg.emptyMessage)) return;

  const minV = Math.min(0, ...allValues);
  const maxV = Math.max(...allValues);
  const ticks = niceTicks(minV, maxV, 5);
  const tickMin = ticks[0]!;
  const tickMax = ticks[ticks.length - 1]!;
  const span = tickMax - tickMin || 1;

  const n1 = Math.max(1, cfg.categories.length - 1);
  const xForIndex = (i: number): number =>
    cfg.categories.length === 1 ? PLOT_X + PLOT_W / 2 : PLOT_X + (i / n1) * PLOT_W;
  const yForValue = (v: number): number => PLOT_Y + PLOT_H - ((v - tickMin) / span) * PLOT_H;

  // Gorizontal panjaralar + Y yorliqlari.
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const t of ticks) {
    const y = yForValue(t);
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PLOT_X, y);
    ctx.lineTo(PLOT_X + PLOT_W, y);
    ctx.stroke();
    ctx.fillStyle = COLORS.gray;
    ctx.fillText(formatTickValue(t, cfg.valueSuffix), PLOT_X - 10, y);
  }

  // O'q chiziqlari.
  ctx.strokeStyle = COLORS.gray;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PLOT_X, PLOT_Y);
  ctx.lineTo(PLOT_X, PLOT_Y + PLOT_H);
  ctx.lineTo(PLOT_X + PLOT_W, PLOT_Y + PLOT_H);
  ctx.stroke();

  /*
   * X yorliqlari SEYRAKLASHTIRILADI: kunlik 60 nuqtali seriyada har bir
   * kunni yozish yorliqlarni bir-birining ustiga chiqarib, o'qib
   * bo'lmaydigan qilib qo'yardi. Chiziqning o'zi esa BARCHA nuqtalardan
   * o'tadi — faqat yorliq tashlab ketiladi.
   */
  const maxLabels = cfg.maxXLabels ?? 12;
  const step = Math.max(1, Math.ceil(cfg.categories.length / maxLabels));
  ctx.fillStyle = COLORS.gray;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const lastIdx = cfg.categories.length - 1;
  cfg.categories.forEach((label, i) => {
    if (i % step !== 0 && i !== lastIdx) return;
    ctx.fillText(label, xForIndex(i), PLOT_Y + PLOT_H + 10);
  });

  // Seriyalar: chiziqlar + nuqta belgilar.
  for (const s of cfg.series) {
    for (let i = 1; i < s.values.length; i += 1) {
      const dashed = s.splitIndex !== undefined && i >= s.splitIndex;
      ctx.strokeStyle = dashed ? (s.secondaryColor ?? s.color) : s.color;
      ctx.lineWidth = 2.5;
      ctx.setLineDash(dashed ? [7, 5] : []);
      ctx.beginPath();
      ctx.moveTo(xForIndex(i - 1), yForValue(s.values[i - 1]!));
      ctx.lineTo(xForIndex(i), yForValue(s.values[i]!));
      ctx.stroke();
    }
    ctx.setLineDash([]);
    s.values.forEach((v, i) => {
      const secondary = s.splitIndex !== undefined && i >= s.splitIndex;
      ctx.fillStyle = secondary ? (s.secondaryColor ?? s.color) : s.color;
      ctx.beginPath();
      ctx.arc(xForIndex(i), yForValue(v), 3, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  // Afsona — faqat bir nechta seriya bo'lsa (bitta seriyali grafikda ortiqcha).
  if (cfg.series.length > 1) {
    ctx.font = '12px sans-serif';
    const widths = cfg.series.map((s) => 24 + ctx.measureText(s.labelUz).width + 24);
    const totalW = widths.reduce((a, b) => a + b, 0) - 24;
    let cx = PLOT_X + PLOT_W - totalW;
    const ly = 34;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    cfg.series.forEach((s, i) => {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 3;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(cx, ly);
      ctx.lineTo(cx + 18, ly);
      ctx.stroke();
      ctx.fillStyle = COLORS.ink;
      ctx.fillText(s.labelUz, cx + 24, ly);
      cx += widths[i]!;
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// (b) Gorizontal ustunli diagramma
// ═══════════════════════════════════════════════════════════════════════════

interface BarItem { label: string; value: number }

interface BarChartConfig {
  title: string;
  items: BarItem[];
  color: string;
  valueFormatter?: (v: number) => string;
  emptyMessage?: string;
}

function drawHorizontalBarChart(ctx: SKRSContext2D, cfg: BarChartConfig): void {
  if (tryDrawEmpty(ctx, cfg.title, cfg.items.length === 0, cfg.emptyMessage)) return;

  const maxV = Math.max(...cfg.items.map((i) => i.value), 1);
  const gap = 12;
  const count = cfg.items.length;
  const barH = Math.min(34, (PLOT_H - gap * Math.max(0, count - 1)) / count);
  const totalH = barH * count + gap * Math.max(0, count - 1);
  const startY = PLOT_Y + Math.max(0, (PLOT_H - totalH) / 2);
  // Ustun uzunligi uchun joy — o'ngda qiymat yozuviga joy qoldiriladi.
  const barAreaW = PLOT_W - 90;

  const fmt = cfg.valueFormatter ?? ((v: number) => n(v));

  cfg.items.forEach((item, i) => {
    const y = startY + i * (barH + gap);
    const w = Math.max(1, (item.value / maxV) * barAreaW);

    ctx.fillStyle = COLORS.ink;
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(item.label, PLOT_X - 10, y + barH / 2);

    ctx.fillStyle = cfg.color;
    ctx.fillRect(PLOT_X, y, w, barH);

    ctx.fillStyle = COLORS.ink;
    ctx.textAlign = 'left';
    ctx.fillText(fmt(item.value), PLOT_X + w + 8, y + barH / 2);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// (c) Donut diagramma
// ═══════════════════════════════════════════════════════════════════════════

interface DonutSlice { label: string; value: number; color: string }

interface DonutChartConfig {
  title: string;
  slices: DonutSlice[];
  emptyMessage?: string;
}

function drawDonutChart(ctx: SKRSContext2D, cfg: DonutChartConfig): void {
  const total = cfg.slices.reduce((s, x) => s + Math.max(0, x.value), 0);
  if (tryDrawEmpty(ctx, cfg.title, total <= 0, cfg.emptyMessage)) return;

  const cx = PLOT_X + PLOT_W * 0.26;
  const cy = PLOT_Y + PLOT_H / 2;
  const outerR = Math.min(PLOT_H, PLOT_W * 0.5) * 0.4;
  const innerR = outerR * 0.55;

  /*
   * Ulush FOIZDA yoziladi, lekin matn tilim ICHIGA emas — ingichka
   * tilimlarda matn o'qilmay qoladi. Buning o'rniga rangli kvadrat +
   * yorliq afsonada, tilimning yonida turadi.
   */
  let angle = -Math.PI / 2;
  for (const slice of cfg.slices) {
    const frac = Math.max(0, slice.value) / total;
    const sweep = frac * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, outerR, angle, angle + sweep);
    ctx.closePath();
    ctx.fillStyle = slice.color;
    ctx.fill();
    angle += sweep;
  }

  ctx.beginPath();
  ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
  ctx.fillStyle = COLORS.bg;
  ctx.fill();

  const legendX = cx + outerR + 40;
  const rowH = 28;
  let legendY = cy - (cfg.slices.length * rowH) / 2 + rowH / 2;
  ctx.font = '13px sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  for (const slice of cfg.slices) {
    const pct = (Math.max(0, slice.value) / total) * 100;
    ctx.fillStyle = slice.color;
    ctx.fillRect(legendX, legendY - 7, 14, 14);
    ctx.fillStyle = COLORS.ink;
    ctx.fillText(`${slice.label} — ${pct.toFixed(1)}%`, legendX + 22, legendY);
    legendY += rowH;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Hisobotga xos grafik quruvchilar
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Energiya balansi dinamikasi — oxirgi 60 kun (kirgan / sotilgan).
 *
 * DIQQAT: `period` bu yerda SO'ROV uchun ishlatilmaydi — grafik doim
 * mavjud eng so'nggi kunlarni ko'rsatadi, tanlangan oyga bog'lanib
 * qolmaydi. Parametr faqat `renderChart` dispatcheridagi bir xil chaqiruv
 * shakli uchun saqlanadi.
 */
export async function buildEnergyTrendChart(
  ctx: AppContext, feederId: number | null, _period: string,
): Promise<Buffer> {
  const { canvas, ctx: c } = newCanvas();
  const title = 'Energiya balansi dinamikasi';

  const range = await q.dataRange(ctx);
  if (!range.maxDate) {
    drawLineChart(c, { title, categories: [], series: [] });
    return canvas.toBuffer('image/png');
  }

  const to = range.maxDate;
  const from60 = new Date(`${to}T00:00:00Z`);
  from60.setUTCDate(from60.getUTCDate() - 59);
  const minDate = range.minDate ? new Date(`${range.minDate}T00:00:00Z`) : from60;
  const from = (from60.getTime() > minDate.getTime() ? from60 : minDate).toISOString().slice(0, 10);

  const rows = (await q.timeSeries(ctx, from, to, 'day', feederId)).slice(-60);

  drawLineChart(c, {
    title,
    categories: rows.map((r) => formatDayLabel(r.date)),
    series: [
      { labelUz: 'Kirgan energiya', color: COLORS.primary, values: rows.map((r) => r.kwhIn) },
      { labelUz: 'Sotilgan', color: COLORS.green, values: rows.map((r) => r.kwhSold) },
    ],
  });
  return canvas.toBuffer('image/png');
}

const TP_RANKING_TITLES: Record<string, string> = {
  kwh: 'TP lar — eng ko‘p iste’mol',
  disconnected: 'TP lar — eng ko‘p uzilgan abonent',
  off_share: 'TP lar — uzilganlar ulushi eng yuqori',
  consumers: 'TP lar — eng ko‘p abonent',
};

/** TP larni saralab, top N tasini gorizontal ustunlarda ko'rsatadi. */
export async function buildTpRankingChart(
  ctx: AppContext, feederId: number | null, period: string, sortBy: string, limit: number,
): Promise<Buffer> {
  const { canvas, ctx: c } = newCanvas();
  const title = TP_RANKING_TITLES[sortBy] ?? TP_RANKING_TITLES['kwh']!;
  const clampedLimit = Math.min(Math.max(Math.round(limit) || 10, 1), 20);

  const rows = await q.tpMonthly(ctx, period, feederId);

  /*
   * SARALASH — `ai-tools.ts` dagi `list_tps` bilan AYNAN bir xil mantiq.
   * Diagramma modelning matnda aytgan reytingi bilan bir xil tartibda
   * chiqishi kerak: aks holda "eng ko'p iste'mol qiluvchi" degan gap bilan
   * grafikdagi birinchi ustun mos kelmay qoladi.
   */
  const share = (r: (typeof rows)[number]): number =>
    r.consumersTotal > 0 ? r.consumersDisconnected / r.consumersTotal : 0;
  const sorted = [...rows].sort((a, b) => {
    if (sortBy === 'disconnected') return b.consumersDisconnected - a.consumersDisconnected;
    if (sortBy === 'off_share') return share(b) - share(a);
    if (sortBy === 'consumers') return b.consumersTotal - a.consumersTotal;
    return b.kwhMonth - a.kwhMonth;
  });

  const valueOf = (r: (typeof rows)[number]): number => {
    if (sortBy === 'disconnected') return r.consumersDisconnected;
    if (sortBy === 'off_share') return Number((share(r) * 100).toFixed(1));
    if (sortBy === 'consumers') return r.consumersTotal;
    return r.kwhMonth;
  };
  const formatValue = (v: number): string => {
    if (sortBy === 'off_share') return `${v.toFixed(1)}%`;
    if (sortBy === 'kwh') return `${n(v)} kWh`;
    return `${n(v)} ta`;
  };

  drawHorizontalBarChart(c, {
    title,
    color: COLORS.primary,
    items: sorted.slice(0, clampedLimit).map((r) => ({ label: r.code, value: valueOf(r) })),
    valueFormatter: formatValue,
  });
  return canvas.toBuffer('image/png');
}

/** Yo'qotish tuzilmasi — sotilgan / texnologik / tijoriy, donut ko'rinishida. */
export async function buildLossBreakdownChart(
  ctx: AppContext, feederId: number | null, period: string,
): Promise<Buffer> {
  const { canvas, ctx: c } = newCanvas();
  const title = 'Yo‘qotish tuzilmasi';

  /*
   * `feederMonthly` FIDER darajasidagi kirish hisoblagichiga bog'liq —
   * butun tuman bo'yicha yig'indisi yo'q (har bir fiderning boshlang'ich
   * hisoblagichi alohida). Fider tanlanmagan bo'lsa xato tashlanmaydi,
   * grafik shunchaki buni tushuntirib qo'yadi.
   */
  if (feederId === null) {
    drawDonutChart(c, {
      title, slices: [],
      emptyMessage: 'Bu diagramma faqat bitta fider tanlanganda mavjud',
    });
    return canvas.toBuffer('image/png');
  }

  const fm = await q.feederMonthly(ctx, period, feederId);
  if (!fm) {
    drawDonutChart(c, { title, slices: [], emptyMessage: `${period} uchun ma'lumot topilmadi` });
    return canvas.toBuffer('image/png');
  }

  drawDonutChart(c, {
    title,
    slices: [
      { label: 'Sotilgan', value: fm.kwhTpSum, color: COLORS.green },
      { label: 'Texnologik yo‘qotish', value: fm.kwhTechLoss, color: COLORS.amber },
      { label: 'Tijoriy yo‘qotish', value: fm.kwhCommercialLoss, color: COLORS.danger },
    ],
  });
  return canvas.toBuffer('image/png');
}

/**
 * Yo'qotish % prognozi — tarix (yaxlit chiziq) + kelasi oylar (kesik chiziq),
 * bitta uzluksiz seriya sifatida.
 */
export async function buildLossForecastChart(
  ctx: AppContext, feederId: number | null, monthsAhead: number,
): Promise<Buffer> {
  const { canvas, ctx: c } = newCanvas();
  const title = 'Yo‘qotish % prognozi';
  const clamped = Math.min(Math.max(Math.round(monthsAhead) || 3, 1), 12);

  const report = await analytics.forecastLosses(ctx, feederId, clamped);
  const categories = [
    ...report.historyMonths.map((h) => formatMonthLabel(h.period)),
    ...report.forecast.map((f) => formatMonthLabel(f.period)),
  ];
  const values = [
    ...report.historyMonths.map((h) => h.lossPct),
    ...report.forecast.map((f) => f.projectedLossPct),
  ];

  drawLineChart(c, {
    title,
    categories,
    valueSuffix: '%',
    series: [{
      labelUz: 'Yo‘qotish %',
      color: COLORS.primary,
      values,
      splitIndex: report.historyMonths.length,
      secondaryColor: COLORS.amber,
    }],
  });
  return canvas.toBuffer('image/png');
}

// ═══════════════════════════════════════════════════════════════════════════
// Dispatcher
// ═══════════════════════════════════════════════════════════════════════════

export interface RenderChartParams {
  feederId: number | null;
  period?: string;
  sortBy?: string;
  limit?: number;
  monthsAhead?: number;
}

/**
 * Diagramma turi bo'yicha tegishli quruvchini chaqiradi va PNG baytlarini
 * qaytaradi. HTTP marshrut qatlami (bu faylni chaqiruvchi) `kind`ni
 * validatsiya qilmaydi deb hisoblanmasin — bu yerda ham tekshiriladi va
 * noma'lum tur uchun aniq xato tashlanadi, u yerda 400 ga aylantiriladi.
 */
export async function renderChart(
  ctx: AppContext, kind: string, params: RenderChartParams,
): Promise<{ buffer: Buffer; filename: string }> {
  /*
   * Davr markazlashtirilgan holda hal qilinadi — TP reytingi va yo'qotish
   * tuzilmasi diagrammalariga aniq davr KERAK, model esa uni har doim ham
   * bermaydi. `ai.ts`dagi `buildSnapshot` bilan bir xil qoida: berilmasa
   * eng so'nggi to'liq davr olinadi.
   */
  const period = params.period ?? (await q.latestPeriod(ctx)) ?? new Date().toISOString().slice(0, 7);

  let buffer: Buffer;
  switch (kind) {
    case 'energy_trend':
      buffer = await buildEnergyTrendChart(ctx, params.feederId, period);
      break;
    case 'tp_ranking':
      buffer = await buildTpRankingChart(
        ctx, params.feederId, period, params.sortBy ?? 'kwh', params.limit ?? 10,
      );
      break;
    case 'loss_breakdown':
      buffer = await buildLossBreakdownChart(ctx, params.feederId, period);
      break;
    case 'loss_forecast':
      buffer = await buildLossForecastChart(ctx, params.feederId, params.monthsAhead ?? 3);
      break;
    default:
      throw new Error(`Noma'lum diagramma turi: ${kind}`);
  }

  const stamp = params.period ?? new Date().toISOString().slice(0, 10);
  return { buffer, filename: `${kind}_${stamp}.png` };
}

// ═══════════════════════════════════════════════════════════════════════════
// AI yordamchi uchun erkin chizish — `render_table` / `render_custom_chart`
// ═══════════════════════════════════════════════════════════════════════════
//
// Yuqoridagi 4 ta quruvchidan farqli o'laroq bular DB ga murojaat qilmaydi:
// model o'zi bergan (chatda hisoblangan yoki aytgan) raqamlarni sinxron
// ravishda rasmga aylantiradi — shuning uchun `async` emas va `AppContext`
// qabul qilmaydi. `ai-tools.ts` natijani darhol `buffer.toString('base64')`
// bilan ishlatadi.

/** Ko'p seriyali/ko'p tilimli chizmalarda ranglarni tartib bilan taqsimlash uchun. */
const CATEGORICAL_COLORS = [COLORS.primary, COLORS.green, COLORS.amber, COLORS.danger, COLORS.gray];

const MAX_TABLE_ROWS = 30;
const MAX_TABLE_COLS = 8;
const MAX_CUSTOM_CHART_ITEMS = 60;

/** Katakcha matni: raqamlar `n()` bilan (kWh uslubidagi bo'shliqli minglik), qolgani — matn sifatida. */
function formatTableCell(v: string | number): string {
  if (typeof v === 'number') {
    return Number.isFinite(v) ? n(v, Number.isInteger(v) ? 0 : 2) : '—';
  }
  return v === null || v === undefined ? '' : String(v);
}

/**
 * Oddiy, toza jadval: sarlavha zolotasi (rangli fon) + qatorlar (bir
 * qatordan keyin och chiziq). Ustunlar `PLOT_W` bo'ylab teng taqsimlanadi —
 * xuddi boshqa 4 diagramma bilan bir xil chegaralardan foydalanadi.
 * Qiymatlar matn bo'lsa chapga, raqam bo'lsa o'ngga tekislanadi.
 *
 * Chaqiruvchi (`ai-tools.ts`) allaqachon 8 ustun / 30 qatorgacha qisqartirib
 * beradi, lekin bu funksiya QANDAY chaqirilishidan qat'iy nazar hech qachon
 * qulamasligi kerak — shuning uchun chegaralar shu yerda ham majburlanadi.
 */
export function renderTable(title: string, columns: string[], rows: (string | number)[][]): Buffer {
  const { canvas, ctx: c } = newCanvas();

  const cols = columns.slice(0, MAX_TABLE_COLS);
  const clampedRows = rows.slice(0, MAX_TABLE_ROWS).map((r) => r.slice(0, cols.length));

  if (tryDrawEmpty(c, title, cols.length === 0 || clampedRows.length === 0, 'Ma\'lumot yo\'q')) {
    return canvas.toBuffer('image/png');
  }

  const colWidth = PLOT_W / cols.length;
  // Ustun ko'p bo'lsa matn sig'may qolmasligi uchun shrift kichrayadi.
  const fontSize = colWidth < 70 ? 10 : colWidth < 100 ? 11 : colWidth < 140 ? 12 : 13;
  const headerH = 32;
  const rowH = Math.min(28, (PLOT_H - headerH) / clampedRows.length);
  const tableH = headerH + rowH * clampedRows.length;
  const startY = PLOT_Y + Math.max(0, (PLOT_H - tableH) / 2);

  // Sarlavha zolotasi.
  c.fillStyle = COLORS.primary;
  c.fillRect(PLOT_X, startY, PLOT_W, headerH);
  c.font = `bold ${fontSize}px sans-serif`;
  c.fillStyle = '#ffffff';
  c.textAlign = 'left';
  c.textBaseline = 'middle';
  cols.forEach((col, ci) => {
    const x = PLOT_X + ci * colWidth;
    c.save();
    c.beginPath();
    c.rect(x + 2, startY, colWidth - 4, headerH);
    c.clip();
    c.fillText(col, x + 8, startY + headerH / 2);
    c.restore();
  });

  // Qatorlar — juft indekslarda och-kulrang zolota o'qishni osonlashtiradi.
  clampedRows.forEach((row, ri) => {
    const y = startY + headerH + ri * rowH;
    if (ri % 2 === 1) {
      c.globalAlpha = 0.5;
      c.fillStyle = COLORS.grid;
      c.fillRect(PLOT_X, y, PLOT_W, rowH);
      c.globalAlpha = 1;
    }
    c.font = `${fontSize}px sans-serif`;
    c.fillStyle = COLORS.ink;
    c.textBaseline = 'middle';
    row.forEach((cell, ci) => {
      const x = PLOT_X + ci * colWidth;
      const isNum = typeof cell === 'number';
      c.textAlign = isNum ? 'right' : 'left';
      const tx = isNum ? x + colWidth - 8 : x + 8;
      c.save();
      c.beginPath();
      c.rect(x + 2, y, colWidth - 4, rowH);
      c.clip();
      c.fillText(formatTableCell(cell), tx, y + rowH / 2);
      c.restore();
    });
  });

  c.strokeStyle = COLORS.grid;
  c.lineWidth = 1;
  c.strokeRect(PLOT_X, startY, PLOT_W, tableH);

  return canvas.toBuffer('image/png');
}

/**
 * Modelning erkin {label, value[, series]} ma'lumotini MAVJUD chizish
 * primitivlariga (`drawLineChart` / `drawHorizontalBarChart` /
 * `drawDonutChart`) mos shaklga keltirib, shularni chaqiradi — bu yerda
 * yangi chizish mantig'i YO'Q, faqat qayta shakllantirish.
 */
export function renderCustomChart(
  title: string,
  chartType: 'line' | 'bar' | 'donut',
  items: { series?: string; label: string; value: number }[],
): Buffer {
  const { canvas, ctx: c } = newCanvas();
  const capped = items.slice(0, MAX_CUSTOM_CHART_ITEMS);
  const emptyMessage = 'Ma\'lumot yo\'q';

  if (chartType === 'line') {
    // Seriyalarga guruhlash — dastlabki paydo bo'lish tartibi saqlanadi.
    const seriesOrder: string[] = [];
    const seriesPoints = new Map<string, { label: string; value: number }[]>();
    for (const it of capped) {
      const key = it.series ?? '__default__';
      let pts = seriesPoints.get(key);
      if (!pts) {
        pts = [];
        seriesOrder.push(key);
        seriesPoints.set(key, pts);
      }
      pts.push({ label: it.label, value: it.value });
    }

    // X o'qi kategoriyalari — eng uzun seriyaning yorliqlaridan olinadi.
    let categories: string[] = [];
    for (const key of seriesOrder) {
      const pts = seriesPoints.get(key)!;
      if (pts.length > categories.length) categories = pts.map((p) => p.label);
    }

    const series: LineSeries[] = seriesOrder.map((key, i) => ({
      labelUz: key === '__default__' ? title : key,
      color: CATEGORICAL_COLORS[i % CATEGORICAL_COLORS.length]!,
      values: seriesPoints.get(key)!.map((p) => p.value),
    }));

    drawLineChart(c, { title, categories, series, emptyMessage });
    return canvas.toBuffer('image/png');
  }

  if (chartType === 'bar') {
    drawHorizontalBarChart(c, {
      title,
      color: COLORS.primary,
      items: capped.map((it) => ({ label: it.label, value: it.value })),
      emptyMessage,
    });
    return canvas.toBuffer('image/png');
  }

  // 'donut'
  drawDonutChart(c, {
    title,
    slices: capped.map((it, i) => ({
      label: it.label,
      value: it.value,
      color: CATEGORICAL_COLORS[i % CATEGORICAL_COLORS.length]!,
    })),
    emptyMessage,
  });
  return canvas.toBuffer('image/png');
}
