import type { ThemeSettings } from './theme';

export type TxKind = 'income' | 'expense';

export const LOOKUP_KINDS = ['customers', 'carriers', 'goods_types'] as const;
export type LookupKind = (typeof LOOKUP_KINDS)[number];

export const METHODS = ['cash', 'bank', 'card', 'ewallet', 'other'] as const;
export type Method = (typeof METHODS)[number];

export const CURRENCIES = ['VND', 'USD', 'EUR', 'CNY'] as const;
export type Currency = (typeof CURRENCIES)[number];

export const CURRENCY_LABELS: Record<Currency, string> = {
  VND: 'VND – Việt Nam đồng',
  USD: 'USD – Đô la Mỹ',
  EUR: 'EUR – Euro',
  CNY: 'CNY – Nhân dân tệ',
};

export const CURRENCY_SUFFIX: Record<Currency, string> = {
  VND: 'đ',
  USD: 'USD',
  EUR: 'EUR',
  CNY: 'CNY',
};

export const METHOD_LABELS: Record<Method, string> = {
  cash: 'Tiền mặt',
  bank: 'Chuyển khoản',
  card: 'Thẻ',
  ewallet: 'Ví điện tử',
  other: 'Khác',
};

export interface Category {
  id: number;
  name: string;
  kind: TxKind;
  color: string;
  usageCount: number;
}

export interface CategoryInput {
  name: string;
  kind: TxKind;
  color: string;
}

