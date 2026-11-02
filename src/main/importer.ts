import ExcelJS from 'exceljs';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  ImportCommitOptions,
  ImportPreview,
  ImportPreviewRow,
  ImportResult,
  ImportSheetSummary,
  ImportWarning,
  TxKind,
} from '../shared/types';
import { isValidDate } from './validation';
import type { ImportTransactionRow, Store } from './db';

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_SHEET_ROWS = 50_000;
const TOKEN_TTL_MS = 30 * 60 * 1000;

interface HeaderColumn {
  col: number;
  label: string;
  norm: string;
}

interface ParsedRow extends ImportPreviewRow {
  sheetName: string;
  rowNumber: number;
  sourceKey: string;
  categoryOverride: string;
}

interface ParsedSheet {
  name: string;
  kind: TxKind;
  rows: ParsedRow[];
  skipped: number;
  warnings: ImportWarning[];
}

interface PendingImport {
  token: string;
  fileName: string;
  rows: ParsedRow[];
  expires: number;
}

const KNOWN_HEADERS = new Set([
  'stt', 'ngaygh', 'ngay', 'ngaygiao', 'ngaygiaodich', 'ngaychungtu',
  'sotk', 'sotokhai', 'sochungtu', 'cua', 'cuakhau', 'diadiem',
  'tencty', 'tencongty', 'khachhang', 'tenkhachhang', 'doitac',
  'tenhang', 'tenhanghoa', 'mathang', 'loaihang', 'loaihanghoa', 'nhomhang',
  'dongia', 'phinang', 'phiha', 'taxi', 'phuthu', 'phuthuhaxa', 'dichvu',
  'thanhtien', 'tongchi', 'tongthu', 'conlai',
  'donvivanchuyen', 'donvi', 'nhacungcap', 'socont', 'socontainer', 'container',
  'kichthuoccont', 'loaicont',
  'haiquan', 'chietkhau', 'tienkhac', 'tienxe', 'thanhtoantienxe',
  'danhmuc', 'hinhthuc', 'ghichu', 'diengiai', 'noidung', 'sotien', 'sotienvnd',
  '20', '40', 'chitietphi', 'loaigiaodich',
]);

const DETAIL_EXCLUSIONS = new Set([
  'stt', 'ngaygh', 'ngay', 'ngaygiao', 'ngaygiaodich', 'ngaychungtu',
  'sotk', 'sotokhai', 'sochungtu', 'cua', 'cuakhau', 'diadiem',
  'tencty', 'tencongty', 'khachhang', 'tenkhachhang', 'doitac',
  'tenhang', 'tenhanghoa', 'mathang', 'loaihang', 'loaihanghoa', 'nhomhang',
  'thanhtien', 'tongchi', 'tongthu', 'conlai', 'sotien', 'sotienvnd',
  'donvivanchuyen', 'donvi', 'nhacungcap', 'socont', 'socontainer', 'container',
  'kichthuoccont', 'loaicont',
  'danhmuc', 'hinhthuc', 'ghichu', 'diengiai', 'noidung', '20', '40', 'chitietphi',
]);

const pending = new Map<string, PendingImport>();

function cleanupPending(): void {
  const now = Date.now();
  for (const [token, batch] of pending) {
    if (batch.expires < now) pending.delete(token);
  }
}

