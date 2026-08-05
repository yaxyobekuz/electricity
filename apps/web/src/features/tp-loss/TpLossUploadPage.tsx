/**
 * TP kunlik chiziqli yo'qotish hisobotini yuklash sahifasi.
 *
 * IKKI BOSQICH: fayl tanlangan zahoti PREVIEW so'raladi (hech narsa
 * yozmaydi - faqat qaysi qatorlar saqlanishini ko'rsatadi), "Tasdiqlash"
 * bosilgandagina CONFIRM chaqirilib haqiqatan UPSERT bo'ladi. Sabab: bu
 * moliyaviy/o'g'irlik-sezgir ma'lumot - xodim noto'g'ri fayl yuklab, eski
 * (to'g'ri) o'qishlarni ustidan yozib yubormasligi kerak.
 */
import { num, pct } from '@beap/shared';
import { Button, Chip, toast } from '@heroui/react';
import { TriangleAlert, Upload } from 'lucide-react';
import { useRef, useState } from 'react';

import { LoadingState, PageHeader } from '../../components/layout/AppShell.tsx';
import { EmptyPanel, Panel } from '../../components/ui/Panel.tsx';
import { usePreviewTpLoss, useConfirmTpLoss } from '../../lib/queries.ts';
import { useUi } from '../../lib/ui-store.ts';

const CAN_UPLOAD = ['mfy_operator', 'elektroset_manager', 'admin'];

export default function TpLossUploadPage() {
  const role = useUi((s) => s.user?.role ?? '');
  const canUpload = CAN_UPLOAD.includes(role);

  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const preview = usePreviewTpLoss();
  const confirm = useConfirmTpLoss();

  const pickFile = (f: File): void => {
    setFile(f);
    confirm.reset();
    preview.mutate(f);
  };

  return (
    <>
      <PageHeader
        subtitle="Elektroset yuboradigan kunlik hisobot (Excel) - TP balans hisoblagichi vs bириктирилган iste’molchilar"
        title="Kunlik TP yo‘qotish hisoboti"
      />

      <Panel>
        {!canUpload ? (
          <EmptyPanel message="Bu sahifaga ma’lumot yuklash huquqingiz yo‘q" />
        ) : (
          <>
            <input
              ref={fileRef}
              accept=".xlsx"
              className="hidden"
              type="file"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) pickFile(f);
                e.target.value = '';
              }}
            />

            <div className="flex flex-wrap items-center gap-3">
              <Button
                isDisabled={preview.isPending}
                variant="secondary"
                onPress={() => fileRef.current?.click()}
              >
                <Upload className="size-4" />
                Excel faylni tanlash
              </Button>
              {file && <span className="text-[12px] text-muted">{file.name}</span>}
            </div>

            {preview.isPending && <LoadingState rows={3} />}

            {preview.isError && (
              <p className="mt-3 text-[12px]" style={{ color: 'var(--viz-critical)' }}>
                {preview.error instanceof Error ? preview.error.message : 'Faylni o‘qib bo‘lmadi'}
              </p>
            )}

            {preview.data && (
              <div className="mt-4">
                {preview.data.summary.unresolvedCodes.length > 0 && (
                  <p
                    className="mb-2 flex items-center gap-1.5 text-[12px]"
                    style={{ color: 'var(--viz-critical)' }}
                  >
                    <TriangleAlert className="size-3.5 shrink-0" />
                    Topilmagan TP kodlari (saqlanmaydi): {preview.data.summary.unresolvedCodes.join(', ')}
                  </p>
                )}
                {preview.data.warnings.length > 0 && (
                  <ul className="mb-2 text-[11.5px] text-muted">
                    {preview.data.warnings.map((w, i) => (
                      <li key={i}>· qator {w.rowNo}: {w.message}</li>
                    ))}
                  </ul>
                )}

                <div className="scroll-y max-h-96 overflow-x-auto">
                  <table className="dt dt--compact dt--center min-w-md table-fixed">
                    <thead>
                      <tr>
                        <th className="w-[14%]">TP</th>
                        <th className="w-[16%]">Sana</th>
                        <th className="w-[17%]">Balans (kWh)</th>
                        <th className="w-[17%]">Iste’molchi (kWh)</th>
                        <th className="w-[17%]">Yo‘qotish (kWh)</th>
                        <th className="w-[19%]">Holat</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.data.rows.map((r, i) => (
                        <tr key={i}>
                          <td className={r.willUpsert ? 'font-semibold text-accent' : 'text-muted'}>
                            {r.tpCode}
                          </td>
                          <td className="text-muted">{r.bizDate}</td>
                          <td className="num">{num(r.kwhBalanceMeter)}</td>
                          <td className="num">{num(r.kwhConsumersAttached)}</td>
                          <td className="num font-semibold">{num(r.kwhLoss)}</td>
                          <td>
                            {!r.willUpsert ? (
                              <Chip color="danger" size="sm" variant="soft">
                                <Chip.Label className="text-[9.5px]">TP topilmadi</Chip.Label>
                              </Chip>
                            ) : (
                              <span className="text-muted">
                                {r.lossPct !== null ? pct(r.lossPct, 1) : '-'}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-4 flex items-center gap-3">
                  <Button
                    isDisabled={file === null || preview.data.summary.resolvedRows === 0 || confirm.isPending}
                    onPress={() => {
                      if (!file) return;
                      confirm.mutate(file, {
                        onSuccess: (res) => {
                          toast.success('Ma’lumot saqlandi', {
                            description: `${res.inserted} ta yangi, ${res.updated} ta yangilandi.`,
                          });
                        },
                        onError: (err) => {
                          toast.danger('Saqlab bo‘lmadi', {
                            description: err instanceof Error ? err.message : 'Noma’lum xato',
                          });
                        },
                      });
                    }}
                  >
                    {confirm.isPending ? 'Saqlanmoqda…' : `Tasdiqlash (${preview.data.summary.resolvedRows} qator)`}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </Panel>
    </>
  );
}
