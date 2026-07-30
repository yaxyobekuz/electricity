/**
 * KPI kartasi.
 *
 * Dizayn: rangli yumshoq fon + o'ng yuqorida to'yingan ikona nishoni +
 * katta raqam + o'zgarish + pastda ustunli sparkline.
 *
 * Har bir kartada "i" tugmasi bor — u metrikaning MANBASINI ko'rsatadi
 * (qo'lda kiritiladimi yoki hisoblanadimi). Hokim "bu raqam qayerdan keldi?"
 * deb so'raganda javob bir bosishda.
 */
import type { KpiTile } from '@beap/shared';
import {
  energyParts, isKnownMetric, moneyParts, num, pct, periodLabel, provenanceText, type MetricKey,
} from '@beap/shared';
import { Button, Chip, Popover, cn } from '@heroui/react';
import { ArrowDown, ArrowUp, Info, Minus } from 'lucide-react';
import type { ReactNode } from 'react';

import { CountUp } from './CountUp.tsx';
import { Sparkline } from './Sparkline.tsx';

export type Tone = 'blue' | 'green' | 'orange' | 'purple' | 'pink' | 'sky' | 'amber' | 'cyan';

function fmtByUnit(value: number | null, unit: string): { value: string; unit: string } {
  if (value === null) return { value: '—', unit };
  switch (unit) {
    case 'kWh':
      return energyParts(value);
    case 'mln so‘m':
      return moneyParts(value);
    case '%':
      return { value: pct(value, 1).replace('%', ''), unit: '%' };
    default:
      return { value: num(value, 0), unit };
  }
}

const formatValue = (tile: KpiTile): { value: string; unit: string } =>
  fmtByUnit(tile.value, tile.unit);

/**
 * O'tgan oyga nisbatan o'zgarish — MUTLAQ qiymatda.
 *
 * Yolg'iz "↑ 0.2%" hech nima aytmaydi: nimadan nimaga o'zgargani ko'rinmaydi.
 * Shu sababli har bir kartada uchta narsa birga turadi: yo'nalish (o'q va
 * so'z), mutlaq o'zgarish (masalan «89 ta») va o'tgan oyning aniq qiymati.
 *
 * Foiz ko'rsatkichlari uchun o'zgarish FOIZ PUNKTIDA beriladi — 8.6% dan
 * 8.8% ga o'tish "2.3% o'sish" emas, "0.2 p.p. o'sish".
 */
function changeText(tile: KpiTile): { abs: string; word: string } | null {
  if (tile.value === null || tile.prevValue === null) return null;
  const d = tile.value - tile.prevValue;
  const word = d > 0 ? 'ko‘paydi' : d < 0 ? 'kamaydi' : 'o‘zgarmadi';
  if (d === 0) return { abs: '', word };
  const abs =
    tile.unit === '%'
      ? `${num(Math.abs(d), 2)} p.p.`
      : (() => {
          const p = fmtByUnit(Math.abs(d), tile.unit);
          return `${p.value} ${p.unit}`;
        })();
  return { abs, word };
}

const sparkCaption = (t: KpiTile): string =>
  t.spark.length < 2 ? '' : t.sparkBucket === 'day' ? `${t.spark.length} kun` : `${t.spark.length} oy`;

interface StatTileProps {
  tile: KpiTile;
  icon?: ReactNode;
  tone?: Tone;
  compact?: boolean;
}

