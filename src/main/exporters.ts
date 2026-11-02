import ExcelJS from 'exceljs';
import type { Transaction, TxKind } from '../shared/types';
import { METHOD_LABELS } from '../shared/types';
import { formatDate, todayIso } from '../shared/dates';
import { formatNumber } from '../shared/format';
import { LOGO_LOCKUP } from '../shared/brand';

const KIND_LABEL: Record<TxKind, string> = { income: 'Thu nhập', expense: 'Chi phí' };
const INK = 'FF111111';
const MUTED = 'FF6B6B6B';
const LINE = 'FFDADADA';
const SOFT = 'FFF4F4F4';
const INCOME = 'FF177245';
const EXPENSE = 'FFB42318';
const WARNING = 'FF9A6700';
const WHITE = 'FFFFFFFF';

interface XlsxOptions {
  companyName: string;
  periodLabel: string;
}

const CSV_HEADERS = [
  'STT',
  'Ngày',
  'Loại',
  'Số TK',
  'Cửa',
  'Đối tác',
  'Tên hàng',
  'Loại hàng',
  'Số cont',
  'Kích thước cont',
  'Đơn vị vận chuyển',
  'Danh mục',
  'Hình thức',
  'Số tiền (VND)',
  'Ghi chú',
  'Chi tiết phí',
];

function csvCell(value: string | number): string {
  let text = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function detailsText(details: Record<string, number>): string {
  return Object.entries(details)
    .map(([label, value]) => `${label}: ${formatNumber(value)}`)
    .join('; ');
}

export function buildCsv(rows: Transaction[]): string {
  const lines = rows.map((row, index) =>
    [
      index + 1,
      formatDate(row.occurredOn),
      KIND_LABEL[row.kind],
      row.reference,
      row.port,
      row.party,
      row.goodsName,
      row.goodsType,
      row.containerNo,
      row.containerSize,
      row.carrier && row.carrier !== row.party ? row.carrier : '',
      row.categoryName,
      METHOD_LABELS[row.method],
      row.amount,
      row.note,
      detailsText(row.details),
    ]
      .map(csvCell)
      .join(','),
  );
  return `\uFEFF${[CSV_HEADERS.map(csvCell).join(','), ...lines].join('\r\n')}\r\n`;
}

function totals(rows: Transaction[]): { income: number; expense: number } {
  return {
    income: rows.filter((row) => row.kind === 'income').reduce((sum, row) => sum + row.amount, 0),
    expense: rows.filter((row) => row.kind === 'expense').reduce((sum, row) => sum + row.amount, 0),
  };
}

function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

function monthLabel(month: string): string {
  const [year, monthNumber] = month.split('-');
  return `${monthNumber}/${year}`;
}

function styleHeaderRow(row: ExcelJS.Row, columns: number, amountColumn: number): void {
  row.height = 26;
  for (let col = 1; col <= columns; col += 1) {
    const cell = row.getCell(col);
    cell.font = { bold: true, size: 10, color: { argb: WHITE } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INK } };
    cell.alignment = { vertical: 'middle', horizontal: col === amountColumn ? 'right' : 'left' };
    cell.border = { bottom: { style: 'thin', color: { argb: LINE } } };
  }
}