function normalize(value: unknown): string {
  return asText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function unwrap(value: unknown): unknown {
  if (value && typeof value === 'object') {
    if ('result' in value) return (value as { result: unknown }).result;
    if ('richText' in value) {
      return (value as { richText: { text: string }[] }).richText.map((part) => part.text).join('');
    }
    if ('text' in value) return (value as { text: string }).text;
  }
  return value;
}

function asText(value: unknown): string {
  const raw = unwrap(value);
  if (raw === null || raw === undefined) return '';
  if (raw instanceof Date) {
    return `${raw.getFullYear()}-${String(raw.getMonth() + 1).padStart(2, '0')}-${String(raw.getDate()).padStart(2, '0')}`;
  }
  return String(raw).replace(/\s+/g, ' ').trim();
}

function asNumber(value: unknown): number {
  const raw = unwrap(value);
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0;
  if (typeof raw !== 'string') return 0;
  let text = raw.trim().replace(/\s/g, '').replace(/đ|vnd/gi, '');
  if (!text) return 0;
  const negative = /^\(.*\)$/.test(text);
  text = text.replace(/[()]/g, '');
  if (text.includes('.') && text.includes(',')) {
    text = text.replace(/\./g, '').replace(/,/g, '.');
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(text)) {
    text = text.replace(/\./g, '');
  } else if (/,/.test(text)) {
    text = /^-?\d{1,3}(,\d{3})+$/.test(text) ? text.replace(/,/g, '') : text.replace(/,/g, '.');
  }
  const parsed = Number(text.replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(parsed)) return 0;
  return negative ? -parsed : parsed;
}

function parseDate(value: unknown): string {
  const raw = unwrap(value);
  if (raw === null || raw === undefined || raw === '') return '';
  if (raw instanceof Date) {
    const year = raw.getFullYear();
    const month = String(raw.getMonth() + 1).padStart(2, '0');
    const day = String(raw.getDate()).padStart(2, '0');
    const iso = `${year}-${month}-${day}`;
    return isValidDate(iso) ? iso : '';
  }
  if (typeof raw === 'number' && raw > 20000 && raw < 80000) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.round(raw) * 86400000);
    const iso = date.toISOString().slice(0, 10);
    return isValidDate(iso) ? iso : '';
  }
  const text = asText(raw).split(/[ T]/)[0];
  let match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(text);
  if (match) {
    const iso = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
    return isValidDate(iso) ? iso : '';
  }
  match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(text);
  if (match) {
    let year = Number(match[3]);
    if (year < 100) year += 2000;
    const iso = `${year}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
    return isValidDate(iso) ? iso : '';
  }
  return '';
}

function columnToNumber(letters: string): number {
  let result = 0;
  for (const char of letters) result = result * 26 + (char.charCodeAt(0) - 64);
  return result;
}

function buildMergedValues(worksheet: ExcelJS.Worksheet): Map<string, unknown> {
  const map = new Map<string, unknown>();
  for (const range of worksheet.model.merges ?? []) {
    const match = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(range);
    if (!match) continue;
    const startCol = columnToNumber(match[1]);
    const startRow = Number(match[2]);
    const endCol = columnToNumber(match[3]);
    const endRow = Number(match[4]);
    const anchor = worksheet.getCell(startRow, startCol).value;
    for (let row = startRow; row <= endRow; row += 1) {
      for (let col = startCol; col <= endCol; col += 1) {
        map.set(`${row}:${col}`, anchor);
      }
    }
  }
  return map;
}

function detectHeader(
  worksheet: ExcelJS.Worksheet,
  merged: Map<string, unknown>,
): { row: number; columns: HeaderColumn[] } | null {
  let best: { row: number; columns: HeaderColumn[]; score: number } | null = null;
  const maxRow = Math.min(15, worksheet.rowCount);
  for (let row = 1; row <= maxRow; row += 1) {
    const columns: HeaderColumn[] = [];
    let score = 0;
    for (let col = 1; col <= 40; col += 1) {
      const direct = worksheet.getCell(row, col).value;
      const value = direct === '' || direct === null || direct === undefined ? merged.get(`${row}:${col}`) : direct;
      const label = asText(value);
      if (!label) continue;
      const norm = normalize(label);
      if (!norm || norm.length > 40) continue;
      columns.push({ col, label: label.slice(0, 50), norm });
      if (KNOWN_HEADERS.has(norm) || norm.startsWith('phi') || norm.startsWith('phu')) score += 1;
    }
    if (score >= 2 && (!best || score > best.score)) best = { row, columns, score };
  }
  return best && best.score >= 3 ? { row: best.row, columns: best.columns } : null;
}

function pickColumn(columns: HeaderColumn[], ...names: string[]): number | undefined {
  for (const name of names) {
    const found = columns.find((column) => column.norm === name);
    if (found) return found.col;
  }
  return undefined;
}

function sourceKeyFor(row: {
  kind: TxKind;
  date: string;
  amount: number;
  reference: string;
  containerNo: string;
  containerSize: string;
  party: string;
  goodsName: string;
}): string {
  return createHash('sha1')
    .update(
      [
        row.kind,
        row.date,
        row.amount,
        normalize(row.reference),
        normalize(row.containerNo),
        normalize(row.containerSize),
        normalize(row.party),
        normalize(row.goodsName),
      ].join('|'),
    )
    .digest('hex')
    .slice(0, 40);
}

function categoryFor(kind: TxKind, goodsType: string, override = ''): string {
  if (override) return override.slice(0, 60);
  if (goodsType) return `${kind === 'income' ? 'Doanh thu' : 'Chi phí'} ${goodsType}`.slice(0, 60);
  return kind === 'income' ? 'Doanh thu bán hàng' : 'Chi phí làm hàng';
}

function parseSheet(worksheet: ExcelJS.Worksheet): ParsedSheet | null {
  const merged = buildMergedValues(worksheet);
  const header = detectHeader(worksheet, merged);
  if (!header) return null;
  const columns = header.columns;
  const has = (name: string) => columns.some((column) => column.norm === name);
  const sheetName = normalize(worksheet.name);

  let kind: TxKind | null = null;
  let amountCol: number | undefined;
  if (has('thanhtien') && (has('ngaygh') || has('tencty') || has('tenhang'))) {
    kind = 'income';
  } else if (has('tongchi')) {
    kind = 'expense';
  } else if (has('thanhtien')) {
    kind = 'income';
  } else if (sheetName.startsWith('thu') || sheetName.startsWith('kh') || sheetName.includes('thanhtoan')) {
    kind = 'income';
  } else if (sheetName.startsWith('chi') || sheetName.includes('tienlam') || sheetName.includes('lamhang')) {
    kind = 'expense';
  }
  if (!kind) return null;

  if (kind === 'income') {
    amountCol = pickColumn(columns, 'thanhtien', 'tongthu', 'sotienvnd', 'sotien');
  } else {
    amountCol = pickColumn(columns, 'tongchi', 'sotienvnd', 'sotien', 'thanhtien');
  }
  if (!amountCol) return null;

  const info = {
    date: pickColumn(columns, 'ngaygh', 'ngay', 'ngaygiao', 'ngaygiaodich', 'ngaychungtu'),
    reference: pickColumn(columns, 'sotk', 'sotokhai', 'sochungtu'),
    port: pickColumn(columns, 'cua', 'cuakhau', 'diadiem'),
    goodsName: pickColumn(columns, 'tenhang', 'tenhanghoa', 'mathang'),
    goodsType: pickColumn(columns, 'loaihang', 'loaihanghoa', 'nhomhang'),
    containerNo: pickColumn(columns, 'socont', 'socontainer', 'container'),
    containerSize: pickColumn(columns, 'kichthuoccont', 'loaicont'),
    count20: pickColumn(columns, '20'),
    count40: pickColumn(columns, '40'),
    carrier: pickColumn(columns, 'donvivanchuyen', 'donvi', 'nhacungcap'),
    customer: pickColumn(columns, 'tencty', 'tencongty', 'khachhang', 'tenkhachhang', 'doitac'),
    category: pickColumn(columns, 'danhmuc'),
    note: pickColumn(columns, 'ghichu', 'diengiai', 'noidung'),
  };
  const partyCol = kind === 'expense' ? info.carrier ?? info.customer : info.customer ?? info.carrier;

  const valueAt = (row: number, col?: number): unknown => {
    if (!col) return '';
    const direct = worksheet.getCell(row, col).value;
    if (direct === '' || direct === null || direct === undefined) return merged.get(`${row}:${col}`) ?? '';
    return direct;
  };

  const rows: ParsedRow[] = [];
  const warnings: ImportWarning[] = [];
  let skipped = 0;
  const maxRow = Math.min(worksheet.rowCount, MAX_SHEET_ROWS);

  for (let rowNumber = header.row + 1; rowNumber <= maxRow; rowNumber += 1) {
    const amount = Math.round(asNumber(valueAt(rowNumber, amountCol)));
    if (!amount) continue;
    const party = asText(valueAt(rowNumber, partyCol));
    const reference = asText(valueAt(rowNumber, info.reference));
    const goodsName = asText(valueAt(rowNumber, info.goodsName));
    const goodsType = asText(valueAt(rowNumber, info.goodsType));
    const containerNo = asText(valueAt(rowNumber, info.containerNo));
    const explicitSize = asText(valueAt(rowNumber, info.containerSize));
    const count20 = info.count20 ? Math.round(asNumber(valueAt(rowNumber, info.count20))) : 0;
    const count40 = info.count40 ? Math.round(asNumber(valueAt(rowNumber, info.count40))) : 0;
    const sizeParts = [
      count20 > 0 ? `20' ×${count20}` : '',
      count40 > 0 ? `40' ×${count40}` : '',
    ].filter(Boolean);
    const containerSize = explicitSize || sizeParts.join(' · ');
    const port = asText(valueAt(rowNumber, info.port));

    const totalMarker = [goodsType, goodsName, party, asText(valueAt(rowNumber, info.category))]
      .map(normalize)
      .some((value) => value.includes('tongcong') || value === 'tong');
    if (totalMarker) continue;
    if (!reference && !party && !goodsName && !containerNo) {
      skipped += 1;
      if (warnings.length < 12) {
        warnings.push({ sheet: worksheet.name, row: rowNumber, message: 'Bỏ qua dòng không có thông tin nhận diện.' });
      }
      continue;
    }

    const date = parseDate(valueAt(rowNumber, info.date));
    const explicitCategory = asText(valueAt(rowNumber, info.category));
    const note = asText(valueAt(rowNumber, info.note));    const details: Record<string, number> = {};
    for (const column of columns) {
      if (DETAIL_EXCLUSIONS.has(column.norm) || column.norm.startsWith('tong')) continue;
      if (column.col === amountCol) continue;
      const raw = valueAt(rowNumber, column.col);
      if (typeof unwrap(raw) !== 'number' && typeof raw !== 'string') continue;
      const value = Math.round(asNumber(raw));
      if (!value) continue;
      if (Object.keys(details).length >= 30) break;
      details[column.label] = value;
    }

    const parsed: ParsedRow = {
      kind,
      date,
      amount,
      party,
      category: categoryFor(kind, goodsType, explicitCategory),
      reference,
      port,
      goodsName,
      goodsType,
      containerNo,
      containerSize,
      carrier: kind === 'expense' ? party : asText(valueAt(rowNumber, info.carrier)),
      note,
      details,
      sheetName: worksheet.name,
      rowNumber,
      sourceKey: '',
      categoryOverride: explicitCategory,
    };
    rows.push(parsed);
  }

  return { name: worksheet.name, kind, rows, skipped, warnings };
}

