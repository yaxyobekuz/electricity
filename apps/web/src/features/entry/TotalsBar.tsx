/**
 * Nazorat qatori — formaning pastida yopishib turadi.
 *
 * Bu tizimning eng muhim UI elementi: xodim raqam yozayotgan paytda
 * "Yo'qotish" va "Tarkib" ustunlari jonli hisoblanadi. Yig'indi ajralgan
 * ZAHOTI belgi qizil chipga aylanadi va aniq farqni ko'rsatadi.
 *
 * Jami qiymat HECH QACHON kiritilmaydi — u shu yerda hisoblanib turadi.
 */
import { balanceTolerance, num } from '@beap/shared';
import { Button, Chip } from '@heroui/react';
import { CheckCircle2, TriangleAlert, Wand2 } from 'lucide-react';

export interface BalanceTotals {
  kwhIn: number;
  kwhSold: number;
  lossTotal: number;
  lossParts: number;
}

export function TotalsBar({
  totals, filledDays, expectedDays, onFillRemainder, saveState, savedAt,
}: {
  totals: BalanceTotals;
  filledDays: number;
  expectedDays: number;
  onFillRemainder?: () => void;
  saveState: 'idle' | 'saving' | 'saved' | 'error';
  savedAt?: string | null;
}) {
  const diff = totals.lossTotal - totals.lossParts;
  const tolerance = balanceTolerance(totals.kwhIn);
  const balanced = Math.abs(diff) <= tolerance;

  return (
    <div className="sticky bottom-0 z-20 -mx-4 border-t border-border bg-surface/97 px-4 py-2.5 backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <dl className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
          <Item label="Kirgan" value={num(totals.kwhIn, 1)} />
          <Item label="Sotilgan" value={num(totals.kwhSold, 1)} />
          <Item
            label="Yo‘qotish"
            hint="hisoblanadi"
            value={num(totals.lossTotal, 1)}
          />
          <Item
            label="Tarkib"
            hint="tabiiy + texnik + noqonuniy"
            value={num(totals.lossParts, 1)}
            tone={balanced ? undefined : 'bad'}
          />
        </dl>

        <div className="flex items-center gap-2">
          <Chip size="sm" variant="soft">
            <Chip.Label>
              {filledDays} / {expectedDays} kun
            </Chip.Label>
          </Chip>

          {balanced ? (
            <Chip color="success" size="sm" variant="soft">
              <CheckCircle2 className="size-3.5" />
              <Chip.Label>Balans to‘g‘ri</Chip.Label>
            </Chip>
          ) : (
            <>
              <Chip color="danger" size="sm" variant="soft">
                <TriangleAlert className="size-3.5" />
                <Chip.Label>
                  Farq: {diff > 0 ? '+' : ''}
                  {num(diff, 1)} kWh
                </Chip.Label>
              </Chip>
              {onFillRemainder && (
                <Button size="sm" variant="secondary" onPress={onFillRemainder}>
                  <Wand2 className="size-3.5" />
                  Qoldiqni to‘ldirish
                </Button>
              )}
            </>
          )}

          <SaveIndicator savedAt={savedAt ?? null} state={saveState} />
        </div>
      </div>
    </div>
  );
}

function Item({
  label, value, hint, tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'bad';
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-muted">{label}</dt>
      <dd
        className="tabular font-semibold"
        style={tone === 'bad' ? { color: 'var(--viz-critical)' } : undefined}
      >
        {value}
      </dd>
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
    return <span className="text-[11px] font-medium text-danger">Xatolik — qayta urinish</span>;
  }
  if (state === 'saved' && savedAt) {
    return (
      <span className="text-[11px] text-viz-good">
        Saqlandi{' '}
        {new Date(savedAt).toLocaleTimeString('uz-Latn-UZ', {
          hour: '2-digit', minute: '2-digit',
        })}
      </span>
    );
  }
  return null;
}
