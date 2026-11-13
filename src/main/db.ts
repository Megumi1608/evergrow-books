import { DatabaseSync, backup as sqliteBackup } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { monthBounds, pad, shiftMonth, todayIso } from '../shared/dates';
import { DEFAULT_THEME, getThemePreset, type ThemeSettings } from '../shared/theme';
import type {
  AiChange,
  AiChangeStatus,
  AiFieldDiff,
  AiMessage,
  AiOperation,
  AiRevertResult,
  AiSession,
  AiSessionSummary,
  AttachmentMeta,
  BudgetData,
  BudgetInput,
  BudgetRow,
  Category,
  CategoryInput,
  CategoryTotal,
  CompanySettings,
  CustomerFee,
  DashboardData,
  DataStats,
  DebtData,
  DebtItem,
  DebtStatus,
  ImportBatch,
  ImportResult,
  ImportUndoResult,
  LookupKind,
  Method,
  MonthPoint,
  ReportData,
  SeedResult,
  ShipmentDetail,
  ShipmentFilter,
  ShipmentSummary,
  Transaction,
  TransactionDraft,
  TransactionDraftInput,
  TxFilter,
  TxInput,
  TxKind,
  TxPage,
} from '../shared/types';
import { validatePaymentAmount, validateTxInput } from './validation';

const DEFAULT_COMPANY = 'Công ty của bạn';
const SEED_COLORS_INCOME = ['#2F6B4F', '#3D7C8A', '#7A6A3A', '#5E6A52'];
const SEED_COLORS_EXPENSE = [
  '#A44A2A',
  '#B0763A',
  '#8C5A6B',
  '#6B7280',
  '#4E6E81',
  '#7A5E3E',
  '#96614E',
  '#55624C',
  '#6F6A5C',
];

const SEED_CATEGORIES: { name: string; kind: TxKind; color: string }[] = [
  { name: 'Doanh thu bán hàng', kind: 'income', color: SEED_COLORS_INCOME[0] },
  { name: 'Dịch vụ', kind: 'income', color: SEED_COLORS_INCOME[1] },
  { name: 'Đầu tư', kind: 'income', color: SEED_COLORS_INCOME[2] },
  { name: 'Thu khác', kind: 'income', color: SEED_COLORS_INCOME[3] },
  { name: 'Lương & nhân sự', kind: 'expense', color: SEED_COLORS_EXPENSE[0] },
  { name: 'Thuê mặt bằng', kind: 'expense', color: SEED_COLORS_EXPENSE[1] },
  { name: 'Mua hàng', kind: 'expense', color: SEED_COLORS_EXPENSE[2] },
  { name: 'Marketing', kind: 'expense', color: SEED_COLORS_EXPENSE[3] },
  { name: 'Điện nước', kind: 'expense', color: SEED_COLORS_EXPENSE[4] },
  { name: 'Vận chuyển', kind: 'expense', color: SEED_COLORS_EXPENSE[5] },
  { name: 'Văn phòng phẩm', kind: 'expense', color: SEED_COLORS_EXPENSE[6] },
  { name: 'Thuế & phí', kind: 'expense', color: SEED_COLORS_EXPENSE[7] },
  { name: 'Chi khác', kind: 'expense', color: SEED_COLORS_EXPENSE[8] },
];

interface RawTxRow {
  id: number;
  kind: TxKind;
  amount: number;
  occurredOn: string;
  categoryId: number;
  categoryName: string;
  categoryColor: string;
  party: string;
  note: string;
  method: Transaction['method'];
  reference: string;
  port: string;
  goodsName: string;
  goodsType: string;
  containerNo: string;
  containerSize: string;
  carrier: string;
  warehouseAddress: string;
  serviceRevenue: number;
  customerFar: number;
  otherIncome: number;
  customerLift: number;
  customerLower: number;
  customerFeesJson: string;
  detailsJson: string;
  dueDate: string;
  paidAmount: number;
  currency: Transaction['currency'];
  originalAmount: number;
  exchangeRate: number;
  attachmentCount: number;
  importBatchId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ImportTransactionRow {
  kind: TxKind;
  amount: number;
  occurredOn: string;
  categoryName: string;
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
  serviceRevenue: number;
  customerFar?: number;
  otherIncome?: number;
  customerLift?: number;
  customerLower?: number;
  details: Record<string, number>;
  dueDate: string;
  paidAmount: number;
  currency: Transaction['currency'];
  originalAmount: number;
  exchangeRate: number;
  sourceKey: string;
}

const SHIPMENT_REVENUE_SQL = `(CASE WHEN t.kind = 'expense' THEN
  t.service_revenue
  + CAST(ROUND(t.service_revenue * 0.08) AS INTEGER)
  + t.customer_lift + t.customer_lower + t.customer_far + t.other_income
  + COALESCE((
      SELECT SUM(CAST(json_extract(fee.value, '$.amount') AS INTEGER))
      FROM json_each(t.customer_fees_json) AS fee
    ), 0)
ELSE 0 END)`;

const PROFIT_DEDUCTIONS_SQL = `(CASE WHEN t.kind = 'expense' THEN
  COALESCE(json_extract(t.details_json, '$."Phí hải quan"'), 0)
  + COALESCE(json_extract(t.details_json, '$."Chiết khấu"'), 0)
ELSE 0 END)`;

const TX_SELECT = `
  SELECT t.id, t.kind, t.amount, t.occurred_on AS occurredOn,         t.category_id AS categoryId, c.name AS categoryName, c.color AS categoryColor,
         t.party, t.note, t.method, t.reference, t.port,
         t.goods_name AS goodsName, t.goods_type AS goodsType,
         t.container_no AS containerNo, t.container_size AS containerSize,
         t.carrier, t.warehouse_address AS warehouseAddress,
         t.service_revenue AS serviceRevenue,
         t.customer_far AS customerFar, t.other_income AS otherIncome,
         t.customer_lift AS customerLift, t.customer_lower AS customerLower,
         t.customer_fees_json AS customerFeesJson,
         t.details_json AS detailsJson,
         t.due_date AS dueDate, t.paid_amount AS paidAmount, t.currency,
         t.original_amount AS originalAmount, t.exchange_rate AS exchangeRate,
         t.import_batch_id AS importBatchId,
         (SELECT COUNT(*) FROM attachments a WHERE a.transaction_id = t.id) AS attachmentCount,
         t.created_at AS createdAt, t.updated_at AS updatedAt
  FROM transactions t
  JOIN categories c ON c.id = t.category_id
`;

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function assertNotFuture(date: string): void {
  if (date > todayIso()) throw new Error('Ngày giao dịch không được ở tương lai.');
}

export interface AiChangeDraft {
  sessionId: string;
  messageId: number;
  operation: AiOperation;
  targetId: number | null;
  summary: string;
  diff: AiFieldDiff[];
  payload: unknown;
  before: unknown;
  after: unknown;
  baseUpdatedAt: string;
  attachmentCount: number;
}

interface RawAiChangeRow {
  id: number;
  sessionId: string;
  messageId: number | null;
  operation: string;
  targetId: number | null;
  summary: string;
  diffJson: string;
  status: string;
  attachmentCount: number;
  createdAt: string;
  appliedAt: string | null;
  revertedAt: string | null;
}

interface RawAiChangeFull extends RawAiChangeRow {
  payloadJson: string;
  beforeJson: string;
  afterJson: string;
  baseUpdatedAt: string;
}

const AI_CHANGE_SELECT = `SELECT id, session_id AS sessionId, message_id AS messageId, operation,
  target_id AS targetId, summary, diff_json AS diffJson, status,
  attachment_count AS attachmentCount, created_at AS createdAt,
  applied_at AS appliedAt, reverted_at AS revertedAt
  FROM ai_changes`;

function parseAiJson(value: string): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function validateAiTarget(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error('Giao dịch không hợp lệ.');
  }
  return value;
}

function sameTxSnapshot(
  current: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): boolean {
  if (!current || !after) return false;
  if (String(current.updated_at) !== String(after.updated_at)) return false;
  const strip = (row: Record<string, unknown>): Record<string, unknown> => {
    const copy = { ...row };
    delete copy.updated_at;
    return copy;
  };
  return JSON.stringify(strip(current)) === JSON.stringify(strip(after));
}

export class Store {
  private db: DatabaseSync;

  constructor(private readonly dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = this.open();
  }

