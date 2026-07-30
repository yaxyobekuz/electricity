/** Transformatorlar ro'yxati — butun tuman bo'yicha. */
import { SearchField, Select, ListBox, Chip } from '@heroui/react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { LoadingState, PageHeader } from '../../components/layout/AppShell.tsx';
import { Panel } from '../../components/ui/Panel.tsx';
import { TpMonitorPanel } from '../district/panels/TpMonitorPanel.tsx';
import { PeriodPicker } from '../district/panels/PeriodPicker.tsx';
import { useBootstrap, useTpMonitoring } from '../../lib/queries.ts';
import { useUi } from '../../lib/ui-store.ts';

export default function TpListPage() {
  const { t } = useTranslation();
  const period = useUi((s) => s.period);
  const boot = useBootstrap();
  const tp = useTpMonitoring(period ?? undefined, 1000);

  const [search, setSearch] = useState('');
  const [mfyFilter, setMfyFilter] = useState<string | null>(null);
  const [conditionFilter, setConditionFilter] = useState<string | null>(null);

  const rows = useMemo(() => {
    let out = tp.data ?? [];
    if (search) {
      const q = search.toLowerCase();
      out = out.filter((r) => r.code.toLowerCase().includes(q) || r.mfyName.toLowerCase().includes(q));
    }
    if (mfyFilter) out = out.filter((r) => String(r.mfyId) === mfyFilter);
    if (conditionFilter) out = out.filter((r) => r.condition === conditionFilter);
    return out;
  }, [tp.data, search, mfyFilter, conditionFilter]);

  const overloaded = (tp.data ?? []).filter((r) => r.condition === 'OVERLOAD').length;
  const nonCompliant = (tp.data ?? []).filter((r) => r.distanceCompliant === false).length;

  if (tp.isLoading) return <LoadingState rows={5} />;

  return (
    <>
      <PageHeader
        actions={<PeriodPicker />}
        subtitle={`${tp.data?.length ?? 0} ta transformator · ${overloaded} ta ortiqcha yuklangan · ${nonCompliant} ta masofa normasidan uzoq`}
        title={t('nav.transformers')}
      />

      {/* Filtr qatori — u ta'sir qiladigan jadvaldan YUQORIDA */}
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <SearchField
          aria-label={t('common.search')}
          className="w-60"
          value={search}
          onChange={setSearch}
        >
          <SearchField.Group>
            <SearchField.SearchIcon />
            <SearchField.Input placeholder="TP kodi yoki mahalla…" />
            <SearchField.ClearButton />
          </SearchField.Group>
        </SearchField>

        <Select
          aria-label="Mahalla"
          className="w-52"
          placeholder="Barcha mahallalar"
          value={mfyFilter}
          onChange={(v) => setMfyFilter(v === null ? null : String(v))}
        >
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {(boot.data?.mfys ?? []).map((m) => (
                <ListBox.Item key={m.id} id={String(m.id)} textValue={m.nameUz}>
                  {m.nameUz}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>

        <Select
          aria-label="Holat"
          className="w-44"
          placeholder="Barcha holatlar"
          value={conditionFilter}
          onChange={(v) => setConditionFilter(v === null ? null : String(v))}
        >
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              <ListBox.Item id="GOOD" textValue="Yaxshi">Yaxshi<ListBox.ItemIndicator /></ListBox.Item>
              <ListBox.Item id="ATTENTION" textValue="Diqqat">Diqqat talab qiladi<ListBox.ItemIndicator /></ListBox.Item>
              <ListBox.Item id="OVERLOAD" textValue="Ortiqcha">Ortiqcha yuklama<ListBox.ItemIndicator /></ListBox.Item>
              <ListBox.Item id="FAULT" textValue="Nosozlik">Nosozlik<ListBox.ItemIndicator /></ListBox.Item>
            </ListBox>
          </Select.Popover>
        </Select>

        <Chip size="sm" variant="soft">
          <Chip.Label>{rows.length} ta ko‘rsatilmoqda</Chip.Label>
        </Chip>
      </div>

      <Panel flush>
        <TpMonitorPanel rows={rows} />
      </Panel>
    </>
  );
}
