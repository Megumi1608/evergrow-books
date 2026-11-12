import {
  CURRENCIES,
  LOOKUP_KINDS,
  METHODS,
  type AiChatContext,
  type AiConfigInput,
  type BudgetInput,
  type CategoryInput,
  type CompanySettings,
  type Currency,
  type ImportCommitOptions,
  type LookupKind,
  type Method,
  type MissingDatePolicy,
  type PaymentRequestInput,
  type TxFilter,
  type TxInput,
  type TxKind,
  type TransactionDraftInput,
} from '../shared/types';
import {
  THEME_COLOR_KEYS,
  THEME_PRESETS,
  type ThemeColors,
  type ThemeSettings,
} from '../shared/theme';
import { parseContainerCounts, splitContainerNos } from '../shared/containers';

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

export function validateReference(value: unknown): string {
  if (typeof value !== 'string') fail('Số tờ khai không hợp lệ.');
  const reference = value.trim();
  if (!reference || reference.length > 80) fail('Số tờ khai không hợp lệ.');
  return reference;
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

function currency(value: unknown): Currency {
  if (typeof value !== 'string' || !CURRENCIES.includes(value as Currency)) fail('Tiền tệ không hợp lệ.');
  return value as Currency;
}

function color(value: unknown): string {
  if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) fail('Màu không hợp lệ.');
  return value.toUpperCase();
}

function details(value: unknown): Record<string, number> {
  if (value === undefined || value === null) return {};
  const input = asRecord(value, 'Chi tiết phí');
  const entries = Object.entries(input);
  if (entries.length > 30) fail('Chi tiết phí có quá nhiều mục.');
  const result: Record<string, number> = {};
  for (const [rawLabel, rawValue] of entries) {
    const label = rawLabel.trim();
    if (!label || label.length > 50) fail('Tên mục trong chi tiết phí không hợp lệ.');
    if (typeof rawValue !== 'number' || !Number.isFinite(rawValue)) fail('Giá trị chi tiết phí không hợp lệ.');
    result[label] = Math.round(rawValue);
  }
  return result;
}

export function validateTxInput(value: unknown): TxInput {
  const input = asRecord(value, 'Dữ liệu giao dịch');
  const kindValue = kind(input.kind);
  const currencyValue = input.currency === undefined ? 'VND' : currency(input.currency);
  let amount = 0;
  let originalAmount = 0;
  let exchangeRate = 1;

  if (currencyValue === 'VND') {
    amount = input.amount as number;
    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
      fail('Số tiền phải là số nguyên dương.');
    }
    if (amount > MAX_AMOUNT) fail('Số tiền vượt quá giới hạn cho phép.');
    originalAmount = amount;
  } else {
    originalAmount = input.originalAmount as number;
    exchangeRate = input.exchangeRate as number;
    if (typeof originalAmount !== 'number' || !Number.isFinite(originalAmount) || originalAmount <= 0) {
      fail('Số tiền ngoại tệ phải lớn hơn 0.');
    }
    if (typeof exchangeRate !== 'number' || !Number.isFinite(exchangeRate) || exchangeRate <= 0) {
      fail('Tỷ giá phải lớn hơn 0.');
    }
    amount = Math.round(originalAmount * exchangeRate);
    if (amount <= 0 || amount > MAX_AMOUNT) fail('Số tiền quy đổi vượt quá giới hạn cho phép.');
  }

  const dueDate = input.dueDate ? validateDate(input.dueDate, 'Hạn thanh toán') : '';
  let paidAmount: number = amount;
  if (input.paidAmount !== undefined) {
    if (typeof input.paidAmount !== 'number' || !Number.isInteger(input.paidAmount) || input.paidAmount < 0) {
      fail('Số tiền đã thanh toán không hợp lệ.');
    }
    paidAmount = input.paidAmount;
  }
  if (paidAmount > amount) fail('Đã thanh toán không được vượt quá số tiền giao dịch.');
  if (!dueDate) paidAmount = amount;

  let serviceRevenue = 0;
  if (input.serviceRevenue !== undefined) {
    if (
      typeof input.serviceRevenue !== 'number' ||
      !Number.isInteger(input.serviceRevenue) ||
      input.serviceRevenue < 0
    ) {
      fail('Doanh thu dịch vụ container không hợp lệ.');
    }
    serviceRevenue = input.serviceRevenue;
  }

  const extraMoney = (raw: unknown, label: string): number => {
    if (raw === undefined) return 0;
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) fail(`${label} không hợp lệ.`);
    return raw;
  };
  const customerFar = extraMoney(input.customerFar, 'Phụ thu hạ xa khách hàng');
  const otherIncome = extraMoney(input.otherIncome, 'Phí khác thu khách');
  const customerLift = extraMoney(input.customerLift, 'Phí nâng khách hàng');
  const customerLower = extraMoney(input.customerLower, 'Phí hạ khách hàng');

  const containerNo = text(input.containerNo, 'Số container', 400);
  const containerSize = text(input.containerSize, 'Kích thước container', 80);
  const counts = parseContainerCounts(containerSize);
  const declaredContainers = counts.count20 + counts.count40;
  if (declaredContainers > 0 && splitContainerNos(containerNo).length > declaredContainers) {
    fail(`Số container đã nhập vượt quá tổng số lượng container (${declaredContainers}).`);
  }

  return {
    kind: kindValue,
    amount,
    occurredOn: validateDate(input.occurredOn, 'Ngày giao dịch'),
    categoryId: validateId(input.categoryId, 'Danh mục'),
    party: text(input.party, 'Đối tác', 160),
    note: text(input.note, 'Ghi chú', 500),
    method: method(input.method),
    reference: text(input.reference, 'Số tờ khai', 80),
    port: text(input.port, 'Cửa khẩu', 80),
    goodsName: text(input.goodsName, 'Tên hàng', 160),
    goodsType: text(input.goodsType, 'Loại hàng', 80),
    containerNo,
    containerSize,
    carrier: text(input.carrier, 'Đơn vị vận chuyển', 120),
    warehouseAddress: text(input.warehouseAddress, 'Địa chỉ kho', 200),
    serviceRevenue,
    customerFar,
    otherIncome,
    customerLift,
    customerLower,
    details: details(input.details),
    dueDate,
    paidAmount,
    currency: currencyValue,
    originalAmount,
    exchangeRate,
  };
}