  private open(): DatabaseSync {
    const db = new DatabaseSync(this.dbPath);
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA synchronous = NORMAL;');
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec(`
      CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL COLLATE NOCASE,
        kind TEXT NOT NULL CHECK (kind IN ('income', 'expense')),
        color TEXT NOT NULL DEFAULT '#6B7280',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (kind, name)
      );

      CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL CHECK (kind IN ('income', 'expense')),
        amount INTEGER NOT NULL CHECK (amount > 0),
        occurred_on TEXT NOT NULL,
        category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
        party TEXT NOT NULL DEFAULT '',
        note TEXT NOT NULL DEFAULT '',
        method TEXT NOT NULL DEFAULT 'cash',
        reference TEXT NOT NULL DEFAULT '',
        port TEXT NOT NULL DEFAULT '',
        goods_name TEXT NOT NULL DEFAULT '',
        goods_type TEXT NOT NULL DEFAULT '',
        container_no TEXT NOT NULL DEFAULT '',
        container_size TEXT NOT NULL DEFAULT '',
        carrier TEXT NOT NULL DEFAULT '',
        warehouse_address TEXT NOT NULL DEFAULT '',
        service_revenue INTEGER NOT NULL DEFAULT 0,
        customer_far INTEGER NOT NULL DEFAULT 0,
        other_income INTEGER NOT NULL DEFAULT 0,
        customer_lift INTEGER NOT NULL DEFAULT 0,
        customer_lower INTEGER NOT NULL DEFAULT 0,
        customer_fees_json TEXT NOT NULL DEFAULT '[]',
        details_json TEXT NOT NULL DEFAULT '{}',
        source_key TEXT,
        due_date TEXT NOT NULL DEFAULT '',
        paid_amount INTEGER NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'VND',
        original_amount REAL NOT NULL DEFAULT 0,
        exchange_rate REAL NOT NULL DEFAULT 1,
        import_batch_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_tx_occurred ON transactions(occurred_on);
      CREATE INDEX IF NOT EXISTS idx_tx_kind ON transactions(kind);
      CREATE INDEX IF NOT EXISTS idx_tx_category ON transactions(category_id);

      CREATE TABLE IF NOT EXISTS attachments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
        file_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size INTEGER NOT NULL,
        data BLOB NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_attachments_tx ON attachments(transaction_id);

      CREATE TABLE IF NOT EXISTS transaction_drafts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        label TEXT NOT NULL DEFAULT '',
        step INTEGER NOT NULL DEFAULT 0,
        payload_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
      );
      CREATE INDEX IF NOT EXISTS idx_drafts_updated ON transaction_drafts(updated_at);

      CREATE TABLE IF NOT EXISTS import_batches (
        id TEXT PRIMARY KEY,
        file_name TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        inserted INTEGER NOT NULL DEFAULT 0,
        income INTEGER NOT NULL DEFAULT 0,
        expense INTEGER NOT NULL DEFAULT 0,
        created_category_ids TEXT NOT NULL DEFAULT '[]'
      );

      CREATE TABLE IF NOT EXISTS budgets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
        month TEXT NOT NULL,
        amount INTEGER NOT NULL CHECK (amount > 0),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (category_id, month)
      );
      CREATE INDEX IF NOT EXISTS idx_budgets_month ON budgets(month);

      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS lookup_values (
        kind TEXT NOT NULL,
        value TEXT NOT NULL COLLATE NOCASE,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (kind, value)
      );

      CREATE TABLE IF NOT EXISTS ai_sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        provider TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS ai_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES ai_sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_ai_messages_session ON ai_messages(session_id, id);

      CREATE TABLE IF NOT EXISTS ai_changes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES ai_sessions(id) ON DELETE CASCADE,
        message_id INTEGER REFERENCES ai_messages(id) ON DELETE SET NULL,
        operation TEXT NOT NULL,
        target_id INTEGER,
        summary TEXT NOT NULL DEFAULT '',
        diff_json TEXT NOT NULL DEFAULT '[]',
        payload_json TEXT NOT NULL DEFAULT '{}',
        before_json TEXT NOT NULL DEFAULT '',
        after_json TEXT NOT NULL DEFAULT '',
        base_updated_at TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        attachment_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        applied_at TEXT,
        reverted_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_ai_changes_session ON ai_changes(session_id, id);
      CREATE INDEX IF NOT EXISTS idx_ai_changes_status ON ai_changes(status);

      CREATE TABLE IF NOT EXISTS ai_backup_attachments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        change_id INTEGER NOT NULL REFERENCES ai_changes(id) ON DELETE CASCADE,
        attachment_id INTEGER NOT NULL,
        file_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size INTEGER NOT NULL,
        data BLOB NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_ai_backup_attachments_change ON ai_backup_attachments(change_id);
    `);
    this.migrateLegacySchema(db);
    const count = db.prepare('SELECT COUNT(*) AS count FROM categories').get() as { count: number };
    if (count.count === 0) {
      const insert = db.prepare('INSERT INTO categories (name, kind, color) VALUES (?, ?, ?)');
      for (const category of SEED_CATEGORIES) insert.run(category.name, category.kind, category.color);
    }
    const insertLookup = db.prepare('INSERT OR IGNORE INTO lookup_values (kind, value) VALUES (?, ?)');
    const lookupSeeds: [LookupKind, string][] = [
      ['customers', 'NAM VIỆT'],
      ['customers', 'HAFLIFE'],
      ['customers', 'ITAGRO'],
      ['customers', 'MBA'],
      ['carriers', 'THANH HÒA'],
      ['goods_types', 'PHÂN BÓN'],
      ['goods_types', 'THUỐC TRỪ SÂU'],
    ];
    for (const [kind, value] of lookupSeeds) insertLookup.run(kind, value);
    return db;
  }

  private migrateLegacySchema(db: DatabaseSync): void {
    const columns = new Set(
      (db.prepare('PRAGMA table_info(transactions)').all() as unknown as { name: string }[]).map(
        (column) => column.name,
      ),
    );
    const additions: [string, string][] = [
      ['reference', "reference TEXT NOT NULL DEFAULT ''"],
      ['port', "port TEXT NOT NULL DEFAULT ''"],
      ['goods_name', "goods_name TEXT NOT NULL DEFAULT ''"],
      ['goods_type', "goods_type TEXT NOT NULL DEFAULT ''"],
      ['container_no', "container_no TEXT NOT NULL DEFAULT ''"],
      ['container_size', "container_size TEXT NOT NULL DEFAULT ''"],
      ['carrier', "carrier TEXT NOT NULL DEFAULT ''"],
      ['warehouse_address', "warehouse_address TEXT NOT NULL DEFAULT ''"],
      ['service_revenue', 'service_revenue INTEGER NOT NULL DEFAULT 0'],
      ['customer_far', 'customer_far INTEGER NOT NULL DEFAULT 0'],
      ['other_income', 'other_income INTEGER NOT NULL DEFAULT 0'],
      ['customer_lift', 'customer_lift INTEGER NOT NULL DEFAULT 0'],
      ['customer_lower', 'customer_lower INTEGER NOT NULL DEFAULT 0'],
      ['customer_fees_json', "customer_fees_json TEXT NOT NULL DEFAULT '[]'"],
      ['details_json', "details_json TEXT NOT NULL DEFAULT '{}'"],
      ['source_key', 'source_key TEXT'],
      ['due_date', "due_date TEXT NOT NULL DEFAULT ''"],
      ['paid_amount', 'paid_amount INTEGER NOT NULL DEFAULT 0'],
      ['currency', "currency TEXT NOT NULL DEFAULT 'VND'"],
      ['original_amount', 'original_amount REAL NOT NULL DEFAULT 0'],
      ['exchange_rate', 'exchange_rate REAL NOT NULL DEFAULT 1'],
      ['import_batch_id', 'import_batch_id TEXT'],
    ];
    const addedPaid = !columns.has('paid_amount');
    const addedCurrency = !columns.has('currency');
    const addedCustomerLift = !columns.has('customer_lift');
    const addedCustomerLower = !columns.has('customer_lower');
    for (const [name, definition] of additions) {
      if (!columns.has(name)) db.exec(`ALTER TABLE transactions ADD COLUMN ${definition}`);
    }
    if (addedCustomerLift || addedCustomerLower) {
      db.exec(`
        UPDATE transactions SET
          customer_lift = COALESCE(json_extract(details_json, '$."Phí nâng"'), 0),
          customer_lower = COALESCE(json_extract(details_json, '$."Phí hạ"'), 0)
        WHERE details_json IS NOT NULL AND details_json <> ''
      `);
    }
    if (addedPaid) {
      db.exec("UPDATE transactions SET paid_amount = amount WHERE due_date = '' OR due_date IS NULL");
    }
    if (addedCurrency) {
      db.exec("UPDATE transactions SET currency = 'VND', original_amount = amount, exchange_rate = 1");
    }
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_tx_source_key
        ON transactions(source_key) WHERE source_key IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_tx_import_batch ON transactions(import_batch_id);
      PRAGMA user_version = 7;
    `);
  }

  close(): void {
    this.db.close();
  }

  getDatabasePath(): string {
    return this.dbPath;
  }

  private toTransaction(row: unknown): Transaction {
    const { detailsJson, customerFeesJson, ...rest } = row as RawTxRow;
    let details: Record<string, number> = {};
    try {
      const parsed = JSON.parse(detailsJson || '{}') as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [label, value] of Object.entries(parsed)) {
          if (typeof value === 'number' && Number.isFinite(value)) details[label] = value;
        }
      }
    } catch {
      details = {};
    }
    let customerFees: CustomerFee[] = [];
    try {
      const parsed = JSON.parse(customerFeesJson || '[]') as unknown;
      if (Array.isArray(parsed)) {
        customerFees = parsed
          .filter(
            (item): item is { label: string; amount: number } =>
              Boolean(item) &&
              typeof item === 'object' &&
              typeof (item as { label?: unknown }).label === 'string' &&
              typeof (item as { amount?: unknown }).amount === 'number',
          )
          .map((item) => ({ label: item.label, amount: item.amount }));
      }
    } catch {
      customerFees = [];
    }
    return { ...rest, details, customerFees };
  }

  private categoryById(id: number): Category | undefined {
    return this.db
      .prepare(
        `SELECT c.id, c.name, c.kind, c.color,
                (SELECT COUNT(*) FROM transactions t WHERE t.category_id = c.id) AS usageCount
         FROM categories c WHERE c.id = ?`,
      )
      .get(id) as Category | undefined;
  }

  listLookups(kind: LookupKind): string[] {
    return (
      this.db
        .prepare('SELECT value FROM lookup_values WHERE kind = ? ORDER BY value COLLATE NOCASE')
        .all(kind) as unknown as { value: string }[]
    ).map((row) => row.value);
  }

  addLookup(kind: LookupKind, value: string): string[] {
    const trimmed = value.replace(/\s+/g, ' ').trim().slice(0, 120);
    if (trimmed) {
      this.db
        .prepare('INSERT OR IGNORE INTO lookup_values (kind, value) VALUES (?, ?)')
        .run(kind, trimmed);
    }
    return this.listLookups(kind);
  }

  listCategories(): Category[] {
    return this.db
      .prepare(
        `SELECT c.id, c.name, c.kind, c.color,
                (SELECT COUNT(*) FROM transactions t WHERE t.category_id = c.id) AS usageCount
         FROM categories c ORDER BY c.kind DESC, c.name COLLATE NOCASE`,
      )
      .all() as unknown as Category[];
  }

  createCategory(input: CategoryInput): Category {
    try {
      const result = this.db
        .prepare('INSERT INTO categories (name, kind, color) VALUES (?, ?, ?)')
        .run(input.name, input.kind, input.color);
      return this.categoryById(Number(result.lastInsertRowid))!;
    } catch (error) {
      if (String(error).includes('UNIQUE')) throw new Error('Danh mục này đã tồn tại.');
      throw error;
    }
  }

  updateCategory(id: number, input: CategoryInput): Category {
    const current = this.categoryById(id);
    if (!current) throw new Error('Không tìm thấy danh mục.');
    if (current.kind !== input.kind) throw new Error('Không thể đổi loại của danh mục.');
    try {
      this.db.prepare('UPDATE categories SET name = ?, color = ? WHERE id = ?').run(input.name, input.color, id);
    } catch (error) {
      if (String(error).includes('UNIQUE')) throw new Error('Danh mục này đã tồn tại.');
      throw error;
    }
    return this.categoryById(id)!;
  }

  removeCategory(id: number): void {
    const current = this.categoryById(id);
    if (!current) throw new Error('Không tìm thấy danh mục.');
    const used = this.db
      .prepare('SELECT COUNT(*) AS count FROM transactions WHERE category_id = ?')
      .get(id) as { count: number };
    if (used.count > 0) {
      throw new Error(`Danh mục đang được dùng bởi ${used.count} giao dịch, không thể xoá.`);
    }
    this.db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  }

  private buildWhere(filter: TxFilter): { clause: string; params: (string | number)[] } {
    const parts: string[] = [];
    const params: (string | number)[] = [];
    if (filter.from) {
      parts.push('t.occurred_on >= ?');
      params.push(filter.from);
    }
    if (filter.to) {
      parts.push('t.occurred_on <= ?');
      params.push(filter.to);
    }
    if (filter.kind === 'income' || filter.kind === 'expense') {
      parts.push('t.kind = ?');
      params.push(filter.kind);
    }
    if (filter.categoryId) {
      parts.push('t.category_id = ?');
      params.push(filter.categoryId);
    }
    if (filter.q) {
      const query = `%${escapeLike(filter.q)}%`;
      parts.push(
        `(t.party LIKE ? ESCAPE '\\' OR t.note LIKE ? ESCAPE '\\' OR t.reference LIKE ? ESCAPE '\\'
          OR t.port LIKE ? ESCAPE '\\' OR t.goods_name LIKE ? ESCAPE '\\'
          OR t.goods_type LIKE ? ESCAPE '\\' OR t.container_no LIKE ? ESCAPE '\\'
          OR t.container_size LIKE ? ESCAPE '\\' OR t.carrier LIKE ? ESCAPE '\\')`,
      );
      params.push(query, query, query, query, query, query, query, query, query);
    }
    return { clause: parts.length ? `WHERE ${parts.join(' AND ')}` : '', params };
  }

  listTransactions(filter: TxFilter): TxPage {
    const { clause, params } = this.buildWhere(filter);
    const totals = this.db
      .prepare(
        `SELECT COUNT(*) AS total,
                COALESCE(SUM(CASE WHEN t.kind = 'income' THEN t.amount ELSE 0 END), 0)
                  + COALESCE(SUM(${SHIPMENT_REVENUE_SQL}), 0) AS income,
                COALESCE(SUM(CASE WHEN t.kind = 'expense' THEN t.amount ELSE 0 END), 0) AS expense,
                COALESCE(SUM(${PROFIT_DEDUCTIONS_SQL}), 0) AS deductions
         FROM transactions t ${clause}`,
      )
      .get(...params) as { total: number; income: number; expense: number; deductions: number };
    const limit = filter.limit ?? 50;
    const offset = filter.offset ?? 0;
    const rows = this.db
      .prepare(`${TX_SELECT} ${clause} ORDER BY t.occurred_on DESC, t.id DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as unknown[];
    return {
      items: rows.map((row) => this.toTransaction(row)),
      total: totals.total,
      income: totals.income,
      expense: totals.expense,
      deductions: totals.deductions,
      profit: totals.income - totals.expense - totals.deductions,
    };
  }

