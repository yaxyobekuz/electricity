/**
 * Davr tanlagich.
 *
 * URL da emas, global holatda saqlanadi — barcha panellar bitta davrga
 * bo'ysunadi. Filtr qatori u ta'sir qiladigan hamma narsadan YUQORIDA turadi.
 */
import { periodLabel, shiftPeriod, toPeriod } from '@beap/shared';
import { Button, Select, ListBox } from '@heroui/react';
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';
import { useMemo } from 'react';

import { useBootstrap } from '../../../lib/queries.ts';
import { useUi } from '../../../lib/ui-store.ts';

export function PeriodPicker() {
  const { data: boot } = useBootstrap();
  const period = useUi((s) => s.period);
  const setPeriod = useUi((s) => s.setPeriod);

  const periods = useMemo(() => {
    if (!boot?.dataRange.minDate || !boot.dataRange.maxDate) return [];
    const min = toPeriod(boot.dataRange.minDate);
    const max = toPeriod(boot.dataRange.maxDate);
    const out: string[] = [];
    let cur = max;
    // 36 oydan ko'p bo'lmasin — ro'yxat cheksiz o'smasin.
    for (let i = 0; i < 36 && cur >= min; i += 1) {
      out.push(cur);
      cur = shiftPeriod(cur, -1);
    }
    return out;
  }, [boot]);

  const current = period ?? periods[0] ?? null;
  const idx = current ? periods.indexOf(current) : -1;

  if (periods.length === 0) return null;

  return (
    <div className="flex items-center gap-1">
      <Button
        isIconOnly
        aria-label="Oldingi oy"
        isDisabled={idx < 0 || idx >= periods.length - 1}
        size="sm"
        variant="ghost"
        onPress={() => setPeriod(periods[idx + 1] ?? null)}
      >
        <ChevronLeft className="size-4" />
      </Button>

      <Select
        aria-label="Davr"
        className="w-40"
        placeholder="Davr tanlang"
        value={current}
        onChange={(v) => setPeriod(v === null ? null : String(v))}
      >
        <Select.Trigger>
          <Calendar className="size-3.5 text-muted" />
          <Select.Value />
          <Select.Indicator />
        </Select.Trigger>
        <Select.Popover>
          <ListBox>
            {periods.map((p) => (
              <ListBox.Item key={p} id={p} textValue={periodLabel(p)}>
                {periodLabel(p)}
                <ListBox.ItemIndicator />
              </ListBox.Item>
            ))}
          </ListBox>
        </Select.Popover>
      </Select>

      <Button
        isIconOnly
        aria-label="Keyingi oy"
        isDisabled={idx <= 0}
        size="sm"
        variant="ghost"
        onPress={() => setPeriod(periods[idx - 1] ?? null)}
      >
        <ChevronRight className="size-4" />
      </Button>
    </div>
  );
}
