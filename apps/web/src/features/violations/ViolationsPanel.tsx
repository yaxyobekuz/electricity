/**
 * Aniqlangan qoidabuzarliklar - toifa bo'yicha soni va summasi.
 *
 * Har bir qator BOSILADI va "bu raqam nima asosida chiqdi?" degan savolga
 * to'liq javob beradi: toifaning ta'rifi, manba jadval, hisoblash qoidasi va
 * raqamni tashkil qilgan DALOLATNOMALAR RO'YXATI. Davlat panelida har bir
 * son izohlanishi shart - aks holda unga ishonib bo'lmaydi.
 */
import type { ViolationSummaryRow } from '@beap/shared';
import {
  VIOLATION_CASE_MEANING_UZ, VIOLATION_STATUS_LABEL_UZ, dateShort, money, num, periodLabel,
} from '@beap/shared';
import { Chip, Modal } from '@heroui/react';
import { FileWarning, Gavel, ShieldCheck } from 'lucide-react';
import { useState } from 'react';

import { EmptyPanel } from '../../components/ui/Panel.tsx';

const ICON: Record<string, React.ReactNode> = {
  ADMINISTRATIVE: <FileWarning className="size-4" />,
  CRIMINAL: <Gavel className="size-4" />,
  NO_FAULT: <ShieldCheck className="size-4" />,
};

const TONE: Record<string, string> = {
  ADMINISTRATIVE: 'var(--viz-warning)',
  CRIMINAL: 'var(--viz-critical)',
  NO_FAULT: 'var(--viz-good)',
};

const BOX = 'rounded-xl border border-separator px-3 py-2.5 text-left transition-colors hover:bg-surface-secondary';

/** Toifa belgisi - rangi toifadan keladi. */
function CaseIcon({ caseType, size }: { caseType: string; size: string }) {
  return (
    <span
      className={`flex ${size} shrink-0 items-center justify-center rounded-lg`}
      style={{
        background: `color-mix(in oklab, ${TONE[caseType]} 12%, transparent)`,
        color: TONE[caseType],
      }}
    >
      {ICON[caseType]}
    </span>
  );
}

/**
 * Asosiy toifa - to'liq kenglikdagi qator.
 *
 * Son va summa YONMA-YON, o'ng chekkada bitta guruh bo'lib turadi. Ilgari
 * summa qat'iy `w-24` ustunda edi va keng panelda matn bilan raqam orasida
 * katta bo'shliq ochilib qolardi.
 */
function CaseRow({
  r, onOpen,
}: {
  r: ViolationSummaryRow;
  onOpen: (r: ViolationSummaryRow) => void;
}) {
  return (
    <button className={`flex items-center gap-3 ${BOX}`} type="button" onClick={() => onOpen(r)}>
      <CaseIcon caseType={r.caseType} size="size-8" />

      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-medium leading-tight">{r.labelUz}</span>
        <span className="block truncate text-[10px] leading-tight text-muted">
          {r.kwhIdentified > 0 ? `${num(r.kwhIdentified)} kWh aniqlangan` : 'jarima solinmagan'}
        </span>
      </span>

      <span className="flex shrink-0 items-baseline gap-1">
        <span className="tabular text-[15px] font-bold leading-none">{num(r.count)}</span>
        <span className="text-[9.5px] leading-none text-muted">ta</span>
      </span>

      {r.fineMln > 0 && (
        <span className="tabular shrink-0 text-[12.5px] font-semibold">{money(r.fineMln).text}</span>
      )}
    </button>
  );
}

/**
 * Ikkilamchi toifa - panjaradagi kartochka.
 *
 * Bo'laklar VERTIKAL joylashadi: yarim ustun kengligi (~160px) da ikonka,
 * nom, son va summani bitta gorizontal qatorga tiqish matnni ham,
 * raqamni ham kesib tashlardi ("Iste'molchi…", "jarima solinm…").
 */
function CaseTile({
  r, onOpen,
}: {
  r: ViolationSummaryRow;
  onOpen: (r: ViolationSummaryRow) => void;
}) {
  return (
    <button className={`flex flex-col gap-2 ${BOX}`} type="button" onClick={() => onOpen(r)}>
      <span className="flex items-center gap-2">
        <CaseIcon caseType={r.caseType} size="size-7" />
        <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium leading-tight">
          {r.labelUz}
        </span>
      </span>

      <span className="flex items-baseline gap-1">
        <span className="tabular text-[15px] font-bold leading-none">{num(r.count)}</span>
        <span className="text-[9.5px] leading-none text-muted">ta</span>
        <span className="tabular ml-auto truncate text-[11.5px] font-semibold">
          {r.fineMln > 0 ? money(r.fineMln).text : '-'}
        </span>
      </span>
    </button>
  );
}

/** Oynadagi xulosa raqami - yorliq ustida, qiymat ostida. */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-surface-secondary px-3 py-2">
      <p className="text-[10px] leading-tight text-muted">{label}</p>
      <p className="tabular mt-0.5 text-[14px] font-bold leading-tight">{value}</p>
    </div>
  );
}

