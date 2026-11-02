export type TxKind = 'income' | 'expense';

export const METHODS = ['cash', 'bank', 'card', 'ewallet', 'other'] as const;
export type Method = (typeof METHODS)[number];

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

export interface EvergrowApi {
  getMeta(): Promise<AppMeta>;
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
  settings: {
    get(): Promise<CompanySettings>;
    save(input: CompanySettings): Promise<CompanySettings>;
  };
  report(range: { from: string; to: string }): Promise<ReportData>;
  exportFile(format: 'csv' | 'xlsx' | 'pdf', filter: TxFilter): Promise<ExportResult>;
  data: {
    backup(): Promise<ExportResult>;
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
  printReady(): void;
}
