/**
 * PASPORT jadvali — rasmiy hujjat ko'rinishi.
 *
 * Har bir qatorda MANBA belgisi bor:
 *   "Kiritiladi"  → xodim qo'lda kiritadi
 *   "Hisoblanadi" → tizim boshqa ma'lumotlardan chiqaradi
 *
 * Bu — "jami hech qachon qo'lda yozilmaydi" qoidasining ko'rinadigan isboti.
 */
import type { Passport } from '@beap/shared';
import { num } from '@beap/shared';
import { Chip, cn } from '@heroui/react';
import { Fragment } from 'react';

import { currentScript } from '../../i18n/index.ts';

function formatValue(value: number | null, unit: string): string {
  if (value === null) return '—';
  const decimals = unit === 'ta' ? 0 : unit === 'km' ? 2 : 1;
  return num(value, decimals);
}

export function PassportTable({ passport, compact }: { passport: Passport; compact?: boolean }) {
  const cyr = currentScript() === 'cyrl';

  return (
    <table className={cn('dt w-full', compact && 'text-xs')}>
      <thead>
        <tr>
          <th className="w-10 text-center">№</th>
          <th>Ko‘rsatkich</th>
          <th className="w-32 text-right">Qiymat</th>
          <th className="w-24">Birlik</th>
          <th className="w-28 no-print">Manba</th>
        </tr>
      </thead>
      <tbody>
        {/*
          Har bir pasport qatori BIR NECHTA <tr> beradi (asosiy qator +
          "shundan ..." kichik qatorlari). Ro'yxat elementi — Fragment,
          shuning uchun `key` AYNAN unga qo'yiladi, ichkaridagi <tr> ga emas.
        */}
        {passport.rows.map((row) => (
          <Fragment key={row.no}>
            <tr className="font-medium">
              <td className="text-center tabular text-muted">{row.no}</td>
              <td>{cyr ? row.labelUzCyr : row.labelUz}</td>
              <td className="num font-semibold">{formatValue(row.value, row.unit)}</td>
              <td className="text-muted">{row.unit}</td>
              <td className="no-print">
                <Chip
                  color={row.source === 'input' ? 'accent' : 'default'}
                  size="sm"
                  variant="soft"
                >
                  <Chip.Label>
                    {row.source === 'input' ? 'Kiritiladi' : 'Hisoblanadi'}
                  </Chip.Label>
                </Chip>
              </td>
            </tr>
            {row.children?.map((child, ci) => (
              <tr key={`${row.no}-${ci}`} className="text-muted">
                <td />
                <td className="pl-8 italic">
                  {cyr ? child.labelUzCyr : child.labelUz}
                </td>
                <td className="num">{formatValue(child.value, row.unit)}</td>
                <td className="text-muted">{row.unit}</td>
                <td className="no-print" />
              </tr>
            ))}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}