export function validateDraftInput(value: unknown): TransactionDraftInput {
  const input = asRecord(value, 'Dữ liệu nháp');
  const id = input.id === undefined || input.id === null ? undefined : validateId(input.id, 'Nháp');
  const label = text(input.label, 'Tên nháp', 160);
  if (typeof input.step !== 'number' || !Number.isInteger(input.step) || input.step < 0 || input.step > 9) {
    fail('Bước nháp không hợp lệ.');
  }
  if (!input.payload || typeof input.payload !== 'object' || Array.isArray(input.payload)) {
    fail('Dữ liệu nháp không hợp lệ.');
  }
  let payloadJson = '';
  try {
    payloadJson = JSON.stringify(input.payload) ?? '';
  } catch {
    fail('Dữ liệu nháp không hợp lệ.');
  }
  if (payloadJson.length > 512 * 1024) fail('Dữ liệu nháp quá lớn.');
  return { id, label, step: input.step, payload: input.payload };
}

export function validatePaymentRequest(value: unknown): PaymentRequestInput {  const input = asRecord(value, 'Dữ liệu yêu cầu thanh toán');
  const money = (raw: unknown, label: string): number => {
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0 || raw > MAX_AMOUNT) {
      fail(`${label} không hợp lệ.`);
    }
    return Math.round(raw);
  };
  return {
    customer: text(input.customer, 'Khách hàng', 160),
    reference: text(input.reference, 'Số tờ khai', 80),
    port: text(input.port, 'Cửa khẩu', 80),
    goodsName: text(input.goodsName, 'Tên hàng', 160),
    goodsType: text(input.goodsType, 'Loại hàng', 80),
    containerNo: text(input.containerNo, 'Số container', 80),
    containerSize: text(input.containerSize, 'Kích thước container', 80),
    deliveryDate: input.deliveryDate
      ? validateDate(input.deliveryDate, 'Ngày giao hàng')
      : '',
    note: text(input.note, 'Ghi chú', 500),
    serviceRevenue: money(input.serviceRevenue, 'Phí dịch vụ container'),
    truckFee: money(input.truckFee, 'Tiền xe'),
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

export function validateTheme(value: unknown): ThemeSettings {
  const input = asRecord(value, 'Bộ màu');
  const preset = input.preset;
  if (preset !== 'custom') {
    const found = THEME_PRESETS.find((item) => item.id === preset);
    if (!found) fail('Bộ màu không hợp lệ.');
    return { preset: found.id, colors: { ...found.colors } };
  }
  const rawColors = asRecord(input.colors, 'Màu giao diện');
  const colors = {} as ThemeColors;
  for (const key of THEME_COLOR_KEYS) {
    colors[key] = color(rawColors[key]);
  }
  return { preset: 'custom', colors };
}

export function validateToken(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(value)) fail('Phiên nhập dữ liệu không hợp lệ.');
  return value;
}

