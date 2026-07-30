/**
 * Hisobot markazi.
 *
 * Barcha fayllar SERVERDA hosil bo'ladi va to'g'ridan-to'g'ri yuklanadi:
 * tashqi xizmat, bulut yoki CDN ishlatilmaydi (tizimning offline talabi).
 */
import { Button, SearchField, ToggleButton, ToggleButtonGroup } from '@heroui/react';
import {
  Building2, CalendarDays, FileSpreadsheet, FileText, Printer, ScrollText,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { PageHeader } from '../../components/layout/AppShell.tsx';
import { EmptyPanel, Panel } from '../../components/ui/Panel.tsx';
import { useBootstrap } from '../../lib/queries.ts';
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
  const navigate = useNavigate();
  const period = useUi((s) => s.period);
  const boot = useBootstrap();

  const [kind, setKind] = useState<string>('monthly');
  const [search, setSearch] = useState('');

  const qs = period ? `?period=${period}` : '';

  const mfys = useMemo(() => {
    const all = boot.data?.mfys ?? [];
    if (!search) return all;
    const q = search.toLowerCase();
    return all.filter((m) => m.nameUz.toLowerCase().includes(q));
  }, [boot.data, search]);

  const go = (url: string): void => {
    window.location.href = url;
  };

  return (
    <div>
      <PageHeader
        actions={<PeriodPicker />}
        subtitle="davriy hisobotlar va rasmiy pasportlar"
        title={t('nav.reports')}
      />

      <div className="mb-2.5 grid grid-cols-1 gap-2.5 xl:grid-cols-12">
        {/* ── Davriy hisobot ─────────────────────────────────────────── */}
        <Panel
          className="xl:col-span-5"
          subtitle="tanlangan davr bo‘yicha to‘liq ma’lumot"
          title="Davriy hisobot"
        >
          <div className="flex flex-col gap-3">
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
              Hisobot tanlangan davrdagi barcha mahallalar bo‘yicha energiya balansi,
              yo‘qotish tarkibi, abonentlar va qarzdorlik ko‘rsatkichlarini qamrab oladi.
            </p>
          </div>
        </Panel>

        {/* ── Tuman pasporti ─────────────────────────────────────────── */}
        <Panel
          className="xl:col-span-7"
          subtitle="rasmiy hujjat — 13 qatorli forma"
          title="Tuman pasporti"
        >
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Button size="sm" variant="primary" onPress={() => void navigate('/passport')}>
                <ScrollText className="size-4" />
                Ochish
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onPress={() => go(`/api/report/passport/tuman.xlsx${qs}`)}
              >
                <FileSpreadsheet className="size-4 text-viz-3" />
                Excel
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onPress={() => go(`/api/report/passport/tuman.pdf${qs}`)}
              >
                <FileText className="size-4 text-viz-2" />
                PDF
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onPress={() =>
                  window.open(`/passport/print/tuman/0/${period ?? 'latest'}`, '_blank')
                }
              >
                <Printer className="size-4" />
                {t('common.print')}
              </Button>
            </div>

            <p className="rounded-lg bg-surface-secondary px-3 py-2.5 text-[10.5px] leading-relaxed text-muted">
              Tuman pasporti mahallalar pasportlarining <strong>yig‘indisi</strong> sifatida
              hisoblanadi — uni qo‘lda kiritishning imkoni yo‘q. Tasdiqlangan pasport
              o‘zgarmas nusxa (snapshot) sifatida <code>content_sha256</code> bilan
              muzlatiladi.
            </p>
          </div>
        </Panel>
      </div>

      {/* ── Mahalla pasportlari ──────────────────────────────────────── */}
      <Panel
        actions={
          <SearchField
            aria-label={t('common.search')}
            className="w-52"
            value={search}
            onChange={setSearch}
          >
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input placeholder="Mahalla nomi…" />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>
        }
        subtitle={`${mfys.length} ta mahalla`}
        title="Mahalla pasportlari"
      >
        {mfys.length === 0 ? (
          <EmptyPanel message="Mahalla topilmadi" />
        ) : (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {mfys.map((m) => (
              <li
                key={m.id}
                className="flex items-center gap-2.5 rounded-lg bg-surface-secondary px-3 py-2"
              >
                <Building2 className="size-4 shrink-0 text-accent" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium">{m.nameUz}</span>
                  <span className="block truncate text-[10px] leading-tight text-muted">
                    {m.elektrosetName}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-0.5">
                  <Button
                    isIconOnly
                    aria-label={`${m.nameUz} — pasportni ochish`}
                    size="sm"
                    variant="ghost"
                    onPress={() => void navigate(`/passport/mfy/${m.id}/${period ?? 'latest'}`)}
                  >
                    <ScrollText className="size-3.5" />
                  </Button>
                  <Button
                    isIconOnly
                    aria-label={`${m.nameUz} — Excel`}
                    size="sm"
                    variant="ghost"
                    onPress={() => go(`/api/report/passport/mfy/${m.id}.xlsx${qs}`)}
                  >
                    <FileSpreadsheet className="size-3.5 text-viz-3" />
                  </Button>
                  <Button
                    isIconOnly
                    aria-label={`${m.nameUz} — PDF`}
                    size="sm"
                    variant="ghost"
                    onPress={() => go(`/api/report/passport/mfy/${m.id}.pdf${qs}`)}
                  >
                    <FileText className="size-3.5 text-viz-2" />
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
