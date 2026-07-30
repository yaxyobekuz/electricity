/**
 * Hisobot generatori — Excel (exceljs) va PDF (pdfmake).
 *
 * IKKI QOIDA:
 *   1. Hech qanday tashqi xizmat ishlatilmaydi. Shriftlar `pdfmake` paketi
 *      ichidan keladi (Roboto — u ham `o‘` dagi U+2018 ni, ham kirill
 *      `қ ғ ҳ ў` harflarini qoplaydi; tekshirilgan).
 *   2. Pasport eksporti rasmiy ПАСПОРТ maketini takrorlaydi: 13 raqamli
 *      qator, "shundan …" kichik qatorlari va har bir qatorning MANBASI
 *      (kiritiladimi yoki hisoblanadimi).
 */
import type { Passport, PassportRow } from '@beap/shared';
import ExcelJS from 'exceljs';
import pdfmakeModule from 'pdfmake';
import type { TableCell, TDocumentDefinitions } from 'pdfmake/interfaces.js';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

/**
 * `@types/pdfmake` hali 0.2 API sini (`new PdfPrinter(fonts)`) e'lon qiladi,
 * lekin o'rnatilgan pdfmake **0.3.11** modul sifatida TAYYOR OBYEKT qaytaradi
 * (`module.exports = new pdfmake()`). Shu sababli klass sifatida chaqirish
 * "PdfPrinter is not a constructor" xatosini beradi.
 *
 * Tiplar paketi yangilanmaguncha bizga kerak bo'lgan yuzani shu yerda
 * e'lon qilamiz — bu qasddan qilingan va sababi yuqorida yozilgan.
 */
interface PdfMakeV3 {
  setFonts(fonts: Record<string, Record<string, string>>): void;
  setUrlAccessPolicy(cb: (url: string) => boolean): void;
  setLocalAccessPolicy(cb: (filePath: string) => boolean): void;
  createPdf(doc: TDocumentDefinitions): { getBuffer(): Promise<Buffer> };
}

const pdfmake = pdfmakeModule as unknown as PdfMakeV3;

/**
 * Roboto TTF fayllari `pdfmake` paketi ICHIDA — tarmoqdan olinmaydi.
 * Tekshirilgan: Roboto `o‘` dagi U+2018 ni ham, kirill `ў қ ғ ҳ` ni ham
 * qoplaydi, ya'ni lotin va kirill pasportlar bir xil to'g'ri chiqadi.
 */
const FONT_DIR = path.dirname(require.resolve('pdfmake/fonts/Roboto/Roboto-Regular.ttf'));

pdfmake.setFonts({
  Roboto: {
    normal: path.join(FONT_DIR, 'Roboto-Regular.ttf'),
    bold: path.join(FONT_DIR, 'Roboto-Medium.ttf'),
    italics: path.join(FONT_DIR, 'Roboto-Italic.ttf'),
    bolditalics: path.join(FONT_DIR, 'Roboto-MediumItalic.ttf'),
  },
});

/*
 * OFFLINE KAFOLATI — mashina tomonidan majburlanadi.
 *
 * pdfmake hujjat ichidagi `http(s)://` manzillarni yuklab olishga urinishi
 * mumkin. Bu tizimda ma'lumot tashqariga chiqmasligi shart, shuning uchun
 * tashqi manzillarga ruxsat BERILMAYDI, lokal fayllardan esa faqat shrift
 * papkasi ochiq.
 */
pdfmake.setUrlAccessPolicy(() => false);
pdfmake.setLocalAccessPolicy((p: string) => path.resolve(p).startsWith(FONT_DIR));

/** Hujjat ta'rifidan bayt oqimini yig'adi. */
function render(doc: TDocumentDefinitions): Promise<Buffer> {
  return pdfmake.createPdf(doc).getBuffer();
}

const NUM_FMT: Record<string, string> = {
  ta: '#,##0',
  km: '#,##0.00',
  'ming kVt/soat': '#,##0.0',
  'mln so‘m': '#,##0.0',
};

function fmtFor(unit: string): string {
  return NUM_FMT[unit] ?? '#,##0.0';
}