export function validateImportOptions(value: unknown): ImportCommitOptions {
  const input = asRecord(value, 'Tuỳ chọn nhập');
  const missingDate = input.missingDate;
  if (missingDate !== 'previous' && missingDate !== 'skip') fail('Cách xử lý ngày thiếu không hợp lệ.');
  return {
    missingDate: missingDate as MissingDatePolicy,
    method: method(input.method),
  };
}

export function validateBudgetInput(value: unknown): BudgetInput {
  const input = asRecord(value, 'Dữ liệu ngân sách');
  const amount = input.amount;
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
    fail('Ngân sách phải là số nguyên dương.');
  }
  if (amount > MAX_AMOUNT) fail('Ngân sách vượt quá giới hạn cho phép.');
  return {
    categoryId: validateId(input.categoryId, 'Danh mục'),
    month: validateMonth(input.month),
    amount,
  };
}

export function validatePaymentAmount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    fail('Số tiền thanh toán phải là số nguyên dương.');
  }
  return value;
}

export function validateLookupKind(value: unknown): LookupKind {
  if (typeof value !== 'string' || !LOOKUP_KINDS.includes(value as LookupKind)) {
    fail('Danh sách tra cứu không hợp lệ.');
  }
  return value as LookupKind;
}

export function validateLookupValue(value: unknown): string {
  const trimmed = text(value, 'Giá trị', 120);
  if (!trimmed) fail('Giá trị không được để trống.');
  return trimmed;
}

export function validateAiSessionId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(value)) {
    fail('Phiên trò chuyện không hợp lệ.');
  }
  return value;
}

export function validateAiConfigInput(value: unknown): AiConfigInput {
  const input = asRecord(value, 'Cấu hình trợ lý');
  if (input.provider !== 'openai' && input.provider !== 'anthropic') {
    fail('Nhà cung cấp AI không hợp lệ.');
  }
  if (typeof input.baseUrl !== 'string' || input.baseUrl.length > 500) fail('Base URL không hợp lệ.');
  if (typeof input.model !== 'string' || input.model.length > 120) fail('Model không hợp lệ.');
  if (typeof input.temperature !== 'number' || !Number.isFinite(input.temperature) || input.temperature < 0 || input.temperature > 1) {
    fail('Temperature phải nằm trong khoảng 0 đến 1.');
  }
  if (typeof input.enabled !== 'boolean') fail('Trạng thái bật/tắt không hợp lệ.');
  if (input.apiKey !== undefined && (typeof input.apiKey !== 'string' || input.apiKey.length > 500)) {
    fail('API key không hợp lệ.');
  }
  if (input.clearKey !== undefined && typeof input.clearKey !== 'boolean') fail('Yêu cầu xoá key không hợp lệ.');
  return {
    provider: input.provider,
    baseUrl: input.baseUrl,
    model: input.model,
    temperature: input.temperature,
    enabled: input.enabled,
    apiKey: typeof input.apiKey === 'string' ? input.apiKey : undefined,
    clearKey: input.clearKey === true,
  };
}

export function validateAiChatInput(value: unknown): {
  sessionId?: string;
  text: string;
  context?: AiChatContext;
} {
  const input = asRecord(value, 'Tin nhắn');
  if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 2000) {
    fail('Tin nhắn phải có nội dung và tối đa 2.000 ký tự.');
  }
  const result: { sessionId?: string; text: string; context?: AiChatContext } = {
    text: input.text.trim(),
  };
  if (input.sessionId !== undefined && input.sessionId !== '') {
    result.sessionId = validateAiSessionId(input.sessionId);
  }
  if (input.context !== undefined && input.context !== null) {
    const context = asRecord(input.context, 'Ngữ cảnh');
    const parsed: AiChatContext = {};
    if (context.route !== undefined) {
      if (typeof context.route !== 'string' || context.route.length > 120) fail('Màn hình hiện tại không hợp lệ.');
      parsed.route = context.route;
    }
    if (context.month !== undefined && context.month !== '') {
      parsed.month = validateMonth(context.month);
    }
    result.context = parsed;
  }
  return result;
}