export function StatTile({ tile, icon, tone = 'blue', compact }: StatTileProps) {
  const { value, unit } = formatValue(tile);

  const delta = tile.deltaPct;
  const isGood =
    delta === null || delta === 0
      ? null
      : tile.goodDirection === 'up'
        ? delta > 0
        : delta < 0;

  const DeltaIcon = delta === null || delta === 0 ? Minus : delta > 0 ? ArrowUp : ArrowDown;
  const provenance = isKnownMetric(tile.metric) ? provenanceText(tile.metric as MetricKey) : null;
  const change = changeText(tile);
  const prev = fmtByUnit(tile.prevValue, tile.unit);
  const prevText = tile.prevValue === null ? '—' : `${prev.value} ${prev.unit}`;
  const caption = sparkCaption(tile);

  return (
    <article className={cn('kpi group', `tone-${tone}`, compact && 'gap-2 p-3')}>
      <header className="flex items-start justify-between gap-2">
        <h3 className="kpi__label pr-1">{tile.labelUz}</h3>

        <div className="flex shrink-0 items-center gap-1">
          {provenance && (
            <Popover>
              <Button
                isIconOnly
                aria-label="Ma’lumot manbasi"
                className="size-6 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                size="sm"
                variant="ghost"
              >
                <Info className="size-3.5" />
              </Button>
              <Popover.Content className="max-w-72">
                <Popover.Dialog>
                  <Popover.Heading className="text-xs font-semibold">
                    {tile.labelUz}
                  </Popover.Heading>
                  <p className="mt-1 text-xs leading-relaxed text-muted">{provenance}</p>
                </Popover.Dialog>
              </Popover.Content>
            </Popover>
          )}
          {icon && <span className="kpi__badge">{icon}</span>}
        </div>
      </header>

      <div className="flex items-end gap-1.5">
        {/* Raqam 0 dan joriy qiymatga sanalib chiqadi */}
        <CountUp
          className={cn('kpi__value', compact && 'text-xl')}
          format={(v) => fmtByUnit(v, tile.unit).value}
          value={tile.value}
        />
        <span className="kpi__unit">{unit}</span>
      </div>

      {/* Yo'nalish + mutlaq o'zgarish + foiz — uchalasi birga */}
      <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
        <span
          className="inline-flex items-center gap-0.5 text-[11.5px] font-semibold"
          style={{
            color:
              isGood === null
                ? 'var(--viz-muted)'
                : isGood
                  ? 'var(--viz-delta-good)'
                  : 'var(--viz-delta-bad)',
          }}
        >
          <DeltaIcon aria-hidden="true" className="size-3.5" />
          {change && change.abs ? change.abs : delta === null ? '—' : `${Math.abs(delta).toFixed(1)}%`}
        </span>
        <span className="text-[10.5px] leading-tight text-muted">
          {change ? change.word : 'o‘tgan oyga nisbatan'}
          {change && change.abs && delta !== null && ` (${Math.abs(delta).toFixed(1)}%)`}
        </span>
      </div>

      {/* O'tgan oyning ANIQ qiymati — raqam o'z-o'zini izohlaydi */}
      <p className="truncate text-[10px] leading-tight text-muted">
        {periodLabel(tile.prevPeriod)}: <span className="font-medium">{prevText}</span>
      </p>

      {/*
        Sparkline SHARTSIZ chiziladi va `mt-auto` bilan pastga bosiladi.
        Ilgari u `spark.length > 1` sharti ostida edi va ma'lumoti yo'q
        kartalarning pasti bo'sh qolib, qator notekis ko'rinardi.
      */}
      <div className="mt-auto flex items-end gap-1.5">
        <Sparkline className="min-w-0 flex-1" height={28} values={tile.spark} variant="bars" width={150} />
        {caption && (
          <span className="shrink-0 text-[9px] leading-none text-muted">{caption}</span>
        )}
      </div>
    </article>
  );
}

/**
 * Kichik ko'rsatkich kartasi.
 *
 * Tuzilishi: yuqorida yorliq + rangli ikona, o'rtada katta qiymat, pastda
 * solishtirish qiymati (chapda) va o'zgarish (o'ngda).
 */
