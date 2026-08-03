/**
 * Hisobot markazi.
 *
 * Barcha fayllar SERVERDA hosil bo'ladi va to'g'ridan-to'g'ri yuklanadi:
 * tashqi xizmat, bulut yoki CDN ishlatilmaydi (tizimning offline talabi).
 */
import { Button, ToggleButton, ToggleButtonGroup } from '@heroui/react';
import { CalendarDays, FileSpreadsheet, FileText } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PageHeader } from '../../components/layout/AppShell.tsx';
import { Panel } from '../../components/ui/Panel.tsx';
import { useUi } from '../../lib/ui-store.ts';
import { PeriodPicker } from '../district/panels/PeriodPicker.tsx';

const PERIOD_KINDS = [
  { id: 'daily', labelKey: 'reports.daily' },
  { id: 'weekly', labelKey: 'reports.weekly' },
  { id: 'monthly', labelKey: 'reports.monthly' },
  { id: 'quarterly', labelKey: 'reports.quarterly' },
  { id: 'yearly', labelKey: 'reports.yearly' },
] as const;

export default function ReportsPage() {
  const { t } = useTranslation();
  const period = useUi((s) => s.period);
  const [kind, setKind] = useState<string>('monthly');

  const qs = period ? `?period=${period}` : '';
  const go = (url: string): void => {
    window.location.href = url;
  };

  return (
    <div>
      <PageHeader
        actions={<PeriodPicker />}
        subtitle="fider bo‘yicha davriy hisobotlar"
        title={t('nav.reports')}
      />

      <Panel
        subtitle="tanlangan davr bo‘yicha to‘liq ma’lumot"
        title="Davriy hisobot"
      >
        <div className="flex max-w-2xl flex-col gap-3">
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-muted">
              <CalendarDays className="size-3.5" />
              Hisobot davri
            </p>
            <ToggleButtonGroup
              aria-label="Hisobot davri"
              className="flex-wrap"
              selectedKeys={new Set([kind])}
              selectionMode="single"
              size="sm"
              onSelectionChange={(keys) => {
                const next = [...keys][0];
                if (typeof next === 'string') setKind(next);
              }}
            >
              {PERIOD_KINDS.map((p) => (
                <ToggleButton key={p.id} id={p.id}>
                  {t(p.labelKey)}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button
              size="sm"
              variant="secondary"
              onPress={() => go(`/api/report/period/${kind}.xlsx${qs}`)}
            >
              <FileSpreadsheet className="size-4 text-viz-3" />
              {t('reports.excel')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onPress={() => go(`/api/report/period/${kind}.pdf${qs}`)}
            >
              <FileText className="size-4 text-viz-2" />
              {t('reports.pdf')}
            </Button>
          </div>

          <p className="text-[10.5px] leading-relaxed text-muted">
            Hisobot tanlangan davrdagi fider balansi, yo‘qotish tarkibi, transformatorlar
            va abonentlar ko‘rsatkichlarini qamrab oladi.
          </p>
        </div>
      </Panel>
    </div>
  );
}
