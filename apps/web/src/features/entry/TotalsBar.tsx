/**
 * Nazorat qatori - formaning pastida yopishib turadi.
 *
 * Xodim raqam yozayotgan paytda "Yo'qotish" jonli hisoblanadi
 * (kirgan − foydali oqim). Yo'qotish HECH QACHON kiritilmaydi - u shu
 * yerda hisoblanib turadi.
 */
import { num, timeLabel } from '@beap/shared';
import { Chip } from '@heroui/react';

export interface BalanceTotals {
  kwhIn: number;
  kwhSold: number;
  lossTotal: number;
}

export function TotalsBar({
  totals, filledDays, expectedDays, saveState, savedAt,
}: {
  totals: BalanceTotals;
  filledDays: number;
  expectedDays: number;
  saveState: 'idle' | 'saving' | 'saved' | 'error';
  savedAt?: string | null;
}) {
  return (
    <div className="sticky bottom-0 z-20 -mx-4 border-t border-border bg-surface/97 px-4 py-2.5 backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <dl className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
          <Item label="Kirgan" value={num(totals.kwhIn, 1)} />
          <Item label="Foydali oqim" value={num(totals.kwhSold, 1)} />
          <Item
            label="Yo‘qotish"
            hint="hisoblanadi"
            value={num(totals.lossTotal, 1)}
          />
        </dl>

        <div className="flex items-center gap-2">
          <Chip size="sm" variant="soft">
            <Chip.Label>
              {filledDays} / {expectedDays} kun
            </Chip.Label>
          </Chip>

          <SaveIndicator savedAt={savedAt ?? null} state={saveState} />
        </div>
      </div>
    </div>
  );
}

function Item({
  label, value, hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-muted">{label}</dt>
      <dd className="tabular font-semibold">{value}</dd>
      {hint && <span className="text-[10px] text-muted/70">({hint})</span>}
    </div>
  );
}

export function SaveIndicator({
  state, savedAt,
}: {
  state: 'idle' | 'saving' | 'saved' | 'error';
  savedAt: string | null;
}) {
  if (state === 'saving') {
    return <span className="text-[11px] text-muted">Saqlanmoqda…</span>;
  }
  if (state === 'error') {
    return <span className="text-[11px] font-medium text-danger">Xatolik - qayta urinish</span>;
  }
  if (state === 'saved' && savedAt) {
    return (
      <span className="text-[11px] text-viz-good">
        Saqlandi {timeLabel(savedAt)}
      </span>
    );
  }
  return null;
}
