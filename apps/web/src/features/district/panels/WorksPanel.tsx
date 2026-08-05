/**
 * Rejalashtirilgan va bajarilgan ishlar.
 *
 * Qator bosilsa dalolatnoma ochiladi - MFY dashboardidagi ro'yxat bilan
 * bir xil xatti-harakat: ish haqidagi to'liq ma'lumot va rasmlar bir joyda.
 */
import type { WorkRow } from '@beap/shared';
import { WORK_TYPE_LABEL_UZ, dateLabel, energy, num, pct } from '@beap/shared';
import { Chip } from '@heroui/react';
import { useState } from 'react';

import { useVizTokens } from '../../../lib/chart-theme.ts';
import { EmptyPanel } from '../../../components/ui/Panel.tsx';
import { WorkActModal } from '../../works/WorkActModal.tsx';

const STATUS_LABEL: Record<string, string> = {
  PLANNED: 'Reja',
  IN_PROGRESS: 'Jarayonda',
  COMPLETED: 'Bajarildi',
  CANCELLED: 'Bekor qilindi',
};

export function WorksPanel({ rows, mode }: { rows: WorkRow[]; mode: 'planned' | 'completed' }) {
  const t = useVizTokens();
  const [openId, setOpenId] = useState<number | null>(null);

  if (rows.length === 0) {
    return (
      <EmptyPanel
        message={mode === 'planned' ? 'Rejalashtirilgan ish yo‘q' : 'Bajarilgan ish yo‘q'}
      />
    );
  }

  // Bajarilgan ishlarning umumiy natijasi
  const totalSaved = rows.reduce((a, r) => a + r.effectSavingKwhMonth, 0);
  const withEffect = rows.find(
    (r) => r.effectLossPctBefore !== null && r.effectLossPctAfter !== null,
  );

  return (
    <div className="flex flex-col">
      <ul className="scroll-y max-h-[248px] divide-y divide-separator/50">
        {rows.slice(0, 12).map((r) => (
          <li key={r.id}>
            <button
              className="w-full px-4 py-2.5 text-left transition-colors hover:bg-surface-secondary"
              type="button"
              onClick={() => setOpenId(r.id)}
            >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium leading-snug">{r.titleUz}</p>
                {/* Fider bitta - nomini har qatorda takrorlash ma'nosiz. */}
                <p className="mt-0.5 text-[11px] text-muted">
                  {WORK_TYPE_LABEL_UZ[r.workType] ?? r.workType}
                  {r.quantity > 0 && ` · ${num(r.quantity, 1)} ${r.unit}`}
                  {r.actualEnd && ` · ${dateLabel(r.actualEnd)}`}
                </p>
              </div>
              <Chip
                className="shrink-0"
                color={
                  r.status === 'COMPLETED' ? 'success'
                    : r.status === 'IN_PROGRESS' ? 'accent' : 'default'
                }
                size="sm"
                variant="soft"
              >
                <Chip.Label>{STATUS_LABEL[r.status] ?? r.status}</Chip.Label>
              </Chip>
            </div>

            {mode === 'planned' && (
              <div className="mt-1.5 flex items-center gap-2">
                <span className="loadbar h-1.5 flex-1">
                  <span
                    className="loadbar__fill"
                    style={{
                      width: `${r.progressPct}%`,
                      background: r.progressPct >= 60 ? t.status.good : t.series[0],
                    }}
                  />
                </span>
                <span className="tabular w-9 shrink-0 text-right text-[11px] font-medium">
                  {r.progressPct}%
                </span>
              </div>
            )}

            {mode === 'completed' && r.effectSavingKwhMonth > 0 && (
              <p className="mt-1 text-[11px] text-viz-good">
                Tejalgan: {energy(r.effectSavingKwhMonth).text}/oy
              </p>
            )}
            </button>
          </li>
        ))}
      </ul>

      <WorkActModal workId={openId} onClose={() => setOpenId(null)} />

      {/* Umumiy natija - dumbbell ko'rinishi */}
      {mode === 'completed' && (totalSaved > 0 || withEffect) && (
        <div className="border-t border-separator/50 px-4 py-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
            Umumiy natija
          </p>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            {withEffect && (
              <div>
                <p className="text-[10px] text-muted">Yo‘qotish darajasi</p>
                <p className="flex items-center gap-2 text-sm font-semibold">
                  <span className="tabular text-muted line-through">
                    {pct(withEffect.effectLossPctBefore ?? 0, 1)}
                  </span>
                  <span aria-hidden="true" className="text-muted">→</span>
                  <span className="tabular text-viz-good">
                    {pct(withEffect.effectLossPctAfter ?? 0, 1)}
                  </span>
                </p>
              </div>
            )}
            {totalSaved > 0 && (
              <div>
                <p className="text-[10px] text-muted">Iqtisod qilingan energiya</p>
                <p className="tabular text-sm font-semibold text-viz-good">
                  {energy(totalSaved).text}/oy
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export { WORK_TYPE_LABEL_UZ };
