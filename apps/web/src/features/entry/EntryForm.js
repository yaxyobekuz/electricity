import { DOMAIN_LABEL_UZ, balanceTolerance, dateDayMonth, num, periodDates, periodLabel, } from '@beap/shared';
import { AlertDialog, Alert, Button, Chip, Description, Input, InputGroup, Label, NumberField, TextField, toast, } from '@heroui/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Save, Send } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';
import { ErrorState, LoadingState, PageHeader } from '../../components/layout/AppShell.tsx';
import { Panel } from '../../components/ui/Panel.tsx';
import { ApiRequestError, api } from '../../lib/api.ts';
import { useBootstrap } from '../../lib/queries.ts';
import { TotalsBar } from './TotalsBar.tsx';
const r2 = (x) => Math.round(x * 100) / 100;
export default function EntryForm() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const params = useParams();
    const qc = useQueryClient();
    const boot = useBootstrap();
    const mfyId = Number(params['mfyId']);
    const period = params['period'] ?? '';
    const domain = params['domain'] ?? 'ENERGY_BALANCE';
    const mfy = boot.data?.mfys.find((m) => m.id === mfyId);
    // Qoralama ochish (yoki mavjudini olish)
    const draft = useQuery({
        queryKey: ['entry', 'draft', mfyId, domain, period],
        queryFn: () => api.post('/entry/submission', {
            scopeType: 'MFY', scopeId: mfyId, domain, period,
        }),
        enabled: Number.isFinite(mfyId) && period !== '',
        retry: false,
    });
    const submissionId = draft.data?.id;
    const detail = useQuery({
        queryKey: ['entry', 'submission', submissionId],
        queryFn: () => api.get(`/entry/submission/${submissionId}`),
        enabled: Boolean(submissionId),
    });
    if (!Number.isFinite(mfyId) || !period) {
        return <ErrorState message="Manzil parametrlari noto‘g‘ri"/>;
    }
    if (draft.isLoading || detail.isLoading)
        return <LoadingState rows={5}/>;
    if (draft.isError) {
        return (<ErrorState message={draft.error instanceof ApiRequestError
                ? draft.error.message
                : 'Qoralama ochib bo‘lmadi'} onRetry={() => void draft.refetch()}/>);
    }
    const submission = detail.data?.submission ?? draft.data;
    if (!submission)
        return <ErrorState message="Konvert topilmadi"/>;
    const readOnly = submission.status !== 'draft' && submission.status !== 'rejected';
    return (<>
      <PageHeader actions={<Button size="sm" variant="ghost" onPress={() => void navigate('/entry')}>
            <ArrowLeft className="size-4"/>
            {t('common.back')}
          </Button>} breadcrumbs={[
            { label: t('nav.entry'), to: '/entry' },
            { label: mfy?.nameUz ?? `MFY #${mfyId}` },
            { label: periodLabel(period) },
        ]} subtitle={`${DOMAIN_LABEL_UZ[domain] ?? domain} · revision ${submission.revision}`} title={`${mfy?.nameUz ?? ''} — ${periodLabel(period)}`}/>

      {submission.status === 'rejected' && submission.reviewNote && (<Alert className="mb-3" status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title className="text-xs">Hisobot rad etilgan</Alert.Title>
            <Alert.Description className="text-[11px]">{submission.reviewNote}</Alert.Description>
          </Alert.Content>
        </Alert>)}

      {readOnly && (<Alert className="mb-3" status="accent">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title className="text-xs">Faqat o‘qish rejimi</Alert.Title>
            <Alert.Description className="text-[11px]">
              Bu hisobot «{submission.status}» holatida. Tahrirlash uchun tuzatish revisiyasini oching.
            </Alert.Description>
          </Alert.Content>
        </Alert>)}

      {domain === 'ENERGY_BALANCE' ? (<EnergyBalanceGrid initial={detail.data?.data ?? []} period={period} readOnly={readOnly} submission={submission} validation={detail.data?.validation} onSaved={() => void qc.invalidateQueries({ queryKey: ['entry'] })}/>) : domain === 'MONTHLY_RETURN' ? (<MonthlyReturnForm initial={detail.data?.data ?? null} readOnly={readOnly} submission={submission} validation={detail.data?.validation} onSaved={() => void qc.invalidateQueries({ queryKey: ['entry'] })}/>) : (<Panel>
          <p className="text-sm text-muted">
            «{DOMAIN_LABEL_UZ[domain] ?? domain}» formasi
            keyingi bosqichda qo‘shiladi. Ma’lumotlar bazasi va API allaqachon tayyor.
          </p>
        </Panel>)}
    </>);
}
// ═══════════════════════════════════════════════════════════════════════════
// Kunlik energiya balansi — oylik jadval
// ═══════════════════════════════════════════════════════════════════════════
function EnergyBalanceGrid({ submission, period, initial, readOnly, validation, onSaved, }) {
    const navigate = useNavigate();
    const dates = useMemo(() => periodDates(period), [period]);
    const [rows, setRows] = useState(() => {
        const map = {};
        for (const d of dates) {
            map[d] = {
                bizDate: d, kwhIn: 0, kwhSold: 0,
                kwhLossNatural: 0, kwhLossTechnical: 0, kwhLossIllegal: 0, note: null,
            };
        }
        for (const r of initial)
            map[r.bizDate] = r;
        return map;
    });
    const [saveState, setSaveState] = useState('idle');
    const [savedAt, setSavedAt] = useState(null);
    const [fieldErrors, setFieldErrors] = useState({});
    const debounceRef = useRef(null);
    const saveMutation = useMutation({
        mutationFn: (payload) => api.patch(`/entry/submission/${submission.id}/energy-balance`, { rows: payload }),
        onMutate: () => setSaveState('saving'),
        onSuccess: (res) => {
            setSaveState('saved');
            setSavedAt(res.savedAt);
            setFieldErrors({});
            onSaved();
        },
        onError: (err) => {
            setSaveState('error');
            if (err instanceof ApiRequestError) {
                setFieldErrors(err.fieldErrors);
                toast.danger(err.message);
            }
        },
    });
    /** Avtosaqlash — 800 ms kechikish. */
    const scheduleSave = useCallback((next) => {
        if (readOnly)
            return;
        if (debounceRef.current)
            clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            const filled = Object.values(next).filter((r) => r.kwhIn > 0);
            if (filled.length > 0)
                saveMutation.mutate(filled);
        }, 800);
    }, [readOnly, saveMutation]);
    useEffect(() => () => {
        if (debounceRef.current)
            clearTimeout(debounceRef.current);
    }, []);
    const update = (date, patch) => {
        setRows((prev) => {
            const next = { ...prev, [date]: { ...prev[date], ...patch } };
            scheduleSave(next);
            return next;
        });
    };
    const totals = useMemo(() => {
        let kwhIn = 0, kwhSold = 0, lossParts = 0;
        for (const r of Object.values(rows)) {
            kwhIn += r.kwhIn;
            kwhSold += r.kwhSold;
            lossParts += r.kwhLossNatural + r.kwhLossTechnical + r.kwhLossIllegal;
        }
        return { kwhIn: r2(kwhIn), kwhSold: r2(kwhSold), lossTotal: r2(kwhIn - kwhSold), lossParts: r2(lossParts) };
    }, [rows]);
    /** Har bir kunning qoldig'ini texnik yo'qotishga taqsimlaydi. */
    const fillRemainder = () => {
        setRows((prev) => {
            const next = { ...prev };
            for (const [date, r] of Object.entries(prev)) {
                if (r.kwhIn <= 0)
                    continue;
                const total = r2(r.kwhIn - r.kwhSold);
                const parts = r2(r.kwhLossNatural + r.kwhLossIllegal);
                const technical = Math.max(0, r2(total - parts));
                next[date] = { ...r, kwhLossTechnical: technical };
            }
            scheduleSave(next);
            return next;
        });
        toast.success('Qoldiq texnik yo‘qotishga taqsimlandi');
    };
    const submitMutation = useMutation({
        mutationFn: () => api.post(`/entry/submission/${submission.id}/submit`),
        onSuccess: () => {
            toast.success('Hisobot tasdiqlashga yuborildi');
            void navigate('/entry');
        },
        onError: (err) => {
            if (err instanceof ApiRequestError) {
                setFieldErrors(err.fieldErrors);
                toast.danger(err.message);
            }
        },
    });
    const filledDays = Object.values(rows).filter((r) => r.kwhIn > 0).length;
    const hasErrors = (validation?.issues ?? []).some((i) => i.severity === 'error');
    return (<>
      <Panel actions={!readOnly && (<div className="flex items-center gap-2">
              <Button isPending={saveMutation.isPending} size="sm" variant="secondary" onPress={() => {
                const filled = Object.values(rows).filter((r) => r.kwhIn > 0);
                saveMutation.mutate(filled);
            }}>
                <Save className="size-4"/>
                Saqlash
              </Button>
              <AlertDialog>
                <Button isDisabled={hasErrors || filledDays === 0} size="sm">
                  <Send className="size-4"/>
                  Tasdiqlashga yuborish
                </Button>
                <AlertDialog.Backdrop>
                  <AlertDialog.Container>
                    <AlertDialog.Dialog className="sm:max-w-md">
                      <AlertDialog.CloseTrigger />
                      <AlertDialog.Header>
                        <AlertDialog.Icon status="accent"/>
                        <AlertDialog.Heading>Tasdiqlashga yuborilsinmi?</AlertDialog.Heading>
                      </AlertDialog.Header>
                      <AlertDialog.Body>
                        <p className="text-sm">
                          {filledDays} kunlik ma’lumot yuboriladi. Yuborilgandan keyin
                          tahrirlash uchun tuzatish revisiyasi ochish kerak bo‘ladi.
                        </p>
                        <dl className="mt-3 flex flex-col gap-1 text-xs">
                          <div className="flex justify-between">
                            <dt className="text-muted">Tarmoqqa kirgan</dt>
                            <dd className="tabular font-medium">{num(totals.kwhIn, 1)} kWh</dd>
                          </div>
                          <div className="flex justify-between">
                            <dt className="text-muted">Sotilgan</dt>
                            <dd className="tabular font-medium">{num(totals.kwhSold, 1)} kWh</dd>
                          </div>
                          <div className="flex justify-between">
                            <dt className="text-muted">Yo‘qotish</dt>
                            <dd className="tabular font-medium">{num(totals.lossTotal, 1)} kWh</dd>
                          </div>
                        </dl>
                      </AlertDialog.Body>
                      <AlertDialog.Footer>
                        <Button slot="close" variant="tertiary">Bekor qilish</Button>
                        <Button slot="close" onPress={() => submitMutation.mutate()}>
                          Yuborish
                        </Button>
                      </AlertDialog.Footer>
                    </AlertDialog.Dialog>
                  </AlertDialog.Container>
                </AlertDialog.Backdrop>
              </AlertDialog>
            </div>)} subtitle="Qator = kun. «Jami yo‘qotish» ustuni hisoblanadi va tahrirlanmaydi." title="Kunlik energiya balansi" flush>
        {/* Tekshiruv xabarlari */}
        {validation && validation.issues.length > 0 && (<div className="border-b border-separator px-4 py-2.5">
            <ul className="flex flex-col gap-1">
              {validation.issues.slice(0, 5).map((issue, i) => (<li key={i} className="text-[11px]" style={{
                    color: issue.severity === 'error' ? 'var(--viz-critical)' : 'var(--viz-warning)',
                }}>
                  {issue.rowKey ? `${issue.rowKey}: ` : ''}
                  {issue.message}
                </li>))}
              {validation.issues.length > 5 && (<li className="text-[11px] text-muted">
                  … va yana {validation.issues.length - 5} ta
                </li>)}
            </ul>
          </div>)}

        <div className="scroll-y max-h-[58vh] overflow-x-auto">
          <table className="dt min-w-[880px]">
            <thead>
              <tr>
                <th className="sticky left-0 z-20 w-24 bg-surface">Kun</th>
                <th className="text-right">Tarmoqqa kirgan</th>
                <th className="text-right">Sotilgan</th>
                <th className="text-right">Tabiiy</th>
                <th className="text-right">Texnik</th>
                <th className="text-right">Noqonuniy</th>
                <th className="text-right">Jami yo‘qotish</th>
                <th className="text-right">%</th>
              </tr>
            </thead>
            <tbody>
              {dates.map((date) => {
            const row = rows[date];
            const lossTotal = r2(row.kwhIn - row.kwhSold);
            const parts = r2(row.kwhLossNatural + row.kwhLossTechnical + row.kwhLossIllegal);
            const mismatch = row.kwhIn > 0 && Math.abs(lossTotal - parts) > balanceTolerance(row.kwhIn);
            const lossPct = row.kwhIn > 0 ? (lossTotal / row.kwhIn) * 100 : 0;
            return (<tr key={date} className={mismatch ? 'bg-danger/5' : undefined}>
                    {/* Yil sarlavhada turibdi — har qatorda takrorlanmaydi. */}
                    <td className="sticky left-0 z-10 bg-surface font-medium">
                      {dateDayMonth(date)}
                    </td>
                    <NumCell readOnly={readOnly} value={row.kwhIn} onChange={(v) => update(date, { kwhIn: v })}/>
                    <NumCell invalid={row.kwhSold > row.kwhIn} readOnly={readOnly} value={row.kwhSold} onChange={(v) => update(date, { kwhSold: v })}/>
                    <NumCell readOnly={readOnly} value={row.kwhLossNatural} onChange={(v) => update(date, { kwhLossNatural: v })}/>
                    <NumCell invalid={mismatch} readOnly={readOnly} value={row.kwhLossTechnical} onChange={(v) => update(date, { kwhLossTechnical: v })}/>
                    <NumCell readOnly={readOnly} value={row.kwhLossIllegal} onChange={(v) => update(date, { kwhLossIllegal: v })}/>
                    {/* HISOBLANADI — kiritilmaydi */}
                    <td className="num bg-surface-secondary font-semibold">
                      {num(lossTotal, 1)}
                    </td>
                    <td className="num text-muted">{lossPct.toFixed(2)}%</td>
                  </tr>);
        })}
            </tbody>
          </table>
        </div>
      </Panel>

      <TotalsBar expectedDays={dates.length} filledDays={filledDays} savedAt={savedAt} saveState={saveState} totals={totals} onFillRemainder={readOnly ? undefined : fillRemainder}/>

      {Object.keys(fieldErrors).length > 0 && (<Alert className="mt-3" status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title className="text-xs">Server tekshiruvi</Alert.Title>
            <Alert.Description className="text-[11px]">
              {Object.values(fieldErrors).join(' · ')}
            </Alert.Description>
          </Alert.Content>
        </Alert>)}
    </>);
}
/** Raqamli katakcha — birlik maydon ichida ko'rsatilmaydi (jadvalda joy tejaladi). */
function NumCell({ value, onChange, readOnly, invalid, }) {
    return (<td className="num p-1">
      <NumberField aria-label="Qiymat" className="w-full" formatOptions={{ style: 'decimal', maximumFractionDigits: 1 }} isDisabled={readOnly} isInvalid={invalid ?? false} minValue={0} value={value} onChange={(v) => onChange(Number.isFinite(v) ? (v ?? 0) : 0)}>
        <NumberField.Group>
          <NumberField.Input className="w-full text-right text-xs tabular"/>
        </NumberField.Group>
      </NumberField>
    </td>);
}
// ═══════════════════════════════════════════════════════════════════════════
// Oylik hisobot — pasportning 1, 5, 6, 7, 13-qatorlari
// ═══════════════════════════════════════════════════════════════════════════
const EMPTY_RETURN = {
    consumersPopulation: 0, consumersLegal: 0, consumersActive: 0,
    consumersDisconnected: 0, consumersNew: 0,
    debtPopulationMln: 0, debtLegalMln: 0, debtBudgetMln: 0,
    metersOfflineCnt: 0, lowConsumptionCnt: 0,
    metersReplaceNeedCnt: 0, metersReplacedCnt: 0,
};
function MonthlyReturnForm({ submission, initial, readOnly, validation, onSaved, }) {
    const navigate = useNavigate();
    const [data, setData] = useState(initial ?? EMPTY_RETURN);
    const [fieldErrors, setFieldErrors] = useState({});
    const [saveState, setSaveState] = useState('idle');
    const [savedAt, setSavedAt] = useState(null);
    const save = useMutation({
        mutationFn: (payload) => api.patch(`/entry/submission/${submission.id}/monthly-return`, payload),
        onMutate: () => setSaveState('saving'),
        onSuccess: (res) => {
            setSaveState('saved');
            setSavedAt(res.savedAt);
            setFieldErrors({});
            toast.success('Saqlandi');
            onSaved();
        },
        onError: (err) => {
            setSaveState('error');
            if (err instanceof ApiRequestError) {
                setFieldErrors(err.fieldErrors);
                toast.danger(err.message);
            }
        },
    });
    const submit = useMutation({
        mutationFn: () => api.post(`/entry/submission/${submission.id}/submit`),
        onSuccess: () => {
            toast.success('Hisobot tasdiqlashga yuborildi');
            void navigate('/entry');
        },
        onError: (err) => {
            if (err instanceof ApiRequestError) {
                setFieldErrors(err.fieldErrors);
                toast.danger(err.message);
            }
        },
    });
    const set = (patch) => setData((d) => ({ ...d, ...patch }));
    const consumersTotal = data.consumersPopulation + data.consumersLegal;
    const debtTotal = data.debtPopulationMln + data.debtLegalMln + data.debtBudgetMln;
    return (<div className="flex flex-col gap-3">
      {/* 1-qator: iste'molchilar */}
      <Panel subtitle="Pasport 1-qatori" title="Iste’molchilar">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <NumInput error={fieldErrors['consumersPopulation']} label="Aholi" readOnly={readOnly} unit="ta" value={data.consumersPopulation} onChange={(v) => set({ consumersPopulation: v })}/>
          <NumInput error={fieldErrors['consumersLegal']} label="Yuridik" readOnly={readOnly} unit="ta" value={data.consumersLegal} onChange={(v) => set({ consumersLegal: v })}/>
          <ComputedField label="Jami" unit="ta" value={consumersTotal}/>
          <NumInput error={fieldErrors['consumersActive']} label="Aloqaga chiqayotgan istemolchilar" readOnly={readOnly} unit="ta" value={data.consumersActive} onChange={(v) => set({ consumersActive: v })}/>
          <NumInput error={fieldErrors['consumersDisconnected']} label="Uzilgan" readOnly={readOnly} unit="ta" value={data.consumersDisconnected} onChange={(v) => set({ consumersDisconnected: v })}/>
        </div>
      </Panel>

      {/* 5-qator: qarzdorlik */}
      <Panel subtitle="Pasport 5-qatori" title="Debitor qarzdorlik">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <NumInput decimals={1} error={fieldErrors['debtPopulationMln']} label="Aholi" readOnly={readOnly} unit="mln so‘m" value={data.debtPopulationMln} onChange={(v) => set({ debtPopulationMln: v })}/>
          <NumInput decimals={1} error={fieldErrors['debtLegalMln']} label="Yuridik" readOnly={readOnly} unit="mln so‘m" value={data.debtLegalMln} onChange={(v) => set({ debtLegalMln: v })}/>
          <NumInput decimals={1} error={fieldErrors['debtBudgetMln']} label="Budjet tashkilotlari" readOnly={readOnly} unit="mln so‘m" value={data.debtBudgetMln} onChange={(v) => set({ debtBudgetMln: v })}/>
          <ComputedField decimals={1} label="Jami" unit="mln so‘m" value={debtTotal}/>
        </div>
      </Panel>

      {/* 6, 7, 13-qatorlar: hisoblagichlar */}
      <Panel subtitle="Pasport 6, 7, 13-qatorlari" title="Hisoblagichlar">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <NumInput error={fieldErrors['metersOfflineCnt']} label="Aloqadan chiqqan" readOnly={readOnly} unit="ta" value={data.metersOfflineCnt} onChange={(v) => set({ metersOfflineCnt: v })}/>
          <NumInput error={fieldErrors['lowConsumptionCnt']} hint="0 va 50 kWh dan kam" label="Kam iste’molchilar" readOnly={readOnly} unit="ta" value={data.lowConsumptionCnt} onChange={(v) => set({ lowConsumptionCnt: v })}/>
          <NumInput error={fieldErrors['metersReplaceNeedCnt']} label="Almashtirish kerak" readOnly={readOnly} unit="ta" value={data.metersReplaceNeedCnt} onChange={(v) => set({ metersReplaceNeedCnt: v })}/>
          <NumInput error={fieldErrors['metersReplacedCnt']} label="Almashtirilgan" readOnly={readOnly} unit="ta" value={data.metersReplacedCnt} onChange={(v) => set({ metersReplacedCnt: v })}/>
        </div>
      </Panel>

      {validation && validation.issues.length > 0 && (<Alert status={validation.ok ? 'warning' : 'danger'}>
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title className="text-xs">Tekshiruv</Alert.Title>
            <Alert.Description className="text-[11px]">
              {validation.issues.map((i) => i.message).join(' · ')}
            </Alert.Description>
          </Alert.Content>
        </Alert>)}

      {!readOnly && (<div className="sticky bottom-0 -mx-4 flex items-center justify-between gap-3 border-t border-border bg-surface/97 px-4 py-2.5 backdrop-blur">
          <div className="flex items-center gap-3 text-xs">
            <span className="text-muted">Jami iste’molchilar:</span>
            <span className="tabular font-semibold">{num(consumersTotal)} ta</span>
            <span className="text-muted">Jami qarzdorlik:</span>
            <span className="tabular font-semibold">{num(debtTotal, 1)} mln so‘m</span>
            <Chip size="sm" variant="soft">
              <Chip.Label>hisoblanadi</Chip.Label>
            </Chip>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted">
              {saveState === 'saving' ? 'Saqlanmoqda…'
                : saveState === 'saved' && savedAt
                    ? `Saqlandi ${new Date(savedAt).toLocaleTimeString('uz-Latn-UZ', { hour: '2-digit', minute: '2-digit' })}`
                    : ''}
            </span>
            <Button isPending={save.isPending} size="sm" variant="secondary" onPress={() => save.mutate(data)}>
              <Save className="size-4"/>
              Saqlash
            </Button>
            <Button isDisabled={consumersTotal === 0} isPending={submit.isPending} size="sm" onPress={() => submit.mutate()}>
              <Send className="size-4"/>
              Tasdiqlashga yuborish
            </Button>
          </div>
        </div>)}
    </div>);
}
/** Kiritiladigan raqamli maydon — birlik MAYDON ICHIDA. */
function NumInput({ label, value, onChange, unit, hint, error, readOnly, decimals = 0, }) {
    return (<NumberField className="w-full" formatOptions={{ style: 'decimal', maximumFractionDigits: decimals }} isDisabled={readOnly} isInvalid={Boolean(error)} minValue={0} value={value} onChange={(v) => onChange(Number.isFinite(v) ? (v ?? 0) : 0)}>
      <Label className="text-xs">{label}</Label>
      <InputGroup>
        <NumberField.Input className="w-full text-right tabular"/>
        <InputGroup.Suffix className="text-[11px] text-muted">{unit}</InputGroup.Suffix>
      </InputGroup>
      {error ? (<p className="text-[11px] text-danger">{error}</p>) : hint ? (<Description className="text-[10px]">{hint}</Description>) : null}
    </NumberField>);
}
/** Hisoblanadigan maydon — FAQAT O'QISH. Jamilar hech qachon kiritilmaydi. */
function ComputedField({ label, value, unit, decimals = 0, }) {
    return (<TextField isDisabled className="w-full" value={num(value, decimals)}>
      <Label className="flex items-center gap-1.5 text-xs">
        {label}
        <Chip size="sm" variant="soft">
          <Chip.Label>hisoblanadi</Chip.Label>
        </Chip>
      </Label>
      <InputGroup>
        <Input className="w-full bg-surface-secondary text-right tabular font-semibold" readOnly/>
        <InputGroup.Suffix className="text-[11px] text-muted">{unit}</InputGroup.Suffix>
      </InputGroup>
    </TextField>);
}