  private allTransactions(filter: TxFilter): Transaction[] {
    const { clause, params } = this.buildWhere(filter);
    const rows = this.db
      .prepare(`${TX_SELECT} ${clause} ORDER BY t.occurred_on ASC, t.id ASC`)
      .all(...params) as unknown[];
    return rows.map((row) => this.toTransaction(row));
  }

  private getTransaction(id: number): Transaction | undefined {
    const row = this.db.prepare(`${TX_SELECT} WHERE t.id = ?`).get(id);
    return row ? this.toTransaction(row) : undefined;
  }

  private ensureCategoryMatches(categoryId: number, kind: TxKind): void {
    const category = this.categoryById(categoryId);
    if (!category) throw new Error('Danh mục không tồn tại.');
    if (category.kind !== kind) throw new Error('Danh mục không khớp với loại giao dịch.');
  }

  createTransaction(input: TxInput): Transaction {
    assertNotFuture(input.occurredOn);
    this.ensureCategoryMatches(input.categoryId, input.kind);
    const result = this.db
      .prepare(
        `INSERT INTO transactions
           (kind, amount, occurred_on, category_id, party, note, method,
            reference, port, goods_name, goods_type, container_no, container_size, carrier,
            warehouse_address, service_revenue, customer_far, other_income, customer_lift,
            customer_lower, customer_fees_json, details_json,
            due_date, paid_amount, currency, original_amount, exchange_rate)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.kind,
        input.amount,
        input.occurredOn,
        input.categoryId,
        input.party,
        input.note,
        input.method,
        input.reference,
        input.port,
        input.goodsName,
        input.goodsType,
        input.containerNo,
        input.containerSize,
        input.carrier,
        input.warehouseAddress,
        input.serviceRevenue,
        input.customerFar,
        input.otherIncome,
        input.customerLift,
        input.customerLower,
        JSON.stringify(input.customerFees ?? []),
        JSON.stringify(input.details),
        input.dueDate,
        input.paidAmount,
        input.currency,
        input.originalAmount,
        input.exchangeRate,
      );
    return this.getTransaction(Number(result.lastInsertRowid))!;
  }

  updateTransaction(id: number, input: TxInput): Transaction {
    assertNotFuture(input.occurredOn);
    if (!this.getTransaction(id)) throw new Error('Không tìm thấy giao dịch.');
    this.ensureCategoryMatches(input.categoryId, input.kind);
    this.db
      .prepare(
        `UPDATE transactions
         SET kind = ?, amount = ?, occurred_on = ?, category_id = ?, party = ?, note = ?, method = ?,
             reference = ?, port = ?, goods_name = ?, goods_type = ?, container_no = ?,
             container_size = ?, carrier = ?, warehouse_address = ?, service_revenue = ?,
             customer_far = ?, other_income = ?, customer_lift = ?, customer_lower = ?,
             customer_fees_json = ?, details_json = ?,
             due_date = ?, paid_amount = ?, currency = ?, original_amount = ?, exchange_rate = ?,
             updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(
        input.kind,
        input.amount,
        input.occurredOn,
        input.categoryId,
        input.party,
        input.note,
        input.method,
        input.reference,
        input.port,
        input.goodsName,
        input.goodsType,
        input.containerNo,
        input.containerSize,
        input.carrier,
        input.warehouseAddress,
        input.serviceRevenue,
        input.customerFar,
        input.otherIncome,
        input.customerLift,
        input.customerLower,
        JSON.stringify(input.customerFees ?? []),
        JSON.stringify(input.details),
        input.dueDate,
        input.paidAmount,
        input.currency,
        input.originalAmount,
        input.exchangeRate,
        id,
      );
    return this.getTransaction(id)!;
  }

  removeTransaction(id: number): void {
    const result = this.db.prepare('DELETE FROM transactions WHERE id = ?').run(id);
    if (Number(result.changes) === 0) throw new Error('Không tìm thấy giao dịch.');
  }

  hasSourceKey(sourceKey: string): boolean {
    if (!sourceKey) return false;
    return Boolean(this.db.prepare('SELECT 1 FROM transactions WHERE source_key = ?').get(sourceKey));
  }

  importRows(rows: ImportTransactionRow[], batch?: { id: string; fileName: string }): ImportResult {
    const findCategory = this.db.prepare(
      'SELECT id FROM categories WHERE kind = ? AND name = ? COLLATE NOCASE',
    );
    const insertCategory = this.db.prepare('INSERT INTO categories (name, kind, color) VALUES (?, ?, ?)');
    const findSource = this.db.prepare('SELECT 1 FROM transactions WHERE source_key = ?');
    const insert = this.db.prepare(
      `INSERT INTO transactions
         (kind, amount, occurred_on, category_id, party, note, method,
          reference, port, goods_name, goods_type, container_no, container_size, carrier,
          service_revenue, details_json,
          source_key, due_date, paid_amount, currency, original_amount, exchange_rate, import_batch_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    let income = 0;
    let expense = 0;
    let inserted = 0;
    let duplicates = 0;
    let skipped = 0;
    let categoriesCreated = 0;
    const createdCategoryIds: number[] = [];
    const seen = new Set<string>();

    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const row of rows) {
        if (!row.occurredOn || row.amount <= 0 || !row.categoryName.trim()) {
          skipped += 1;
          continue;
        }
        if (row.sourceKey) {
          if (seen.has(row.sourceKey) || findSource.get(row.sourceKey)) {
            duplicates += 1;
            continue;
          }
          seen.add(row.sourceKey);
        }
        let category = findCategory.get(row.kind, row.categoryName.trim()) as { id: number } | undefined;
        if (!category) {
          const color = row.kind === 'income' ? '#177245' : '#B42318';
          const result = insertCategory.run(row.categoryName.trim(), row.kind, color);
          category = { id: Number(result.lastInsertRowid) };
          createdCategoryIds.push(category.id);
          categoriesCreated += 1;
        }
        insert.run(
          row.kind,
          row.amount,
          row.occurredOn,
          category.id,
          row.party,
          row.note,
          row.method,
          row.reference,
          row.port,
          row.goodsName,
          row.goodsType,
          row.containerNo,
          row.containerSize,
          row.carrier,
          row.serviceRevenue,
          JSON.stringify(row.details),
          row.sourceKey || null,
          row.dueDate,
          row.paidAmount,
          row.currency,
          row.originalAmount,
          row.exchangeRate,
          batch?.id ?? null,
        );
        inserted += 1;
        if (row.kind === 'income') income += row.amount;
        else expense += row.amount;
      }
      if (batch && inserted > 0) {
        this.db
          .prepare(
            `INSERT INTO import_batches (id, file_name, inserted, income, expense, created_category_ids)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(batch.id, batch.fileName, inserted, income, expense, JSON.stringify(createdCategoryIds));
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return {
      income,
      expense,
      inserted,
      duplicates,
      skipped,
      categoriesCreated,
      batchId: batch && inserted > 0 ? batch.id : undefined,
    };
  }

  listImportBatches(): ImportBatch[] {
    return this.db
      .prepare(
        `SELECT id, file_name AS fileName, created_at AS createdAt,
                inserted, income, expense
         FROM import_batches ORDER BY created_at DESC LIMIT 50`,
      )
      .all() as unknown as ImportBatch[];
  }

  undoImportBatch(id: string): ImportUndoResult {
    const batch = this.db
      .prepare('SELECT created_category_ids FROM import_batches WHERE id = ?')
      .get(id) as { created_category_ids: string } | undefined;
    if (!batch) throw new Error('Không tìm thấy lần nhập dữ liệu.');

    let removed = 0;
    let categoriesRemoved = 0;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = this.db.prepare('DELETE FROM transactions WHERE import_batch_id = ?').run(id);
      removed = Number(result.changes);
      this.db.prepare('DELETE FROM import_batches WHERE id = ?').run(id);
      let categoryIds: number[] = [];
      try {
        const parsed = JSON.parse(batch.created_category_ids) as unknown;
        if (Array.isArray(parsed)) categoryIds = parsed.filter((value): value is number => typeof value === 'number');
      } catch {
        categoryIds = [];
      }
      for (const categoryId of categoryIds) {
        const used = this.db
          .prepare('SELECT COUNT(*) AS count FROM transactions WHERE category_id = ?')
          .get(categoryId) as { count: number };
        if (used.count === 0) {
          const deleted = this.db.prepare('DELETE FROM categories WHERE id = ?').run(categoryId);
          categoriesRemoved += Number(deleted.changes);
        }
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return { removed, categoriesRemoved };
  }

  private shipmentWhere(filter: ShipmentFilter): { clause: string; params: string[] } {
    const parts = ["t.reference <> ''"];
    const params: string[] = [];
    if (filter.from) {
      parts.push('t.occurred_on >= ?');
      params.push(filter.from);
    }
    if (filter.to) {
      parts.push('t.occurred_on <= ?');
      params.push(filter.to);
    }
    if (filter.q) {
      const query = `%${escapeLike(filter.q)}%`;
      parts.push(
        `(t.reference LIKE ? ESCAPE '\\' OR t.party LIKE ? ESCAPE '\\'
          OR t.goods_name LIKE ? ESCAPE '\\' OR t.goods_type LIKE ? ESCAPE '\\'
          OR t.container_no LIKE ? ESCAPE '\\' OR t.carrier LIKE ? ESCAPE '\\')`,
      );
      params.push(query, query, query, query, query, query);
    }
    return { clause: `WHERE ${parts.join(' AND ')}`, params };
  }

  private mapShipment(row: Record<string, unknown>): ShipmentSummary {
    const income = Number(row.income ?? 0);
    const expense = Number(row.expense ?? 0);
    const profit = income - expense;
    const split = (value: unknown): string[] =>
      String(value ?? '')
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
    return {
      reference: String(row.reference ?? ''),
      firstDate: String(row.firstDate ?? ''),
      lastDate: String(row.lastDate ?? ''),
      customer: String(row.customer ?? ''),
      goodsType: String(row.goodsType ?? ''),
      goodsNames: [...new Set(split(row.goodsNames))],
      containers: [...new Set(split(row.containers))],
      count: Number(row.count ?? 0),
      income,
      expense,
      profit,
      margin: income > 0 ? Math.round((profit / income) * 1000) / 10 : 0,
    };
  }

  listShipments(filter: ShipmentFilter): ShipmentSummary[] {
    const { clause, params } = this.shipmentWhere(filter);
    const rows = this.db
      .prepare(
        `SELECT t.reference,
                MIN(t.occurred_on) AS firstDate,
                MAX(t.occurred_on) AS lastDate,
                COALESCE(MAX(CASE WHEN t.kind = 'income' THEN NULLIF(t.party, '') END),
                         MAX(NULLIF(t.party, '')), '') AS customer,
                COALESCE(MAX(NULLIF(t.goods_type, '')), '') AS goodsType,
                GROUP_CONCAT(DISTINCT NULLIF(t.goods_name, '')) AS goodsNames,
                GROUP_CONCAT(DISTINCT NULLIF(t.container_no, '')) AS containers,
                COUNT(*) AS count,
                COALESCE(SUM(CASE WHEN t.kind = 'income' THEN t.amount ELSE 0 END), 0) AS income,
                COALESCE(SUM(CASE WHEN t.kind = 'expense' THEN t.amount ELSE 0 END), 0) AS expense
         FROM transactions t
         ${clause}
         GROUP BY t.reference
         ORDER BY lastDate DESC, t.reference DESC
         LIMIT 1000`,
      )
      .all(...params) as unknown as Record<string, unknown>[];
    return rows.map((row) => this.mapShipment(row));
  }

  getShipment(reference: string): ShipmentDetail {
    const row = this.db
      .prepare(
        `SELECT t.reference,
                MIN(t.occurred_on) AS firstDate,
                MAX(t.occurred_on) AS lastDate,
                COALESCE(MAX(CASE WHEN t.kind = 'income' THEN NULLIF(t.party, '') END),
                         MAX(NULLIF(t.party, '')), '') AS customer,
                COALESCE(MAX(NULLIF(t.goods_type, '')), '') AS goodsType,
                GROUP_CONCAT(DISTINCT NULLIF(t.goods_name, '')) AS goodsNames,
                GROUP_CONCAT(DISTINCT NULLIF(t.container_no, '')) AS containers,
                COUNT(*) AS count,
                COALESCE(SUM(CASE WHEN t.kind = 'income' THEN t.amount ELSE 0 END), 0) AS income,
                COALESCE(SUM(CASE WHEN t.kind = 'expense' THEN t.amount ELSE 0 END), 0) AS expense
         FROM transactions t WHERE t.reference = ? GROUP BY t.reference`,
      )
      .get(reference) as Record<string, unknown> | undefined;
    if (!row) throw new Error('Không tìm thấy lô hàng với số tờ khai này.');
    const transactions = this.db
      .prepare(`${TX_SELECT} WHERE t.reference = ? ORDER BY t.occurred_on ASC, t.id ASC`)
      .all(reference) as unknown[];
    return {
      summary: this.mapShipment(row),
      transactions: transactions.map((item) => this.toTransaction(item)),
    };
  }

  private buildDebtItem(transaction: Transaction): DebtItem {
    const outstanding = Math.max(0, transaction.amount - transaction.paidAmount);
    const today = todayIso();
    const dueTimestamp = transaction.dueDate ? Date.parse(`${transaction.dueDate}T00:00:00Z`) : NaN;
    const todayTimestamp = Date.parse(`${today}T00:00:00Z`);
    const daysOverdue = Number.isFinite(dueTimestamp)
      ? Math.max(0, Math.floor((todayTimestamp - dueTimestamp) / 86400000))
      : 0;
    let status: DebtStatus;
    if (outstanding <= 0) status = 'paid';
    else if (daysOverdue > 0) status = 'overdue';
    else if (transaction.paidAmount > 0) status = 'partial';
    else status = 'unpaid';
    return { transaction, outstanding, status, daysOverdue };
  }

  listDebts(): DebtData {
    const rows = this.db
      .prepare(`${TX_SELECT} WHERE t.due_date <> '' ORDER BY t.due_date ASC, t.id ASC`)
      .all() as unknown[];
    const items = rows.map((row) => this.buildDebtItem(this.toTransaction(row)));
    let receivable = 0;
    let payable = 0;
    let overdueReceivable = 0;
    let overduePayable = 0;
    let overdueCount = 0;
    const agingMap = new Map<string, { label: string; receivable: number; payable: number }>([
      ['current', { label: 'Chưa đến hạn', receivable: 0, payable: 0 }],
      ['1-30', { label: 'Quá hạn 1–30 ngày', receivable: 0, payable: 0 }],
      ['31-60', { label: 'Quá hạn 31–60 ngày', receivable: 0, payable: 0 }],
      ['61-90', { label: 'Quá hạn 61–90 ngày', receivable: 0, payable: 0 }],
      ['90+', { label: 'Quá hạn trên 90 ngày', receivable: 0, payable: 0 }],
    ]);
    for (const item of items) {
      if (item.outstanding <= 0) continue;
      const key =
        item.daysOverdue <= 0
          ? 'current'
          : item.daysOverdue <= 30
            ? '1-30'
            : item.daysOverdue <= 60
              ? '31-60'
              : item.daysOverdue <= 90
                ? '61-90'
                : '90+';
      const bucket = agingMap.get(key)!;
      if (item.transaction.kind === 'income') {
        receivable += item.outstanding;
        bucket.receivable += item.outstanding;
        if (item.daysOverdue > 0) overdueReceivable += item.outstanding;
      } else {
        payable += item.outstanding;
        bucket.payable += item.outstanding;
        if (item.daysOverdue > 0) overduePayable += item.outstanding;
      }
      if (item.daysOverdue > 0) overdueCount += 1;
    }
    return {
      items,
      receivable,
      payable,
      overdueReceivable,
      overduePayable,
      tracked: items.length,
      overdueCount,
      aging: [...agingMap.values()],
    };
  }

  payDebt(id: number, amount: number): DebtItem {
    const current = this.getTransaction(id);
    if (!current) throw new Error('Không tìm thấy giao dịch.');
    if (!current.dueDate) throw new Error('Giao dịch này không theo dõi công nợ.');
    const outstanding = Math.max(0, current.amount - current.paidAmount);
    if (outstanding === 0) throw new Error('Giao dịch đã được thanh toán đủ.');
    if (amount > outstanding) throw new Error('Số tiền thanh toán vượt quá số còn nợ.');
    this.db
      .prepare("UPDATE transactions SET paid_amount = paid_amount + ?, updated_at = datetime('now') WHERE id = ?")
      .run(amount, id);
    return this.buildDebtItem(this.getTransaction(id)!);
  }

  listAttachments(transactionId: number): AttachmentMeta[] {
    return this.db
      .prepare(
        `SELECT id, transaction_id AS transactionId, file_name AS fileName,
                mime_type AS mimeType, size, created_at AS createdAt
         FROM attachments WHERE transaction_id = ? ORDER BY created_at ASC, id ASC`,
      )
      .all(transactionId) as unknown as AttachmentMeta[];
  }

  addAttachment(transactionId: number, fileName: string, mimeType: string, data: Buffer): AttachmentMeta {
    if (!this.getTransaction(transactionId)) throw new Error('Không tìm thấy giao dịch.');
    const result = this.db
      .prepare(
        `INSERT INTO attachments (transaction_id, file_name, mime_type, size, data)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(transactionId, fileName, mimeType, data.length, data);
    return this.db
      .prepare(
        `SELECT id, transaction_id AS transactionId, file_name AS fileName,
                mime_type AS mimeType, size, created_at AS createdAt
         FROM attachments WHERE id = ?`,
      )
      .get(Number(result.lastInsertRowid)) as unknown as AttachmentMeta;
  }

  getAttachment(id: number): { meta: AttachmentMeta; data: Uint8Array } | undefined {
    const row = this.db
      .prepare(
        `SELECT id, transaction_id AS transactionId, file_name AS fileName,
                mime_type AS mimeType, size, created_at AS createdAt, data
         FROM attachments WHERE id = ?`,
      )
      .get(id) as (AttachmentMeta & { data: Uint8Array }) | undefined;
    if (!row) return undefined;
    const { data, ...meta } = row;
    return { meta, data };
  }

  removeAttachment(id: number): void {
    const result = this.db.prepare('DELETE FROM attachments WHERE id = ?').run(id);
    if (Number(result.changes) === 0) throw new Error('Không tìm thấy chứng từ.');
  }

  listDrafts(): TransactionDraft[] {
    const rows = this.db
      .prepare(
        `SELECT id, label, step, payload_json AS payloadJson,
                created_at AS createdAt, updated_at AS updatedAt
         FROM transaction_drafts ORDER BY updated_at DESC, id DESC`,
      )
      .all() as unknown as {
      id: number;
      label: string;
      step: number;
      payloadJson: string;
      createdAt: string;
      updatedAt: string;
    }[];
    return rows.map((row) => ({
      id: row.id,
      label: row.label,
      step: row.step,
      payload: this.parseDraftPayload(row.payloadJson),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }

  saveDraft(input: TransactionDraftInput): TransactionDraft {
    const payloadJson = JSON.stringify(input.payload ?? {});
    if (input.id) {
      const result = this.db
        .prepare(
          `UPDATE transaction_drafts
           SET label = ?, step = ?, payload_json = ?, updated_at = datetime('now', 'localtime')
           WHERE id = ?`,
        )
        .run(input.label, input.step, payloadJson, input.id);
      if (Number(result.changes) === 0) throw new Error('Không tìm thấy nháp.');
      return this.getDraft(input.id);
    }
    const result = this.db
      .prepare('INSERT INTO transaction_drafts (label, step, payload_json) VALUES (?, ?, ?)')
      .run(input.label, input.step, payloadJson);
    return this.getDraft(Number(result.lastInsertRowid));
  }

  removeDraft(id: number): void {
    const result = this.db.prepare('DELETE FROM transaction_drafts WHERE id = ?').run(id);
    if (Number(result.changes) === 0) throw new Error('Không tìm thấy nháp.');
  }

  private getDraft(id: number): TransactionDraft {
    const row = this.db
      .prepare(
        `SELECT id, label, step, payload_json AS payloadJson,
                created_at AS createdAt, updated_at AS updatedAt
         FROM transaction_drafts WHERE id = ?`,
      )
      .get(id) as
      | {
          id: number;
          label: string;
          step: number;
          payloadJson: string;
          createdAt: string;
          updatedAt: string;
        }
      | undefined;
    if (!row) throw new Error('Không tìm thấy nháp.');
    return {
      id: row.id,
      label: row.label,
      step: row.step,
      payload: this.parseDraftPayload(row.payloadJson),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private parseDraftPayload(json: string): unknown {
    try {
      return JSON.parse(json) as unknown;
    } catch {
      return {};
    }
  }

  getBudgets(month: string): BudgetData {
    const rows = this.db
      .prepare(
        `SELECT c.id AS categoryId, c.name AS categoryName,
                COALESCE(b.amount, 0) AS budget,
                COALESCE(SUM(CASE WHEN t.kind = 'expense' THEN t.amount ELSE 0 END), 0) AS spent
         FROM categories c
         LEFT JOIN budgets b ON b.category_id = c.id AND b.month = ?
         LEFT JOIN transactions t ON t.category_id = c.id
           AND t.kind = 'expense' AND substr(t.occurred_on, 1, 7) = ?
         WHERE c.kind = 'expense'
         GROUP BY c.id
         ORDER BY budget DESC, spent DESC, c.name COLLATE NOCASE`,
      )
      .all(month, month) as unknown as { categoryId: number; categoryName: string; budget: number; spent: number }[];
    const normalized: BudgetRow[] = rows.map((row) => ({
      ...row,
      usage: row.budget > 0 ? Math.round((row.spent / row.budget) * 1000) / 10 : 0,
    }));
    return {
      month,
      totalBudget: normalized.reduce((sum, row) => sum + row.budget, 0),
      totalSpent: normalized.filter((row) => row.budget > 0).reduce((sum, row) => sum + row.spent, 0),
      rows: normalized,
    };
  }

  saveBudget(input: BudgetInput): BudgetData {
    const category = this.categoryById(input.categoryId);
    if (!category) throw new Error('Không tìm thấy danh mục.');
    if (category.kind !== 'expense') throw new Error('Ngân sách chỉ áp dụng cho danh mục chi phí.');
    this.db
      .prepare(
        `INSERT INTO budgets (category_id, month, amount) VALUES (?, ?, ?)
         ON CONFLICT(category_id, month) DO UPDATE SET amount = excluded.amount,
           updated_at = datetime('now')`,
      )
      .run(input.categoryId, input.month, input.amount);
    return this.getBudgets(input.month);
  }

  removeBudget(categoryId: number, month: string): BudgetData {
    this.db.prepare('DELETE FROM budgets WHERE category_id = ? AND month = ?').run(categoryId, month);
    return this.getBudgets(month);
  }

  copyPreviousBudgets(month: string): BudgetData {
    const previous = shiftMonth(month, -1);
    this.db
      .prepare(
        `INSERT INTO budgets (category_id, month, amount)
         SELECT category_id, ?, amount FROM budgets WHERE month = ?
         ON CONFLICT(category_id, month) DO NOTHING`,
      )
      .run(month, previous);
    return this.getBudgets(month);
  }

  private summary(
    from: string,
    to: string,
    includeShipmentRevenue = false,
  ): { income: number; expense: number; count: number; deductions: number } {
    const incomeExpression = includeShipmentRevenue
      ? `COALESCE(SUM(CASE WHEN t.kind = 'income' THEN t.amount ELSE 0 END), 0)
         + COALESCE(SUM(${SHIPMENT_REVENUE_SQL}), 0)`
      : "COALESCE(SUM(CASE WHEN t.kind = 'income' THEN t.amount ELSE 0 END), 0)";
    return this.db
      .prepare(
        `SELECT ${incomeExpression} AS income,
                COALESCE(SUM(CASE WHEN t.kind = 'expense' THEN t.amount ELSE 0 END), 0) AS expense,
                COALESCE(SUM(${PROFIT_DEDUCTIONS_SQL}), 0) AS deductions,
                COUNT(*) AS count
         FROM transactions t WHERE t.occurred_on BETWEEN ? AND ?`,
      )
      .get(from, to) as {
      income: number;
      expense: number;
      count: number;
      deductions: number;
    };
  }

  private monthlySeries(
    fromMonth: string,
    toMonth: string,
    includeShipmentRevenue = false,
  ): MonthPoint[] {
    const months: string[] = [];
    let cursor = fromMonth;
    while (cursor <= toMonth && months.length < 240) {
      months.push(cursor);
      cursor = shiftMonth(cursor, 1);
    }
    const { from } = monthBounds(fromMonth);
    const { to } = monthBounds(toMonth);
    const incomeExpression = includeShipmentRevenue
      ? `COALESCE(SUM(CASE WHEN t.kind = 'income' THEN t.amount ELSE 0 END), 0)
         + COALESCE(SUM(${SHIPMENT_REVENUE_SQL}), 0)`
      : "COALESCE(SUM(CASE WHEN t.kind = 'income' THEN t.amount ELSE 0 END), 0)";
    const rows = this.db
      .prepare(
        `SELECT substr(t.occurred_on, 1, 7) AS month,
                ${incomeExpression} AS income,
                COALESCE(SUM(CASE WHEN t.kind = 'expense' THEN t.amount ELSE 0 END), 0) AS expense
         FROM transactions t
         WHERE t.occurred_on BETWEEN ? AND ?
         GROUP BY month`,
      )
      .all(from, to) as unknown as { month: string; income: number; expense: number }[];
    const map = new Map(months.map((month) => [month, { month, income: 0, expense: 0 }]));
    for (const row of rows) {
      const point = map.get(row.month);
      if (!point) continue;
      point.income = row.income;
      point.expense = row.expense;
    }
    return [...map.values()];
  }

  dashboard(month: string): DashboardData {
    const { from, to } = monthBounds(month);
    const current = this.summary(from, to, true);
    const prevMonth = shiftMonth(month, -1);
    const prevBounds = monthBounds(prevMonth);
    const prev = this.summary(prevBounds.from, prevBounds.to, true);
    const topExpense = this.db
      .prepare(
        `SELECT c.name, c.color, SUM(t.amount) AS total, COUNT(*) AS count
         FROM transactions t JOIN categories c ON c.id = t.category_id
         WHERE t.kind = 'expense' AND t.occurred_on BETWEEN ? AND ?
         GROUP BY c.id ORDER BY total DESC LIMIT 5`,
      )
      .all(from, to) as unknown as CategoryTotal[];
    const recentRows = this.db
      .prepare(`${TX_SELECT} WHERE t.occurred_on BETWEEN ? AND ? ORDER BY t.occurred_on DESC, t.id DESC LIMIT 5`)
      .all(from, to) as unknown[];
    return {
      month,
      income: current.income,
      expense: current.expense,
      deductions: current.deductions,
      net: current.income - current.expense - current.deductions,
      count: current.count,
      prevIncome: prev.income,
      prevExpense: prev.expense,
      series: this.monthlySeries(shiftMonth(month, -5), month, true),
      topExpense,
      recent: recentRows.map((row) => this.toTransaction(row)),
    };
  }

  report(from: string, to: string): ReportData {
    const totals = this.summary(from, to);
    const byCategory = this.db
      .prepare(
        `SELECT c.kind AS kind, c.name, c.color, SUM(t.amount) AS total, COUNT(*) AS count
         FROM transactions t JOIN categories c ON c.id = t.category_id
         WHERE t.occurred_on BETWEEN ? AND ?
         GROUP BY c.id ORDER BY c.kind DESC, total DESC`,
      )
      .all(from, to) as unknown as (CategoryTotal & { kind: TxKind })[];
    return {
      from,
      to,
      income: totals.income,
      expense: totals.expense,
      net: totals.income - totals.expense,
      count: totals.count,
      byCategory,
      byMonth: this.monthlySeries(from.slice(0, 7), to.slice(0, 7)),
      transactions: this.allTransactions({ from, to }),
    };
  }

  exportTransactions(filter: TxFilter): Transaction[] {
    return this.allTransactions(filter);
  }

  getSettings(): CompanySettings {
    const row = this.db.prepare("SELECT value FROM app_settings WHERE key = 'company_name'").get() as
      | { value: string }
      | undefined;
    return { companyName: row?.value ?? DEFAULT_COMPANY };
  }

  saveSettings(settings: CompanySettings): CompanySettings {
    this.db
      .prepare(
        `INSERT INTO app_settings (key, value) VALUES ('company_name', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(settings.companyName);
    return this.getSettings();
  }

  getTheme(): ThemeSettings {
    const row = this.db.prepare("SELECT value FROM app_settings WHERE key = 'theme'").get() as
      | { value: string }
      | undefined;
    if (!row) return { preset: DEFAULT_THEME.preset, colors: { ...DEFAULT_THEME.colors } };
    try {
      const parsed = JSON.parse(row.value) as ThemeSettings;
      if (parsed.preset !== 'custom') {
        const preset = getThemePreset(parsed.preset);
        if (preset) return { preset: preset.id, colors: { ...preset.colors } };
        return { preset: DEFAULT_THEME.preset, colors: { ...DEFAULT_THEME.colors } };
      }
      return { preset: 'custom', colors: { ...DEFAULT_THEME.colors, ...parsed.colors } };
    } catch {
      return { preset: DEFAULT_THEME.preset, colors: { ...DEFAULT_THEME.colors } };
    }
  }

  saveTheme(theme: ThemeSettings): ThemeSettings {
    this.db
      .prepare(
        `INSERT INTO app_settings (key, value) VALUES ('theme', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(JSON.stringify(theme));
    return this.getTheme();
  }

  stats(): DataStats {
    const transactions = this.db.prepare('SELECT COUNT(*) AS count FROM transactions').get() as { count: number };
    const categories = this.db.prepare('SELECT COUNT(*) AS count FROM categories').get() as { count: number };
    return { transactions: transactions.count, categories: categories.count };
  }

  seedDemo(): SeedResult {
    if (this.stats().transactions > 0) {
      throw new Error('Chỉ có thể tải dữ liệu mẫu khi sổ đang trống.');
    }
    const categories = this.listCategories();
    const find = (kind: TxKind, name: string) => categories.find((c) => c.kind === kind && c.name === name)?.id;
    const random = mulberry32(20261102);
    const today = todayIso();
    const currentMonth = today.slice(0, 7);
    const insert = this.db.prepare(
      `INSERT INTO transactions
         (kind, amount, occurred_on, category_id, party, note, method,
          paid_amount, currency, original_amount, exchange_rate)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'VND', ?, 1)`,
    );

    const salesParties = ['Công ty Sao Việt', 'Khách hàng Minh Anh', 'Công ty Hòa Bình', 'Đối tác An Phú', 'Công ty Tân Long'];
    const vendors = ['Nhà cung cấp Hoàng Gia', 'Công ty Vật tư Đông Á', 'Công ty Bao bì Việt', 'Nhà phân phối Phú Thịnh'];
    const agencies = ['Meta Ads', 'Google Ads', 'TikTok Ads', 'Công ty Truyền thông Mộc'];
    const amounts = (min: number, max: number) =>
      100_000 + Math.floor((min + random() * (max - min)) / 100_000) * 100_000;
    let inserted = 0;

    const add = (
      kind: TxKind,
      categoryName: string,
      amount: number,
      date: string,
      party: string,
      note: string,
      method: Transaction['method'],
    ) => {
      if (date > today) return;
      const categoryId = find(kind, categoryName);
      if (!categoryId) return;
      insert.run(kind, amount, date, categoryId, party, note, method, amount, amount);
      inserted += 1;
    };

    for (let offset = 5; offset >= 0; offset -= 1) {
      const month = shiftMonth(currentMonth, -offset);
      const monthNumber = Number(month.slice(5, 7));
      const day = (value: number) => `${month}-${pad(Math.min(value, 28))}`;

      if (offset === 0) {
        const todayDay = Number(today.slice(8, 10));
        const recentDay = (back: number) => `${month}-${pad(Math.max(1, todayDay - back))}`;
        add('income', 'Doanh thu bán hàng', amounts(120_000_000, 180_000_000), recentDay(0), salesParties[0], 'Thanh toán đơn hàng đầu tháng', 'bank');
        add('income', 'Dịch vụ', amounts(60_000_000, 90_000_000), recentDay(1), salesParties[1], 'Phí tư vấn và triển khai', 'bank');
        add('expense', 'Lương & nhân sự', amounts(95_000_000, 115_000_000), recentDay(1), 'Bảng lương nội bộ', `Lương tháng ${monthNumber}`, 'bank');
        add('expense', 'Thuê mặt bằng', 36_000_000, recentDay(0), 'Công ty Bất động sản Hòa Phát', `Tiền thuê văn phòng tháng ${monthNumber}`, 'bank');
        add('expense', 'Marketing', amounts(8_000_000, 18_000_000), recentDay(0), agencies[0], 'Chiến dịch quảng cáo tháng', 'bank');
        add('expense', 'Mua hàng', amounts(12_000_000, 24_000_000), recentDay(0), vendors[0], 'Nhập vật tư đầu tháng', 'bank');
        add('expense', 'Điện nước', amounts(2_500_000, 4_200_000), recentDay(0), 'Điện lực & Cấp nước', `Hoá đơn điện nước tháng ${monthNumber}`, 'bank');
        continue;
      }

      add('expense', 'Lương & nhân sự', amounts(105_000_000, 138_000_000), day(5), 'Bảng lương nội bộ', `Lương tháng ${monthNumber}`, 'bank');
      add('expense', 'Thuê mặt bằng', 36_000_000, day(3), 'Công ty Bất động sản Hòa Phát', `Tiền thuê văn phòng tháng ${monthNumber}`, 'bank');
      add('expense', 'Điện nước', amounts(2_600_000, 5_400_000), day(12), 'Điện lực & Cấp nước', `Hoá đơn điện nước tháng ${monthNumber}`, 'bank');
      add('expense', 'Marketing', amounts(10_000_000, 24_000_000), day(18), agencies[Math.floor(random() * agencies.length)], 'Chiến dịch quảng cáo tháng', 'bank');
      add('expense', 'Mua hàng', amounts(16_000_000, 42_000_000), day(20), vendors[Math.floor(random() * vendors.length)], 'Nhập vật tư và bao bì', 'bank');
      add('expense', 'Vận chuyển', amounts(2_000_000, 5_000_000), day(22), 'Giao hàng Nhanh', 'Cước vận chuyển nội bộ', 'cash');
      add('expense', 'Thuế & phí', amounts(6_000_000, 14_000_000), day(25), 'Cơ quan Thuế', `Thuế GTGT tháng ${monthNumber}`, 'bank');
      if (offset % 2 === 0) {
        add('expense', 'Văn phòng phẩm', amounts(900_000, 3_200_000), day(15), 'Cửa hàng Văn phòng Xanh', 'Bổ sung văn phòng phẩm', 'cash');
      }

      add('income', 'Doanh thu bán hàng', amounts(78_000_000, 198_000_000), day(8), salesParties[Math.floor(random() * salesParties.length)], `Thanh toán đơn hàng tháng ${monthNumber}`, 'bank');
      add('income', 'Doanh thu bán hàng', amounts(58_000_000, 150_000_000), day(26), salesParties[Math.floor(random() * salesParties.length)], 'Thanh toán đợt 2', 'bank');
      add('income', 'Dịch vụ', amounts(36_000_000, 95_000_000), day(17), salesParties[Math.floor(random() * salesParties.length)], 'Phí tư vấn và triển khai', 'bank');
      add('income', 'Đầu tư', amounts(1_800_000, 6_200_000), day(28), 'Ngân hàng TMCP', 'Lãi tiền gửi', 'bank');
      if (random() > 0.55) {
        add('income', 'Thu khác', amounts(1_500_000, 9_000_000), day(14), 'Nội bộ', 'Hoàn ứng công tác', 'cash');
      }
    }
    return { inserted };
  }

  getTransactionById(id: number): Transaction | undefined {
    return this.getTransaction(id);
  }

  getTransactionSnapshot(id: number): Record<string, unknown> | null {
    return this.txSnapshot(id);
  }

  private txSnapshot(id: number): Record<string, unknown> | null {
    const row = this.db.prepare('SELECT * FROM transactions WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    return row ?? null;
  }

  createAiSession(provider: string, model: string): AiSession {
    const id = randomUUID();
    this.db
      .prepare('INSERT INTO ai_sessions (id, provider, model) VALUES (?, ?, ?)')
      .run(id, provider, model);
    return this.getAiSession(id)!;
  }

  getAiSession(id: string): AiSession | undefined {
    return this.db
      .prepare(
        `SELECT id, title, provider, model, created_at AS createdAt, updated_at AS updatedAt
         FROM ai_sessions WHERE id = ?`,
      )
      .get(id) as unknown as AiSession | undefined;
  }

  listAiSessions(): AiSessionSummary[] {
    return this.db
      .prepare(
        `SELECT s.id, s.title, s.provider, s.model, s.created_at AS createdAt, s.updated_at AS updatedAt,
                (SELECT COUNT(*) FROM ai_messages m WHERE m.session_id = s.id) AS messageCount,
                (SELECT COUNT(*) FROM ai_changes c WHERE c.session_id = s.id) AS changeCount
         FROM ai_sessions s ORDER BY s.updated_at DESC, s.created_at DESC LIMIT 50`,
      )
      .all() as unknown as AiSessionSummary[];
  }

  listAiMessages(sessionId: string): AiMessage[] {
    const messages = this.db
      .prepare(
        `SELECT id, session_id AS sessionId, role, content, created_at AS createdAt
         FROM ai_messages WHERE session_id = ? ORDER BY id ASC`,
      )
      .all(sessionId) as unknown as Omit<AiMessage, 'changes'>[];
    const changes = this.listAiChanges(sessionId);
    const byMessage = new Map<number, AiChange[]>();
    for (const change of changes) {
      if (change.messageId === null) continue;
      const list = byMessage.get(change.messageId) ?? [];
      list.push(change);
      byMessage.set(change.messageId, list);
    }
    return messages.map((message) => ({ ...message, changes: byMessage.get(message.id) ?? [] }));
  }

  appendAiMessage(sessionId: string, role: 'user' | 'assistant', content: string): AiMessage {
    const result = this.db
      .prepare('INSERT INTO ai_messages (session_id, role, content) VALUES (?, ?, ?)')
      .run(sessionId, role, content);
    const id = Number(result.lastInsertRowid);
    this.touchAiSession(sessionId);
    if (role === 'user') {
      const session = this.getAiSession(sessionId);
      if (session && !session.title.trim()) {
        const title = content.replace(/\s+/g, ' ').trim().slice(0, 60);
        this.db.prepare('UPDATE ai_sessions SET title = ? WHERE id = ?').run(title, sessionId);
      }
    }
    return {
      id,
      sessionId,
      role,
      content,
      createdAt:
        (this.db.prepare('SELECT created_at AS createdAt FROM ai_messages WHERE id = ?').get(id) as {
          createdAt: string;
        }).createdAt,
      changes: [],
    };
  }

  updateAiMessageContent(id: number, sessionId: string, content: string): void {
    this.db.prepare('UPDATE ai_messages SET content = ? WHERE id = ?').run(content, id);
    this.touchAiSession(sessionId);
  }

  private touchAiSession(sessionId: string): void {
    this.db.prepare("UPDATE ai_sessions SET updated_at = datetime('now') WHERE id = ?").run(sessionId);
  }

  createAiChange(draft: AiChangeDraft): AiChange {
    const result = this.db
      .prepare(
        `INSERT INTO ai_changes
           (session_id, message_id, operation, target_id, summary, diff_json, payload_json,
            before_json, after_json, base_updated_at, attachment_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        draft.sessionId,
        draft.messageId,
        draft.operation,
        draft.targetId,
        draft.summary,
        JSON.stringify(draft.diff),
        JSON.stringify(draft.payload ?? {}),
        JSON.stringify(draft.before ?? null),
        JSON.stringify(draft.after ?? null),
        draft.baseUpdatedAt,
        draft.attachmentCount,
      );
    this.touchAiSession(draft.sessionId);
    return this.getAiChange(Number(result.lastInsertRowid))!;
  }

  listAiChanges(sessionId: string): AiChange[] {
    const rows = this.db
      .prepare(`${AI_CHANGE_SELECT} WHERE session_id = ? ORDER BY id ASC`)
      .all(sessionId) as unknown as RawAiChangeRow[];
    return rows.map((row) => this.toAiChange(row));
  }

  getAiChange(id: number): AiChange | undefined {
    const row = this.db.prepare(`${AI_CHANGE_SELECT} WHERE id = ?`).get(id) as unknown as
      | RawAiChangeRow
      | undefined;
    return row ? this.toAiChange(row) : undefined;
  }

  private getAiChangeFull(id: number): RawAiChangeFull | undefined {
    return this.db
      .prepare(
        `SELECT id, session_id AS sessionId, message_id AS messageId, operation, target_id AS targetId,
                summary, diff_json AS diffJson, payload_json AS payloadJson, before_json AS beforeJson,
                after_json AS afterJson, base_updated_at AS baseUpdatedAt, status,
                attachment_count AS attachmentCount, created_at AS createdAt,
                applied_at AS appliedAt, reverted_at AS revertedAt
         FROM ai_changes WHERE id = ?`,
      )
      .get(id) as unknown as RawAiChangeFull | undefined;
  }

  private toAiChange(row: RawAiChangeRow): AiChange {
    let diff: AiFieldDiff[] = [];
    try {
      const parsed = JSON.parse(row.diffJson) as unknown;
      if (Array.isArray(parsed)) {
        diff = parsed.filter(
          (item): item is AiFieldDiff =>
            Boolean(item) &&
            typeof item === 'object' &&
            typeof (item as AiFieldDiff).label === 'string' &&
            typeof (item as AiFieldDiff).before === 'string' &&
            typeof (item as AiFieldDiff).after === 'string',
        );
      }
    } catch {
      diff = [];
    }
    return {
      id: row.id,
      sessionId: row.sessionId,
      messageId: row.messageId,
      operation: row.operation as AiOperation,
      targetId: row.targetId,
      summary: row.summary,
      diff,
      status: row.status as AiChangeStatus,
      attachmentCount: row.attachmentCount,
      createdAt: row.createdAt,
      appliedAt: row.appliedAt,
      revertedAt: row.revertedAt,
    };
  }

  approveAiChange(id: number): AiChange {
    const change = this.getAiChangeFull(id);
    if (!change) throw new Error('Không tìm thấy đề xuất của trợ lý.');
    if (change.status !== 'pending') throw new Error('Đề xuất này đã được xử lý.');
    const payload = parseAiJson(change.payloadJson) ?? {};
    this.db.exec('BEGIN IMMEDIATE');
    try {
      let targetId = change.targetId;
      let before: Record<string, unknown> | null = null;
      let after: Record<string, unknown> | null = null;
      let attachmentCount = 0;

      if (change.operation === 'create_transaction') {
        const input = validateTxInput(payload);
        const created = this.createTransaction(input);
        targetId = created.id;
        after = this.txSnapshot(created.id);
      } else if (change.operation === 'update_transaction') {
        const record = payload as { id?: unknown; input?: unknown };
        const currentId = validateAiTarget(record.id);
        const current = this.txSnapshot(currentId);
        if (!current) throw new Error('Không tìm thấy giao dịch cần sửa.');
        const base = parseAiJson(change.beforeJson) as Record<string, unknown> | null;
        if (!sameTxSnapshot(current, base)) {
          throw new Error('Giao dịch đã thay đổi sau khi trợ lý đề xuất. Hãy yêu cầu trợ lý làm lại.');
        }
        const input = validateTxInput(record.input);
        before = current;
        this.updateTransaction(currentId, input);
        after = this.txSnapshot(currentId);
        targetId = currentId;
      } else if (change.operation === 'delete_transaction') {
        const record = payload as { id?: unknown };
        const currentId = validateAiTarget(record.id);
        const current = this.txSnapshot(currentId);
        if (!current) throw new Error('Không tìm thấy giao dịch cần xoá.');
        const base = parseAiJson(change.beforeJson) as Record<string, unknown> | null;
        if (!sameTxSnapshot(current, base)) {
          throw new Error('Giao dịch đã thay đổi sau khi trợ lý đề xuất. Hãy yêu cầu trợ lý làm lại.');
        }
        before = current;
        const attachments = this.db
          .prepare('SELECT * FROM attachments WHERE transaction_id = ?')
          .all(currentId) as unknown as {
          id: number;
          file_name: string;
          mime_type: string;
          size: number;
          data: Uint8Array;
        }[];
        attachmentCount = attachments.length;
        for (const attachment of attachments) {
          this.db
            .prepare(
              `INSERT INTO ai_backup_attachments
                 (change_id, attachment_id, file_name, mime_type, size, data)
               VALUES (?, ?, ?, ?, ?, ?)`,
            )
            .run(id, attachment.id, attachment.file_name, attachment.mime_type, attachment.size, attachment.data);
        }
        this.removeTransaction(currentId);
        after = null;
        targetId = currentId;
      } else if (change.operation === 'pay_debt') {
        const record = payload as { id?: unknown; amount?: unknown };
        const currentId = validateAiTarget(record.id);
        const amount = validatePaymentAmount(record.amount);
        const current = this.txSnapshot(currentId);
        if (!current) throw new Error('Không tìm thấy giao dịch công nợ.');
        const base = parseAiJson(change.beforeJson) as Record<string, unknown> | null;
        if (!sameTxSnapshot(current, base)) {
          throw new Error('Giao dịch đã thay đổi sau khi trợ lý đề xuất. Hãy yêu cầu trợ lý làm lại.');
        }
        before = current;
        this.payDebt(currentId, amount);
        after = this.txSnapshot(currentId);
        targetId = currentId;
      } else {
        throw new Error('Thao tác của trợ lý không hợp lệ.');
      }

      this.db
        .prepare(
          `UPDATE ai_changes
             SET status = 'approved', target_id = ?, before_json = ?, after_json = ?,
                 attachment_count = ?, applied_at = datetime('now')
           WHERE id = ?`,
        )
        .run(
          targetId,
          JSON.stringify(before),
          after ? JSON.stringify(after) : '',
          attachmentCount,
          id,
        );
      this.touchAiSession(change.sessionId);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.getAiChange(id)!;
  }

  rejectAiChange(id: number): AiChange {
    const result = this.db
      .prepare("UPDATE ai_changes SET status = 'rejected' WHERE id = ? AND status = 'pending'")
      .run(id);
    if (Number(result.changes) === 0) throw new Error('Đề xuất không còn ở trạng thái chờ duyệt.');
    const change = this.getAiChange(id)!;
    this.touchAiSession(change.sessionId);
    return change;
  }

  revertAiChange(id: number): AiChange {
    const change = this.getAiChangeFull(id);
    if (!change) throw new Error('Không tìm thấy thay đổi của trợ lý.');
    if (change.status !== 'approved' || change.revertedAt) {
      throw new Error('Chỉ có thể hoàn tác thay đổi đã áp dụng và chưa hoàn tác.');
    }
    const before = parseAiJson(change.beforeJson) as Record<string, unknown> | null;
    const after = parseAiJson(change.afterJson) as Record<string, unknown> | null;

    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (change.operation === 'create_transaction') {
        const currentId = change.targetId;
        if (!currentId) throw new Error('Thiếu giao dịch cần hoàn tác.');
        const current = this.txSnapshot(currentId);
        if (!current) throw new Error('Giao dịch đã bị xoá trước đó.');
        if (!sameTxSnapshot(current, after)) {
          throw new Error('Giao dịch đã thay đổi sau khi trợ lý tạo. Không thể hoàn tác an toàn.');
        }
        const attachments = this.db
          .prepare('SELECT COUNT(*) AS count FROM attachments WHERE transaction_id = ?')
          .get(currentId) as { count: number };
        if (attachments.count > 0) {
          throw new Error('Giao dịch đã có chứng từ đính kèm. Hãy xoá chứng từ trước khi hoàn tác.');
        }
        this.removeTransaction(currentId);
      } else if (change.operation === 'update_transaction') {
        const currentId = change.targetId;
        if (!currentId) throw new Error('Thiếu giao dịch cần hoàn tác.');
        const current = this.txSnapshot(currentId);
        if (!current) throw new Error('Giao dịch đã bị xoá trước đó.');
        if (!sameTxSnapshot(current, after)) {
          throw new Error('Giao dịch đã thay đổi sau khi trợ lý sửa. Không thể hoàn tác an toàn.');
        }
        this.restoreTransaction(currentId, before);
      } else if (change.operation === 'delete_transaction') {
        if (!before) throw new Error('Thiếu bản sao giao dịch đã xoá.');
        const currentId = change.targetId;
        if (!currentId) throw new Error('Thiếu giao dịch cần khôi phục.');
        if (this.txSnapshot(currentId)) throw new Error('Một giao dịch cùng mã đã tồn tại.');
        this.insertTransactionSnapshot(before);
        const attachments = this.db
          .prepare(
            `SELECT attachment_id AS attachmentId, file_name AS fileName, mime_type AS mimeType,
                    size, data
             FROM ai_backup_attachments WHERE change_id = ? ORDER BY id ASC`,
          )
          .all(id) as unknown as {
          attachmentId: number;
          fileName: string;
          mimeType: string;
          size: number;
          data: Uint8Array;
        }[];
        for (const attachment of attachments) {
          const exists = this.db
            .prepare('SELECT 1 FROM attachments WHERE id = ?')
            .get(attachment.attachmentId);
          if (exists) {
            this.db
              .prepare(
                'INSERT INTO attachments (transaction_id, file_name, mime_type, size, data) VALUES (?, ?, ?, ?, ?)',
              )
              .run(currentId, attachment.fileName, attachment.mimeType, attachment.size, attachment.data);
          } else {
            this.db
              .prepare(
                'INSERT INTO attachments (id, transaction_id, file_name, mime_type, size, data) VALUES (?, ?, ?, ?, ?, ?)',
              )
              .run(
                attachment.attachmentId,
                currentId,
                attachment.fileName,
                attachment.mimeType,
                attachment.size,
                attachment.data,
              );
          }
        }
      } else if (change.operation === 'pay_debt') {
        const currentId = change.targetId;
        if (!currentId) throw new Error('Thiếu giao dịch công nợ.');
        const current = this.txSnapshot(currentId);
        if (!current) throw new Error('Giao dịch đã bị xoá trước đó.');
        if (!sameTxSnapshot(current, after)) {
          throw new Error('Giao dịch đã thay đổi sau khi ghi thanh toán. Không thể hoàn tác an toàn.');
        }
        this.db
          .prepare(
            "UPDATE transactions SET paid_amount = ?, updated_at = datetime('now') WHERE id = ?",
          )
          .run(Number(before?.paid_amount ?? 0), currentId);
      } else {
        throw new Error('Thao tác của trợ lý không hợp lệ.');
      }

      this.db
        .prepare("UPDATE ai_changes SET status = 'reverted', reverted_at = datetime('now') WHERE id = ?")
        .run(id);
      this.touchAiSession(change.sessionId);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.getAiChange(id)!;
  }

  revertAiSession(sessionId: string): AiRevertResult {
    const rows = this.db
      .prepare(
        `SELECT id FROM ai_changes
         WHERE session_id = ? AND status = 'approved' AND reverted_at IS NULL
         ORDER BY id DESC`,
      )
      .all(sessionId) as unknown as { id: number }[];
    let reverted = 0;
    for (const row of rows) {
      try {
        this.revertAiChange(row.id);
        reverted += 1;
      } catch (error) {
        return {
          reverted,
          conflictId: row.id,
          message: error instanceof Error ? error.message : 'Không thể hoàn tác thay đổi.',
        };
      }
    }
    return {
      reverted,
      message: reverted > 0 ? `Đã hoàn tác ${reverted} thay đổi.` : 'Không có thay đổi nào để hoàn tác.',
    };
  }

  private restoreTransaction(id: number, snapshot: Record<string, unknown> | null): void {
    if (!snapshot) throw new Error('Thiếu bản sao giao dịch.');
    const row = snapshot as Record<string, string | number | null>;
    this.ensureCategoryMatches(Number(row.category_id), String(row.kind) as TxKind);
    this.db
      .prepare(
        `UPDATE transactions SET
           kind = ?, amount = ?, occurred_on = ?, category_id = ?, party = ?, note = ?, method = ?,
           reference = ?, port = ?, goods_name = ?, goods_type = ?, container_no = ?,
           container_size = ?, carrier = ?, warehouse_address = ?, service_revenue = ?, details_json = ?, source_key = ?, due_date = ?,
           paid_amount = ?, currency = ?, original_amount = ?, exchange_rate = ?,
           import_batch_id = ?, created_at = ?, updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(
        row.kind,
        row.amount,
        row.occurred_on,
        row.category_id,
        row.party,
        row.note,
        row.method,
        row.reference,
        row.port,
        row.goods_name,
        row.goods_type,
        row.container_no,
        row.container_size,
        row.carrier,
        row.warehouse_address ?? '',
        row.service_revenue ?? 0,
        row.details_json,
        row.source_key ?? null,
        row.due_date,
        row.paid_amount,
        row.currency,
        row.original_amount,
        row.exchange_rate,
        row.import_batch_id ?? null,
        row.created_at,
        id,
      );
  }

  private insertTransactionSnapshot(snapshot: Record<string, unknown>): void {
    const row = snapshot as Record<string, string | number | null>;
    this.ensureCategoryMatches(Number(row.category_id), String(row.kind) as TxKind);
    const columns = [
      'id',
      'kind',
      'amount',
      'occurred_on',
      'category_id',
      'party',
      'note',
      'method',
      'reference',
      'port',
      'goods_name',
      'goods_type',
      'container_no',
      'container_size',
      'carrier',
      'warehouse_address',
      'service_revenue',
      'customer_far',
      'other_income',
      'customer_lift',
      'customer_lower',
      'customer_fees_json',
      'details_json',
      'source_key',
      'due_date',
      'paid_amount',
      'currency',
      'original_amount',
      'exchange_rate',
      'import_batch_id',
      'created_at',
      'updated_at',
    ];
    this.db
      .prepare(
        `INSERT INTO transactions (${columns.join(', ')})
         VALUES (${columns.map(() => '?').join(', ')})`,
      )
      .run(
        ...columns.map(
          (column) =>
            row[column] ??
            (column === 'customer_fees_json'
              ? '[]'
              : [
                  'service_revenue',
                  'customer_far',
                  'other_income',
                  'customer_lift',
                  'customer_lower',
                ].includes(column)
                ? 0
                : null),
        ),
      );
  }

  resetAll(): void {
    this.db.exec('DELETE FROM transactions;');
  }

  async backupTo(target: string): Promise<void> {
    if (path.resolve(target) === path.resolve(this.dbPath)) {
      throw new Error('Không thể sao lưu đè lên tệp đang mở.');
    }
    await sqliteBackup(this.db, target);
  }

  async restoreFrom(file: string): Promise<void> {
    if (path.resolve(file) === path.resolve(this.dbPath)) {
      throw new Error('Tệp được chọn chính là cơ sở dữ liệu đang mở.');
    }
    if (!fs.existsSync(file)) throw new Error('Không tìm thấy tệp sao lưu.');

    const check = new DatabaseSync(file, { readOnly: true });
    try {
      const tables = check.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as unknown as {
        name: string;
      }[];
      const names = new Set(tables.map((table) => table.name));
      if (!names.has('transactions') || !names.has('categories')) {
        throw new Error('Tệp này không phải bản sao lưu Evergrow Books.');
      }
    } finally {
      check.close();
    }

    const safety = `${this.dbPath}.before-restore`;
    this.close();
    try {
      fs.copyFileSync(this.dbPath, safety);
      fs.copyFileSync(file, this.dbPath);
      for (const suffix of ['-wal', '-shm']) {
        const sidecar = `${this.dbPath}${suffix}`;
        if (fs.existsSync(sidecar)) fs.rmSync(sidecar);
      }
    } finally {
      this.db = this.open();
    }
  }

}

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}
