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
import { createPortal } from 'react-dom';

import { usePanelHeaderSlot } from '../ui/Panel.tsx';

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
  /**
   * Boshqaruv tugmalarini panel sarlavhasi qatoriga ko'chirish.
   * Standart — ko'chiriladi: karta ichida bo'sh qator qolmaydi.
   */
  hoistControls?: boolean;
  /**
   * Legenda diagrammadan KEYIN, pastda chiqsin.
   * Doiraviy diagrammalarda o'qish tartibi tabiiyroq: avval shakl,
   * keyin uning izohi. Bunda yorliqlar kattaroq yoziladi.
   */
  legendPlacement?: 'top' | 'bottom';
}

export function ChartFrame<T>({
  title, subtitle, legend, height = 240, children,
  tableData, tableColumns, csvName = 'export', actions, className,
  legendPlacement = 'top', hoistControls = true,
}: ChartFrameProps<T>) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const hasTable = Boolean(tableData && tableColumns);
  const headerSlot = usePanelHeaderSlot();

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

  const atBottom = legendPlacement === 'bottom';

  const legendList =
    legend && legend.length > 1 && view === 'chart' ? (
      <ul className={cn('chart-frame__legend', atBottom && 'chart-frame__legend--lg')}>
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
    ) : null;

  /*
   * Sarlavha bo'lmasa legenda AYNAN SHU qatorda chapda turadi — aks holda
   * yuqorida faqat tugmalar turgan bo'sh qator paydo bo'lardi.
   * Panelning o'z sarlavhasi bor bo'lgan hollarda shunday bo'ladi.
   */
  const legendInHeader = !title && !subtitle && !atBottom;

  /*
   * Tugmalar sarlavha qatoriga FAQAT diagrammaning o'z sarlavhasi bo'lmaganda
   * ko'chiriladi — bunda sarlavha panelniki, ya'ni ular bir xil kartaga tegishli.
   */
  const hoist = hoistControls && Boolean(headerSlot) && !title && !subtitle;

  const controls =
    actions || hasTable ? (
      /*
        `ml-auto` — legenda keng bo'lib tugmalar keyingi qatorga tushganda
        ham ular O'NGDA qoladi. `justify-between` yolg'iz o'zi bunday
        holatda yagona elementni chapga tashlab yuboradi.
      */
      <div className={cn('flex shrink-0 items-center gap-1.5', !hoist && 'ml-auto')}>
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
    ) : null;

  const headerLeft = title || subtitle || (legendInHeader && legendList);

  return (
    <div className={cn('flex min-w-0 flex-col gap-3', className)}>
      {hoist && controls && headerSlot && createPortal(controls, headerSlot)}

      {(headerLeft || (!hoist && controls)) && (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
          <div className="min-w-0 flex-1">
            {title && <p className="text-[13px] font-semibold leading-tight">{title}</p>}
            {subtitle && <p className="text-[11px] text-muted">{subtitle}</p>}
            {legendInHeader && legendList}
          </div>

          {!hoist && controls}
        </div>
      )}

      {/* Legenda — ≥2 seriya bo'lsa doim ko'rinadi */}
      {!legendInHeader && !atBottom && legendList}

      {view === 'chart' ? (
        <>
          <div style={{ height }} className="min-w-0">
            {children}
          </div>
          {/* Diagrammadan KEYINGI legenda */}
          {atBottom && legendList}
        </>
      ) : (
        <div className="scroll-y max-h-80 rounded-lg border border-border/70">
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
