/** Mahallalar ro'yxati — yo'qotish reytingi va tez o'tish. */
import { pct } from '@beap/shared';
import { Chip, SearchField, Table } from '@heroui/react';
import type { SortDescriptor } from '@heroui/react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { LoadingState, PageHeader } from '../../components/layout/AppShell.tsx';
import { Panel } from '../../components/ui/Panel.tsx';
import { PeriodPicker } from '../district/panels/PeriodPicker.tsx';
import { useBootstrap, useLossMap } from '../../lib/queries.ts';
import { useUi } from '../../lib/ui-store.ts';

const STATUS_LABEL: Record<string, string> = {
  good: 'Yaxshi', warning: 'Diqqat', serious: 'Jiddiy', critical: 'Tanqidiy',
};

export default function MfyList() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const period = useUi((s) => s.period);
  const boot = useBootstrap();
  const lossMap = useLossMap(period ?? undefined);

  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortDescriptor>({ column: 'lossPct', direction: 'descending' });

  const rows = useMemo(() => {
    const cells = lossMap.data ?? [];
    const byId = new Map((boot.data?.mfys ?? []).map((m) => [m.id, m]));

    const merged = cells.map((c) => ({
      ...c,
      elektroset: byId.get(c.mfyId)?.elektrosetName ?? '—',
    }));

    const filtered = search
      ? merged.filter((r) => r.nameUz.toLowerCase().includes(search.toLowerCase()))
      : merged;

    const col = sort.column as string;
    return [...filtered].sort((a, b) => {
      const av = a[col as keyof typeof a];
      const bv = b[col as keyof typeof b];
      let cmp = 0;
      if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
      else cmp = String(av).localeCompare(String(bv));
      return sort.direction === 'descending' ? -cmp : cmp;
    });
  }, [lossMap.data, boot.data, search, sort]);

  if (lossMap.isLoading) return <LoadingState rows={5} />;

  return (
    <>
      <PageHeader
        actions={
          <div className="flex items-center gap-2">
            <SearchField
              aria-label={t('common.search')}
              className="w-56"
              value={search}
              onChange={setSearch}
            >
              <SearchField.Group>
                <SearchField.SearchIcon />
                <SearchField.Input placeholder="Mahalla nomi…" />
                <SearchField.ClearButton />
              </SearchField.Group>
            </SearchField>
            <PeriodPicker />
          </div>
        }
        subtitle={`${rows.length} ta mahalla`}
        title={t('nav.mahallalar')}
      />

      <Panel flush>
        <Table>
          <Table.ScrollContainer>
            <Table.Content
              aria-label="Mahallalar"
              className="min-w-[760px]"
              sortDescriptor={sort}
              onSortChange={setSort}
            >
              <Table.Header>
                <Table.Column allowsSorting isRowHeader id="nameUz">
                  {({ sortDirection }) => (
                    <Table.SortableColumnHeader sortDirection={sortDirection}>
                      Mahalla
                    </Table.SortableColumnHeader>
                  )}
                </Table.Column>
                <Table.Column allowsSorting id="elektroset">
                  {({ sortDirection }) => (
                    <Table.SortableColumnHeader sortDirection={sortDirection}>
                      Elektroset
                    </Table.SortableColumnHeader>
                  )}
                </Table.Column>
                <Table.Column allowsSorting id="kwhIn">
                  {({ sortDirection }) => (
                    <Table.SortableColumnHeader sortDirection={sortDirection}>
                      Energiya
                    </Table.SortableColumnHeader>
                  )}
                </Table.Column>
                <Table.Column allowsSorting id="lossPct">
                  {({ sortDirection }) => (
                    <Table.SortableColumnHeader sortDirection={sortDirection}>
                      Yo‘qotish
                    </Table.SortableColumnHeader>
                  )}
                </Table.Column>
                <Table.Column allowsSorting id="gapPp">
                  {({ sortDirection }) => (
                    <Table.SortableColumnHeader sortDirection={sortDirection}>
                      Normadan farq
                    </Table.SortableColumnHeader>
                  )}
                </Table.Column>
                <Table.Column id="status">Holat</Table.Column>
              </Table.Header>
              <Table.Body>
                {rows.map((r) => (
                  <Table.Row
                    key={r.mfyId}
                    id={r.mfyId}
                    onAction={() => void navigate(`/dashboard/mfy/${r.mfyId}`)}
                  >
                    <Table.Cell>
                      <span className="font-medium">{r.nameUz}</span>
                    </Table.Cell>
                    <Table.Cell>
                      <span className="text-muted">{r.elektroset}</span>
                    </Table.Cell>
                    <Table.Cell>
                      <span className="tabular">
                        {(r.kwhIn / 1e6).toFixed(2)} mln kWh
                      </span>
                    </Table.Cell>
                    <Table.Cell>
                      <span className="tabular font-semibold">{pct(r.lossPct, 2)}</span>
                    </Table.Cell>
                    <Table.Cell>
                      <span
                        className="tabular font-medium"
                        style={{
                          color: r.gapPp > 0 ? 'var(--viz-critical)' : 'var(--viz-good)',
                        }}
                      >
                        {r.gapPp > 0 ? '+' : ''}
                        {r.gapPp.toFixed(2)} p.p.
                      </span>
                    </Table.Cell>
                    <Table.Cell>
                      <Chip
                        color={
                          r.status === 'good' ? 'success'
                            : r.status === 'warning' ? 'warning' : 'danger'
                        }
                        size="sm"
                        variant="soft"
                      >
                        <span className={`dot dot--${r.status}`} aria-hidden="true" />
                        <Chip.Label>{STATUS_LABEL[r.status]}</Chip.Label>
                      </Chip>
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>
      </Panel>
    </>
  );
}
