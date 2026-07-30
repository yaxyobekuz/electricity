import { dateLabel } from '@beap/shared';
import { Chip } from '@heroui/react';
import { EmptyPanel } from '../../components/ui/Panel.tsx';
const STATUS_LABEL = {
    PLANNED: 'Reja',
    IN_PROGRESS: 'Jarayonda',
    COMPLETED: 'Bajarildi',
    CANCELLED: 'Bekor qilindi',
};
export function WorkTimeline({ rows, planned = false, limit = 4, }) {
    if (rows.length === 0) {
        return (<EmptyPanel message={planned ? 'Rejalashtirilgan ish yo‘q' : 'Bajarilgan ish yo‘q'}/>);
    }
    return (<ul className="flex flex-col">
      {rows.slice(0, limit).map((w) => (<li key={w.id} className="flex items-center gap-3 px-5 py-2.5 [&+&]:border-t [&+&]:border-separator">
          <span className="w-23 shrink-0 text-[11px] font-medium text-muted" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {((d) => (d ? dateLabel(d) : '—'))(planned ? w.plannedEnd : w.actualEnd)}
          </span>

          <span className="min-w-0 flex-1 truncate text-[12px]" title={w.titleUz}>
            {w.titleUz}
            {w.quantity > 0 && (<span className="text-muted">
                {' '}
                ({w.quantity} {w.unit})
              </span>)}
          </span>

          <Chip className="shrink-0" color={w.status === 'COMPLETED' ? 'success' : w.status === 'IN_PROGRESS' ? 'accent' : 'warning'} size="sm" variant="soft">
            <Chip.Label>{STATUS_LABEL[w.status] ?? w.status}</Chip.Label>
          </Chip>
        </li>))}
    </ul>);
}
