/**
 * Ish dalolatnomasi oynasi.
 *
 * Ro'yxatdagi qator bosilganda ochiladi: ishning HAMMA maydoni, rasmlari va
 * chop etish tugmasi shu yerda. Chop etish alohida sahifada ochiladi
 * (`/works/act/:id/print`) - modalni bevosita chop etsa, orqa fondagi butun
 * dashboard ham qog'ozga tushib ketardi.
 */
import { Button, Modal, Spinner } from '@heroui/react';
import { Printer, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';

import { EmptyPanel } from '../../components/ui/Panel.tsx';
import { useDeleteWorkPhoto, useUploadWorkPhoto, useWork } from '../../lib/queries.ts';
import { WorkAct } from './WorkAct.tsx';

export function WorkActModal({
  workId, onClose,
}: {
  /** `null` - oyna yopiq. */
  workId: number | null;
  onClose: () => void;
}) {
  const work = useWork(workId);
  const upload = useUploadWorkPhoto(workId);
  const remove = useDeleteWorkPhoto(workId);
  const fileRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<'BEFORE' | 'AFTER' | 'DOC'>('AFTER');

  return (
    <Modal.Backdrop isOpen={workId !== null} onOpenChange={(open) => !open && onClose()}>
      <Modal.Container size="lg">
        <Modal.Dialog>
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>Ish dalolatnomasi</Modal.Heading>
          </Modal.Header>

          <Modal.Body>
            {work.isLoading && (
              <div className="flex min-h-40 items-center justify-center">
                <Spinner />
              </div>
            )}
            {!work.isLoading && !work.data && <EmptyPanel message="Ish topilmadi" />}
            {work.data && <WorkAct work={work.data} />}

            {/* Rasm biriktirish */}
            {work.data && (
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-separator pt-3">
                <select
                  aria-label="Rasm turi"
                  className="rounded-lg border border-separator bg-surface px-2 py-1.5 text-[11.5px]"
                  value={kind}
                  onChange={(e) => setKind(e.target.value as 'BEFORE' | 'AFTER' | 'DOC')}
                >
                  <option value="BEFORE">Ishgacha</option>
                  <option value="AFTER">Ishdan keyin</option>
                  <option value="DOC">Hujjat</option>
                </select>

                <input
                  ref={fileRef}
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  type="file"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) upload.mutate({ file, kind });
                    e.target.value = '';
                  }}
                />

                <Button
                  isDisabled={upload.isPending}
                  size="sm"
                  variant="secondary"
                  onPress={() => fileRef.current?.click()}
                >
                  <Upload className="size-4" />
                  {upload.isPending ? 'Yuklanmoqda…' : 'Rasm qo‘shish'}
                </Button>

                {work.data.photos.length > 0 && (
                  <Button
                    isDisabled={remove.isPending}
                    size="sm"
                    variant="ghost"
                    onPress={() => {
                      const last = work.data.photos.at(-1);
                      if (last) remove.mutate(last.id);
                    }}
                  >
                    <Trash2 className="size-4" />
                    Oxirgi rasmni o‘chirish
                  </Button>
                )}

                {upload.isError && (
                  <span className="text-[11px]" style={{ color: 'var(--viz-critical)' }}>
                    {upload.error instanceof Error ? upload.error.message : 'Yuklab bo‘lmadi'}
                  </span>
                )}
              </div>
            )}
          </Modal.Body>

          <Modal.Footer>
            <Button slot="close" variant="secondary">Yopish</Button>
            <Button
              isDisabled={!work.data}
              onPress={() => window.open(`/works/act/${String(workId)}/print`, '_blank')}
            >
              <Printer className="size-4" />
              Chop etish
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
