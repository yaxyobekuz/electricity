/**
 * Ma'lumot kiritish paneli — bosh sahifa.
 *
 * TO'LIQLIK MATRITSASI: MFY × domen. Hokim aynan shu panel bilan
 * korxonalarni nazorat qiladi — qaysi mahalla nimani yubormaganini
 * bir qarashda ko'rsatadi.
 */
import type { CompletenessCell, Domain } from '@beap/shared';
import { DOMAIN_LABEL_UZ, DOMAINS, periodLabel, toPeriod } from '@beap/shared';
import { Chip, Tooltip, cn } from '@heroui/react';
import { CircleCheck, CircleDashed, Clock, FileEdit, XCircle } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { LoadingState, PageHeader } from '../../components/layout/AppShell.tsx';
import { Panel } from '../../components/ui/Panel.tsx';
import { PeriodPicker } from '../district/panels/PeriodPicker.tsx';
import { useBootstrap, useCompleteness } from '../../lib/queries.ts';
import { useUi } from '../../lib/ui-store.ts';

const STATUS_META = {
  missing: { label: 'Kiritilmagan', icon: CircleDashed, color: 'var(--viz-muted)', bg: 'transparent' },
  draft: { label: 'Qoralama', icon: FileEdit, color: 'var(--viz-warning)', bg: 'color-mix(in oklab, var(--viz-warning) 16%, transparent)' },
  submitted: { label: 'Yuborilgan', icon: Clock, color: 'var(--viz-1)', bg: 'color-mix(in oklab, var(--viz-1) 16%, transparent)' },
  approved: { label: 'Tasdiqlangan', icon: CircleCheck, color: 'var(--viz-good)', bg: 'color-mix(in oklab, var(--viz-good) 16%, transparent)' },
  rejected: { label: 'Rad etilgan', icon: XCircle, color: 'var(--viz-critical)', bg: 'color-mix(in oklab, var(--viz-critical) 18%, transparent)' },
  superseded: { label: 'Almashtirilgan', icon: CircleDashed, color: 'var(--viz-muted)', bg: 'transparent' },
} as const;

export default function EntryPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const boot = useBootstrap();
  const period = useUi((s) => s.period);
  const user = useUi((s) => s.user);

  const effectivePeriod =
    period ?? (boot.data?.dataRange.maxDate ? toPeriod(boot.data.dataRange.maxDate) : null);

  const completeness = useCompleteness(effectivePeriod ?? '', Boolean(effectivePeriod));

  const { matrix, stats } = useMemo(() => {
    const cells = completeness.data ?? [];
    const map = new Map<string, CompletenessCell>();
    for (const c of cells) map.set(`${c.mfyId}|${c.domain}`, c);

    const counts: Record<string, number> = {
      missing: 0, draft: 0, submitted: 0, approved: 0, rejected: 0, superseded: 0,
    };
    for (const c of cells) counts[c.status] = (counts[c.status] ?? 0) + 1;

    return { matrix: map, stats: counts };
  }, [completeness.data]);

  const mfys = boot.data?.mfys ?? [];
  const canWrite = user && ['mfy_operator', 'elektroset_manager', 'admin'].includes(user.role);

  if (completeness.isLoading || boot.isLoading) return <LoadingState rows={5} />;

  const total = mfys.length * DOMAINS.length;
  const approvedPct = total > 0 ? Math.round(((stats['approved'] ?? 0) / total) * 100) : 0;

  return (
    <>
      <PageHeader
        actions={<PeriodPicker />}
        subtitle={
          effectivePeriod
            ? `${periodLabel(effectivePeriod)} · ${approvedPct}% tasdiqlangan`
            : undefined
        }
        title={t('entry.title')}
      />

      {/* Umumiy holat */}
      <div className="mb-4 flex flex-wrap gap-2">
        {(['approved', 'submitted', 'draft', 'rejected', 'missing'] as const).map((s) => {
          const meta = STATUS_META[s];
          const Icon = meta.icon;
          return (
            <div
              key={s}
              className="flex items-center gap-2 rounded-lg border border-border/70 bg-surface px-3 py-2"
            >
              <Icon className="size-4" style={{ color: meta.color }} />
              <div>
                <p className="text-[10px] uppercase leading-none tracking-wide text-muted">
                  {meta.label}
                </p>
                <p className="tabular text-sm font-semibold leading-tight">{stats[s] ?? 0}</p>
              </div>
            </div>
          );
        })}
      </div>

      <Panel
        subtitle="Mahalla × ma’lumot turi. Katakcha ustiga bosib formani oching."
        title={t('entry.completeness')}
        flush
      >
        <div className="scroll-y max-h-[70vh] overflow-x-auto">
          <table className="dt min-w-[900px]">
            <thead>
              <tr>
                <th className="sticky left-0 z-20 bg-surface">Mahalla</th>
                {DOMAINS.map((d) => (
                  <th key={d} className="text-center">
                    <span className="block max-w-24 truncate" title={DOMAIN_LABEL_UZ[d]}>
                      {DOMAIN_LABEL_UZ[d]}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {mfys.map((m) => (
                <tr key={m.id}>
                  <td className="sticky left-0 z-10 bg-surface font-medium">
                    {m.nameUz}
                    <span className="block text-[10px] font-normal text-muted">
                      {m.elektrosetName}
                    </span>
                  </td>
                  {DOMAINS.map((d) => {
                    const cell = matrix.get(`${m.id}|${d}`);
                    const status = cell?.status ?? 'missing';
                    const meta = STATUS_META[status];
                    const Icon = meta.icon;

                    const canOpen = canWrite && (user.role === 'admin' || user.mfyIds.includes(m.id));

                    return (
                      <td key={d} className="p-1 text-center">
                        <Tooltip delay={300}>
                          <button
                            type="button"
                            aria-label={`${m.nameUz} — ${DOMAIN_LABEL_UZ[d]}: ${meta.label}`}
                            className={cn(
                              'inline-flex size-8 items-center justify-center rounded-lg transition-transform',
                              canOpen ? 'cursor-pointer hover:scale-110' : 'cursor-default',
                            )}
                            style={{ background: meta.bg }}
                            disabled={!canOpen}
                            onClick={() => {
                              if (canOpen && effectivePeriod) {
                                void navigate(`/entry/${m.id}/${effectivePeriod}/${d}`);
                              }
                            }}
                          >
                            <Icon className="size-4" style={{ color: meta.color }} />
                          </button>
                          <Tooltip.Content>
                            <p className="text-xs font-medium">{DOMAIN_LABEL_UZ[d as Domain]}</p>
                            <p className="text-[11px] text-muted">{meta.label}</p>
                          </Tooltip.Content>
                        </Tooltip>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {!canWrite && (
        <Chip className="mt-3" size="sm" variant="soft">
          <Chip.Label>
            Sizda ma’lumot kiritish huquqi yo‘q — faqat kuzatish rejimi
          </Chip.Label>
        </Chip>
      )}
    </>
  );
}
