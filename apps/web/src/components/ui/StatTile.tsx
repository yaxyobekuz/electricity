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
  energyParts, isKnownMetric, moneyParts, num, pct, provenanceText, type MetricKey,
} from '@beap/shared';
import { Button, Chip, Popover, cn } from '@heroui/react';
import { ArrowDown, ArrowUp, Info, Minus } from 'lucide-react';
import type { ReactNode } from 'react';

import { Sparkline } from './Sparkline.tsx';

export type Tone = 'blue' | 'green' | 'orange' | 'purple' | 'pink' | 'sky' | 'amber' | 'cyan';

function formatValue(tile: KpiTile): { value: string; unit: string } {
  if (tile.value === null) return { value: '—', unit: tile.unit };
  switch (tile.unit) {
    case 'kWh':
      return energyParts(tile.value);
    case 'mln so‘m':
      return moneyParts(tile.value);
    case '%':
      return { value: pct(tile.value, 1).replace('%', ''), unit: '%' };
    default:
      return { value: num(tile.value, 0), unit: tile.unit };
  }
}

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
        <span className={cn('kpi__value', compact && 'text-xl')}>{value}</span>
        <span className="kpi__unit">{unit}</span>
      </div>

      <div className="flex items-center gap-1.5">
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
          {delta === null ? '—' : `${Math.abs(delta).toFixed(1)}%`}
        </span>
        <span className="truncate text-[10.5px] leading-tight text-muted">o‘tgan oyga nisbatan</span>
      </div>

      {tile.spark.length > 1 && (
        <Sparkline className="w-full" height={28} values={tile.spark} variant="bars" width={150} />
      )}
    </article>
  );
}

/**
 * Qo'shimcha ko'rsatkichlar chizig'i — bitta panel ichida bir nechta metrika,
 * vertikal ajratgichlar bilan. Maketning KPI qatoridagi KENG qutisi.
 */
export function StatStrip({
  tiles, icons, title,
}: {
  tiles: KpiTile[];
  icons?: Record<string, ReactNode>;
  title?: string;
}) {
  if (tiles.length === 0) return null;

  return (
    <section className="panel justify-center">
      {title && (
        <p className="px-4 pt-2.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
          {title}
        </p>
      )}
      <div
        className="grid flex-1 divide-x divide-separator"
        style={{ gridTemplateColumns: `repeat(${tiles.length}, minmax(0, 1fr))` }}
      >
        {tiles.map((tile) => {
          const { value, unit } = formatValue(tile);
          const d = tile.deltaPct;
          const good =
            d === null || d === 0 ? null : tile.goodDirection === 'up' ? d > 0 : d < 0;
          const Icon = d === null || d === 0 ? Minus : d > 0 ? ArrowUp : ArrowDown;

          return (
            <div key={tile.key} className="flex min-w-0 flex-col justify-center gap-1 px-3.5 py-2.5">
              <p className="flex items-center gap-1.5 text-[10.5px] font-medium leading-tight text-muted">
                {icons?.[tile.key] && (
                  <span className="shrink-0 text-accent">{icons[tile.key]}</span>
                )}
                <span className="truncate">{tile.labelUz}</span>
              </p>

              <p className="flex items-baseline gap-1">
                <span
                  className="text-[19px] font-bold leading-none tracking-tight"
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {value}
                </span>
                <span className="text-[10px] font-medium text-muted">{unit}</span>
              </p>

              <span
                className="inline-flex items-center gap-0.5 text-[10.5px] font-semibold"
                style={{
                  color:
                    good === null
                      ? 'var(--viz-muted)'
                      : good
                        ? 'var(--viz-delta-good)'
                        : 'var(--viz-delta-bad)',
                }}
              >
                <Icon aria-hidden="true" className="size-3" />
                {d === null ? '—' : `${Math.abs(d).toFixed(1)}%`}
              </span>

              {tile.spark.length > 1 && (
                <Sparkline className="w-full" height={20} values={tile.spark} variant="bars" width={120} />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * Kichik ko'rsatkich kartasi.
 *
 * Tuzilishi: yuqorida yorliq + rangli ikona, o'rtada katta qiymat, pastda
 * solishtirish qiymati (chapda) va o'zgarish (o'ngda).
 */
export function MiniStat({
  label, value, unit, hint, icon, tone = 'accent', delta, deltaGood,
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
}) {
  const toneColor =
    tone === 'good' ? 'var(--viz-good)'
      : tone === 'warning' ? 'var(--viz-warning)'
        : tone === 'critical' ? 'var(--viz-critical)'
          : 'var(--accent)';

  const DeltaIcon =
    deltaGood === null || deltaGood === undefined ? Minus : deltaGood ? ArrowUp : ArrowDown;

  return (
    <div className="panel panel--row gap-3 px-3.5 py-3">
      {icon && (
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-lg"
          style={{
            background: `color-mix(in oklab, ${toneColor} 12%, transparent)`,
            color: toneColor,
          }}
        >
          {icon}
        </span>
      )}

      <div className="min-w-0 flex-1">
        <p className="truncate text-[10.5px] font-medium leading-tight text-muted">{label}</p>

        <p
          className="mt-0.5 truncate text-[19px] font-bold leading-none"
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {value}
          {unit && <span className="ml-1 text-[10.5px] font-medium text-muted">{unit}</span>}
        </p>

        {(hint || delta) && (
          <p className="mt-1 flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-[10.5px] text-muted">{hint ?? ''}</span>
            {delta && (
              <span
                className="inline-flex shrink-0 items-center gap-0.5 text-[10.5px] font-semibold"
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
        <p className="text-[11px] leading-tight text-muted">{label}</p>
        <p className="text-sm font-bold leading-tight" style={{ fontVariantNumeric: 'tabular-nums' }}>
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
