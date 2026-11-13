import ExcelJS from 'exceljs';
import type { Transaction, TxKind, VoucherExportType } from '../shared/types';
import { METHOD_LABELS } from '../shared/types';
import { formatDate, todayIso } from '../shared/dates';
import { amountInWords, formatDecimal, formatNumber } from '../shared/format';
import { parseContainerCounts } from '../shared/containers';
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
  'Tiền tệ',
  'Số tiền gốc',
  'Tỷ giá',
  'Hạn thanh toán',
  'Đã thanh toán',
  'Còn nợ',
  'Chứng từ',
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
      row.currency,
      row.originalAmount,
      row.exchangeRate,
      row.dueDate ? formatDate(row.dueDate) : '',
      row.paidAmount,
      Math.max(0, row.amount - row.paidAmount),
      row.attachmentCount,
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
    { key: 'fx', width: 22 },
    { key: 'debt', width: 34 },
    { key: 'attachments', width: 10 },
  ];

  sheet.mergeCells('A1:R1');
  const company = sheet.getCell('A1');
  company.value = options.companyName;
  company.font = { bold: true, size: 15, color: { argb: INK } };
  company.alignment = { vertical: 'middle' };
  sheet.getRow(1).height = 26;

  sheet.mergeCells('A2:R2');
  const title = sheet.getCell('A2');
  title.value = kind === 'income' ? 'SỔ THU NHẬP' : 'SỔ CHI PHÍ';
  title.font = { bold: true, size: 11, color: { argb: INK } };
  title.alignment = { vertical: 'middle' };
  sheet.getRow(2).height = 18;

  sheet.mergeCells('A3:R3');
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
    'Ngoại tệ',
    'Công nợ',
    'Chứng từ',
  ];
  const headerRow = sheet.getRow(5);
  headerRow.values = headerLabels;
  styleHeaderRow(headerRow, headerLabels.length, 13);

  const firstDataRow = 6;
  rows.forEach((row, index) => {
    const added = sheet.getRow(firstDataRow + index);
    const fxText =
      row.currency !== 'VND'
        ? `${formatDecimal(row.originalAmount)} ${row.currency} × ${formatDecimal(row.exchangeRate)}`
        : '';
    const debtText = row.dueDate
      ? `${formatNumber(row.paidAmount)} / ${formatNumber(row.amount)} đ · hạn ${formatDate(row.dueDate)}`
      : '';
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
      fxText,
      debtText,
      row.attachmentCount || '',
    ];
    added.height = 22;
    added.eachCell({ includeEmpty: true }, (cell, col) => {
      cell.font = { size: 9.5, color: { argb: col === 13 ? (kind === 'income' ? INCOME : EXPENSE) : INK } };
      cell.alignment = {
        vertical: 'top',
        wrapText: col === 14 || col === 15 || col === 17,
        horizontal: col === 13 || col === 1 || col === 18 ? 'right' : 'left',
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
  for (let col = 1; col <= 18; col += 1) {
    totalRow.getCell(col).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SOFT } };
    totalRow.getCell(col).border = {
      top: { style: 'thin', color: { argb: LINE } },
      bottom: { style: 'thin', color: { argb: LINE } },
    };
  }

  if (rows.length > 0) {
    sheet.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5 + rows.length, column: 18 } };
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

const VOUCHER_FONT = 'Times New Roman';
const VOUCHER_COMPANY = 'CÔNG TY TNHH THƯƠNG MẠI EVERGROW VIỆT NAM';
const VOUCHER_SIGNER = 'NGÔ ĐỨC TUẤN';
const VOUCHER_BANK = {
  name: 'Ngân hàng Thương mại Cổ phần Á Châu',
  account: '40466868',
  holder: VOUCHER_COMPANY,
  branch: 'ACB – Chi nhánh Sài Gòn',
};
const VOUCHER_TITLES: Record<VoucherExportType, string> = {
  cost: 'BẢNG KÊ CHI PHÍ',
  payment: 'PHIẾU YÊU CẦU THANH TOÁN',
};
const TABLE_BORDER = {
  top: { style: 'thin' as const, color: { argb: 'FF000000' } },
  left: { style: 'thin' as const, color: { argb: 'FF000000' } },
  bottom: { style: 'thin' as const, color: { argb: 'FF000000' } },
  right: { style: 'thin' as const, color: { argb: 'FF000000' } },
};

interface VoucherItem {
  name: string;
  sl: number | '';
  amount: number | '';
  vat: number | '';
  total: number;
}

function voucherItem(name: string, amount: number): VoucherItem {
  return { name, sl: '', amount, vat: '', total: amount };
}

function voucherGroups(transaction: Transaction): { title: string; items: VoucherItem[] }[] {
  const paid: VoucherItem[] = [];
  if (transaction.customerLift > 0) paid.push(voucherItem('Phí nâng Cont', transaction.customerLift));
  if (transaction.customerLower > 0) paid.push(voucherItem('Phí hạ Cont', transaction.customerLower));
  for (const fee of transaction.customerFees) {
    if (fee.amount > 0) paid.push(voucherItem(fee.label, fee.amount));
  }

  const other: VoucherItem[] = [];
  if (transaction.customerFar > 0) other.push(voucherItem('Phụ thu hạ xa', transaction.customerFar));
  if (transaction.otherIncome > 0) other.push(voucherItem('Phí khác', transaction.otherIncome));

  const service: VoucherItem[] = [];
  const counts = parseContainerCounts(transaction.containerSize);
  const containerCount = counts.count20 + counts.count40;
  const base = transaction.serviceRevenue;
  if (base > 0) {
    service.push({
      name: `Phí dịch vụ ${transaction.containerSize || 'container'}`.trim(),
      sl: containerCount || '',
      amount: base,
      vat: '',
      total: base,
    });
    const vat = Math.round(base * 0.08);
    if (vat > 0) {
      service.push({ name: 'VAT (8%)', sl: '', amount: '', vat, total: vat });
    }
  }

  return [
    { title: '1. PHÍ CHI HỘ', items: paid },
    { title: '2. PHÍ KHÁC', items: other },
    { title: '3. PHÍ DỊCH VỤ KHAI THUÊ VÀ GIAO NHẬN', items: service },
  ];
}

function voucherSheetName(transaction: Transaction, index: number, used: Set<string>): string {
  let base = (transaction.reference || `Lo ${index + 1}`).replace(/[\\/*?:[\]]/g, ' ').trim();
  if (!base) base = `Lo ${index + 1}`;
  base = base.slice(0, 31);
  let name = base;
  let suffix = 2;
  while (used.has(name)) {
    name = `${base.slice(0, 28)} ${suffix}`;
    suffix += 1;
  }
  used.add(name);
  return name;
}

function addVoucherSheet(
  workbook: ExcelJS.Workbook,
  transaction: Transaction,
  type: VoucherExportType,
  index: number,
  usedNames: Set<string>,
): void {
  const sheet = workbook.addWorksheet(voucherSheetName(transaction, index, usedNames));
  sheet.pageSetup = {
    paperSize: 9,
    orientation: 'portrait',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 },
  };
  sheet.columns = [
    { width: 4.66 },
    { width: 8.89 },
    { width: 8.11 },
    { width: 9.11 },
    { width: 6.66 },
    { width: 5.33 },
    { width: 10.55 },
    { width: 7.66 },
    { width: 7.66 },
    { width: 8.89 },
    { width: 12.55 },
  ];

  const setCell = (
    row: number,
    col: number,
    value: string | number,
    options: {
      bold?: boolean;
      underline?: boolean;
      size?: number;
      align?: 'left' | 'center' | 'right';
      wrap?: boolean;
      border?: boolean;
      numberFormat?: string;
    } = {},
  ) => {
    const cell = sheet.getCell(row, col);
    cell.value = value;
    cell.font = {
      name: VOUCHER_FONT,
      size: options.size ?? 11,
      bold: options.bold ?? false,
      underline: options.underline ?? false,
    };
    cell.alignment = {
      vertical: 'middle',
      horizontal: options.align ?? 'left',
      wrapText: options.wrap ?? true,
    };
    cell.border = options.border ? TABLE_BORDER : {};
    if (options.numberFormat) cell.numFmt = options.numberFormat;
    return cell;
  };

  const merged = (
    range: string,
    row: number,
    col: number,
    value: string | number,
    options: Parameters<typeof setCell>[3] = {},
  ) => {
    sheet.mergeCells(range);
    setCell(row, col, value, options);
  };

  merged('A1:E3', 1, 1, VOUCHER_COMPANY, { bold: true, align: 'center' });
  merged('G1:K3', 1, 7, 'CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM\nĐộc lập – Tự do – Hạnh phúc', {
    bold: true,
    align: 'center',
  });

  merged('A4:E4', 4, 1, `Số: ${transaction.reference ? `${transaction.reference}/EGVN` : '—'}`, {
    bold: true,
    size: 10,
  });
  const now = new Date();
  merged(
    'G4:K4',
    4,
    7,
    `Tp.HCM, ngày ${now.getDate()} tháng ${now.getMonth() + 1} năm ${now.getFullYear()}`,
    { align: 'right', size: 10 },
  );

  merged('A6:K6', 6, 1, VOUCHER_TITLES[type], { bold: true, align: 'center' });
  sheet.getRow(6).height = 24;
  merged('A7:J7', 7, 1, '', {});
  merged('A8:K8', 8, 1, `Kính gửi: ${transaction.party || 'Quý Công ty'}`, { bold: true });

  const containers =
    transaction.containerSize ||
    [transaction.containerNo].filter(Boolean).join(', ') ||
    '—';
  const goods =
    [transaction.goodsType, transaction.goodsName].filter(Boolean).join(': ') || '—';
  merged(
    'B10:K14',
    10,
    2,
    `Được sự ủy nhiệm của Quý Công ty, ${VOUCHER_COMPANY} thực hiện nhiệm vụ làm thủ tục ` +
      `khai thuê hải quan và giao nhận hàng hóa lô hàng ${containers}. Hàng ${goods}. ` +
      `Theo tờ khai số ${transaction.reference || '—'} ngày ${formatDate(transaction.occurredOn)} ` +
      `từ Cảng ${transaction.port || '—'} về kho của Quý Công ty tại ` +
      `${transaction.warehouseAddress || '—'}.`,
    {},
  );
  for (let line = 10; line <= 14; line += 1) sheet.getRow(line).height = 15;
  merged(
    'B15:K15',
    15,
    2,
    'Nay Cty EVERGROW VIỆT NAM báo đến Quý Công ty các chi phí phát sinh như sau:',
    {},
  );

  const groups = voucherGroups(transaction);
  let row = 17;
  let grandTotal = 0;

  const headerCells = (
    labels: [string, number, string][],
    headerRow: number,
    withCount: boolean,
  ) => {
    for (const [label, col, range] of labels) {
      if (range) merged(range, headerRow, col, label, { bold: true, align: 'center', border: true });
      else setCell(headerRow, col, label, { bold: true, align: 'center', border: true });
    }
    if (withCount) {
      setCell(headerRow, 4, 'SL', { bold: true, align: 'center', border: true });
    }
  };

  const sectionTitle = (title: string) => {
    merged(`A${row}:K${row}`, row, 1, title, { bold: true });
    row += 1;
  };

  const sectionHeader12 = () => {
    headerCells(
      [
        ['STT', 1, ''],
        ['NỘI DUNG', 2, `B${row}:D${row}`],
        ['SỐ TIỀN', 5, `E${row}:F${row}`],
        ['VAT (8%)', 7, ''],
        ['THÀNH TIỀN', 8, `H${row}:I${row}`],
        ['GHI CHÚ', 10, `J${row}:K${row}`],
      ],
      row,
      false,
    );
    row += 1;
  };

  const sectionHeader3 = () => {
    headerCells(
      [
        ['STT', 1, ''],
        ['NỘI DUNG', 2, `B${row}:C${row}`],
        ['SL', 4, ''],
        ['SỐ TIỀN', 5, `E${row}:G${row}`],
        ['THÀNH TIỀN', 8, `H${row}:I${row}`],
        ['GHI CHÚ', 10, `J${row}:K${row}`],
      ],
      row,
      false,
    );
    row += 1;
  };

  const simpleSection = (title: string, items: VoucherItem[]) => {
    sectionTitle(title);
    sectionHeader12();
    const total = items.reduce((sum, item) => sum + item.total, 0);
    if (items.length === 0) {
      merged(`B${row}:K${row}`, row, 2, '—', { align: 'center', border: true });
      row += 1;
    } else {
      items.forEach((item, itemIndex) => {
        setCell(row, 1, itemIndex + 1, { align: 'center', border: true });
        merged(`B${row}:D${row}`, row, 2, item.name, { border: true });
        merged(`E${row}:F${row}`, row, 5, item.amount, {
          align: 'right',
          border: true,
          numberFormat: '#,##0',
        });
        setCell(row, 7, item.vat, { align: 'right', border: true, numberFormat: '#,##0' });
        merged(`H${row}:I${row}`, row, 8, item.total, {
          align: 'right',
          border: true,
          numberFormat: '#,##0',
        });
        merged(`J${row}:K${row}`, row, 10, '', { border: true });
        row += 1;
      });
    }
    setCell(row, 1, '', { border: true });
    merged(`B${row}:D${row}`, row, 2, 'CỘNG', { bold: true, align: 'center', border: true });
    merged(`E${row}:F${row}`, row, 5, '', { border: true });
    setCell(row, 7, '', { border: true });
    merged(`H${row}:I${row}`, row, 8, total, {
      bold: true,
      align: 'right',
      border: true,
      numberFormat: '#,##0',
    });
    merged(`J${row}:K${row}`, row, 10, '', { border: true });
    grandTotal += total;
    row += 2;
  };

  simpleSection(groups[0].title, groups[0].items);
  simpleSection(groups[1].title, groups[1].items);

  sectionTitle(groups[2].title);
  sectionHeader3();
  let serviceTotal = 0;
  if (groups[2].items.length === 0) {
    merged(`B${row}:K${row}`, row, 2, '—', { align: 'center', border: true });
    row += 1;
  } else {
    groups[2].items.forEach((item, itemIndex) => {
      setCell(row, 1, itemIndex + 1, { align: 'center', border: true });
      merged(`B${row}:C${row}`, row, 2, item.name, { border: true });
      setCell(row, 4, item.sl, { align: 'center', border: true });
      merged(`E${row}:G${row}`, row, 5, item.amount, {
        align: 'right',
        border: true,
        numberFormat: '#,##0',
      });
      merged(`H${row}:I${row}`, row, 8, item.total, {
        align: 'right',
        border: true,
        numberFormat: '#,##0',
      });
      merged(`J${row}:K${row}`, row, 10, '', { border: true });
      serviceTotal += item.total;
      row += 1;
    });
  }
  setCell(row, 1, '', { border: true });
  merged(`B${row}:D${row}`, row, 2, 'CỘNG', { bold: true, align: 'center', border: true });
  merged(`E${row}:G${row}`, row, 5, '', { border: true });
  merged(`H${row}:I${row}`, row, 8, serviceTotal, {
    bold: true,
    align: 'right',
    border: true,
    numberFormat: '#,##0',
  });
  merged(`J${row}:K${row}`, row, 10, '', { border: true });
  grandTotal += serviceTotal;
  row += 2;

  merged(`A${row}:G${row}`, row, 1, 'TỔNG CỘNG (1+2+3)', { bold: true, border: true });
  merged(`H${row}:I${row}`, row, 8, grandTotal, {
    bold: true,
    align: 'right',
    border: true,
    numberFormat: '#,##0',
  });
  merged(`J${row}:K${row}`, row, 10, '', { border: true });
  row += 1;

  merged(`A${row}:K${row}`, row, 1, `(Bằng tiền: ${amountInWords(grandTotal)}./.)`, {});
  row += 2;

  const paymentRow = row;
  merged(`A${paymentRow}:F${paymentRow}`, paymentRow, 1, 'THANH TOÁN', {
    bold: true,
    underline: true,
  });
  merged(`H${paymentRow}:K${paymentRow + 1}`, paymentRow, 8, VOUCHER_COMPANY, {
    bold: true,
    align: 'center',
  });

  const bankRow = paymentRow + 2;
  merged(`A${bankRow}:B${bankRow}`, bankRow, 1, 'Tên Ngân hàng', {});
  setCell(bankRow, 3, ':');
  setCell(bankRow, 4, VOUCHER_BANK.name);
  merged(`I${bankRow}:J${bankRow}`, bankRow, 9, '', {});

  setCell(bankRow + 1, 1, 'Số Tài khoản');
  setCell(bankRow + 1, 3, ':');
  merged(`D${bankRow + 1}:H${bankRow + 1}`, bankRow + 1, 4, VOUCHER_BANK.account, {});

  merged(`A${bankRow + 2}:B${bankRow + 3}`, bankRow + 2, 1, 'Tên Tài khoản', {});
  merged(`C${bankRow + 2}:C${bankRow + 3}`, bankRow + 2, 3, ':');
  merged(`D${bankRow + 2}:H${bankRow + 3}`, bankRow + 2, 4, VOUCHER_BANK.holder, {});

  const branchRow = bankRow + 4;
  merged(`A${branchRow}:B${branchRow}`, branchRow, 1, 'Chi nhánh', {});
  setCell(branchRow, 3, ':');
  merged(`D${branchRow}:G${branchRow}`, branchRow, 4, VOUCHER_BANK.branch, {});
  merged(`H${branchRow}:K${branchRow}`, branchRow, 8, '', {});

  merged(`H${branchRow + 1}:K${branchRow + 1}`, branchRow + 1, 8, VOUCHER_SIGNER, {
    align: 'center',
  });
}

export async function writeVoucherXlsx(
  file: string,
  rows: Transaction[],
  type: VoucherExportType,
): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Evergrow Books';
  workbook.created = new Date();
  const usedNames = new Set<string>();
  rows.forEach((transaction, index) => {
    addVoucherSheet(workbook, transaction, type, index, usedNames);
  });
  await workbook.xlsx.writeFile(file);
}

export function periodLabel(from?: string, to?: string): string {
  if (from && to) return `${formatDate(from)} – ${formatDate(to)}`;
  if (from) return `Từ ${formatDate(from)}`;
  if (to) return `Đến ${formatDate(to)}`;
  return 'Toàn bộ dữ liệu';
}