function createDetailSheet(
  workbook: ExcelJS.Workbook,
  kind: TxKind,
  rows: Transaction[],
  options: XlsxOptions,
): void {
  const sheet = workbook.addWorksheet(kind === 'income' ? 'Thu' : 'Chi', {
    views: [{ state: 'frozen', ySplit: 5 }],
    properties: { defaultRowHeight: 20 },
    pageSetup: {
      orientation: 'landscape',
      paperSize: 9,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      printTitlesRow: '5:5',
      margins: { left: 0.3, right: 0.3, top: 0.45, bottom: 0.45, header: 0.2, footer: 0.2 },
    },
  });

  sheet.columns = [
    { key: 'stt', width: 5.5 },
    { key: 'date', width: 12 },
    { key: 'reference', width: 15 },
    { key: 'port', width: 8 },
    { key: 'party', width: 24 },
    { key: 'goodsName', width: 24 },
    { key: 'goodsType', width: 13 },
    { key: 'containerNo', width: 15 },
    { key: 'containerSize', width: 14 },
    { key: 'carrier', width: 18 },
    { key: 'category', width: 21 },
    { key: 'method', width: 14 },
    { key: 'amount', width: 17 },
    { key: 'note', width: 28 },
    { key: 'details', width: 42 },
  ];

  sheet.mergeCells('A1:O1');
  const company = sheet.getCell('A1');
  company.value = options.companyName;
  company.font = { bold: true, size: 15, color: { argb: INK } };
  company.alignment = { vertical: 'middle' };
  sheet.getRow(1).height = 26;

  sheet.mergeCells('A2:O2');
  const title = sheet.getCell('A2');
  title.value = kind === 'income' ? 'SỔ THU NHẬP' : 'SỔ CHI PHÍ';
  title.font = { bold: true, size: 11, color: { argb: INK } };
  title.alignment = { vertical: 'middle' };
  sheet.getRow(2).height = 18;

  sheet.mergeCells('A3:O3');
  const period = sheet.getCell('A3');
  period.value = `Kỳ: ${options.periodLabel}   ·   Xuất ngày ${formatDate(todayIso())}   ·   ${rows.length} giao dịch`;
  period.font = { size: 9, color: { argb: MUTED } };
  period.alignment = { vertical: 'middle' };

  const headerLabels = [
    'STT',
    'Ngày',
    'Số TK',
    'Cửa',
    kind === 'income' ? 'Khách hàng' : 'Đối tác',
    'Tên hàng',
    'Loại hàng',
    'Số cont',
    'Kích thước cont',
    'Đơn vị vận chuyển',
    'Danh mục',
    'Hình thức',
    'Số tiền (VND)',
    'Ghi chú',
    'Chi tiết phí',
  ];
  const headerRow = sheet.getRow(5);
  headerRow.values = headerLabels;
  styleHeaderRow(headerRow, headerLabels.length, 13);

  const firstDataRow = 6;
  rows.forEach((row, index) => {
    const added = sheet.getRow(firstDataRow + index);
    added.values = [
      index + 1,
      formatDate(row.occurredOn),
      row.reference,
      row.port,
      row.party,
      row.goodsName,
      row.goodsType,
      row.containerNo,
      row.containerSize,
      row.carrier && row.carrier !== row.party ? row.carrier : '',
      row.categoryName,
      METHOD_LABELS[row.method],
      row.amount,
      row.note,
      detailsText(row.details),
    ];
    added.height = 22;
    added.eachCell({ includeEmpty: true }, (cell, col) => {
      cell.font = { size: 9.5, color: { argb: col === 13 ? (kind === 'income' ? INCOME : EXPENSE) : INK } };
      cell.alignment = {
        vertical: 'top',
        wrapText: col === 14 || col === 15,
        horizontal: col === 13 || col === 1 ? 'right' : 'left',
      };
      cell.border = { bottom: { style: 'hair', color: { argb: LINE } } };
      if (index % 2 === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SOFT } };
      }
    });
    added.getCell(13).numFmt = '#,##0';
    added.getCell(13).font = { size: 9.5, bold: true, color: { argb: kind === 'income' ? INCOME : EXPENSE } };
  });

  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  const totalRowIndex = firstDataRow + rows.length;
  const totalRow = sheet.getRow(totalRowIndex);
  totalRow.height = 23;
  sheet.mergeCells(totalRowIndex, 1, totalRowIndex, 12);
  totalRow.getCell(1).value = `TỔNG CỘNG · ${rows.length} giao dịch`;
  totalRow.getCell(1).font = { bold: true, size: 10, color: { argb: INK } };
  totalRow.getCell(1).alignment = { horizontal: 'right', vertical: 'middle' };
  totalRow.getCell(13).value = total;
  totalRow.getCell(13).numFmt = '#,##0';
  totalRow.getCell(13).font = { bold: true, size: 10, color: { argb: kind === 'income' ? INCOME : EXPENSE } };
  totalRow.getCell(13).alignment = { horizontal: 'right', vertical: 'middle' };
  for (let col = 1; col <= 15; col += 1) {
    totalRow.getCell(col).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SOFT } };
    totalRow.getCell(col).border = {
      top: { style: 'thin', color: { argb: LINE } },
      bottom: { style: 'thin', color: { argb: LINE } },
    };
  }

  if (rows.length > 0) {
    sheet.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5 + rows.length, column: 15 } };
  }
  sheet.headerFooter = {
    oddFooter: `&L${options.companyName}&CTrang &P / &N&R${options.periodLabel}`,
  };
}