export function ViolationsPanel({
  rows, from, to,
}: {
  rows: ViolationSummaryRow[];
  /** Hisob oralig'i - `YYYY-MM`. */
  from: string;
  to: string;
}) {
  const [open, setOpen] = useState<ViolationSummaryRow | null>(null);
  const total = rows.reduce((s, r) => s + r.count, 0);

  if (rows.length === 0) return <EmptyPanel message="Ma’lumot yo‘q" />;

  /*
   * `@container` - joylashuv EKRAN kengligiga emas, PANELNING o'ziga
   * qaraydi. Panel maketda `xl:col-span-3`, ya'ni keng monitorda ham atigi
   * ~340px: oddiy `sm:`/`lg:` nuqtalari bu yerda yolg'on gapiradi.
   */
  return (
    <div className="@container flex flex-col gap-2">
      <p className="text-[10.5px] text-muted">
        {periodLabel(from)} - {periodLabel(to)} · jami {num(total)} ta dalolatnoma
      </p>

      {/*
        Birinchi toifa (odatda ma'muriy - yagona to'ldirilgani) TO'LIQ
        kenglikda. Qolganlari panjarada: joy tor bo'lsa ustma-ust, 320px dan
        keng bo'lsa ikki ustun - ular deyarli har doim nol bo'lgani uchun
        alohida-alohida qator egallashi kartani bekorga cho'zib yuborardi.
      */}
      {rows[0] && <CaseRow r={rows[0]} onOpen={setOpen} />}

      {rows.length > 1 && (
        <div className="grid grid-cols-1 gap-2 @xs:grid-cols-2">
          {rows.slice(1).map((r) => (
            <CaseTile key={r.caseType} r={r} onOpen={setOpen} />
          ))}
        </div>
      )}

      {/* ── "Nima asosida?" oynasi ─────────────────────────────────────── */}
      <Modal.Backdrop isOpen={open !== null} onOpenChange={(v) => !v && setOpen(null)}>
        <Modal.Container size="lg">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>{open?.labelUz}</Modal.Heading>
            </Modal.Header>

            <Modal.Body>
              {open && (
                <div className="flex flex-col gap-4">
                  <section>
                    <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
                      Bu toifa nimani bildiradi
                    </h4>
                    <p className="text-[12.5px] leading-relaxed">
                      {VIOLATION_CASE_MEANING_UZ[open.caseType]}
                    </p>
                  </section>

                  {/*
                    Uch xulosa raqami - jadval nomlari va ustunlar EMAS.
                    Bu oynani hokim o'qiydi: unga "qancha, qanchaga, qancha
                    energiya" kerak, ma'lumotlar bazasining tuzilishi emas.
                  */}
                  <section className="grid grid-cols-3 gap-2">
                    <Stat label="Dalolatnoma" value={`${num(open.count)} ta`} />
                    <Stat
                      label="Solingan jarima"
                      value={open.fineMln > 0 ? money(open.fineMln).text : '-'}
                    />
                    <Stat
                      label="Aniqlangan energiya"
                      value={open.kwhIdentified > 0 ? `${num(open.kwhIdentified)} kWh` : '-'}
                    />
                  </section>

                  {open.acts.length > 0 && (
                    <section>
                      <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
                        Hujjatlar holati
                      </h4>
                      <div className="flex flex-wrap gap-1.5">
                        {Object.entries(
                          open.acts.reduce<Record<string, number>>((acc, a) => {
                            acc[a.status] = (acc[a.status] ?? 0) + 1;
                            return acc;
                          }, {}),
                        ).map(([status, cnt]) => (
                          <Chip key={status} size="sm" variant="soft">
                            <Chip.Label>
                              {VIOLATION_STATUS_LABEL_UZ[status as keyof typeof VIOLATION_STATUS_LABEL_UZ] ?? status}
                              : {cnt} ta
                            </Chip.Label>
                          </Chip>
                        ))}
                      </div>
                    </section>
                  )}

                  <section>
                    <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
                      Shu raqam qaysi hujjatlardan chiqdi ({open.acts.length})
                    </h4>

                    {open.acts.length === 0 ? (
                      <p className="text-[12px] text-muted">
                        Bu toifada dalolatnoma yo‘q - shuning uchun ko‘rsatkich 0.
                      </p>
                    ) : (
                      <div className="scroll-y max-h-72 overflow-x-auto">
                        <table className="dt dt--compact min-w-md">
                          <thead>
                            <tr>
                              <th>Dalolatnoma</th>
                              <th>Sana</th>
                              <th>Iste’molchi</th>
                              <th className="text-right">Aniqlangan energiya</th>
                              <th className="text-right">Jarima</th>
                              <th>Holat</th>
                            </tr>
                          </thead>
                          <tbody>
                            {open.acts.map((a) => (
                              <tr key={a.id}>
                                <td className="font-semibold">{a.actNo}</td>
                                <td className="whitespace-nowrap">{dateShort(a.actDate)}</td>
                                <td className="truncate" title={a.consumerRef ?? ''}>
                                  {a.consumerRef ?? '-'}
                                  {a.tpCode && (
                                    <span className="block text-[10px] text-muted">{a.tpCode}</span>
                                  )}
                                </td>
                                <td className="num whitespace-nowrap">
                                  {a.kwhIdentified > 0 ? `${num(a.kwhIdentified)} kWh` : '-'}
                                </td>
                                <td className="num whitespace-nowrap">
                                  {a.fineMln > 0 ? money(a.fineMln).text : '-'}
                                </td>
                                <td>
                                  <Chip size="sm" variant="soft">
                                    <Chip.Label className="text-[9.5px]">
                                      {VIOLATION_STATUS_LABEL_UZ[a.status] ?? a.status}
                                    </Chip.Label>
                                  </Chip>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>

                  {/* Ishonch uchun: ma'lumot qayerdan keladi - bir jumlada */}
                  <p className="border-t border-separator pt-2.5 text-[11px] leading-relaxed text-muted">
                    Ma’lumot mahalla operatori rasmiylashtirgan va elektroset menejeri
                    tasdiqlagan dalolatnomalardan olinadi. Hisob-kitob emas - har bir raqam
                    ortida yuqoridagi hujjatlar turadi. Oraliq: {periodLabel(from)} -{' '}
                    {periodLabel(to)}.
                  </p>
                </div>
              )}
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </div>
  );
}