function linkSheets(sheets: ParsedSheet[]): void {
  const incomeRows = sheets.filter((sheet) => sheet.kind === 'income').flatMap((sheet) => sheet.rows);
  const expenseRows = sheets.filter((sheet) => sheet.kind === 'expense').flatMap((sheet) => sheet.rows);
  const incomeByRow = new Map<number, ParsedRow>();
  const incomeByRef = new Map<string, ParsedRow>();
  const expenseByRow = new Map<number, ParsedRow>();
  const expenseByRef = new Map<string, ParsedRow>();
  for (const row of incomeRows) {
    incomeByRow.set(row.rowNumber, row);
    if (row.reference && !incomeByRef.has(row.reference)) incomeByRef.set(row.reference, row);
  }
  for (const row of expenseRows) {
    expenseByRow.set(row.rowNumber, row);
    if (row.reference && !expenseByRef.has(row.reference)) expenseByRef.set(row.reference, row);
  }

  for (const row of expenseRows) {
    const linked = incomeByRow.get(row.rowNumber) ?? (row.reference ? incomeByRef.get(row.reference) : undefined);
    if (!linked) continue;
    if (!row.date) row.date = linked.date;
    if (!row.port) row.port = linked.port;
    if (!row.goodsName) row.goodsName = linked.goodsName;
    if (!row.goodsType) row.goodsType = linked.goodsType;
    if (!row.categoryOverride) row.category = categoryFor(row.kind, row.goodsType);
  }
  for (const row of incomeRows) {
    const linked = expenseByRow.get(row.rowNumber) ?? (row.reference ? expenseByRef.get(row.reference) : undefined);
    if (linked && !row.containerNo) row.containerNo = linked.containerNo;
    if (linked && !row.containerSize) row.containerSize = linked.containerSize;
  }
  for (const row of [...incomeRows, ...expenseRows]) {
    row.sourceKey = sourceKeyFor(row);
  }
}

