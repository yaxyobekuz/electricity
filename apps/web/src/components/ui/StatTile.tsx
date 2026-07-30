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
          className="inline-flex items-center gap-0.5 text-[12px] font-semibold"
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
        <span className="text-[11px] leading-tight text-muted">o‘tgan oyga nisbatan</span>
      </div>

      {tile.spark.length > 1 && (
        <Sparkline className="mt-0.5 w-full" height={34} values={tile.spark} variant="bars" width={150} />
      )}
    </article>
  );
}

/** Kichik ko'rsatkich plitkasi (MFY panelidagi 4 ta karta uchun). */
export function MiniStat({
  label, value, unit, hint, icon, tone,
}: {
  label: string;
  value: string;
  unit?: string;
  hint?: string;
  icon?: ReactNode;
  tone?: 'good' | 'warning' | 'critical';
}) {
  const toneColor =
    tone === 'good' ? 'var(--viz-good)'
      : tone === 'warning' ? 'var(--viz-warning)'
        : tone === 'critical' ? 'var(--viz-critical)'
          : 'var(--accent)';

  return (
    <div className="panel flex-row items-center gap-3 p-4">
      {icon && (
        <span
          className="flex size-10 shrink-0 items-center justify-center rounded-xl"
          style={{
            background: `color-mix(in oklab, ${toneColor} 12%, transparent)`,
            color: toneColor,
          }}
        >
          {icon}
        </span>
      )}
      <div className="min-w-0">
        <p className="truncate text-[11px] font-medium uppercase tracking-wide text-muted">
          {label}
        </p>
        <p className="text-lg font-bold leading-tight" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {value}
          {unit && <span className="ml-1 text-xs font-medium text-muted">{unit}</span>}
        </p>
        {hint && <p className="truncate text-[11px] text-muted">{hint}</p>}
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
