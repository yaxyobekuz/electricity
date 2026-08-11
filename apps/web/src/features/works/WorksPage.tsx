/** Ishlar sahifasi - reja va bajarilgan, natijasi bilan. */
import { Tabs } from '@heroui/react';

import { LoadingState, PageHeader } from '../../components/layout/AppShell.tsx';
import { Panel } from '../../components/ui/Panel.tsx';
import { WorksPanel } from '../district/panels/WorksPanel.tsx';
import { useWorks } from '../../lib/queries.ts';

export default function WorksPage() {
  const works = useWorks();

  if (works.isLoading) return <LoadingState rows={4} />;

  const rows = works.data ?? [];
  const planned = rows.filter((w) => w.status === 'PLANNED');
  const inProgress = rows.filter((w) => w.status === 'IN_PROGRESS');
  const completed = rows.filter((w) => w.status === 'COMPLETED');

  return (
    <>
      <PageHeader
        subtitle={`${planned.length} ta reja · ${inProgress.length} ta jarayonda · ${completed.length} ta bajarilgan`}
        title="Ishlar"
      />

      <Panel flush>
        <Tabs className="w-full">
          <Tabs.ListContainer>
            <Tabs.List aria-label="Ishlar holati">
              <Tabs.Tab id="progress">
                Jarayonda ({inProgress.length})
                <Tabs.Indicator />
              </Tabs.Tab>
              <Tabs.Tab id="planned">
                Reja ({planned.length})
                <Tabs.Indicator />
              </Tabs.Tab>
              <Tabs.Tab id="completed">
                Bajarilgan ({completed.length})
                <Tabs.Indicator />
              </Tabs.Tab>
            </Tabs.List>
          </Tabs.ListContainer>

          {/*
            `full` - bu ALOHIDA sahifa: ro'yxat balandligi cheklanmaydi va
            hech bir qator kesilmaydi. Dashboarddagi ixcham panel esa yonidagi
            panellar bilan bir qatorda turgani uchun past bo'lib qolaveradi.
          */}
          <Tabs.Panel className="p-3" id="progress">
            <WorksPanel full mode="planned" rows={inProgress} />
          </Tabs.Panel>
          <Tabs.Panel className="p-3" id="planned">
            <WorksPanel full mode="planned" rows={planned} />
          </Tabs.Panel>
          <Tabs.Panel className="p-3" id="completed">
            <WorksPanel full mode="completed" rows={completed} />
          </Tabs.Panel>
        </Tabs>
      </Panel>

      <p className="mt-3 text-[11px] text-muted">{'Manba'}: fact.work</p>
    </>
  );
}