export async function previewImport(filePath: string, store: Store): Promise<ImportPreview> {
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_FILE_BYTES) throw new Error('Tệp lớn hơn 50 MB, vui lòng tách bớt dữ liệu.');
  if (!/\.xlsx$/i.test(filePath)) throw new Error('Chỉ hỗ trợ tệp .xlsx.');

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheets: ParsedSheet[] = [];
  for (const worksheet of workbook.worksheets) {
    if (worksheet.state !== 'visible') continue;
    const parsed = parseSheet(worksheet);
    if (parsed) sheets.push(parsed);
  }
  if (sheets.length === 0) throw new Error('Không tìm thấy sheet thu chi phù hợp trong tệp.');
  linkSheets(sheets);

  const allRows = sheets.flatMap((sheet) => sheet.rows);
  if (allRows.length === 0) throw new Error('Không tìm thấy giao dịch hợp lệ trong tệp.');

  const seen = new Set<string>();
  let duplicates = 0;
  let missingDates = 0;
  const lastDateBySheet = new Map<string, string>();
  for (const row of allRows) {
    if (!row.date) missingDates += 1;
    let resolvedDate = row.date;
    if (!resolvedDate) resolvedDate = lastDateBySheet.get(row.sheetName) ?? '';
    if (resolvedDate) lastDateBySheet.set(row.sheetName, resolvedDate);
    const key = sourceKeyFor({ ...row, date: resolvedDate });
    if (key && (seen.has(key) || store.hasSourceKey(key))) duplicates += 1;
    if (key) seen.add(key);
  }

  const warnings: ImportWarning[] = [];
  for (const sheet of sheets) {
    warnings.push(...sheet.warnings);
  }
  for (const row of allRows) {
    if (!row.date && warnings.length < 20) {
      warnings.push({ sheet: row.sheetName, row: row.rowNumber, message: 'Thiếu ngày giao dịch.' });
    }
  }

  const summary: ImportSheetSummary[] = sheets.map((sheet) => {
    const dates = sheet.rows.map((row) => row.date).filter(Boolean).sort();
    return {
      name: sheet.name,
      kind: sheet.kind,
      rows: sheet.rows.length,
      skipped: sheet.skipped,
      total: sheet.rows.reduce((sum, row) => sum + row.amount, 0),
      from: dates[0] ?? '',
      to: dates[dates.length - 1] ?? '',
    };
  });

  const income = allRows.filter((row) => row.kind === 'income').reduce((sum, row) => sum + row.amount, 0);
  const expense = allRows.filter((row) => row.kind === 'expense').reduce((sum, row) => sum + row.amount, 0);
  const previewRows: ImportPreviewRow[] = allRows.map((row) => ({
    kind: row.kind,
    date: row.date,
    amount: row.amount,
    party: row.party,
    category: row.category,
    reference: row.reference,
    port: row.port,
    goodsName: row.goodsName,
    goodsType: row.goodsType,
    containerNo: row.containerNo,
    containerSize: row.containerSize,
    carrier: row.carrier,
    note: row.note,
    details: row.details,
  }));
  const sample: ImportPreviewRow[] = [
    ...previewRows.filter((row) => row.kind === 'income').slice(0, 4),
    ...previewRows.filter((row) => row.kind === 'expense').slice(0, 4),
  ];

  cleanupPending();
  const token = randomUUID();
  pending.set(token, {
    token,
    fileName: path.basename(filePath),
    rows: allRows,
    expires: Date.now() + TOKEN_TTL_MS,
  });

  return {
    token,
    fileName: path.basename(filePath),
    sheets: summary,
    samples: sample,
    income,
    expense,
    rows: allRows.length,
    duplicates,
    missingDates,
    warnings: warnings.slice(0, 20),
    categories: [...new Set(allRows.map((row) => row.category))],
  };
}

