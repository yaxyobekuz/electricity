/**
 * TP darajasidagi kunlik chiziqli yo'qotish hisobotini (Excel) o'qish.
 *
 * Elektroset yuboradigan fayl HAR BIR QATORDA IKKITA sanani solishtiradi
 * (masalan "хатlov"dan oldin va keyin) - shuning uchun bitta manba qatori
 * IKKITA natija qatoriga aylanadi. CLI skript ham, yuklash route'i ham
 * shu funksiyani chaqiradi - parsing kodi ikki joyda takrorlanmaydi.
 *
 * Ustun xaritasi (1-indeksli, `row.getCell(n)`) - `8-2-2026.xlsx` bilan
 * to'g'ridan-to'g'ri tekshirilgan:
 *   2=ТП НОМИ, 3=САНА(1), 4=Баланс(1), 5=Бириктирилган(1), 8=Хатловдан кейин,
 *   9=САНА(2), 10=Баланс(2), 11=Бириктирилган(2).
 * 6/7/12/13-ustunlar (yo'qotish/foiz) HISOBLANADI, o'qilmaydi.
 */
import ExcelJS from 'exceljs';

export interface ParsedTpLossRow {
  rowNo: number;
  tpCode: string;
  bizDate: string;
  kwhBalanceMeter: number;
  kwhConsumersAttached: number;
  inspectionNote: string | null;
}

export interface ParseWarning {
  rowNo: number;
  message: string;
}

export interface ParseResult {
  rows: ParsedTpLossRow[];
  warnings: ParseWarning[];
}

/**
 * Formula kataklarini ochadi: keshlangan (`result`) va bo'lishilgan
 * (`sharedFormula`, `result` bilan birga keladi) ikkalasini ham.
 * `load-feeder-data.ts`dagi bilan bir xil - bu faylga nisbatan tekshirilgan.
 */
function val(x: ExcelJS.CellValue): string | number {
  if (x === null || x === undefined) return '';
  if (x instanceof Date) return x.toISOString();
  if (typeof x === 'object') {
    const o = x as { result?: unknown; text?: string };
    if (o.result !== undefined) return o.result as string | number;
    return o.text ?? '';
  }
  return x as string | number;
}

function numOf(x: ExcelJS.CellValue): number {
  const v = val(x);
  if (typeof v === 'number') return v;
  const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Sana katagini `YYYY-MM-DD` ga keltiradi. Uchta ko'rinishni qamrab oladi:
 * exceljs avtomatik aniqlagan `Date` obyekti (odatiy hol), ISO satr, va
 * `DD/MM/YYYY` matn (ba'zi qatorlarda hisoblagich sanasi format sifatida
 * tanilmasdan xom matn bo'lib qolgan - masalan "01/08/2026").
 */
function dateOf(x: ExcelJS.CellValue): string | null {
  if (x === null || x === undefined || x === '') return null;
  if (x instanceof Date) return x.toISOString().slice(0, 10);
  if (typeof x === 'object') {
    const o = x as { result?: unknown; text?: string };
    return dateOf((o.result !== undefined ? o.result : o.text) as ExcelJS.CellValue);
  }
  const s = String(x).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (dmy) return `${dmy[3]}-${dmy[2]!.padStart(2, '0')}-${dmy[1]!.padStart(2, '0')}`;
  return null;
}

export async function parseTpLossWorkbook(buffer: Buffer): Promise<ParseResult> {
  const wb = new ExcelJS.Workbook();
  // exceljs o'zining index.d.ts faylida eskirgan `interface Buffer extends
  // ArrayBuffer` shimini e'lon qiladi - bu global `Buffer` bilan birlashib
  // (declaration merging) soxta nomuvofiqlik hosil qiladi. Runtime'da bu
  // oddiy Buffer, muammo faqat tur darajasida.
  await wb.xlsx.load(buffer as any);

  const ws = wb.worksheets.find((w) => w.name.includes('кунлик')) ?? wb.worksheets[0];
  const rows: ParsedTpLossRow[] = [];
  const warnings: ParseWarning[] = [];

  if (!ws) {
    warnings.push({ rowNo: 0, message: 'Faylda hech qanday varaq topilmadi' });
    return { rows, warnings };
  }

  for (let r = 5; r <= ws.rowCount; r += 1) {
    const row = ws.getRow(r);
    const bare = String(val(row.getCell(2).value)).trim();
    // Bo'sh qatorlarni VA "Жами" jamlovchi qatorini (2-ustuni bo'sh) o'tkazib yuboradi.
    if (!/^\d+$/.test(bare)) continue;

    const tpCode = `TP-${bare.padStart(3, '0')}`;
    const noteRaw = String(val(row.getCell(8).value)).trim();
    const inspectionNote = noteRaw.length > 0 ? noteRaw : null;

    const date1 = dateOf(row.getCell(3).value);
    if (date1) {
      rows.push({
        rowNo: r, tpCode, bizDate: date1,
        kwhBalanceMeter: numOf(row.getCell(4).value),
        kwhConsumersAttached: numOf(row.getCell(5).value),
        inspectionNote,
      });
    } else {
      warnings.push({ rowNo: r, message: `${tpCode}: 1-sana bloki bo‘sh yoki tushunarsiz - o‘tkazib yuborildi` });
    }

    const date2 = dateOf(row.getCell(9).value);
    if (date2) {
      rows.push({
        rowNo: r, tpCode, bizDate: date2,
        kwhBalanceMeter: numOf(row.getCell(10).value),
        kwhConsumersAttached: numOf(row.getCell(11).value),
        // "Хатловдан кейин" ustuni jismonan faqat 1-blokka tegishli.
        inspectionNote: null,
      });
    } else {
      warnings.push({ rowNo: r, message: `${tpCode}: 2-sana bloki bo‘sh yoki tushunarsiz - o‘tkazib yuborildi` });
    }
  }

  return { rows, warnings };
}
