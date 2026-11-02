import {
  METHODS,
  type CategoryInput,
  type CompanySettings,
  type Method,
  type TxFilter,
  type TxInput,
  type TxKind,
} from '../shared/types';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;
const MAX_AMOUNT = 999_999_999_999;

function fail(message: string): never {
  throw new Error(message);
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} không hợp lệ.`);
  return value as Record<string, unknown>;
}

export function isValidDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validateDate(value: unknown, label = 'Ngày'): string {
  if (typeof value !== 'string' || !isValidDate(value)) fail(`${label} không hợp lệ.`);
  const year = Number(value.slice(0, 4));
  if (year < 2000 || year > 2100) fail(`${label} nằm ngoài khoảng cho phép.`);
  return value;
}

export function validateMonth(value: unknown): string {
  if (typeof value !== 'string' || !MONTH_RE.test(value)) fail('Tháng không hợp lệ.');
  const normalized = `${value}-01`;
  if (!isValidDate(normalized)) fail('Tháng không hợp lệ.');
  return value;
}

export function validateId(value: unknown, label = 'Mã'): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) fail(`${label} không hợp lệ.`);
  return value;
}

function text(value: unknown, label: string, max: number): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') fail(`${label} không hợp lệ.`);
  const trimmed = value.trim();
  if (trimmed.length > max) fail(`${label} tối đa ${max} ký tự.`);
  return trimmed;
}

function kind(value: unknown): TxKind {
  if (value !== 'income' && value !== 'expense') fail('Loại giao dịch không hợp lệ.');
  return value;
}

function method(value: unknown): Method {
  if (typeof value !== 'string' || !METHODS.includes(value as Method)) fail('Hình thức thanh toán không hợp lệ.');
  return value as Method;
}

function color(value: unknown): string {
  if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) fail('Màu danh mục không hợp lệ.');
  return value.toUpperCase();
}

export function validateTxInput(value: unknown): TxInput {
  const input = asRecord(value, 'Dữ liệu giao dịch');
  const amount = input.amount;
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
    fail('Số tiền phải là số nguyên dương.');
  }
  if (amount > MAX_AMOUNT) fail('Số tiền vượt quá giới hạn cho phép.');
  const party = text(input.party, 'Đối tác', 160);
  const note = text(input.note, 'Ghi chú', 500);
  return {
    kind: kind(input.kind),
    amount,
    occurredOn: validateDate(input.occurredOn, 'Ngày giao dịch'),
    categoryId: validateId(input.categoryId, 'Danh mục'),
    party,
    note,
    method: method(input.method),
  };
}

export function validateCategoryInput(value: unknown): CategoryInput {
  const input = asRecord(value, 'Dữ liệu danh mục');
  const name = text(input.name, 'Tên danh mục', 60);
  if (!name) fail('Tên danh mục không được để trống.');
  return { name, kind: kind(input.kind), color: color(input.color) };
}

export function validateCompanySettings(value: unknown): CompanySettings {
  const input = asRecord(value, 'Dữ liệu cài đặt');
  const companyName = text(input.companyName, 'Tên công ty', 120);
  if (!companyName) fail('Tên công ty không được để trống.');
  return { companyName };
}

export function validateFilter(value: unknown): TxFilter {
  if (value === undefined || value === null) return {};
  const input = asRecord(value, 'Bộ lọc');
  const filter: TxFilter = {};
  if (input.from !== undefined && input.from !== '') filter.from = validateDate(input.from, 'Từ ngày');
  if (input.to !== undefined && input.to !== '') filter.to = validateDate(input.to, 'Đến ngày');
  if (filter.from && filter.to && filter.from > filter.to) fail('Khoảng ngày không hợp lệ.');
  if (input.kind !== undefined && input.kind !== 'all') filter.kind = kind(input.kind);
  if (input.categoryId !== undefined && input.categoryId !== null) {
    filter.categoryId = validateId(input.categoryId, 'Danh mục');
  }
  if (input.q !== undefined) filter.q = text(input.q, 'Từ khoá', 120);
  if (input.limit !== undefined) {
    if (typeof input.limit !== 'number' || !Number.isInteger(input.limit) || input.limit < 1) fail('Giới hạn không hợp lệ.');
    filter.limit = Math.min(input.limit, 500);
  }
  if (input.offset !== undefined) {
    if (typeof input.offset !== 'number' || !Number.isInteger(input.offset) || input.offset < 0) fail('Vị trí không hợp lệ.');
    filter.offset = input.offset;
  }
  return filter;
}

export function validateRange(value: unknown): { from: string; to: string } {
  const input = asRecord(value, 'Khoảng thời gian');
  const from = validateDate(input.from, 'Từ ngày');
  const to = validateDate(input.to, 'Đến ngày');
  if (from > to) fail('Khoảng ngày không hợp lệ.');
  return { from, to };
}

export function validateConfirm(value: unknown): string {
  if (value !== 'XOA') fail('Cần nhập đúng "XOA" để xác nhận.');
  return value;
}