export function MiniStat({
  label, value, unit, hint, icon, tone = 'accent', delta, deltaGood, compact, className,
}: {
  label: string;
  value: string;
  unit?: string;
  /** Solishtirish qiymati, masalan «Kecha: 37 ta». */
  hint?: string;
  icon?: ReactNode;
  tone?: 'accent' | 'good' | 'warning' | 'critical';
  /** O'zgarish matni, masalan «1 ta» yoki «2.3%». */
  delta?: string;
  /** O'zgarish ijobiymi — rangni shu belgilaydi. */
  deltaGood?: boolean | null;
  /**
   * Tor ustunda vertikal joylashganda — kichikroq ikona va raqam,
   * ixchamroq chetlash.
   */
  compact?: boolean;
  className?: string;
}) {
  const toneColor =
    tone === 'good' ? 'var(--viz-good)'
      : tone === 'warning' ? 'var(--viz-warning)'
        : tone === 'critical' ? 'var(--viz-critical)'
          : 'var(--accent)';

  const DeltaIcon =
    deltaGood === null || deltaGood === undefined ? Minus : deltaGood ? ArrowUp : ArrowDown;

  return (
    <div
      className={cn(
        'panel panel--row',
        compact ? 'gap-2.5 px-3 py-2.5' : 'gap-3 px-3.5 py-3',
        className,
      )}
    >
      {icon && (
        <span
          className={cn(
            'flex shrink-0 items-center justify-center rounded-lg',
            compact ? 'size-8' : 'size-9',
          )}
          style={{
            background: `color-mix(in oklab, ${toneColor} 12%, transparent)`,
            color: toneColor,
          }}
        >
          {icon}
        </span>
      )}

      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'truncate font-medium leading-tight text-muted',
            compact ? 'text-[10px]' : 'text-[10.5px]',
          )}
          title={label}
        >
          {label}
        </p>

        <p
          className={cn(
            'mt-0.5 truncate font-bold leading-none',
            compact ? 'text-[16px]' : 'text-[19px]',
          )}
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {value}
          {unit && <span className="ml-1 text-[10px] font-medium text-muted">{unit}</span>}
        </p>

        {(hint || delta) && (
          <p className="mt-0.5 flex items-center gap-2">
            <span
              className="min-w-0 flex-1 truncate text-[10px] text-muted"
              title={hint ?? ''}
            >
              {hint ?? ''}
            </span>
            {delta && (
              <span
                className="inline-flex shrink-0 items-center gap-0.5 text-[10px] font-semibold"
                style={{
                  color:
                    deltaGood === null || deltaGood === undefined
                      ? 'var(--viz-muted)'
                      : deltaGood
                        ? 'var(--viz-delta-good)'
                        : 'var(--viz-delta-bad)',
                }}
              >
                <DeltaIcon aria-hidden="true" className="size-3" />
                {delta}
              </span>
            )}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Tezkor ko'rsatkich — 2×2 to'r ichidagi ixcham element.
 * Panel EMAS, panel ICHIDA ishlatiladi.
 */
export function QuickMetric({
  label, value, icon, tone = 'accent',
}: {
  label: string;
  value: string;
  icon?: ReactNode;
  tone?: 'accent' | 'good' | 'warning' | 'critical';
}) {
  const toneColor =
    tone === 'good' ? 'var(--viz-good)'
      : tone === 'warning' ? 'var(--viz-warning)'
        : tone === 'critical' ? 'var(--viz-critical)'
          : 'var(--accent)';

  return (
    <div className="flex items-start gap-2.5">
      {icon && (
        <span
          className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg"
          style={{
            background: `color-mix(in oklab, ${toneColor} 12%, transparent)`,
            color: toneColor,
          }}
        >
          {icon}
        </span>
      )}
      <div className="min-w-0">
        {/*
          `truncate` — tor panelda "Maks. yuklama" ikki qatorga bo'linib,
          yonidagi katakdan balandroq bo'lib qolardi. To'liq matn `title`
          atributida qoladi.
        */}
        <p className="truncate text-[10.5px] leading-tight text-muted" title={label}>
          {label}
        </p>
        <p
          className="truncate text-[13px] font-bold leading-tight"
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {value}
        </p>
      </div>
    </div>
  );
}

/** Status chipi — DOIM ikona + matn (rang yolg'iz ishlatilmaydi). */
export function StatusChip({
  status, label, size = 'sm',
}: {
  status: 'good' | 'warning' | 'serious' | 'critical';
  label: string;
  size?: 'sm' | 'md';
}) {
  const color = status === 'good' ? 'success' : status === 'warning' ? 'warning' : 'danger';

  return (
    <Chip color={color} size={size} variant="soft">
      <span aria-hidden="true" className={`dot dot--${status}`} />
      <Chip.Label>{label}</Chip.Label>
    </Chip>
  );
}
