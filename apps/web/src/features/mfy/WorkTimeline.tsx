/**
 * Ishlar ro'yxati - sana · nom · holat qatorlari.
 * Mockupdagi "Amalga oshirilgan ishlar" / "Rejalashtirilgan ishlar" panellari.
 *
 * Har bir qator BOSILADI va ishning dalolatnomasini ochadi: to'liq maydonlar,
 * rasmlar va chop etish. Qator `<button>` - klaviatura bilan ham yuriladi.
 */
import type { WorkRow } from '@beap/shared';
import { dateShort } from '@beap/shared';
import { Chip } from '@heroui/react';
import { useState } from 'react';

import { EmptyPanel } from '../../components/ui/Panel.tsx';
import { WorkActModal } from '../works/WorkActModal.tsx';

const STATUS_LABEL: Record<string, string> = {
  PLANNED: 'Reja',
  IN_PROGRESS: 'Jarayonda',
  COMPLETED: 'Bajarildi',
  CANCELLED: 'Bekor qilindi',
};

export function WorkTimeline({
  rows, planned = false, limit = 4,
}: {
  rows: WorkRow[];
  /** Reja ro'yxati - sana sifatida rejalashtirilgan tugash sanasi olinadi. */
  planned?: boolean;
  limit?: number;
}) {
  const [openId, setOpenId] = useState<number | null>(null);

  if (rows.length === 0) {
    return (
      <EmptyPanel message={planned ? 'Rejalashtirilgan ish yo‘q' : 'Bajarilgan ish yo‘q'} />
    );
  }

  return (
    <>
      <ul className="flex flex-col">
        {rows.slice(0, limit).map((w) => (
          <li key={w.id} className="[&+&]:border-t [&+&]:border-separator">
            <button
              className="flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors hover:bg-surface-secondary"
              type="button"
              onClick={() => setOpenId(w.id)}
            >
              <span
                className="w-17 shrink-0 text-[11px] font-medium text-muted"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {((d) => (d ? dateShort(d) : '-'))(planned ? w.plannedEnd : w.actualEnd)}
              </span>

              <span className="min-w-0 flex-1 truncate text-[12px]" title={w.titleUz}>
                {w.titleUz}
                {w.quantity > 0 && (
                  <span className="text-muted">
                    {' '}
                    ({w.quantity} {w.unit})
                  </span>
                )}
              </span>

              <Chip
                className="shrink-0"
                color={w.status === 'COMPLETED' ? 'success' : w.status === 'IN_PROGRESS' ? 'accent' : 'warning'}
                size="sm"
                variant="soft"
              >
                <Chip.Label>{STATUS_LABEL[w.status] ?? w.status}</Chip.Label>
              </Chip>
            </button>
          </li>
        ))}
      </ul>

      <WorkActModal workId={openId} onClose={() => setOpenId(null)} />
    </>
  );
}