function addSummarySheet(
  workbook: ExcelJS.Workbook,
  rows: Transaction[],
  options: XlsxOptions,
): void {
  const sheet = workbook.addWorksheet('Tổng hợp', {
    views: [{ showGridLines: false }],
    pageSetup: {
      orientation: 'portrait',
      paperSize: 9,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.5, right: 0.5, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    },
  });
  sheet.columns = [
    { width: 24 },
    { width: 13 },
    { width: 17 },
    { width: 12 },
    { width: 17 },
    { width: 12 },
    { width: 17 },
    { width: 14 },
  ];

  const logoId = workbook.addImage({
    base64: LOGO_LOCKUP.split(',')[1],
    extension: 'png',
  });
  sheet.addImage(logoId, { tl: { col: 0, row: 0 }, ext: { width: 144, height: 52 } });
  sheet.getRow(1).height = 46;

  sheet.mergeCells('C1:H1');
  const company = sheet.getCell('C1');
  company.value = options.companyName;
  company.font = { bold: true, size: 16, color: { argb: INK } };
  company.alignment = { vertical: 'middle' };

  sheet.mergeCells('C2:H2');
  const title = sheet.getCell('C2');
  title.value = 'BÁO CÁO THU CHI';
  title.font = { bold: true, size: 10, color: { argb: MUTED } };
  title.alignment = { vertical: 'middle' };

  sheet.mergeCells('C3:H3');
  const period = sheet.getCell('C3');
  period.value = `Kỳ báo cáo: ${options.periodLabel}   ·   Lập ngày ${formatDate(todayIso())}`;
  period.font = { size: 9, color: { argb: MUTED } };
  period.alignment = { vertical: 'middle' };

  const sums = totals(rows);
  const net = sums.income - sums.expense;
  const cards: {
    label: string;
    value: string;
    color: string;
    labelRange: string;
    valueRange: string;
  }[] = [
    {
      label: 'THU NHẬP',
      value: `${formatNumber(sums.income)} đ`,
      color: INCOME,
      labelRange: 'A5:B5',
      valueRange: 'A6:B6',
    },
    {
      label: 'CHI PHÍ',
      value: `${formatNumber(sums.expense)} đ`,
      color: EXPENSE,
      labelRange: 'C5:D5',
      valueRange: 'C6:D6',
    },
    {
      label: 'CHÊNH LỆCH',
      value: `${formatNumber(net)} đ`,
      color: net >= 0 ? WARNING : EXPENSE,
      labelRange: 'E5:F5',
      valueRange: 'E6:F6',
    },
    {
      label: 'GIAO DỊCH',
      value: formatNumber(rows.length),
      color: INK,
      labelRange: 'G5:H5',
      valueRange: 'G6:H6',
    },
  ];
  sheet.getRow(5).height = 18;
  sheet.getRow(6).height = 28;
  for (const card of cards) {
    sheet.mergeCells(card.labelRange);
    const label = sheet.getCell(card.labelRange.split(':')[0]);
    label.value = card.label;
    label.font = { size: 8.5, bold: true, color: { argb: MUTED } };
    label.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    label.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SOFT } };

    sheet.mergeCells(card.valueRange);
    const value = sheet.getCell(card.valueRange.split(':')[0]);
    value.value = card.value;
    value.font = { size: 14, bold: true, color: { argb: card.color } };
    value.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    value.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SOFT } };

    for (const range of [card.labelRange, card.valueRange]) {
      const [startAddress, endAddress] = range.split(':');
      const rowNumber = Number(startAddress.slice(1));
      const startCol = startAddress.charCodeAt(0) - 64;
      const endCol = endAddress.charCodeAt(0) - 64;
      for (let col = startCol; col <= endCol; col += 1) {
        sheet.getCell(rowNumber, col).border = {
          top: { style: 'thin', color: { argb: LINE } },
          bottom: { style: 'thin', color: { argb: LINE } },
        };
      }
    }
  }

  const categoryMap = new Map<string, { name: string; kind: TxKind; total: number; count: number }>();
  for (const row of rows) {
    const key = `${row.kind}:${row.categoryName}`;
    const entry = categoryMap.get(key) ?? { name: row.categoryName, kind: row.kind, total: 0, count: 0 };
    entry.total += row.amount;
    entry.count += 1;
    categoryMap.set(key, entry);
  }

  let cursor = 8;
  sheet.mergeCells(cursor, 1, cursor, 8);
  const categoryTitle = sheet.getCell(cursor, 1);
  categoryTitle.value = 'CƠ CẤU THEO DANH MỤC';
  categoryTitle.font = { bold: true, size: 10, color: { argb: INK } };
  cursor += 1;
  const categoryHeader = sheet.getRow(cursor);
  categoryHeader.values = ['Danh mục', 'Loại', 'Số giao dịch', 'Số tiền (VND)'];
  for (let col = 1; col <= 4; col += 1) {
    const cell = categoryHeader.getCell(col);
    cell.font = { bold: true, size: 9, color: { argb: WHITE } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INK } };
    cell.alignment = { horizontal: col === 3 || col === 4 ? 'right' : 'left' };
  }
  cursor += 1;
  const categories = [...categoryMap.values()].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'income' ? -1 : 1;
    return b.total - a.total;
  });
  for (const category of categories) {
    const row = sheet.getRow(cursor);
    row.values = [category.name, KIND_LABEL[category.kind], category.count, category.total];
    row.getCell(1).font = { size: 9.5, color: { argb: INK } };
    row.getCell(2).font = { size: 9.5, color: { argb: category.kind === 'income' ? INCOME : EXPENSE } };
    row.getCell(3).alignment = { horizontal: 'right' };
    row.getCell(4).numFmt = '#,##0';
    row.getCell(4).alignment = { horizontal: 'right' };
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.border = { bottom: { style: 'hair', color: { argb: LINE } } };
    });
    cursor += 1;
  }
  if (categories.length === 0) {
    sheet.getCell(cursor, 1).value = 'Không có giao dịch trong kỳ.';
    sheet.getCell(cursor, 1).font = { italic: true, size: 9.5, color: { argb: MUTED } };
    cursor += 1;
  }

  cursor += 2;
  sheet.mergeCells(cursor, 1, cursor, 8);
  const monthTitle = sheet.getCell(cursor, 1);
  monthTitle.value = 'TỔNG HỢP THEO THÁNG';
  monthTitle.font = { bold: true, size: 10, color: { argb: INK } };
  cursor += 1;
  const monthHeader = sheet.getRow(cursor);
  monthHeader.values = ['Tháng', 'Thu nhập', 'Chi phí', 'Chênh lệch'];
  for (let col = 1; col <= 4; col += 1) {
    const cell = monthHeader.getCell(col);
    cell.font = { bold: true, size: 9, color: { argb: WHITE } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INK } };
    cell.alignment = { horizontal: col > 1 ? 'right' : 'left' };
  }
  cursor += 1;
  const monthly = new Map<string, { income: number; expense: number }>();
  for (const row of rows) {
    const key = monthKey(row.occurredOn);
    const entry = monthly.get(key) ?? { income: 0, expense: 0 };
    if (row.kind === 'income') entry.income += row.amount;
    else entry.expense += row.amount;
    monthly.set(key, entry);
  }
  for (const [month, value] of [...monthly.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const row = sheet.getRow(cursor);
    row.values = [monthLabel(month), value.income, value.expense, value.income - value.expense];
    row.getCell(1).font = { size: 9.5, color: { argb: INK } };
    row.getCell(2).font = { size: 9.5, color: { argb: INCOME } };
    row.getCell(3).font = { size: 9.5, color: { argb: EXPENSE } };
    row.getCell(4).font = { size: 9.5, color: { argb: value.income - value.expense >= 0 ? WARNING : EXPENSE } };
    for (let col = 2; col <= 4; col += 1) {
      row.getCell(col).numFmt = '#,##0';
      row.getCell(col).alignment = { horizontal: 'right' };
    }
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.border = { bottom: { style: 'hair', color: { argb: LINE } } };
    });
    cursor += 1;
  }

  cursor += 2;
  sheet.mergeCells(cursor, 1, cursor, 8);
  const note = sheet.getCell(cursor, 1);
  note.value = 'Ghi chú: Số liệu được tổng hợp từ sổ giao dịch Evergrow Books. Số tiền làm tròn đến đồng.';
  note.font = { italic: true, size: 8.5, color: { argb: MUTED } };
}

export async function writeXlsx(file: string, rows: Transaction[], options: XlsxOptions): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Evergrow Books';
  workbook.created = new Date();

  addSummarySheet(workbook, rows, options);
  const incomeRows = rows.filter((row) => row.kind === 'income');
  const expenseRows = rows.filter((row) => row.kind === 'expense');
  createDetailSheet(workbook, 'income', incomeRows, options);
  createDetailSheet(workbook, 'expense', expenseRows, options);

  await workbook.xlsx.writeFile(file);
}

export function periodLabel(from?: string, to?: string): string {
  if (from && to) return `${formatDate(from)} – ${formatDate(to)}`;
  if (from) return `Từ ${formatDate(from)}`;
  if (to) return `Đến ${formatDate(to)}`;
  return 'Toàn bộ dữ liệu';
}