// ─── Excel ───────────────────────────────────────────────────────────────────

/** Pasportni rasmiy forma ko'rinishida Excel'ga yozadi. */
export async function passportXlsx(passport: Passport): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'BEAP — Baliqchi tumani elektr energiya nazorat tizimi';
  wb.created = new Date();

  const ws = wb.addWorksheet('Pasport', {
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1 },
    views: [{ state: 'frozen', ySplit: 5 }],
  });

  ws.columns = [
    { key: 'no', width: 6 },
    { key: 'label', width: 58 },
    { key: 'value', width: 16 },
    { key: 'unit', width: 16 },
    { key: 'source', width: 14 },
  ];

  // Sarlavha bloki
  ws.mergeCells('A1:E1');
  ws.getCell('A1').value = 'PASPORT';
  ws.getCell('A1').font = { size: 15, bold: true };
  ws.getCell('A1').alignment = { horizontal: 'center' };

  ws.mergeCells('A2:E2');
  ws.getCell('A2').value = passport.scopeName;
  ws.getCell('A2').font = { size: 12, bold: true };
  ws.getCell('A2').alignment = { horizontal: 'center' };

  ws.mergeCells('A3:E3');
  ws.getCell('A3').value = `Hisobot davri: ${passport.period}`;
  ws.getCell('A3').alignment = { horizontal: 'center' };
  ws.getCell('A3').font = { size: 10, color: { argb: 'FF666666' } };

  ws.addRow([]);

  const head = ws.addRow(['№', 'Ko‘rsatkich', 'Qiymat', 'Birlik', 'Manba']);
  head.font = { bold: true, size: 10 };
  head.alignment = { vertical: 'middle' };
  head.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF3FA' } };
    cell.border = {
      top: { style: 'thin' }, bottom: { style: 'thin' },
      left: { style: 'thin' }, right: { style: 'thin' },
    };
  });

  const writeRow = (row: PassportRow): void => {
    const r = ws.addRow([
      row.no,
      row.labelUz,
      row.value,
      row.unit,
      row.source === 'input' ? 'Kiritiladi' : 'Hisoblanadi',
    ]);
    r.font = { bold: true, size: 10 };
    r.getCell(3).numFmt = fmtFor(row.unit);
    r.getCell(1).alignment = { horizontal: 'center' };
    r.eachCell((cell) => {
      cell.border = { top: { style: 'hair' }, bottom: { style: 'hair' } };
    });

    for (const child of row.children ?? []) {
      const c = ws.addRow([null, `    shundan: ${child.labelUz}`, child.value, row.unit, null]);
      c.font = { size: 10, italic: true, color: { argb: 'FF666666' } };
      c.getCell(3).numFmt = fmtFor(row.unit);
    }
  };

  for (const row of passport.rows) writeRow(row);

  ws.addRow([]);
  const note = ws.addRow([
    null,
    '"Kiritiladi" — xodim qo‘lda yozadi. "Hisoblanadi" — tizim boshqa ma’lumotlardan chiqaradi. '
      + 'Hech qanday jami qiymat qo‘lda kiritilmaydi.',
  ]);
  note.font = { size: 9, italic: true, color: { argb: 'FF888888' } };
  ws.mergeCells(`B${note.number}:E${note.number}`);
  note.getCell(2).alignment = { wrapText: true, vertical: 'top' };

  return Buffer.from(await wb.xlsx.writeBuffer());
}

export interface PeriodReportInput {
  scopeName: string;
  period: string;
  kindLabel: string;
  totals: {
    kwhIn: number;
    kwhSold: number;
    kwhLossTotal: number;
    lossPct: number;
    consumersTotal: number;
    consumersActive: number;
    consumersDisconnected: number;
    tpCount: number;
    debtTotalMln: number;
  };
  balance: { labelUz: string; kwh: number; pct: number }[];
  mfys: {
    nameUz: string;
    kwhIn: number;
    lossPct: number;
    normPct: number;
    gapPp: number;
    status: string;
  }[];
  debt: { labelUz: string; amountMln: number; pct: number }[];
  topDebtors: { rank: number; debtorName: string; mfyName: string; amountMln: number }[];
}

