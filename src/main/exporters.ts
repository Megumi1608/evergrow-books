import ExcelJS from 'exceljs';
import type { Transaction, TxKind } from '../shared/types';
import { METHOD_LABELS } from '../shared/types';
import { formatDate, todayIso } from '../shared/dates';

const KIND_LABEL: Record<TxKind, string> = { income: 'Thu nhập', expense: 'Chi phí' };
const GREEN = 'FF1E5B45';
const CLAY = 'FFA44A2A';
const INK = 'FF23231F';
const MUTED = 'FF6F6F66';
const LINE = 'FFE0DED6';
const SOFT = 'FFF2F1EC';

function csvCell(value: string | number): string {
  let text = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildCsv(rows: Transaction[]): string {
  const header = ['Ngày', 'Loại', 'Danh mục', 'Số tiền (VND)', 'Hình thức', 'Đối tác', 'Ghi chú'];
  const lines = rows.map((row) =>
    [
      formatDate(row.occurredOn),
      KIND_LABEL[row.kind],
      row.categoryName,
      row.amount,
      METHOD_LABELS[row.method],
      row.party,
      row.note,
    ]
      .map(csvCell)
      .join(','),
  );
  return `\uFEFF${[header.join(','), ...lines].join('\r\n')}\r\n`;
}

interface XlsxOptions {
  companyName: string;
  periodLabel: string;
}

export async function writeXlsx(file: string, rows: Transaction[], options: XlsxOptions): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Evergrow Books';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Giao dịch', {
    views: [{ state: 'frozen', ySplit: 1 }],
    properties: { defaultRowHeight: 20 },
  });
  sheet.columns = [
    { header: 'Ngày', key: 'date', width: 13 },
    { header: 'Loại', key: 'kind', width: 12 },
    { header: 'Danh mục', key: 'category', width: 24 },
    { header: 'Đối tác', key: 'party', width: 28 },
    { header: 'Hình thức', key: 'method', width: 16 },
    { header: 'Số tiền (VND)', key: 'amount', width: 18 },
    { header: 'Ghi chú', key: 'note', width: 42 },
  ];

  const header = sheet.getRow(1);
  header.height = 26;
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } };
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
  });

  rows.forEach((row, index) => {
    const added = sheet.addRow([
      formatDate(row.occurredOn),
      KIND_LABEL[row.kind],
      row.categoryName,
      row.party,
      METHOD_LABELS[row.method],
      row.amount,
      row.note,
    ]);
    added.height = 21;
    added.eachCell((cell, cellIndex) => {
      cell.font = { color: { argb: INK }, size: 10 };
      cell.border = { bottom: { style: 'hair', color: { argb: LINE } } };
      if (cellIndex === 6) {
        cell.numFmt = '#,##0';
        cell.alignment = { horizontal: 'right' };
        cell.font = { color: { argb: row.kind === 'income' ? GREEN : CLAY }, size: 10, bold: true };
      }
      if (index % 2 === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SOFT } };
      }
    });
  });

  if (rows.length > 0) {
    sheet.autoFilter = { from: 'A1', to: 'G1' };
  }

  const income = rows.filter((row) => row.kind === 'income').reduce((sum, row) => sum + row.amount, 0);
  const expense = rows.filter((row) => row.kind === 'expense').reduce((sum, row) => sum + row.amount, 0);

  const summary = workbook.addWorksheet('Tổng hợp', { properties: { defaultRowHeight: 20 } });
  summary.columns = [{ width: 32 }, { width: 16 }, { width: 18 }, { width: 16 }];
  summary.mergeCells('A1:D1');
  const title = summary.getCell('A1');
  title.value = options.companyName;
  title.font = { bold: true, size: 16, color: { argb: INK } };
  summary.getCell('A2').value = 'Báo cáo thu chi';
  summary.getCell('A2').font = { size: 11, color: { argb: MUTED } };
  summary.getCell('A3').value = `Kỳ báo cáo: ${options.periodLabel}`;
  summary.getCell('A3').font = { size: 10, color: { argb: MUTED } };
  summary.getCell('A4').value = `Xuất ngày ${formatDate(todayIso())}`;
  summary.getCell('A4').font = { size: 10, color: { argb: MUTED } };

  const summaryRows: [string, number, string][] = [
    ['Tổng thu nhập', income, 'FF1E5B45'],
    ['Tổng chi phí', expense, 'FFA44A2A'],
    ['Chênh lệch', income - expense, 'FF23231F'],
  ];
  summaryRows.forEach(([label, value, color], index) => {
    const row = summary.getRow(6 + index);
    row.values = [label, value];
    row.getCell(1).font = { bold: true, size: 11, color: { argb: INK } };
    row.getCell(2).value = value;
    row.getCell(2).numFmt = '#,##0';
    row.getCell(2).font = { bold: true, size: 11, color: { argb: color } };
    row.getCell(2).alignment = { horizontal: 'right' };
    row.eachCell((cell) => {
      cell.border = { bottom: { style: 'hair', color: { argb: LINE } } };
    });
  });

  const categoryStart = 11;
  const categoryHeader = summary.getRow(categoryStart);
  categoryHeader.values = ['Danh mục', 'Loại', 'Số tiền (VND)', 'Số giao dịch'];
  categoryHeader.eachCell((cell) => {
    cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } };
  });

  const grouped = new Map<string, { name: string; kind: TxKind; total: number; count: number }>();
  for (const row of rows) {
    const key = `${row.kind}:${row.categoryName}`;
    const entry = grouped.get(key) ?? { name: row.categoryName, kind: row.kind, total: 0, count: 0 };
    entry.total += row.amount;
    entry.count += 1;
    grouped.set(key, entry);
  }
  const ordered = [...grouped.values()].sort((a, b) => b.total - a.total);
  ordered.forEach((entry, index) => {
    const row = summary.getRow(categoryStart + 1 + index);
    row.values = [entry.name, KIND_LABEL[entry.kind], entry.total, entry.count];
    row.getCell(1).font = { size: 10, color: { argb: INK } };
    row.getCell(2).font = { size: 10, color: { argb: entry.kind === 'income' ? GREEN : CLAY } };
    row.getCell(3).numFmt = '#,##0';
    row.getCell(3).alignment = { horizontal: 'right' };
    row.getCell(4).alignment = { horizontal: 'right' };
    row.eachCell((cell) => {
      cell.border = { bottom: { style: 'hair', color: { argb: LINE } } };
    });
  });

  if (ordered.length === 0) {
    summary.getCell(categoryStart + 1, 1).value = 'Chưa có giao dịch trong kỳ.';
    summary.getCell(categoryStart + 1, 1).font = { italic: true, color: { argb: MUTED } };
  }

  await workbook.xlsx.writeFile(file);
}

export function periodLabel(from?: string, to?: string): string {
  if (from && to) return `${formatDate(from)} – ${formatDate(to)}`;
  if (from) return `Từ ${formatDate(from)}`;
  if (to) return `Đến ${formatDate(to)}`;
  return 'Toàn bộ dữ liệu';
}
