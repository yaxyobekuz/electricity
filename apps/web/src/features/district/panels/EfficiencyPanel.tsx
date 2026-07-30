/**
 * Energiya samaradorlik indeksi.
 *
 * Hokim "nega 85?" deb so'raydi — javob DOIM ochiq turadi: 5 komponent va
 * ularning vaznlari. Sehrli raqam yo'q.
 */
import type { EfficiencyBreakdown } from '@beap/shared';
import { Chip, Popover, Button } from '@heroui/react';
import { Info, TrendingDown, TrendingUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Gauge } from '../../../components/charts/Gauge.tsx';
import { useVizTokens } from '../../../lib/chart-theme.ts';

function scoreLabel(score: number): { label: string; tone: 'good' | 'warning' | 'serious' | 'critical' } {
  if (score >= 85) return { label: 'Yaxshi', tone: 'good' };
  if (score >= 70) return { label: 'Qoniqarli', tone: 'warning' };
  if (score >= 50) return { label: 'Past', tone: 'serious' };
  return { label: 'Tanqidiy', tone: 'critical' };
}

export function EfficiencyPanel({ data }: { data: EfficiencyBreakdown }) {
  const { t } = useTranslation();
  const tokens = useVizTokens();
  const { label, tone } = scoreLabel(data.score);

  const forecastFirst = data.forecast?.[0];
  const forecastLast = data.forecast?.at(-1);
  const improving =
    forecastFirst && forecastLast ? forecastLast.lossPct < forecastFirst.lossPct : null;

  return (
    <div className="flex flex-col gap-3">
      <Gauge height={182} label={t('efficiency.outOf')} value={data.score} />

      <div className="flex items-center justify-center gap-2">
        <Chip
          color={tone === 'good' ? 'success' : tone === 'warning' ? 'warning' : 'danger'}
          size="sm"
          variant="soft"
        >
          <span className={`dot dot--${tone}`} aria-hidden="true" />
          <Chip.Label>{label}</Chip.Label>
        </Chip>

        <Popover>
          <Button isIconOnly aria-label={t('efficiency.components')} size="sm" variant="ghost">
            <Info className="size-3.5" />
          </Button>
          <Popover.Content className="max-w-80">
            <Popover.Dialog>
              <Popover.Heading className="text-xs font-semibold">
                {t('efficiency.components')}
              </Popover.Heading>
              <p className="mb-2 mt-1 text-[11px] leading-relaxed text-muted">
                {t('efficiency.explain')}
              </p>
              <table className="dt text-[11px]">
                <thead>
                  <tr>
                    <th>Komponent</th>
                    <th className="text-right">{t('efficiency.weight')}</th>
                    <th className="text-right">{t('efficiency.score')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.components.map((c) => (
                    <tr key={c.key}>
                      <td>{c.labelUz}</td>
                      <td className="num">{(c.weight * 100).toFixed(0)}%</td>
                      <td className="num font-medium">{c.score.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Popover.Dialog>
          </Popover.Content>
        </Popover>
      </div>

      {/* Komponent ballari — mini bar'lar */}
      <ul className="flex flex-col gap-1.5">
        {data.components.map((c) => (
          <li key={c.key} className="flex items-center gap-2 text-[11px]">
            <span className="w-28 shrink-0 truncate text-muted">{c.labelUz}</span>
            <span className="loadbar flex-1">
              <span
                className="loadbar__fill"
                style={{
                  width: `${Math.max(2, c.score)}%`,
                  background:
                    c.score >= 85 ? tokens.status.good
                      : c.score >= 70 ? tokens.status.warning
                        : c.score >= 50 ? tokens.status.serious
                          : tokens.status.critical,
                }}
              />
            </span>
            <span className="tabular w-8 shrink-0 text-right font-medium">
              {c.score.toFixed(0)}
            </span>
          </li>
        ))}
      </ul>

      {/* Statistik prognoz — AI EMAS, chiziqli trend */}
      {data.forecast && data.forecast.length > 0 && (
        <div className="rounded-lg border border-border/70 bg-surface-secondary p-2.5">
          <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold">
            {improving ? (
              <TrendingDown className="size-3.5 text-viz-good" />
            ) : (
              <TrendingUp className="size-3.5 text-viz-critical" />
            )}
            {t('efficiency.forecast')}
          </p>
          <p className="text-[11px] leading-relaxed text-muted">
            Hozirgi sur’at saqlansa, {forecastLast?.period} ga borib yo‘qotish{' '}
            <strong className="tabular text-foreground">{forecastLast?.lossPct.toFixed(1)}%</strong>{' '}
            bo‘lishi kutilmoqda.
          </p>
          <p className="mt-1 text-[10px] leading-tight text-muted/80">
            {t('efficiency.forecastNote')}
          </p>
        </div>
      )}
    </div>
  );
}
