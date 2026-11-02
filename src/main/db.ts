import { DatabaseSync, backup as sqliteBackup } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { monthBounds, pad, shiftMonth, todayIso } from '../shared/dates';
import { DEFAULT_THEME, getThemePreset, type ThemeSettings } from '../shared/theme';
import type {
  Category,
  CategoryInput,
  CategoryTotal,
  CompanySettings,
  DashboardData,
  DataStats,
  ImportResult,
  Method,
  MonthPoint,
  ReportData,
  SeedResult,
  Transaction,
  TxFilter,
  TxInput,
  TxKind,
  TxPage,
} from '../shared/types';

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
  detailsJson: string;
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
  details: Record<string, number>;
  sourceKey: string;
}

const TX_SELECT = `
  SELECT t.id, t.kind, t.amount, t.occurred_on AS occurredOn,
         t.category_id AS categoryId, c.name AS categoryName, c.color AS categoryColor,
         t.party, t.note, t.method, t.reference, t.port,
         t.goods_name AS goodsName, t.goods_type AS goodsType,
         t.container_no AS containerNo, t.container_size AS containerSize,
         t.carrier, t.details_json AS detailsJson,
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
        details_json TEXT NOT NULL DEFAULT '{}',
        source_key TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_tx_occurred ON transactions(occurred_on);
      CREATE INDEX IF NOT EXISTS idx_tx_kind ON transactions(kind);
      CREATE INDEX IF NOT EXISTS idx_tx_category ON transactions(category_id);

      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    this.migrateLegacySchema(db);
    const count = db.prepare('SELECT COUNT(*) AS count FROM categories').get() as { count: number };
    if (count.count === 0) {
      const insert = db.prepare('INSERT INTO categories (name, kind, color) VALUES (?, ?, ?)');
      for (const category of SEED_CATEGORIES) insert.run(category.name, category.kind, category.color);
    }
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
      ['details_json', "details_json TEXT NOT NULL DEFAULT '{}'"],
      ['source_key', 'source_key TEXT'],
    ];
    for (const [name, definition] of additions) {
      if (!columns.has(name)) db.exec(`ALTER TABLE transactions ADD COLUMN ${definition}`);
    }
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_tx_source_key
        ON transactions(source_key) WHERE source_key IS NOT NULL;
      PRAGMA user_version = 3;
    `);
  }

  close(): void {
    this.db.close();
  }

  getDatabasePath(): string {
    return this.dbPath;
  }

  private toTransaction(row: unknown): Transaction {
    const { detailsJson, ...rest } = row as RawTxRow;
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
    return { ...rest, details };
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
                COALESCE(SUM(CASE WHEN t.kind = 'income' THEN t.amount ELSE 0 END), 0) AS income,
                COALESCE(SUM(CASE WHEN t.kind = 'expense' THEN t.amount ELSE 0 END), 0) AS expense
         FROM transactions t ${clause}`,
      )
      .get(...params) as { total: number; income: number; expense: number };
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
            reference, port, goods_name, goods_type, container_no, container_size, carrier, details_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        JSON.stringify(input.details),
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
             container_size = ?, carrier = ?, details_json = ?, updated_at = datetime('now')
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
        JSON.stringify(input.details),
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

  importRows(rows: ImportTransactionRow[]): ImportResult {
    const findCategory = this.db.prepare(
      'SELECT id FROM categories WHERE kind = ? AND name = ? COLLATE NOCASE',
    );
    const insertCategory = this.db.prepare('INSERT INTO categories (name, kind, color) VALUES (?, ?, ?)');
    const findSource = this.db.prepare('SELECT 1 FROM transactions WHERE source_key = ?');
    const insert = this.db.prepare(
      `INSERT INTO transactions
         (kind, amount, occurred_on, category_id, party, note, method,
          reference, port, goods_name, goods_type, container_no, container_size, carrier, details_json, source_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    let income = 0;
    let expense = 0;
    let inserted = 0;
    let duplicates = 0;
    let skipped = 0;
    let categoriesCreated = 0;
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
          JSON.stringify(row.details),
          row.sourceKey || null,
        );
        inserted += 1;
        if (row.kind === 'income') income += row.amount;
        else expense += row.amount;
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return { income, expense, inserted, duplicates, skipped, categoriesCreated };
  }

  private summary(from: string, to: string): { income: number; expense: number; count: number } {
    return this.db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN kind = 'income' THEN amount ELSE 0 END), 0) AS income,
                COALESCE(SUM(CASE WHEN kind = 'expense' THEN amount ELSE 0 END), 0) AS expense,
                COUNT(*) AS count
         FROM transactions WHERE occurred_on BETWEEN ? AND ?`,
      )
      .get(from, to) as { income: number; expense: number; count: number };
  }

  private monthlySeries(fromMonth: string, toMonth: string): MonthPoint[] {
    const months: string[] = [];
    let cursor = fromMonth;
    while (cursor <= toMonth && months.length < 240) {
      months.push(cursor);
      cursor = shiftMonth(cursor, 1);
    }
    const { from } = monthBounds(fromMonth);
    const { to } = monthBounds(toMonth);
    const rows = this.db
      .prepare(
        `SELECT substr(occurred_on, 1, 7) AS month, kind,
                COALESCE(SUM(amount), 0) AS total
         FROM transactions
         WHERE occurred_on BETWEEN ? AND ?
         GROUP BY month, kind`,
      )
      .all(from, to) as unknown as { month: string; kind: TxKind; total: number }[];
    const map = new Map(months.map((month) => [month, { month, income: 0, expense: 0 }]));
    for (const row of rows) {
      const point = map.get(row.month);
      if (!point) continue;
      if (row.kind === 'income') point.income = row.total;
      else point.expense = row.total;
    }
    return [...map.values()];
  }

  dashboard(month: string): DashboardData {
    const { from, to } = monthBounds(month);
    const current = this.summary(from, to);
    const prevMonth = shiftMonth(month, -1);
    const prevBounds = monthBounds(prevMonth);
    const prev = this.summary(prevBounds.from, prevBounds.to);
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
      net: current.income - current.expense,
      count: current.count,
      prevIncome: prev.income,
      prevExpense: prev.expense,
      series: this.monthlySeries(shiftMonth(month, -5), month),
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
      `INSERT INTO transactions (kind, amount, occurred_on, category_id, party, note, method)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
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
      insert.run(kind, amount, date, categoryId, party, note, method);
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
