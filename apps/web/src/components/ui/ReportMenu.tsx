/**
 * Hisobot menyusi — yuqori chiziqdagi ixcham tugma.
 *
 * Ilgari bu "Hisobot davri: Kunlik" ko'rinishidagi ALOHIDA panel edi va
 * ekranning bir qismini egallab turardi, ustiga tanlov hech narsaga
 * ta'sir qilmasdi. Endi bitta tugma — bosilganda fayl darhol yuklanadi.
 *
 * Barcha fayllar SERVERDA hosil bo'ladi va lokal yuklanadi; tashqi xizmat
 * ishlatilmaydi (tizimning offline talabi).
 */
import { Button, Dropdown } from '@heroui/react';
import { Download, FileSpreadsheet, FileText, Printer } from 'lucide-react';

import { useUi } from '../../lib/ui-store.ts';

interface ReportMenuProps {
  /** MFY hisoboti uchun — bo'lmasa tuman hisoboti olinadi. */
  mfyId?: number;
  /** Chop etish oynasi uchun yo'l. */
  printScope?: 'tuman' | 'mfy';
}

const PERIOD_KINDS = [
  { id: 'daily', label: 'Kunlik hisobot' },
  { id: 'weekly', label: 'Haftalik hisobot' },
  { id: 'monthly', label: 'Oylik hisobot' },
  { id: 'quarterly', label: 'Choraklik hisobot' },
  { id: 'yearly', label: 'Yillik hisobot' },
] as const;

export function ReportMenu({ mfyId, printScope = 'tuman' }: ReportMenuProps) {
  const period = useUi((s) => s.period);
  const qs = period ? `?period=${period}` : '';
  const passportPath = mfyId ? `/api/report/passport/mfy/${mfyId}` : '/api/report/passport/tuman';

  return (
    <Dropdown>
      <Button className="rounded-lg" size="sm" variant="secondary">
        <Download className="size-3.5" />
        Hisobot
      </Button>

      <Dropdown.Popover>
        <Dropdown.Menu
          onAction={(key) => {
            const id = String(key);
            if (id === 'print') {
              window.open(`/passport/print/${printScope}/${mfyId ?? 0}/${period ?? 'latest'}`, '_blank');
              return;
            }
            if (id === 'passport-xlsx') {
              window.location.href = `${passportPath}.xlsx${qs}`;
              return;
            }
            if (id === 'passport-pdf') {
              window.location.href = `${passportPath}.pdf${qs}`;
              return;
            }
            window.location.href = `/api/report/period/${id}.xlsx${qs}`;
          }}
        >
          <Dropdown.Item id="passport-xlsx" textValue="Pasport — Excel">
            <FileSpreadsheet className="size-4" />
            Pasport — Excel
          </Dropdown.Item>
          <Dropdown.Item id="passport-pdf" textValue="Pasport — PDF">
            <FileText className="size-4" />
            Pasport — PDF
          </Dropdown.Item>
          <Dropdown.Item id="print" textValue="Chop etish">
            <Printer className="size-4" />
            Chop etish
          </Dropdown.Item>

          {PERIOD_KINDS.map((p) => (
            <Dropdown.Item key={p.id} id={p.id} textValue={p.label}>
              <FileSpreadsheet className="size-4" />
              {p.label}
            </Dropdown.Item>
          ))}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}