const STATUS_UZ: Record<string, string> = {
  good: 'Standart doirasida', warning: 'Diqqat', serious: 'Jiddiy', critical: 'Tanqidiy',
};

/** Davriy hisobot — bir nechta varaqli Excel kitobi. */
export async function periodXlsx(input: PeriodReportInput): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'BEAP';
  wb.created = new Date();

  // ── 1-varaq: umumiy ────────────────────────────────────────────────────
  const s1 = wb.addWorksheet('Umumiy');
  s1.columns = [{ width: 42 }, { width: 20 }, { width: 16 }];

  s1.mergeCells('A1:C1');
  s1.getCell('A1').value = `${input.kindLabel} hisobot — ${input.scopeName}`;
  s1.getCell('A1').font = { size: 14, bold: true };
  s1.mergeCells('A2:C2');
  s1.getCell('A2').value = `Davr: ${input.period}`;
  s1.getCell('A2').font = { size: 10, color: { argb: 'FF666666' } };
  s1.addRow([]);

  const kpis: [string, number, string][] = [
    ['Tarmoqqa kirgan energiya', input.totals.kwhIn, 'kVt/soat'],
    ['Sotilgan energiya', input.totals.kwhSold, 'kVt/soat'],
    ['Jami yo‘qotish', input.totals.kwhLossTotal, 'kVt/soat'],
    ['Yo‘qotish darajasi', input.totals.lossPct, '%'],
    ['Jami iste’molchilar', input.totals.consumersTotal, 'ta'],
    ['Faol iste’molchilar', input.totals.consumersActive, 'ta'],
    ['Uzilgan iste’molchilar', input.totals.consumersDisconnected, 'ta'],
    ['Transformator punktlari', input.totals.tpCount, 'ta'],
    ['Jami qarzdorlik', input.totals.debtTotalMln, 'mln so‘m'],
  ];

  const h1 = s1.addRow(['Ko‘rsatkich', 'Qiymat', 'Birlik']);
  h1.font = { bold: true };
  for (const [label, value, unit] of kpis) {
    const r = s1.addRow([label, value, unit]);
    r.getCell(2).numFmt = unit === 'ta' ? '#,##0' : '#,##0.00';
  }

  s1.addRow([]);
  const h1b = s1.addRow(['Energiya balansi', 'kVt/soat', 'Ulushi, %']);
  h1b.font = { bold: true };
  for (const b of input.balance) {
    const r = s1.addRow([b.labelUz, b.kwh, b.pct]);
    r.getCell(2).numFmt = '#,##0';
    r.getCell(3).numFmt = '0.00';
  }

  // ── 2-varaq: mahallalar ────────────────────────────────────────────────
  const s2 = wb.addWorksheet('Mahallalar');
  s2.columns = [
    { header: 'Mahalla', key: 'name', width: 30 },
    { header: 'Tarmoqqa kirgan, kVt/soat', key: 'kwh', width: 26 },
    { header: 'Yo‘qotish, %', key: 'loss', width: 15 },
    { header: 'Standart, %', key: 'norm', width: 14 },
    { header: 'Farq, p.p.', key: 'gap', width: 13 },
    { header: 'Holat', key: 'status', width: 20 },
  ];
  s2.getRow(1).font = { bold: true };
  s2.views = [{ state: 'frozen', ySplit: 1 }];

  for (const m of input.mfys) {
    const r = s2.addRow({
      name: m.nameUz, kwh: m.kwhIn, loss: m.lossPct, norm: m.normPct,
      gap: m.gapPp, status: STATUS_UZ[m.status] ?? m.status,
    });
    r.getCell('kwh').numFmt = '#,##0';
    r.getCell('loss').numFmt = '0.00';
    r.getCell('norm').numFmt = '0.00';
    r.getCell('gap').numFmt = '+0.00;-0.00';
    if (m.gapPp > 0) r.getCell('gap').font = { color: { argb: 'FFC1121F' } };
  }

  // Jami qatori — FORMULA bilan, qo'lda emas.
  const last = s2.rowCount;
  if (input.mfys.length > 0) {
    const total = s2.addRow({ name: 'JAMI', kwh: { formula: `SUM(B2:B${last})` } });
    total.font = { bold: true };
    total.getCell('kwh').numFmt = '#,##0';
  }

  // ── 3-varaq: qarzdorlik ────────────────────────────────────────────────
  const s3 = wb.addWorksheet('Qarzdorlik');
  s3.columns = [{ width: 34 }, { width: 18 }, { width: 14 }];
  const h3 = s3.addRow(['Toifa', 'Summa, mln so‘m', 'Ulushi, %']);
  h3.font = { bold: true };
  for (const d of input.debt) {
    const r = s3.addRow([d.labelUz, d.amountMln, d.pct]);
    r.getCell(2).numFmt = '#,##0.0';
    r.getCell(3).numFmt = '0.0';
  }

  s3.addRow([]);
  const h3b = s3.addRow(['№', 'Qarzdor', 'Mahalla', 'Summa, mln so‘m']);
  h3b.font = { bold: true };
  for (const d of input.topDebtors) {
    const r = s3.addRow([d.rank, d.debtorName, d.mfyName, d.amountMln]);
    r.getCell(4).numFmt = '#,##0.0';
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ─── PDF ─────────────────────────────────────────────────────────────────────

const uz = (v: number | null, unit: string): string => {
  if (v === null) return '—';
  const d = unit === 'ta' ? 0 : unit === 'km' ? 2 : 1;
  return v.toLocaleString('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d });
};

/** Pasport PDF — A4 portret, rasmiy forma. */
export async function passportPdf(passport: Passport): Promise<Buffer> {
  const body: TableCell[][] = [
    [
      { text: '№', style: 'th', alignment: 'center' },
      { text: 'Ko‘rsatkich', style: 'th' },
      { text: 'Qiymat', style: 'th', alignment: 'right' },
      { text: 'Birlik', style: 'th' },
    ],
  ];

  for (const row of passport.rows) {
    body.push([
      { text: String(row.no), alignment: 'center', bold: true },
      { text: row.labelUz, bold: true },
      { text: uz(row.value, row.unit), alignment: 'right', bold: true },
      { text: row.unit, color: '#666666' },
    ]);
    for (const child of row.children ?? []) {
      body.push([
        '',
        { text: `shundan: ${child.labelUz}`, italics: true, color: '#666666', margin: [10, 0, 0, 0] },
        { text: uz(child.value, row.unit), alignment: 'right', color: '#666666' },
        { text: row.unit, color: '#999999' },
      ]);
    }
  }

  return render({
    pageSize: 'A4',
    pageMargins: [34, 34, 34, 40],
    defaultStyle: { font: 'Roboto', fontSize: 9 },
    styles: {
      th: { bold: true, fontSize: 9, fillColor: '#eff3fa' },
    },
    content: [
      { text: 'PASPORT', fontSize: 15, bold: true, alignment: 'center' },
      { text: passport.scopeName, fontSize: 12, bold: true, alignment: 'center', margin: [0, 3, 0, 0] },
      {
        text: `Hisobot davri: ${passport.period}`,
        fontSize: 9, color: '#666666', alignment: 'center', margin: [0, 2, 0, 10],
      },
      {
        table: { headerRows: 1, widths: [18, '*', 62, 64], body },
        layout: {
          hLineWidth: (i: number) => (i === 0 || i === 1 ? 0.8 : 0.3),
          vLineWidth: () => 0,
          hLineColor: () => '#cccccc',
          paddingTop: () => 3,
          paddingBottom: () => 3,
        },
      },
      {
        text: '«Kiritiladi» — xodim qo‘lda yozadi. «Hisoblanadi» — tizim boshqa ma’lumotlardan '
          + 'chiqaradi. Hech qanday jami qiymat qo‘lda kiritilmaydi.',
        fontSize: 7.5, italics: true, color: '#888888', margin: [0, 10, 0, 0],
      },
    ],
    footer: (page: number, total: number) => ({
      text: `${page} / ${total}`,
      alignment: 'center', fontSize: 8, color: '#999999', margin: [0, 8, 0, 0],
    }),
  });

}

/** Davriy hisobot PDF — A4 albom (mahallalar jadvali keng). */
export async function periodPdf(input: PeriodReportInput): Promise<Buffer> {
  const kpiBody: TableCell[][] = [
    [
      { text: 'Ko‘rsatkich', style: 'th' },
      { text: 'Qiymat', style: 'th', alignment: 'right' },
    ],
    ['Tarmoqqa kirgan energiya', { text: `${uz(input.totals.kwhIn, '')} kVt/soat`, alignment: 'right' }],
    ['Sotilgan energiya', { text: `${uz(input.totals.kwhSold, '')} kVt/soat`, alignment: 'right' }],
    ['Jami yo‘qotish', { text: `${uz(input.totals.kwhLossTotal, '')} kVt/soat`, alignment: 'right' }],
    ['Yo‘qotish darajasi', { text: `${uz(input.totals.lossPct, '')} %`, alignment: 'right', bold: true }],
    ['Jami iste’molchilar', { text: `${uz(input.totals.consumersTotal, 'ta')} ta`, alignment: 'right' }],
    ['Transformator punktlari', { text: `${uz(input.totals.tpCount, 'ta')} ta`, alignment: 'right' }],
    ['Jami qarzdorlik', { text: `${uz(input.totals.debtTotalMln, '')} mln so‘m`, alignment: 'right' }],
  ];

  const mfyBody: TableCell[][] = [
    [
      { text: 'Mahalla', style: 'th' },
      { text: 'Tarmoqqa kirgan', style: 'th', alignment: 'right' },
      { text: 'Yo‘qotish, %', style: 'th', alignment: 'right' },
      { text: 'Standart, %', style: 'th', alignment: 'right' },
      { text: 'Farq, p.p.', style: 'th', alignment: 'right' },
      { text: 'Holat', style: 'th' },
    ],
  ];
  for (const m of input.mfys) {
    mfyBody.push([
      m.nameUz,
      { text: uz(m.kwhIn, ''), alignment: 'right' },
      { text: uz(m.lossPct, ''), alignment: 'right', bold: true },
      { text: uz(m.normPct, ''), alignment: 'right', color: '#666666' },
      {
        text: `${m.gapPp > 0 ? '+' : ''}${m.gapPp.toFixed(2)}`,
        alignment: 'right',
        color: m.gapPp > 0 ? '#c1121f' : '#0b7a4b',
      },
      { text: STATUS_UZ[m.status] ?? m.status, fontSize: 8 },
    ]);
  }

  return render({
    pageSize: 'A4',
    pageOrientation: 'landscape',
    pageMargins: [30, 30, 30, 36],
    defaultStyle: { font: 'Roboto', fontSize: 8.5 },
    styles: { th: { bold: true, fontSize: 8.5, fillColor: '#eff3fa' } },
    content: [
      { text: `${input.kindLabel} hisobot`, fontSize: 14, bold: true },
      { text: input.scopeName, fontSize: 11, bold: true, margin: [0, 2, 0, 0] },
      { text: `Davr: ${input.period}`, fontSize: 9, color: '#666666', margin: [0, 1, 0, 10] },

      { text: 'Umumiy ko‘rsatkichlar', fontSize: 10, bold: true, margin: [0, 0, 0, 4] },
      {
        table: { headerRows: 1, widths: [200, 130], body: kpiBody },
        layout: 'lightHorizontalLines',
      },

      { text: 'Mahallalar kesimida', fontSize: 10, bold: true, margin: [0, 12, 0, 4] },
      {
        table: { headerRows: 1, widths: ['*', 90, 62, 62, 62, 90], body: mfyBody },
        layout: {
          hLineWidth: (i: number) => (i === 0 || i === 1 ? 0.8 : 0.3),
          vLineWidth: () => 0,
          hLineColor: () => '#cccccc',
          paddingTop: () => 2.5,
          paddingBottom: () => 2.5,
        },
      },
    ],
    footer: (page: number, total: number) => ({
      text: `${page} / ${total}`,
      alignment: 'center', fontSize: 8, color: '#999999', margin: [0, 6, 0, 0],
    }),
  });

}
