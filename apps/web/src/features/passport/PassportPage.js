/**
 * Pasport sahifasi.
 *
 * Uchta tab:
 *   1. Tuman pasporti — SUM(MFY), qo'lda kiritilmaydi
 *   2. MFY pasporti   — tanlangan mahalla
 *   3. Solishtirish   — SUM(MFY) vs TUMAN qator-baqator
 */
import { Alert, Button, Chip, ListBox, Select, Tabs } from '@heroui/react';
import { CheckCircle2, Lock, Printer, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { ErrorState, LoadingState, PageHeader } from '../../components/layout/AppShell.tsx';
import { EmptyPanel, Panel } from '../../components/ui/Panel.tsx';
import { PeriodPicker } from '../district/panels/PeriodPicker.tsx';
import { useBootstrap, useMfyPassport, useReconcile, useTumanPassport } from '../../lib/queries.ts';
import { useUi } from '../../lib/ui-store.ts';
import { PassportTable } from './PassportTable.tsx';
export default function PassportPage() {
    const { t } = useTranslation();
    const params = useParams();
    const period = useUi((s) => s.period);
    const boot = useBootstrap();
    const routeMfyId = params['scope'] === 'mfy' ? Number(params['id']) : null;
    const [selectedMfy, setSelectedMfy] = useState(routeMfyId);
    const [tab, setTab] = useState(routeMfyId ? 'mfy' : 'tuman');
    const tuman = useTumanPassport(period ?? undefined);
    const mfy = useMfyPassport(selectedMfy, period ?? undefined);
    // Davr hali aniq bo'lmasa `null` — so'rovlar kutib turadi.
    const effectivePeriod = period ?? tuman.data?.period ?? null;
    const reconcile = useReconcile(effectivePeriod);
    if (tuman.isLoading)
        return <LoadingState rows={5}/>;
    if (tuman.isError) {
        return (<ErrorState message={tuman.error instanceof Error ? tuman.error.message : 'Ma’lumot topilmadi'} onRetry={() => void tuman.refetch()}/>);
    }
    const openPrint = () => {
        const scope = tab === 'mfy' && selectedMfy ? `mfy/${selectedMfy}` : 'tuman/0';
        window.open(`/passport/print/${scope}/${effectivePeriod ?? 'latest'}`, '_blank');
    };
    const mismatches = (reconcile.data ?? []).filter((r) => !r.ok);
    return (<>
      <PageHeader actions={<div className="flex items-center gap-2">
            <PeriodPicker />
            <Button size="sm" variant="secondary" onPress={openPrint}>
              <Printer className="size-4"/>
              {t('common.print')}
            </Button>
          </div>} subtitle={t('passport.title')} title={t('nav.passport')}/>

      <Panel flush>
        <Tabs className="w-full" selectedKey={tab} onSelectionChange={(k) => setTab(String(k))}>
          <Tabs.ListContainer>
            <Tabs.List aria-label="Pasport ko‘rinishi">
              <Tabs.Tab id="tuman">
                {t('passport.district')}
                <Tabs.Indicator />
              </Tabs.Tab>
              <Tabs.Tab id="mfy">
                {t('passport.mfy')}
                <Tabs.Indicator />
              </Tabs.Tab>
              <Tabs.Tab id="reconcile">
                {t('passport.reconcile')}
                {mismatches.length > 0 && (<Chip className="ml-1.5" color="danger" size="sm" variant="soft">
                    <Chip.Label>{mismatches.length}</Chip.Label>
                  </Chip>)}
                <Tabs.Indicator />
              </Tabs.Tab>
            </Tabs.List>
          </Tabs.ListContainer>

          {/* ── Tuman pasporti ────────────────────────────────────────── */}
          <Tabs.Panel className="p-4" id="tuman">
            {tuman.data ? (<>
                <PassportHeader frozen={tuman.data.frozen} period={tuman.data.period} scopeName={tuman.data.scopeName}/>
                <Alert className="mb-3" status="accent">
                  <Alert.Indicator />
                  <Alert.Content>
                    <Alert.Title className="text-xs">Avtomatik yig‘ilgan hujjat</Alert.Title>
                    <Alert.Description className="text-[11px]">
                      Tuman pasporti mahallalar pasportlarining yig‘indisidan hosil qilinadi va
                      qo‘lda kiritilmaydi. Bu manba hujjatlarda uchragan «tuman raqamini MFY
                      qatoriga ko‘chirish» xatosini texnik jihatdan imkonsiz qiladi.
                    </Alert.Description>
                  </Alert.Content>
                </Alert>
                <div className="scroll-y max-h-[70vh] rounded-lg border border-border/70">
                  <PassportTable passport={tuman.data}/>
                </div>
              </>) : (<EmptyPanel message={t('common.noData')}/>)}
          </Tabs.Panel>

          {/* ── MFY pasporti ──────────────────────────────────────────── */}
          <Tabs.Panel className="p-4" id="mfy">
            <div className="mb-3">
              <Select aria-label="Mahalla" className="w-64" placeholder="Mahallani tanlang" value={selectedMfy === null ? null : String(selectedMfy)} onChange={(v) => setSelectedMfy(v === null ? null : Number(v))}>
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    {(boot.data?.mfys ?? []).map((m) => (<ListBox.Item key={m.id} id={String(m.id)} textValue={m.nameUz}>
                        {m.nameUz}
                        <ListBox.ItemIndicator />
                      </ListBox.Item>))}
                  </ListBox>
                </Select.Popover>
              </Select>
            </div>

            {selectedMfy === null ? (<EmptyPanel message="Pasportni ko‘rish uchun mahallani tanlang"/>) : mfy.isLoading ? (<LoadingState rows={3}/>) : mfy.data ? (<>
                <PassportHeader frozen={mfy.data.frozen} period={mfy.data.period} scopeName={mfy.data.scopeName}/>
                <div className="scroll-y max-h-[70vh] rounded-lg border border-border/70">
                  <PassportTable passport={mfy.data}/>
                </div>
              </>) : (<EmptyPanel message="Bu davr uchun pasport ma’lumoti yo‘q"/>)}
          </Tabs.Panel>

          {/* ── Solishtirish ──────────────────────────────────────────── */}
          <Tabs.Panel className="p-4" id="reconcile">
            <Alert className="mb-3" status={mismatches.length === 0 ? 'success' : 'danger'}>
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title className="text-xs">
                  {mismatches.length === 0
            ? 'Barcha qatorlar mos keladi'
            : `${mismatches.length} ta qatorda nomuvofiqlik`}
                </Alert.Title>
                <Alert.Description className="text-[11px]">
                  {t('passport.reconcileNote')}
                </Alert.Description>
              </Alert.Content>
            </Alert>

            {reconcile.isLoading ? (<LoadingState rows={3}/>) : (<div className="scroll-y max-h-[70vh] rounded-lg border border-border/70">
                <table className="dt">
                  <thead>
                    <tr>
                      <th className="w-10 text-center">№</th>
                      <th>Ko‘rsatkich</th>
                      <th className="text-right">MFY lar yig‘indisi</th>
                      <th className="text-right">Tuman pasporti</th>
                      <th className="text-right">Farq</th>
                      <th className="w-20">Holat</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(reconcile.data ?? []).map((r) => (<tr key={r.no}>
                        <td className="text-center tabular text-muted">{r.no}</td>
                        <td>{r.labelUz}</td>
                        <td className="num">{r.sumOfMfy?.toLocaleString('uz-Latn-UZ') ?? '—'}</td>
                        <td className="num">{r.frozenValue?.toLocaleString('uz-Latn-UZ') ?? '—'}</td>
                        <td className="num font-medium">
                          {r.diff === null ? '—' : r.diff.toFixed(2)}
                        </td>
                        <td>
                          {r.ok ? (<span className="inline-flex items-center gap-1 text-[11px] text-viz-good">
                              <CheckCircle2 className="size-3.5"/> Mos
                            </span>) : (<span className="inline-flex items-center gap-1 text-[11px] text-viz-critical">
                              <TriangleAlert className="size-3.5"/> Farq
                            </span>)}
                        </td>
                      </tr>))}
                  </tbody>
                </table>
              </div>)}
          </Tabs.Panel>
        </Tabs>
      </Panel>
    </>);
}
function PassportHeader({ scopeName, period, frozen, }) {
    const { t } = useTranslation();
    return (<div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div>
        <h3 className="text-sm font-semibold">{scopeName}</h3>
        <p className="text-[11px] text-muted">{period}</p>
      </div>
      {frozen ? (<div className="flex items-center gap-2">
          <Chip color="success" size="sm" variant="soft">
            <Lock className="size-3"/>
            <Chip.Label>{t('passport.frozen')}</Chip.Label>
          </Chip>
          <span className="font-mono text-[10px] text-muted" title={frozen.sha256}>
            {frozen.sha256.slice(0, 12)}…
          </span>
        </div>) : (<Chip size="sm" variant="soft">
          <Chip.Label>{t('passport.notFrozen')}</Chip.Label>
        </Chip>)}
    </div>);
}
