/**
 * Diqqat talab qiladigan holatlar.
 *
 * MUHIM: bu SUN'IY INTELLEKT EMAS. Ro'yxat deterministik SQL qoidalari
 * asosida tuziladi (yo'qotish normadan oshgan, TP ortiqcha yuklangan,
 * MFY ma'lumot yubormagan, qarzdorlik keskin o'sgan). Tashqi xizmat yoki
 * LLM ishlatilmaydi — bu tizimning offline talabiga mos.
 */
import type { AlertItem } from '@beap/shared';
import { Chip, cn } from '@heroui/react';
import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

const SEVERITY_META = {
  critical: { icon: CircleAlert, color: 'var(--viz-critical)', label: 'Tanqidiy' },
  serious: { icon: TriangleAlert, color: 'var(--viz-serious)', label: 'Jiddiy' },
  warning: { icon: TriangleAlert, color: 'var(--viz-warning)', label: 'Diqqat' },
  info: { icon: Info, color: 'var(--viz-1)', label: 'Ma’lumot' },
} as const;

export function AlertsPanel({ items }: { items: AlertItem[] }) {
  const { t } = useTranslation();

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
        <CircleCheck className="size-8 text-viz-good" />
        <p className="text-sm text-muted">{t('alerts.empty')}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <ul className="scroll-y max-h-[276px] divide-y divide-separator/50">
        {items.map((item) => {
          const meta = SEVERITY_META[item.severity];
          const Icon = meta.icon;
          const body = (
            <div className="flex gap-2.5 px-4 py-2.5">
              <Icon
                className="mt-0.5 size-4 shrink-0"
                style={{ color: meta.color }}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium leading-snug">{item.titleUz}</p>
                <p className="mt-0.5 text-[11px] leading-snug text-muted">{item.detailUz}</p>
              </div>
              <Chip
                className="mt-0.5 shrink-0"
                color={
                  item.severity === 'critical' || item.severity === 'serious' ? 'danger'
                    : item.severity === 'warning' ? 'warning' : 'default'
                }
                size="sm"
                variant="soft"
              >
                <Chip.Label>{meta.label}</Chip.Label>
              </Chip>
            </div>
          );

          return (
            <li key={item.id}>
              {item.href ? (
                <Link
                  to={item.href}
                  className={cn('block transition-colors hover:bg-surface-secondary')}
                >
                  {body}
                </Link>
              ) : (
                body
              )}
            </li>
          );
        })}
      </ul>
      <p className="border-t border-separator/50 px-4 py-2 text-[10px] leading-tight text-muted">
        {t('alerts.note')}
      </p>
    </div>
  );
}
