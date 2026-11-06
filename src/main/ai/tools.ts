import { CURRENCIES, METHODS, type ShipmentFilter, type Transaction } from '../../shared/types';
import type { Store } from '../db';
import {
  validateFilter,
  validateId,
  validateMonth,
  validateRange,
  validateReference,
} from '../validation';
import type { AiToolDefinition } from './providers';

const TX_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['income', 'expense'] },
    amount: { type: 'number', description: 'Số tiền VND, số nguyên dương.' },
    occurredOn: { type: 'string', description: 'Ngày giao dịch YYYY-MM-DD.' },
    categoryId: { type: 'number', description: 'ID danh mục lấy từ list_categories.' },
    party: { type: 'string' },
    note: { type: 'string' },
    method: { type: 'string', enum: [...METHODS] },
    reference: { type: 'string', description: 'Số tờ khai.' },
    port: { type: 'string' },
    goodsName: { type: 'string' },
    goodsType: { type: 'string' },
    containerNo: { type: 'string' },
    containerSize: { type: 'string' },
    carrier: { type: 'string' },
    warehouseAddress: { type: 'string' },
    details: { type: 'object', additionalProperties: { type: 'number' } },
    dueDate: { type: 'string', description: 'Hạn thanh toán YYYY-MM-DD, rỗng nếu không theo dõi.' },
    paidAmount: { type: 'number' },
    currency: { type: 'string', enum: [...CURRENCIES] },
    originalAmount: { type: 'number' },
    exchangeRate: { type: 'number' },
  },
  required: ['kind', 'amount', 'occurredOn', 'categoryId', 'method'],
  additionalProperties: false,
};

