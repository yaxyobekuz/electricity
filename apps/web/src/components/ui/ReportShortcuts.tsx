/**
 * Hisobot yorliqlari — davr turi kartochkalar ko'rinishida tanlanadi,
 * so'ng Excel yoki PDF yuklab olinadi.
 *
 * Ikki bosqich ATAYLAB ajratilgan: "Kunlik" tugmasi bosilishi bilan fayl
 * yuklanib ketsa, foydalanuvchi qaysi formatda kelishini oldindan bilmaydi.
 * Avval davr (tanlangani ko'rinib turadi), keyin format.
 *
 * Tanlov RADIO guruh: bu klaviatura bilan o'q tugmalarida yuriladigan,
 * skrinriderga "4 tadan 1-si" deb o'qiladigan yagona to'g'ri semantika.
 *
 * Barcha fayllar SERVERDA hosil bo'ladi va lokal yuklanadi — tashqi xizmat
 * ishlatilmaydi (tizimning offline talabi).
 */
import { Button, Radio, RadioGroup } from '@heroui/react';
import { FileSpreadsheet, FileText } from 'lucide-react';
import { useState } from 'react';

import { useUi } from '../../lib/ui-store.ts';

const KINDS = [
  { id: 'daily', label: 'Kunlik hisobot', tone: 'var(--viz-1)' },
  { id: 'monthly', label: 'Oylik hisobot', tone: 'var(--viz-3)' },
  { id: 'quarterly', label: 'Choraklik hisobot', tone: 'var(--viz-4)' },
  { id: 'yearly', label: 'Yillik hisobot', tone: 'var(--viz-5)' },
] as const;

export function ReportShortcuts() {
  const period = useUi((s) => s.period);
  const [kind, setKind] = useState<string>('monthly');
  const qs = period ? `?period=${period}` : '';

  const download = (ext: 'xlsx' | 'pdf'): void => {
    window.location.href = `/api/report/period/${kind}.${ext}${qs}`;
  };

  const selected = KINDS.find((k) => k.id === kind)?.label ?? '';

  return (
    <div className="flex flex-col gap-3">
      <RadioGroup aria-label="Hisobot davri" value={kind} onChange={setKind}>
        {/* Bitta qatorda 4 ta — maketdagidek; tor ekranda 2×2 ga tushadi. */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {KINDS.map((k) => (
            <Radio key={k.id} value={k.id}>
              <Radio.Content
                className="flex h-full w-full flex-col items-start gap-1.5 rounded-xl
                           border border-separator bg-surface px-2.5 py-2.5 transition-colors
                           data-[selected=true]:border-accent data-[selected=true]:bg-accent/8
                           data-[focus-visible=true]:border-accent"
              >
                <span
                  className="flex size-7 items-center justify-center rounded-lg"
                  style={{
                    background: `color-mix(in oklab, ${k.tone} 14%, transparent)`,
                    color: k.tone,
                  }}
                >
                  <FileText className="size-4" />
                </span>
                <span className="text-[11px] font-medium leading-tight">{k.label}</span>
              </Radio.Content>
            </Radio>
          ))}
        </div>
      </RadioGroup>

      {/*
        Tugma matni "Excel eksport" — nima eksport qilinishini tanlangan davr
        belgilaydi, shuning uchun u `aria-label` da ham aytiladi.
      */}
      <div className="grid grid-cols-2 gap-2">
        <Button
          aria-label={`${selected} — Excel`}
          className="border-viz-good/25 bg-viz-good/10 text-viz-good hover:bg-viz-good/18"
          size="sm"
          variant="secondary"
          onPress={() => download('xlsx')}
        >
          <FileSpreadsheet className="size-4" />
          Excel eksport
        </Button>
        <Button
          aria-label={`${selected} — PDF`}
          className="border-viz-critical/25 bg-viz-critical/10 text-viz-critical hover:bg-viz-critical/18"
          size="sm"
          variant="secondary"
          onPress={() => download('pdf')}
        >
          <FileText className="size-4" />
          PDF eksport
        </Button>
      </div>
    </div>
  );
}