export interface Transaction {
  id: number;
  kind: TxKind;
  amount: number;
  occurredOn: string;
  categoryId: number;
  categoryName: string;
  categoryColor: string;
  party: string;
  note: string;
  method: Method;
  reference: string;
  port: string;
  goodsName: string;
  goodsType: string;
  containerNo: string;
  containerSize: string;
  carrier: string;
  warehouseAddress: string;
  serviceRevenue: number;
  details: Record<string, number>;
  dueDate: string;
  paidAmount: number;
  currency: Currency;
  originalAmount: number;
  exchangeRate: number;
  attachmentCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface TxInput {
  kind: TxKind;
  amount: number;
  occurredOn: string;
  categoryId: number;
  party: string;
  note: string;
  method: Method;
  reference: string;
  port: string;
  goodsName: string;
  goodsType: string;
  containerNo: string;
  containerSize: string;
  carrier: string;
  warehouseAddress: string;
  serviceRevenue: number;
  details: Record<string, number>;
  dueDate: string;
  paidAmount: number;
  currency: Currency;
  originalAmount: number;
  exchangeRate: number;
}

export interface TxFilter {
  from?: string;
  to?: string;
  kind?: TxKind | 'all';
  categoryId?: number | null;
  q?: string;
  limit?: number;
  offset?: number;
}

export interface TxPage {
  items: Transaction[];
  total: number;
  income: number;
  expense: number;
}

export interface MonthPoint {
  month: string;
  income: number;
  expense: number;
}

export interface CategoryTotal {
  name: string;
  color: string;
  total: number;
  count: number;
}

export interface DashboardData {
  month: string;
  income: number;
  expense: number;
  net: number;
  count: number;
  prevIncome: number;
  prevExpense: number;
  series: MonthPoint[];
  topExpense: CategoryTotal[];
  recent: Transaction[];
}

export interface ReportData {
  from: string;
  to: string;
  income: number;
  expense: number;
  net: number;
  count: number;
  byCategory: (CategoryTotal & { kind: TxKind })[];
  byMonth: MonthPoint[];
  transactions: Transaction[];
}

export interface CompanySettings {
  companyName: string;
}

export interface AppMeta {
  version: string;
  dbPath: string;
  isPackaged: boolean;
  releasesUrl: string;
}

export interface ExportResult {
  saved: boolean;
  path?: string;
}

export interface PaymentRequestInput {
  customer: string;
  reference: string;
  port: string;
  goodsName: string;
  goodsType: string;
  containerNo: string;
  containerSize: string;
  deliveryDate: string;
  note: string;
  serviceRevenue: number;
  truckFee: number;
}

export interface SeedResult {
  inserted: number;
}

export interface DataStats {
  transactions: number;
  categories: number;
}

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'up-to-date'
  | 'error'
  | 'unsupported';

export interface UpdateState {
  status: UpdateStatus;
  version?: string;
  percent?: number;
  message?: string;
  checkedAt?: string;
}

export type MissingDatePolicy = 'previous' | 'skip';

export interface ImportPreviewRow {
  kind: TxKind;
  date: string;
  amount: number;
  party: string;
  category: string;
  reference: string;
  port: string;
  goodsName: string;
  goodsType: string;
  containerNo: string;
  containerSize: string;
  carrier: string;
  note: string;
  details: Record<string, number>;
}

export interface ImportSheetSummary {
  name: string;
  kind: TxKind;
  rows: number;
  skipped: number;
  total: number;
  from: string;
  to: string;
}

export interface ImportWarning {
  sheet: string;
  row: number;
  message: string;
}

export interface ImportPreview {
  token: string;
  fileName: string;
  sheets: ImportSheetSummary[];
  samples: ImportPreviewRow[];
  income: number;
  expense: number;
  rows: number;
  duplicates: number;
  missingDates: number;
  warnings: ImportWarning[];
  categories: string[];
}

export interface ImportPreviewResult {
  canceled: boolean;
  preview?: ImportPreview;
}

export interface ImportCommitOptions {
  missingDate: MissingDatePolicy;
  method: Method;
}

export interface ImportResult {
  income: number;
  expense: number;
  inserted: number;
  duplicates: number;
  skipped: number;
  categoriesCreated: number;
  batchId?: string;
}

export interface ImportBatch {
  id: string;
  fileName: string;
  createdAt: string;
  inserted: number;
  income: number;
  expense: number;
}

export interface ImportUndoResult {
  removed: number;
  categoriesRemoved: number;
}

export interface AttachmentMeta {
  id: number;
  transactionId: number;
  fileName: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

export interface StagedAttachment {
  token: string;
  fileName: string;
  size: number;
}

export interface ShipmentSummary {
  reference: string;
  firstDate: string;
  lastDate: string;
  customer: string;
  goodsType: string;
  goodsNames: string[];
  containers: string[];
  count: number;
  income: number;
  expense: number;
  profit: number;
  margin: number;
}

export interface ShipmentDetail {
  summary: ShipmentSummary;
  transactions: Transaction[];
}

export interface ShipmentFilter {
  from?: string;
  to?: string;
  q?: string;
}

export type DebtStatus = 'unpaid' | 'partial' | 'overdue' | 'paid';

export interface DebtItem {
  transaction: Transaction;
  outstanding: number;
  status: DebtStatus;
  daysOverdue: number;
}

export interface DebtData {
  items: DebtItem[];
  receivable: number;
  payable: number;
  overdueReceivable: number;
  overduePayable: number;
  tracked: number;
  overdueCount: number;
  aging: { label: string; receivable: number; payable: number }[];
}

export interface BudgetRow {
  categoryId: number;
  categoryName: string;
  budget: number;
  spent: number;
  usage: number;
}

export interface BudgetData {
  month: string;
  totalBudget: number;
  totalSpent: number;
  rows: BudgetRow[];
}

export interface BudgetInput {
  categoryId: number;
  month: string;
  amount: number;
}

export interface BackupInfo {
  directory: string;
  lastBackup: string | null;
  count: number;
}

export interface TransactionDraft {
  id: number;
  label: string;
  step: number;
  payload: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface TransactionDraftInput {
  id?: number;
  label: string;
  step: number;
  payload: unknown;
}

export type AiProvider = 'openai' | 'anthropic';

export interface AiConfig {
  provider: AiProvider;
  baseUrl: string;
  model: string;
  temperature: number;
  enabled: boolean;
  hasKey: boolean;
  keyHint: string;
}

export interface AiConfigInput {
  provider: AiProvider;
  baseUrl: string;
  model: string;
  temperature: number;
  enabled: boolean;
  apiKey?: string;
  clearKey?: boolean;
}

export interface AiTestResult {
  ok: boolean;
  message: string;
}

export interface AiSession {
  id: string;
  title: string;
  provider: string;
  model: string;
  createdAt: string;
  updatedAt: string;
}

export interface AiSessionSummary extends AiSession {
  messageCount: number;
  changeCount: number;
}

export type AiOperation =
  | 'create_transaction'
  | 'update_transaction'
  | 'delete_transaction'
  | 'pay_debt';

export type AiChangeStatus = 'pending' | 'approved' | 'rejected' | 'reverted';

export interface AiFieldDiff {
  label: string;
  before: string;
  after: string;
}

export interface AiChange {
  id: number;
  sessionId: string;
  messageId: number | null;
  operation: AiOperation;
  targetId: number | null;
  summary: string;
  diff: AiFieldDiff[];
  status: AiChangeStatus;
  attachmentCount: number;
  createdAt: string;
  appliedAt: string | null;
  revertedAt: string | null;
}

export interface AiMessage {
  id: number;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  changes: AiChange[];
}

export interface AiChatContext {
  route?: string;
  month?: string;
}

export type AiEvent =
  | { requestId: string; sessionId: string; type: 'delta'; text: string }
  | { requestId: string; sessionId: string; type: 'proposal'; change: AiChange }
  | { requestId: string; sessionId: string; type: 'tool'; name: string; state: 'running' | 'done' }
  | { requestId: string; sessionId: string; type: 'done'; messageId: number }
  | { requestId: string; sessionId: string; type: 'error'; message: string };

export interface AiRevertResult {
  reverted: number;
  conflictId?: number;
  message: string;
}

export interface EvergrowApi {
  getMeta(): Promise<AppMeta>;
  setWindowChrome(input: { background: string; symbol: string }): Promise<void>;
  dashboard(month: string): Promise<DashboardData>;
  transactions: {
    list(filter: TxFilter): Promise<TxPage>;
    create(input: TxInput): Promise<Transaction>;
    update(id: number, input: TxInput): Promise<Transaction>;
    remove(id: number): Promise<void>;
  };
  categories: {
    list(): Promise<Category[]>;
    create(input: CategoryInput): Promise<Category>;
    update(id: number, input: CategoryInput): Promise<Category>;
    remove(id: number): Promise<void>;
  };
  lookups: {
    list(kind: LookupKind): Promise<string[]>;
    add(kind: LookupKind, value: string): Promise<string[]>;
  };
  settings: {
    get(): Promise<CompanySettings>;
    save(input: CompanySettings): Promise<CompanySettings>;
  };
  theme: {
    get(): Promise<ThemeSettings>;
    save(input: ThemeSettings): Promise<ThemeSettings>;
  };
  report(range: { from: string; to: string }): Promise<ReportData>;
  exportFile(format: 'csv' | 'xlsx' | 'pdf', filter: TxFilter): Promise<ExportResult>;
  paymentRequest: {
    export(input: PaymentRequestInput): Promise<ExportResult>;
  };
  importFile: {
    preview(): Promise<ImportPreviewResult>;
    commit(token: string, options: ImportCommitOptions): Promise<ImportResult>;
    history(): Promise<ImportBatch[]>;
    undo(batchId: string): Promise<ImportUndoResult>;
  };
  shipments: {
    list(filter: ShipmentFilter): Promise<ShipmentSummary[]>;
    get(reference: string): Promise<ShipmentDetail>;
  };
  debts: {
    list(): Promise<DebtData>;
    pay(id: number, amount: number): Promise<DebtItem>;
  };
  attachments: {
    list(transactionId: number): Promise<AttachmentMeta[]>;
    add(transactionId: number): Promise<AttachmentMeta | null>;
    stage(): Promise<StagedAttachment | null>;
    commit(transactionId: number, tokens: string[]): Promise<void>;
    open(id: number): Promise<void>;
    remove(id: number): Promise<void>;
  };
  drafts: {
    list(): Promise<TransactionDraft[]>;
    save(input: TransactionDraftInput): Promise<TransactionDraft>;
    remove(id: number): Promise<void>;
  };
  budgets: {
    get(month: string): Promise<BudgetData>;
    save(input: BudgetInput): Promise<BudgetData>;
    remove(categoryId: number, month: string): Promise<BudgetData>;
    copyPrevious(month: string): Promise<BudgetData>;
  };
  data: {
    backup(): Promise<ExportResult>;
    backupInfo(): Promise<BackupInfo>;
    backupNow(): Promise<BackupInfo>;
    openBackupFolder(): Promise<void>;
    restore(): Promise<{ restored: boolean }>;
    openFolder(): Promise<void>;
    seedDemo(): Promise<SeedResult>;
    resetAll(confirm: string): Promise<void>;
    stats(): Promise<DataStats>;
  };
  updater: {
    getState(): Promise<UpdateState>;
    check(): Promise<UpdateState>;
    install(): Promise<UpdateState>;
    openReleases(): Promise<void>;
    onState(cb: (state: UpdateState) => void): () => void;
  };
  ai: {
    config(): Promise<AiConfig>;
    saveConfig(input: AiConfigInput): Promise<AiConfig>;
    clearKey(): Promise<AiConfig>;
    test(): Promise<AiTestResult>;
    sessions(): Promise<AiSessionSummary[]>;
    messages(sessionId: string): Promise<AiMessage[]>;
    chat(input: {
      sessionId?: string;
      text: string;
      context?: AiChatContext;
    }): Promise<{ requestId: string; sessionId: string }>;
    abort(requestId: string): Promise<void>;
    approve(changeId: number): Promise<AiChange>;
    reject(changeId: number): Promise<AiChange>;
    changes(sessionId: string): Promise<AiChange[]>;
    revertChange(changeId: number): Promise<AiChange>;
    revertSession(sessionId: string): Promise<AiRevertResult>;
    onEvent(cb: (event: AiEvent) => void): () => void;
  };
  printReady(): void;
}