export const AI_TOOLS: AiToolDefinition[] = [
  {
    name: 'search_transactions',
    description:
      'Tìm giao dịch trong sổ. Dùng để lấy ID, số tiền, ngày, đối tác, phí, container. Tối đa 50 dòng.',
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Từ ngày YYYY-MM-DD.' },
        to: { type: 'string', description: 'Đến ngày YYYY-MM-DD.' },
        kind: { type: 'string', enum: ['income', 'expense', 'all'] },
        categoryId: { type: 'number' },
        q: { type: 'string', description: 'Từ khoá đối tác, tờ khai, container…' },
        limit: { type: 'number' },
        offset: { type: 'number' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_transaction',
    description: 'Lấy đầy đủ một giao dịch theo ID, gồm các khoản phí và công nợ.',
    parameters: {
      type: 'object',
      properties: { id: { type: 'number' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_categories',
    description: 'Liệt kê danh mục thu/chi hiện có. Luôn dùng trước khi tạo hoặc sửa giao dịch.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_shipments',
    description: 'Liệt kê lô hàng gộp theo số tờ khai, kèm thu/chi/lợi nhuận.',
    parameters: {
      type: 'object',
      properties: { from: { type: 'string' }, to: { type: 'string' }, q: { type: 'string' } },
      additionalProperties: false,
    },
  },
  {
    name: 'get_shipment',
    description: 'Lấy chi tiết một lô hàng theo số tờ khai, gồm các giao dịch bên trong.',
    parameters: {
      type: 'object',
      properties: { reference: { type: 'string' } },
      required: ['reference'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_debts',
    description: 'Liệt kê công nợ phải thu/phải trả và số còn nợ.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_budgets',
    description: 'Xem ngân sách theo tháng (chỉ đọc).',
    parameters: {
      type: 'object',
      properties: { month: { type: 'string', description: 'YYYY-MM' } },
      required: ['month'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_report',
    description: 'Tổng hợp thu chi theo khoảng ngày: tổng, theo danh mục, theo tháng.',
    parameters: {
      type: 'object',
      properties: { from: { type: 'string' }, to: { type: 'string' } },
      required: ['from', 'to'],
      additionalProperties: false,
    },
  },
  {
    name: 'propose_create_transaction',
    description:
      'Tạo đề xuất thêm giao dịch. Chỉ tạo đề xuất, chưa ghi vào sổ; người dùng phải duyệt.',
    parameters: {
      type: 'object',
      properties: { input: TX_INPUT_SCHEMA },
      required: ['input'],
      additionalProperties: false,
    },
  },
  {
    name: 'propose_update_transaction',
    description:
      'Tạo đề xuất sửa giao dịch. Phải gọi get_transaction trước và gửi lại toàn bộ input. Người dùng phải duyệt.',
    parameters: {
      type: 'object',
      properties: { id: { type: 'number' }, input: TX_INPUT_SCHEMA },
      required: ['id', 'input'],
      additionalProperties: false,
    },
  },
  {
    name: 'propose_delete_transaction',
    description: 'Tạo đề xuất xoá giao dịch (có backup để hoàn tác). Người dùng phải duyệt.',
    parameters: {
      type: 'object',
      properties: { id: { type: 'number' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'propose_pay_debt',
    description: 'Tạo đề xuất ghi nhận thanh toán công nợ cho một giao dịch. Người dùng phải duyệt.',
    parameters: {
      type: 'object',
      properties: { id: { type: 'number' }, amount: { type: 'number' } },
      required: ['id', 'amount'],
      additionalProperties: false,
    },
  },
];

const READ_TOOLS = new Set([
  'search_transactions',
  'get_transaction',
  'list_categories',
  'list_shipments',
  'get_shipment',
  'list_debts',
  'get_budgets',
  'get_report',
]);

const WRITE_TOOLS = new Set([
  'propose_create_transaction',
  'propose_update_transaction',
  'propose_delete_transaction',
  'propose_pay_debt',
]);

export function isReadTool(name: string): boolean {
  return READ_TOOLS.has(name);
}

export function isWriteTool(name: string): boolean {
  return WRITE_TOOLS.has(name);
}

function compactTransaction(transaction: Transaction): Record<string, unknown> {
  return {
    id: transaction.id,
    date: transaction.occurredOn,
    kind: transaction.kind,
    amount: transaction.amount,
    categoryId: transaction.categoryId,
    category: transaction.categoryName,
    party: transaction.party,
    note: transaction.note,
    method: transaction.method,
    reference: transaction.reference,
    port: transaction.port,
    goodsName: transaction.goodsName,
    goodsType: transaction.goodsType,
    containerNo: transaction.containerNo,
    containerSize: transaction.containerSize,
    carrier: transaction.carrier,
    warehouseAddress: transaction.warehouseAddress,
    details: transaction.details,
    dueDate: transaction.dueDate,
    paidAmount: transaction.paidAmount,
    currency: transaction.currency,
    originalAmount: transaction.originalAmount,
    exchangeRate: transaction.exchangeRate,
    attachmentCount: transaction.attachmentCount,
    updatedAt: transaction.updatedAt,
  };
}

function argsRecord(args: unknown): Record<string, unknown> {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return {};
  return args as Record<string, unknown>;
}

export function executeReadTool(store: Store, name: string, rawArgs: unknown): unknown {
  const args = argsRecord(rawArgs);
  switch (name) {
    case 'search_transactions': {
      const filter = validateFilter(args);
      filter.limit = Math.min(filter.limit ?? 20, 50);
      const page = store.listTransactions(filter);
      return {
        total: page.total,
        income: page.income,
        expense: page.expense,
        items: page.items.map(compactTransaction),
      };
    }
    case 'get_transaction': {
      const id = validateId(args.id, 'Giao dịch');
      const transaction = store.getTransactionById(id);
      if (!transaction) throw new Error('Không tìm thấy giao dịch.');
      return compactTransaction(transaction);
    }
    case 'list_categories':
      return store.listCategories().map((category) => ({
        id: category.id,
        name: category.name,
        kind: category.kind,
        color: category.color,
      }));
    case 'list_shipments': {
      const filter = validateFilter({ from: args.from, to: args.to, q: args.q });
      const shipments: ShipmentFilter = { from: filter.from, to: filter.to, q: filter.q };
      return store.listShipments(shipments).slice(0, 50);
    }
    case 'get_shipment': {
      const reference = validateReference(args.reference);
      const detail = store.getShipment(reference);
      return {
        summary: detail.summary,
        transactions: detail.transactions.slice(0, 100).map(compactTransaction),
      };
    }
    case 'list_debts': {
      const debts = store.listDebts();
      return {
        receivable: debts.receivable,
        payable: debts.payable,
        overdueReceivable: debts.overdueReceivable,
        overduePayable: debts.overduePayable,
        tracked: debts.tracked,
        overdueCount: debts.overdueCount,
        items: debts.items.slice(0, 80).map((item) => ({
          ...compactTransaction(item.transaction),
          outstanding: item.outstanding,
          status: item.status,
          daysOverdue: item.daysOverdue,
        })),
      };
    }
    case 'get_budgets':
      return store.getBudgets(validateMonth(args.month));
    case 'get_report': {
      const range = validateRange(args);
      const report = store.report(range.from, range.to);
      return {
        from: report.from,
        to: report.to,
        income: report.income,
        expense: report.expense,
        net: report.net,
        count: report.count,
        byCategory: report.byCategory,
        byMonth: report.byMonth,
      };
    }
    default:
      throw new Error(`Tool không hỗ trợ: ${name}`);
  }
}
