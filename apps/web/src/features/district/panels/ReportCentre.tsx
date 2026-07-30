/**
 * Hisobot markazi.
 *
 * Barcha hisobotlar SERVERDA hosil qilinadi va lokal yuklanadi —
 * tashqi xizmat yoki bulut ishlatilmaydi.
 */
import { Button, ToggleButton, ToggleButtonGroup } from '@heroui/react';
import { CalendarDays, FileSpreadsheet, FileText, Printer } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { useUi } from '../../../lib/ui-store.ts';

const PERIOD_KINDS = [
  { id: 'daily', labelKey: 'reports.daily' },
  { id: 'weekly', labelKey: 'reports.weekly' },
  { id: 'monthly', labelKey: 'reports.monthly' },
  { id: 'quarterly', labelKey: 'reports.quarterly' },
  { id: 'yearly', labelKey: 'reports.yearly' },
] as const;

export function ReportCentre() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const period = useUi((s) => s.period);
  const [kind, setKind] = useState<string>('monthly');

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">
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
          onPress={() => {
            window.location.href = `/api/report/period/${kind}.xlsx${period ? `?period=${period}` : ''}`;
          }}
        >
          <FileSpreadsheet className="size-4 text-viz-3" />
          {t('reports.excel')}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onPress={() => {
            window.location.href = `/api/report/period/${kind}.pdf${period ? `?period=${period}` : ''}`;
          }}
        >
          <FileText className="size-4 text-viz-2" />
          {t('reports.pdf')}
        </Button>
      </div>

      <div className="border-t border-separator/60 pt-3">
        <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted">
          Rasmiy hujjat
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Button size="sm" variant="secondary" onPress={() => void navigate('/passport')}>
            <FileText className="size-4" />
            Pasport
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onPress={() => {
              window.open(`/passport/print/tuman/0/${period ?? 'latest'}`, '_blank');
            }}
          >
            <Printer className="size-4" />
            {t('common.print')}
          </Button>
        </div>
      </div>

      <p className="text-[10px] leading-tight text-muted">
        Hisobotlar server tomonida hosil qilinadi va to‘g‘ridan-to‘g‘ri yuklanadi.
        Hech qanday tashqi xizmat ishlatilmaydi.
      </p>
    </div>
  );
}
