/**
 * Tasdiqlash navbati.
 *
 * Ko'ruvchi (elektroset menejeri / admin) yuborilgan hisobotlarni ko'radi,
 * oldingi tasdiqlangan revisiya bilan MAYDON DARAJASIDAGI farqni tekshiradi
 * va tasdiqlaydi yoki sabab bilan rad etadi.
 */
import type { Submission, SubmissionDiffRow } from '@beap/shared';
import { DOMAIN_LABEL_UZ, dateTimeLabel, num, periodLabel } from '@beap/shared';
import {
  AlertDialog, Alert, Button, Chip, Label, Modal, TextArea, TextField, toast,
} from '@heroui/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Eye, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { LoadingState, PageHeader } from '../../components/layout/AppShell.tsx';
import { EmptyPanel, Panel } from '../../components/ui/Panel.tsx';
import { ApiRequestError, api } from '../../lib/api.ts';
import { useReviewQueue } from '../../lib/queries.ts';
import { useUi } from '../../lib/ui-store.ts';

export default function ReviewQueue() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const user = useUi((s) => s.user);
  const canReview = user && ['elektroset_manager', 'admin'].includes(user.role);

  const queue = useReviewQueue(Boolean(canReview));
  const [selected, setSelected] = useState<Submission | null>(null);
  const [rejectNote, setRejectNote] = useState('');

  const approve = useMutation({
    mutationFn: (id: number) => api.post<Submission>(`/entry/submission/${id}/approve`, {}),
    onSuccess: () => {
      toast.success('Hisobot tasdiqlandi. Agregatlar yangilanmoqda.');
      void qc.invalidateQueries({ queryKey: ['entry'] });
      void qc.invalidateQueries({ queryKey: ['dash'] });
      setSelected(null);
    },
    onError: (err) => {
      toast.danger(err instanceof ApiRequestError ? err.message : 'Xatolik');
    },
  });

  const reject = useMutation({
    mutationFn: ({ id, note }: { id: number; note: string }) =>
      api.post<Submission>(`/entry/submission/${id}/reject`, { note }),
    onSuccess: () => {
      toast.success('Hisobot rad etildi');
      void qc.invalidateQueries({ queryKey: ['entry'] });
      setSelected(null);
      setRejectNote('');
    },
    onError: (err) => {
      toast.danger(err instanceof ApiRequestError ? err.message : 'Xatolik');
    },
  });

  if (!canReview) {
    return (
      <>
        <PageHeader title={t('nav.review')} />
        <Alert status="warning">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title className="text-xs">Ruxsat yo‘q</Alert.Title>
            <Alert.Description className="text-[11px]">
              Hisobotlarni tasdiqlash faqat elektroset menejeri va administrator uchun mavjud.
            </Alert.Description>
          </Alert.Content>
        </Alert>
      </>
    );
  }

  if (queue.isLoading) return <LoadingState rows={4} />;

  const rows = queue.data ?? [];

  return (
    <>
      <PageHeader
        subtitle={`${rows.length} ta hisobot ko‘rib chiqishni kutmoqda`}
        title={t('entry.reviewQueue')}
      />

      <Panel flush>
        {rows.length === 0 ? (
          <EmptyPanel message={t('entry.noSubmissions')} />
        ) : (
          <table className="dt">
            <thead>
              <tr>
                <th>Fider</th>
                <th>Ma’lumot turi</th>
                <th>Davr</th>
                <th>Revision</th>
                <th>Yuborgan</th>
                <th>Yuborilgan sana</th>
                <th className="w-44">Amal</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td className="font-medium">{s.scopeName}</td>
                  <td>{DOMAIN_LABEL_UZ[s.domain]}</td>
                  <td className="tabular">{periodLabel(s.periodStart.slice(0, 7))}</td>
                  <td className="tabular text-muted">#{s.revision}</td>
                  <td className="text-muted">{s.createdByName}</td>
                  <td className="tabular text-muted">
                    {s.submittedAt ? dateTimeLabel(s.submittedAt) : '—'}
                  </td>
                  <td>
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="ghost" onPress={() => setSelected(s)}>
                        <Eye className="size-3.5" />
                        Ko‘rish
                      </Button>
                      <Button
                        isPending={approve.isPending && approve.variables === s.id}
                        size="sm"
                        onPress={() => approve.mutate(s.id)}
                      >
                        <Check className="size-3.5" />
                        Tasdiqlash
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      {/* Farq oynasi */}
      {selected && (
        <Modal.Backdrop isOpen onOpenChange={(open) => !open && setSelected(null)}>
          <Modal.Container size="lg">
            <Modal.Dialog>
              <Modal.CloseTrigger />
              <Modal.Header>
                <Modal.Heading>
                  {selected.scopeName} — {DOMAIN_LABEL_UZ[selected.domain]}
                </Modal.Heading>
              </Modal.Header>
              <Modal.Body>
                <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
                  <Chip size="sm" variant="soft">
                    <Chip.Label>{periodLabel(selected.periodStart.slice(0, 7))}</Chip.Label>
                  </Chip>
                  <Chip size="sm" variant="soft">
                    <Chip.Label>Revision #{selected.revision}</Chip.Label>
                  </Chip>
                  <span className="text-muted">{selected.createdByName}</span>
                </div>

                <DiffTable submissionId={selected.id} />

                <div className="mt-4">
                  <TextField
                    className="w-full"
                    value={rejectNote}
                    onChange={setRejectNote}
                  >
                    <Label className="text-xs">Rad etish sababi (rad etish uchun majburiy)</Label>
                    <TextArea
                      placeholder="Masalan: 12–14-kunlarda tarmoqqa kirgan energiya qiymati shubhali…"
                      rows={2}
                    />
                  </TextField>
                </div>
              </Modal.Body>
              <Modal.Footer>
                <Button
                  isDisabled={rejectNote.trim().length < 5}
                  variant="danger"
                  onPress={() => reject.mutate({ id: selected.id, note: rejectNote })}
                >
                  <X className="size-4" />
                  Rad etish
                </Button>
                <Button onPress={() => approve.mutate(selected.id)}>
                  <Check className="size-4" />
                  Tasdiqlash
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      )}
    </>
  );
}

/** Oldingi tasdiqlangan revisiya bilan maydon darajasidagi farq. */
function DiffTable({ submissionId }: { submissionId: number }) {
  const diff = useQuery({
    queryKey: ['entry', 'diff', submissionId],
    queryFn: () => api.get<SubmissionDiffRow[]>(`/entry/submission/${submissionId}/diff`),
  });

  if (diff.isLoading) return <LoadingState rows={2} />;
  const rows = diff.data ?? [];

  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-border/70 bg-surface-secondary px-3 py-2.5 text-xs text-muted">
        Bu birinchi revisiya — taqqoslash uchun oldingi tasdiqlangan hisobot yo‘q.
      </p>
    );
  }

  return (
    <div className="rounded-lg border border-border/70">
      <table className="dt">
        <thead>
          <tr>
            <th>Ko‘rsatkich</th>
            <th className="text-right">Oldingi</th>
            <th className="text-right">Yangi</th>
            <th className="text-right">O‘zgarish</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const big = r.deltaPct !== null && Math.abs(r.deltaPct) > 30;
            return (
              <tr key={r.path} className={big ? 'bg-warning/10' : undefined}>
                <td>{r.labelUz}</td>
                <td className="num text-muted">
                  {typeof r.before === 'number' ? num(r.before, 1) : (r.before ?? '—')}
                </td>
                <td className="num font-medium">
                  {typeof r.after === 'number' ? num(r.after, 1) : (r.after ?? '—')}
                </td>
                <td className="num">
                  {r.deltaPct === null ? (
                    '—'
                  ) : (
                    <span
                      className="font-medium"
                      style={{
                        color: big ? 'var(--viz-warning)' : 'var(--viz-muted)',
                      }}
                    >
                      {r.deltaPct > 0 ? '+' : ''}
                      {r.deltaPct.toFixed(1)}%
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
