/**
 * Diagramma ramkasi.
 *
 * Har bir diagramma shu ramka ichida bo'ladi va u uchta narsani kafolatlaydi:
 *   1. LEGENDA — ikki va undan ortiq seriya bo'lsa DOIM ko'rinadi
 *   2. JADVAL-EGIZAK — aynan shu ma'lumot jadval ko'rinishida
 *      (a11y javobi va past kontrastli ranglar uchun yechim)
 *   3. CSV eksport — hech qanday tashqi xizmatsiz, brauzerda hosil qilinadi
 */
import { Button, ToggleButton, ToggleButtonGroup, cn } from '@heroui/react';
import { BarChart3, Download, Table2 } from 'lucide-react';
import { type ReactNode, useState } from 'react';

export interface TableColumn<T> {
  key: string;
  label: string;
  align?: 'left' | 'right';
  render: (row: T) => ReactNode;
  /** CSV uchun xom qiymat. */
  raw?: (row: T) => string | number;
}

export interface LegendItem {
  label: string;
  color: string;
  /** Rang bilan birga ishlatiladigan naqsh (forced-colors uchun). */
  pattern?: 'solid' | 'dashed';
}

interface ChartFrameProps<T> {
  title?: ReactNode;
  subtitle?: ReactNode;
  legend?: LegendItem[];
  /** Diagramma balandligi (px). */
  height?: number;
  children: ReactNode;
  /** Jadval-egizak uchun ma'lumot. */
  tableData?: T[];
  tableColumns?: TableColumn<T>[];
  /** CSV fayl nomi (kengaytmasiz). */
  csvName?: string;
  actions?: ReactNode;
  className?: string;
}

export function ChartFrame<T>({
  title, subtitle, legend, height = 240, children,
  tableData, tableColumns, csvName = 'export', actions, className,
}: ChartFrameProps<T>) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const hasTable = Boolean(tableData && tableColumns);

  const downloadCsv = (): void => {
    if (!tableData || !tableColumns) return;
    const head = tableColumns.map((c) => c.label).join(';');
    const body = tableData
      .map((row) =>
        tableColumns
          .map((c) => {
            const v = c.raw ? c.raw(row) : '';
            return typeof v === 'string' && v.includes(';') ? `"${v}"` : String(v);
          })
          .join(';'),
      )
      .join('\n');

    // BOM — Excel UTF-8 ni to'g'ri o'qishi uchun
    const blob = new Blob([`﻿${head}\n${body}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${csvName}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={cn('flex min-w-0 flex-col gap-3', className)}>
      {(title || legend || hasTable || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            {title && <p className="text-[13px] font-semibold leading-tight">{title}</p>}
            {subtitle && <p className="text-[11px] text-muted">{subtitle}</p>}
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {actions}
            {hasTable && (
              <>
                <ToggleButtonGroup
                  aria-label="Ko‘rinish"
                  selectedKeys={new Set([view])}
                  selectionMode="single"
                  size="sm"
                  onSelectionChange={(keys) => {
                    const next = [...keys][0];
                    if (next === 'chart' || next === 'table') setView(next);
                  }}
                >
                  <ToggleButton aria-label="Diagramma" id="chart">
                    <BarChart3 className="size-3.5" />
                  </ToggleButton>
                  <ToggleButton aria-label="Jadval" id="table">
                    <Table2 className="size-3.5" />
                  </ToggleButton>
                </ToggleButtonGroup>
                <Button
                  isIconOnly
                  aria-label="CSV yuklab olish"
                  size="sm"
                  variant="ghost"
                  onPress={downloadCsv}
                >
                  <Download className="size-3.5" />
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Legenda — ≥2 seriya bo'lsa doim ko'rinadi */}
      {legend && legend.length > 1 && view === 'chart' && (
        <ul className="chart-frame__legend">
          {legend.map((item) => (
            <li key={item.label} className="flex items-center gap-1.5">
              <span
                className="chart-frame__swatch"
                style={{ background: item.color }}
                aria-hidden="true"
              />
              <span>{item.label}</span>
            </li>
          ))}
        </ul>
      )}

      {view === 'chart' ? (
        <div style={{ height }} className="min-w-0">
          {children}
        </div>
      ) : (
        <div className="scroll-y max-h-[320px] rounded-lg border border-border/70">
          <table className="dt">
            <thead>
              <tr>
                {tableColumns!.map((c) => (
                  <th key={c.key} className={c.align === 'right' ? 'text-right' : undefined}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableData!.map((row, i) => (
                <tr key={i}>
                  {tableColumns!.map((c) => (
                    <td key={c.key} className={c.align === 'right' ? 'num' : undefined}>
                      {c.render(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