export function commitImport(token: string, options: ImportCommitOptions, store: Store): ImportResult {
  cleanupPending();
  const batch = pending.get(token);
  if (!batch) {
    throw new Error('Phiên nhập dữ liệu đã hết hạn. Vui lòng chọn lại tệp.');
  }

  const lastDateBySheet = new Map<string, string>();
  let skipped = 0;
  const rows: ImportTransactionRow[] = [];
  for (const row of batch.rows) {
    let date = row.date;
    if (!date && options.missingDate === 'previous') {
      date = lastDateBySheet.get(row.sheetName) ?? '';
    }
    if (!date) {
      skipped += 1;
      continue;
    }
    lastDateBySheet.set(row.sheetName, date);
    rows.push({
      kind: row.kind,
      amount: row.amount,
      occurredOn: date,
      categoryName: row.category,
      party: row.party,
      note: row.note,
      method: options.method,
      reference: row.reference,
      port: row.port,
      goodsName: row.goodsName,
      goodsType: row.goodsType,
      containerNo: row.containerNo,
      containerSize: row.containerSize,
      carrier: row.carrier,
      details: row.details,
      sourceKey: sourceKeyFor({ ...row, date }),
    });
  }

  const result = store.importRows(rows);
  pending.delete(token);
  return { ...result, skipped: result.skipped + skipped };
}
