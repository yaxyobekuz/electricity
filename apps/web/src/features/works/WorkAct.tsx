/**
 * Ish dalolatnomasi - ekran (modal) va qog'oz (chop etish) uchun BITTA mazmun.
 *
 * Nusxa ikkita bo'lsa, ular vaqt o'tib bir-biridan uzoqlashadi: ekranda
 * ko'rgan raqam qog'ozda boshqacha chiqadi. Shuning uchun tarkib shu yerda
 * bir marta yoziladi, farq faqat ramkada.
 */
import type { WorkDetail, WorkPhoto } from '@beap/shared';
import {
  WORK_STATUS_LABEL_UZ, WORK_TYPE_LABEL_UZ, dateShort, energy, money, num, pct,
} from '@beap/shared';
import { Chip } from '@heroui/react';

import { AuthImage } from '../../components/ui/AuthImage.tsx';

const PHOTO_KIND_LABEL: Record<WorkPhoto['kind'], string> = {
  BEFORE: 'Ishgacha',
  AFTER: 'Ishdan keyin',
  DOC: 'Hujjat',
};

const STATUS_COLOR: Record<string, 'success' | 'warning' | 'accent' | 'danger'> = {
  COMPLETED: 'success',
  IN_PROGRESS: 'accent',
  PLANNED: 'warning',
  CANCELLED: 'danger',
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 border-b border-separator py-1.5 last:border-b-0">
      <dt className="w-40 shrink-0 text-[11px] text-muted">{label}</dt>
      <dd className="min-w-0 flex-1 text-[12.5px] font-medium">{children}</dd>
    </div>
  );
}

export function WorkAct({ work, print = false }: { work: WorkDetail; print?: boolean }) {
  const dash = (v: string | null): string => (v && v.length > 0 ? dateShort(v) : '-');

  return (
    <div className="flex flex-col gap-4">
      {/* ── Sarlavha bloki ─────────────────────────────────────────────── */}
      <div>
        <p className="text-[11px] uppercase tracking-wide text-muted">
          Dalolatnoma № {work.id} · {work.mfyName}
        </p>
        <h3 className={print ? 'mt-1 text-[15px] font-bold' : 'mt-1 text-[14px] font-bold'}>
          {work.titleUz}
          {work.quantity > 0 && (
            <span className="font-medium text-muted">
              {' '}({num(work.quantity, work.quantity % 1 === 0 ? 0 : 1)} {work.unit})
            </span>
          )}
        </h3>
      </div>

      {/* ── Asosiy maydonlar ───────────────────────────────────────────── */}
      <dl>
        <Row label="Ish turi">{WORK_TYPE_LABEL_UZ[work.workType] ?? work.workType}</Row>
        <Row label="Holati">
          {print ? (
            WORK_STATUS_LABEL_UZ[work.status] ?? work.status
          ) : (
            <Chip color={STATUS_COLOR[work.status] ?? 'accent'} size="sm" variant="soft">
              <Chip.Label>{WORK_STATUS_LABEL_UZ[work.status] ?? work.status}</Chip.Label>
            </Chip>
          )}
          {work.status !== 'COMPLETED' && (
            <span className="ml-2 text-[11px] text-muted">bajarilgani: {work.progressPct}%</span>
          )}
        </Row>
        <Row label="Mahalla">{work.mfyName} ({work.mfyCode})</Row>
        <Row label="Transformator">{work.tpCode ?? '-'}</Row>
        <Row label="Reja muddati">{dash(work.plannedStart)} - {dash(work.plannedEnd)}</Row>
        <Row label="Bajarilgan sana">{dash(work.actualEnd)}</Row>
        <Row label="Hajmi">
          {work.quantity > 0 ? `${num(work.quantity, work.quantity % 1 === 0 ? 0 : 1)} ${work.unit}` : '-'}
        </Row>
        <Row label="Qiymati">{work.costMln > 0 ? money(work.costMln).text : '-'}</Row>
        {work.description && <Row label="Izoh">{work.description}</Row>}
      </dl>

      {/* ── Natija ─────────────────────────────────────────────────────── */}
      <div>
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
          Natija
        </p>
        <dl>
          <Row label="Yo‘qotish (ishgacha)">
            {work.effectLossPctBefore === null ? '-' : pct(work.effectLossPctBefore, 1)}
          </Row>
          <Row label="Yo‘qotish (keyin)">
            {work.effectLossPctAfter === null ? '-' : pct(work.effectLossPctAfter, 1)}
          </Row>
          <Row label="Tejalgan energiya">
            {work.effectSavingKwhMonth > 0 ? (
              <span style={{ color: 'var(--viz-good)' }}>
                {energy(work.effectSavingKwhMonth).text} / oy
              </span>
            ) : '-'}
          </Row>
        </dl>
      </div>

      {/* ── Rasmlar ────────────────────────────────────────────────────── */}
      <div>
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
          Rasmlar ({work.photos.length})
        </p>

        {work.photos.length === 0 ? (
          <p className="text-[11.5px] text-muted">Rasm biriktirilmagan</p>
        ) : (
          <div className={print ? 'grid grid-cols-2 gap-3' : 'grid grid-cols-2 gap-2 sm:grid-cols-3'}>
            {work.photos.map((p) => (
              <figure key={p.id} className="overflow-hidden rounded-lg border border-separator">
                <AuthImage
                  alt={p.caption ?? PHOTO_KIND_LABEL[p.kind]}
                  className="block h-32 w-full object-cover"
                  path={p.url.replace(/^\/api/, '')}
                />
                <figcaption className="px-2 py-1 text-[10px] leading-tight text-muted">
                  {PHOTO_KIND_LABEL[p.kind]}
                  {p.caption && ` · ${p.caption}`}
                </figcaption>
              </figure>
            ))}
          </div>
        )}
      </div>

      {/* ── Imzo joyi - faqat qog'ozda ─────────────────────────────────── */}
      {print && (
        <div className="mt-6 flex justify-between text-[11px]">
          <div className="w-56">
            <p className="mb-8">Topshirdi:</p>
            <p className="border-t border-black pt-1">(imzo, F.I.SH.)</p>
          </div>
          <div className="w-56">
            <p className="mb-8">Qabul qildi:</p>
            <p className="border-t border-black pt-1">(imzo, F.I.SH.)</p>
          </div>
        </div>
      )}
    </div>
  );
}
