import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ExternalLink, FileText, LoaderCircle, Paperclip, Plus, Trash } from 'lucide-react';
import type {
  AttachmentMeta,
  Category,
  Currency,
  Method,
  StagedAttachment,
  Transaction,
  TxInput,
} from '../../shared/types';
import { CURRENCIES, CURRENCY_LABELS, CURRENCY_SUFFIX, METHOD_LABELS } from '../../shared/types';
import { todayIso } from '../../shared/dates';
import { formatNumber, formatVnd, parseAmount } from '../../shared/format';
import { api, getErrorMessage } from '../api';
import { feeLabel, orderedDetailEntries } from './FeeBreakdown';
import { useToast } from './toast';
import { Checkbox, ComboBox, DateInput, Dropdown, Modal } from './ui';

const METHOD_OPTIONS = Object.entries(METHOD_LABELS) as [Method, string][];
const CURRENCY_OPTIONS = CURRENCIES.map((value) => ({ value, label: CURRENCY_LABELS[value] }));

const CONTAINER_UNIT_FEE = { '20': 6_300_000, '40': 7_300_000 } as const;
const VAT_RATE = 0.08;
type ContainerChoice = keyof typeof CONTAINER_UNIT_FEE;
type ExpenseCostKey = 'lift' | 'lower' | 'far' | 'bot' | 'customs' | 'discount' | 'other';

const EXPENSE_COST_LABELS: Record<ExpenseCostKey, string> = {
  lift: 'Phí nâng',
  lower: 'Phí hạ',
  far: 'Phụ thu hạ xa',
  bot: 'Phụ thu qua bot',
  customs: 'Phí hải quan',
  discount: 'Chiết khấu',
  other: 'Khác',
};

const EXPENSE_DETAIL_ALIASES: Record<ExpenseCostKey | 'service' | 'truck', string[]> = {
  service: ['phidichvu', 'dichvu'],
  truck: ['tienxe', 'thanhtoantienxe'],
  lift: ['phinang'],
  lower: ['phiha'],
  far: ['phuthuhaxa'],
  bot: ['phuthuquabot'],
  customs: ['phihaiquan', 'haiquan'],
  discount: ['chietkhau'],
  other: ['khac', 'tienkhac'],
};

const EXPENSE_DETAIL_NAMES: Record<ExpenseCostKey | 'service' | 'truck', string> = {
  service: 'Phí dịch vụ',
  truck: 'Tiền xe',
  lift: 'Phí nâng',
  lower: 'Phí hạ',
  far: 'Phụ thu hạ xa',
  bot: 'Phụ thu qua bot',
  customs: 'Phí hải quan',
  discount: 'Chiết khấu',
  other: 'Khác',
};

interface FeeRow {
  label: string;
  text: string;
}

interface DebtDraft {
  track: boolean;
  dueDate: string;
  paidAmount: number;
  paidText: string;
}

interface DeclarationDraft {
  party: string;
  reference: string;
  port: string;
  goodsName: string;
  goodsType: string;
  containerNo: string;
  containerChoice: ContainerChoice;
  containerCount: number;
  containerCountText: string;
  containerDirty: boolean;
}

interface ExpenseDraft {
  enabled: boolean;
  occurredOn: string;
  categoryId: number;
  method: Method;
  costs: Record<ExpenseCostKey, string>;
  amountDirty: boolean;
  carrier: string;
  warehouseAddress: string;
  note: string;
  costText: string;
  vatText: string;
  costDirty: boolean;
  vatDirty: boolean;
  debt: DebtDraft;
}

interface IncomeDraft {
  enabled: boolean;
  occurredOn: string;
  categoryId: number;
  method: Method;
  currency: Currency;
  amount: number;
  amountText: string;
  exchangeRate: number;
  rateText: string;
  note: string;
  containerSize: string;
  carrier: string;
  warehouseAddress: string;
  feeRows: FeeRow[];
  debt: DebtDraft;
}

type StepKey = 'declaration' | 'expense' | 'income';

function normalizeDetailLabel(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function detailValue(details: Record<string, number>, aliases: string[]): number {
  const entry = Object.entries(details).find(([label]) => aliases.includes(normalizeDetailLabel(label)));
  return entry ? entry[1] : 0;
}

function readExpenseCosts(details: Record<string, number>): Record<ExpenseCostKey, string> {
  return {
    lift: detailValue(details, EXPENSE_DETAIL_ALIASES.lift) ? formatNumber(detailValue(details, EXPENSE_DETAIL_ALIASES.lift)) : '',
    lower: detailValue(details, EXPENSE_DETAIL_ALIASES.lower) ? formatNumber(detailValue(details, EXPENSE_DETAIL_ALIASES.lower)) : '',
    far: detailValue(details, EXPENSE_DETAIL_ALIASES.far) ? formatNumber(detailValue(details, EXPENSE_DETAIL_ALIASES.far)) : '',
    bot: detailValue(details, EXPENSE_DETAIL_ALIASES.bot) ? formatNumber(detailValue(details, EXPENSE_DETAIL_ALIASES.bot)) : '',
    customs: detailValue(details, EXPENSE_DETAIL_ALIASES.customs) ? formatNumber(detailValue(details, EXPENSE_DETAIL_ALIASES.customs)) : '',
    discount: detailValue(details, EXPENSE_DETAIL_ALIASES.discount) ? formatNumber(detailValue(details, EXPENSE_DETAIL_ALIASES.discount)) : '',
    other: detailValue(details, EXPENSE_DETAIL_ALIASES.other) ? formatNumber(detailValue(details, EXPENSE_DETAIL_ALIASES.other)) : '',
  };
}

function buildExpenseDetails(
  base: Record<string, number>,
  values: Record<ExpenseCostKey | 'service' | 'truck', number>,
): Record<string, number> {
  const details: Record<string, number> = {};
  const aliases = new Set(Object.values(EXPENSE_DETAIL_ALIASES).flat());
  for (const [label, value] of Object.entries(base)) {
    if (!aliases.has(normalizeDetailLabel(label))) details[label] = value;
  }
  for (const key of Object.keys(EXPENSE_DETAIL_NAMES) as (ExpenseCostKey | 'service' | 'truck')[]) {
    const value = values[key];
    if (value > 0) details[EXPENSE_DETAIL_NAMES[key]] = Math.round(value);
  }
  return details;
}

function parseContainerInfo(text: string): { size: ContainerChoice | ''; count: number } {
  const matches = [...text.matchAll(/(20|40)\s*'?\s*(?:×|x|\*)\s*(\d+)/gi)];
  if (matches.length === 1) {
    return {
      size: matches[0][1] === '40' ? '40' : '20',
      count: Math.min(10, Math.max(1, Number(matches[0][2]) || 1)),
    };
  }
  if (/^20\s*'?$/i.test(text.trim())) return { size: '20', count: 1 };
  if (/^40\s*'?$/i.test(text.trim())) return { size: '40', count: 1 };
  return { size: '', count: 1 };
}

function emptyDebt(): DebtDraft {
  return { track: false, dueDate: '', paidAmount: 0, paidText: '' };
}

function initialDebt(transaction: Transaction | null, kind: 'expense' | 'income'): DebtDraft {
  if (transaction?.kind !== kind) return emptyDebt();
  return {
    track: Boolean(transaction.dueDate),
    dueDate: transaction.dueDate,
    paidAmount: transaction.dueDate ? transaction.paidAmount : 0,
    paidText: transaction.dueDate && transaction.paidAmount ? formatNumber(transaction.paidAmount) : '',
  };
}

function initialDeclaration(transaction: Transaction | null): DeclarationDraft {
  const container = parseContainerInfo(transaction?.containerSize ?? '');
  return {
    party: transaction?.party ?? '',
    reference: transaction?.reference ?? '',
    port: transaction?.port ?? '',
    goodsName: transaction?.goodsName ?? '',
    goodsType: transaction?.goodsType ?? '',
    containerNo: transaction?.containerNo ?? '',
    containerChoice: container.size || '20',
    containerCount: container.count,
    containerCountText: String(container.count),
    containerDirty: !transaction,
  };
}

function initialExpense(transaction: Transaction | null): ExpenseDraft {
  const isExpense = transaction?.kind === 'expense';
  const details = isExpense ? transaction.details : {};
  const storedService = detailValue(details, EXPENSE_DETAIL_ALIASES.service);
  const storedCost = storedService > 0 ? Math.round(storedService / (1 + VAT_RATE)) : 0;
  const storedVat = storedService > 0 ? storedService - storedCost : 0;
  return {
    enabled: transaction ? isExpense : true,
    occurredOn: isExpense ? transaction.occurredOn : todayIso(),
    categoryId: isExpense ? transaction.categoryId : 0,
    method: isExpense ? transaction.method : 'bank',
    costs: readExpenseCosts(details),
    amountDirty: !transaction,
    carrier: isExpense ? transaction.carrier : '',
    warehouseAddress: isExpense ? transaction.warehouseAddress : '',
    note: isExpense ? transaction.note : '',
    costText: storedService > 0 ? formatNumber(storedCost) : '',
    vatText: storedService > 0 ? formatNumber(storedVat) : '',
    costDirty: storedService > 0,
    vatDirty: storedService > 0,
    debt: initialDebt(transaction, 'expense'),
  };
}

function initialIncome(transaction: Transaction | null): IncomeDraft {
  const isIncome = transaction?.kind === 'income';
  const currency: Currency = isIncome ? transaction.currency : 'VND';
  const amount = isIncome ? (currency !== 'VND' ? transaction.originalAmount : transaction.amount) : 0;
  const exchangeRate = isIncome ? transaction.exchangeRate : 1;
  return {
    enabled: transaction ? isIncome : false,
    occurredOn: isIncome ? transaction.occurredOn : todayIso(),
    categoryId: isIncome ? transaction.categoryId : 0,
    method: isIncome ? transaction.method : 'bank',
    currency,
    amount,
    amountText: amount ? formatNumber(amount) : '',
    exchangeRate,
    rateText: String(exchangeRate),
    note: isIncome ? transaction.note : '',
    containerSize: isIncome ? transaction.containerSize : '',
    carrier: isIncome ? transaction.carrier : '',
    warehouseAddress: isIncome ? transaction.warehouseAddress : '',
    feeRows: orderedDetailEntries(isIncome ? transaction.details : {}).map(([label, value]) => ({
      label: feeLabel(label),
      text: value ? formatNumber(value) : '',
    })),
    debt: initialDebt(transaction, 'income'),
  };
}

function debtBlock(
  debt: DebtDraft,
  amountVnd: number,
  onChange: (next: DebtDraft) => void,
) {
  return (
    <div className="debt-block">
      <Checkbox
        checked={debt.track}
        onChange={(enabled) => onChange(enabled ? { ...emptyDebt(), track: true } : emptyDebt())}
        label="Theo dõi công nợ"
        description="Bật để nhập hạn thanh toán và số tiền đã trả."
      />
      {debt.track ? (
        <>
          <div className="form-row">
            <label className="field">
              <span className="field-label">Hạn thanh toán</span>
              <DateInput
                value={debt.dueDate}
                onChange={(event) => onChange({ ...debt, dueDate: event.target.value })}
                aria-label="Hạn thanh toán"
              />
            </label>
            <label className="field">
              <span className="field-label">Đã thanh toán (VND)</span>
              <span className="amount-wrap">
                <input
                  className="input"
                  inputMode="numeric"
                  value={debt.paidText}
                  placeholder="0"
                  onChange={(event) => {
                    const parsed = Math.min(parseAmount(event.target.value), amountVnd);
                    onChange({ ...debt, paidAmount: parsed, paidText: parsed > 0 ? formatNumber(parsed) : '' });
                  }}
                />
                <span className="amount-suffix">đ</span>
              </span>
            </label>
          </div>
          <div className="debt-summary">
            <span>Còn nợ</span>
            <strong className={amountVnd - debt.paidAmount > 0 ? 'expense' : ''}>
              {formatVnd(Math.max(0, amountVnd - debt.paidAmount))}
            </strong>
          </div>
        </>
      ) : (
        <p className="hint no-pad">Không theo dõi công nợ: giao dịch được xem là đã thanh toán đủ.</p>
      )}
    </div>
  );
}

export function TransactionModal({
  transaction,
  onClose,
  onSaved,
}: {
  transaction: Transaction | null;
  onClose: () => void;
  onSaved: (transaction: Transaction) => void;
}) {
  const toast = useToast();
  const [categories, setCategories] = useState<Category[]>([]);
  const [decl, setDecl] = useState<DeclarationDraft>(() => initialDeclaration(transaction));
  const [expense, setExpense] = useState<ExpenseDraft>(() => initialExpense(transaction));
  const [income, setIncome] = useState<IncomeDraft>(() => initialIncome(transaction));
  const [customers, setCustomers] = useState<string[]>([]);
  const [carriers, setCarriers] = useState<string[]>([]);
  const [goodsTypes, setGoodsTypes] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<AttachmentMeta[]>([]);
  const [pendingAttachments, setPendingAttachments] = useState<StagedAttachment[]>([]);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [showIncomeExtras, setShowIncomeExtras] = useState(
    Boolean(
      transaction?.reference ||
        transaction?.port ||
        transaction?.goodsName ||
        transaction?.goodsType ||
        transaction?.containerNo ||
        transaction?.containerSize ||
        transaction?.carrier ||
        transaction?.warehouseAddress,
    ),
  );
  const feeRowsRef = useRef<HTMLDivElement>(null);
  const focusNewFee = useRef(false);

  const steps = useMemo<{ key: StepKey; label: string; hint: string }[]>(() => {
    const declaration: { key: StepKey; label: string; hint: string } = {
      key: 'declaration',
      label: 'Thông tin tờ khai',
      hint: 'Thông tin lô hàng',
    };
    if (transaction) {
      return [
        declaration,
        transaction.kind === 'expense'
          ? { key: 'expense', label: 'Chi phí', hint: 'Các khoản chi của lô' }
          : { key: 'income', label: 'Thu nhập', hint: 'Doanh thu của lô' },
      ];
    }
    return [
      declaration,
      { key: 'expense', label: 'Chi phí', hint: 'Các khoản chi của lô' },
      { key: 'income', label: 'Thu nhập', hint: 'Doanh thu của lô' },
    ];
  }, [transaction]);
  const currentStep = steps[Math.min(stepIndex, steps.length - 1)];
  const lastStep = steps.length - 1;

  useEffect(() => {
    let alive = true;
    api.categories
      .list()
      .then((list) => {
        if (alive) setCategories(list);
      })
      .catch((err) => toast(getErrorMessage(err), 'error'));
    return () => {
      alive = false;
    };
  }, [toast]);

  useEffect(() => {
    let alive = true;
    Promise.all([
      api.lookups.list('customers'),
      api.lookups.list('carriers'),
      api.lookups.list('goods_types'),
    ])
      .then(([customerList, carrierList, goodsTypeList]) => {
        if (!alive) return;
        setCustomers(customerList);
        setCarriers(carrierList);
        setGoodsTypes(goodsTypeList);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!transaction) return;
    let alive = true;
    api.attachments
      .list(transaction.id)
      .then((list) => {
        if (alive) setAttachments(list);
      })
      .catch((err) => toast(getErrorMessage(err), 'error'));
    return () => {
      alive = false;
    };
  }, [transaction, toast]);

  const expenseOptions = useMemo(
    () => categories.filter((category) => category.kind === 'expense'),
    [categories],
  );
  const incomeOptions = useMemo(
    () => categories.filter((category) => category.kind === 'income'),
    [categories],
  );

  useEffect(() => {
    if (expenseOptions.length === 0) return;
    setExpense((current) =>
      current.categoryId && expenseOptions.some((category) => category.id === current.categoryId)
        ? current
        : { ...current, categoryId: expenseOptions[0].id },
    );
  }, [expenseOptions]);

  useEffect(() => {
    if (incomeOptions.length === 0) return;
    setIncome((current) =>
      current.categoryId && incomeOptions.some((category) => category.id === current.categoryId)
        ? current
        : { ...current, categoryId: incomeOptions[0].id },
    );
  }, [incomeOptions]);

  const autoCost = CONTAINER_UNIT_FEE[decl.containerChoice] * decl.containerCount;
  const costAmount = expense.costDirty ? parseAmount(expense.costText) : autoCost;
  const autoVat = Math.round(costAmount * VAT_RATE);
  const vatAmount = expense.vatDirty ? parseAmount(expense.vatText) : autoVat;
  const costDisplay = expense.costDirty ? expense.costText : formatNumber(autoCost);
  const vatDisplay = expense.vatDirty ? expense.vatText : formatNumber(autoVat);
  const serviceFee = costAmount + vatAmount;
  const costValue = (key: ExpenseCostKey) => parseAmount(expense.costs[key]);
  const truckFee = costValue('lift') + costValue('lower') + costValue('far') + costValue('bot');
  const remaining =
    serviceFee - (truckFee + costValue('customs') + costValue('discount') + costValue('other'));
  const computedExpenseAmount = Math.max(0, Math.round(remaining));
  const savedExpenseAmount = transaction?.kind === 'expense' ? transaction.amount : undefined;
  const expenseAmount =
    expense.amountDirty || savedExpenseAmount === undefined ? computedExpenseAmount : savedExpenseAmount;
  const incomeAmountVnd =
    income.currency === 'VND' ? income.amount : Math.round(income.amount * income.exchangeRate);

  const changeContainerChoice = (choice: ContainerChoice) => {
    setDecl((current) => ({ ...current, containerChoice: choice, containerDirty: true }));
    setExpense((current) => ({ ...current, amountDirty: true }));
  };

  const changeContainerCount = (raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, 2);
    const parsed = digits ? Number(digits) : 0;
    setDecl((current) => ({
      ...current,
      containerCountText: digits,
      containerCount: Math.min(10, Math.max(1, parsed || 1)),
      containerDirty: true,
    }));
    setExpense((current) => ({ ...current, amountDirty: true }));
  };

  const normalizeContainerCount = () => {
    setDecl((current) => ({ ...current, containerCountText: String(current.containerCount) }));
  };

  const updateExpenseCost = (key: ExpenseCostKey, raw: string) => {
    const parsed = parseAmount(raw);
    setExpense((current) => ({
      ...current,
      costs: {
        ...current.costs,
        [key]: parsed > 0 ? formatNumber(parsed) : '',
      },
      amountDirty: true,
    }));
  };

  const updateCost = (raw: string) => {
    const parsed = parseAmount(raw);
    setExpense((current) => ({
      ...current,
      costText: parsed > 0 ? formatNumber(parsed) : '',
      costDirty: true,
      amountDirty: true,
    }));
  };

  const updateVat = (raw: string) => {
    const parsed = parseAmount(raw);
    setExpense((current) => ({
      ...current,
      vatText: parsed > 0 ? formatNumber(parsed) : '',
      vatDirty: true,
      amountDirty: true,
    }));
  };

  const changeIncomeCurrency = (next: Currency) => {
    setIncome((current) => {
      if (next === current.currency) return current;
      if (next === 'VND') {
        const converted =
          current.currency === 'VND'
            ? current.amount
            : Math.round(current.amount * current.exchangeRate);
        return {
          ...current,
          currency: next,
          amount: converted,
          amountText: converted ? formatNumber(converted) : '',
          exchangeRate: 1,
          rateText: '1',
        };
      }
      return { ...current, currency: next, amount: 0, amountText: '', exchangeRate: 1, rateText: '1' };
    });
  };

  const addAttachment = async () => {
    setAttachmentBusy(true);
    try {
      if (transaction) {
        const added = await api.attachments.add(transaction.id);
        if (added) {
          setAttachments((current) => [...current, added]);
          toast('Đã thêm chứng từ.');
        }
      } else {
        const staged = await api.attachments.stage();
        if (staged) {
          setPendingAttachments((current) => [...current, staged]);
          toast('Đã chọn chứng từ. Tệp sẽ được lưu cùng giao dịch.');
        }
      }
    } catch (err) {
      toast(getErrorMessage(err), 'error');
    } finally {
      setAttachmentBusy(false);
    }
  };

  const removePendingAttachment = (token: string) => {
    setPendingAttachments((current) => current.filter((item) => item.token !== token));
  };

  const updateFeeRow = (index: number, patch: Partial<FeeRow>) => {
    setIncome((current) => ({
      ...current,
      feeRows: current.feeRows.map((row, position) =>
        position === index ? { ...row, ...patch } : row,
      ),
    }));
  };

  const addFeeRow = () => {
    focusNewFee.current = true;
    setIncome((current) => ({
      ...current,
      feeRows: current.feeRows.length >= 30 ? current.feeRows : [...current.feeRows, { label: '', text: '' }],
    }));
  };

  useEffect(() => {
    if (!focusNewFee.current) return;
    focusNewFee.current = false;
    const lastRow = feeRowsRef.current?.lastElementChild as HTMLElement | null;
    lastRow?.scrollIntoView({ block: 'nearest' });
    lastRow?.querySelector('input')?.focus();
  }, [income.feeRows.length]);

  const removeFeeRow = (index: number) => {
    setIncome((current) => ({
      ...current,
      feeRows: current.feeRows.filter((_, position) => position !== index),
    }));
  };

  const removeAttachment = async (id: number) => {
    try {
      await api.attachments.remove(id);
      setAttachments((current) => current.filter((item) => item.id !== id));
      toast('Đã xoá chứng từ.');
    } catch (err) {
      toast(getErrorMessage(err), 'error');
    }
  };

  const expenseCostField = (key: ExpenseCostKey) => (
    <label className="field" key={key}>
      <span className="field-label">{EXPENSE_COST_LABELS[key]}</span>
      <span className="amount-wrap">
        <input
          className="input"
          inputMode="numeric"
          value={expense.costs[key]}
          placeholder="0"
          onChange={(event) => updateExpenseCost(key, event.target.value)}
        />
        <span className="amount-suffix">đ</span>
      </span>
    </label>
  );

  const expenseContainerSize =
    decl.containerDirty || !transaction
      ? `${decl.containerChoice}' ×${decl.containerCount}`
      : transaction.containerSize;

  const submit = async () => {
    setError('');
    const today = todayIso();
    const inputs: TxInput[] = [];

    if (expense.enabled) {
      if (expense.occurredOn > today) {
        setError('Ngày giao hàng của chi phí không được ở tương lai.');
        return;
      }
      if (!expense.categoryId) {
        setError('Chọn danh mục cho chi phí.');
        return;
      }
      if ((expense.amountDirty || transaction?.kind !== 'expense') && computedExpenseAmount <= 0) {
        setError('Còn lại phải lớn hơn 0. Kiểm tra lại tiền cost, VAT và các khoản chi phí.');
        return;
      }
      if (expense.debt.track && !expense.debt.dueDate) {
        setError('Chọn hạn thanh toán cho chi phí.');
        return;
      }
      const baseDetails = transaction?.kind === 'expense' ? transaction.details : {};
      const details =
        expense.amountDirty || transaction?.kind !== 'expense'
          ? buildExpenseDetails(baseDetails, {
              service: serviceFee,
              truck: truckFee,
              lift: costValue('lift'),
              lower: costValue('lower'),
              far: costValue('far'),
              bot: costValue('bot'),
              customs: costValue('customs'),
              discount: costValue('discount'),
              other: costValue('other'),
            })
          : { ...baseDetails };
      inputs.push({
        kind: 'expense',
        amount: expenseAmount,
        occurredOn: expense.occurredOn,
        categoryId: expense.categoryId,
        method: expense.method,
        party: decl.party,
        note: expense.note,
        reference: decl.reference,
        port: decl.port,
        goodsName: decl.goodsName,
        goodsType: decl.goodsType,
        containerNo: decl.containerNo,
        containerSize: expenseContainerSize,
        carrier: expense.carrier,
        warehouseAddress: expense.warehouseAddress,
        details,
        dueDate: expense.debt.track ? expense.debt.dueDate : '',
        paidAmount: expense.debt.track
          ? Math.min(expense.debt.paidAmount, expenseAmount)
          : expenseAmount,
        currency: 'VND',
        originalAmount: expenseAmount,
        exchangeRate: 1,
      });
    }

    if (income.enabled) {
      if (income.occurredOn > today) {
        setError('Ngày giao dịch của thu nhập không được ở tương lai.');
        return;
      }
      if (income.amount <= 0) {
        setError('Nhập số tiền thu nhập lớn hơn 0.');
        return;
      }
      if (income.currency !== 'VND' && (!Number.isFinite(income.exchangeRate) || income.exchangeRate <= 0)) {
        setError('Nhập tỷ giá lớn hơn 0.');
        return;
      }
      if (!income.categoryId) {
        setError('Chọn danh mục cho thu nhập.');
        return;
      }
      if (income.debt.track && !income.debt.dueDate) {
        setError('Chọn hạn thanh toán cho thu nhập.');
        return;
      }
      const details: Record<string, number> = {};
      for (const row of income.feeRows) {
        const label = row.label.trim().slice(0, 60);
        const value = parseAmount(row.text);
        if (label && value > 0) details[label] = value;
      }
      inputs.push({
        kind: 'income',
        amount: incomeAmountVnd,
        occurredOn: income.occurredOn,
        categoryId: income.categoryId,
        method: income.method,
        party: decl.party,
        note: income.note,
        reference: decl.reference,
        port: decl.port,
        goodsName: decl.goodsName,
        goodsType: decl.goodsType,
        containerNo: decl.containerNo,
        containerSize: income.containerSize,
        carrier: income.carrier,
        warehouseAddress: income.warehouseAddress,
        details,
        dueDate: income.debt.track ? income.debt.dueDate : '',
        paidAmount: income.debt.track
          ? Math.min(income.debt.paidAmount, incomeAmountVnd)
          : incomeAmountVnd,
        currency: income.currency,
        originalAmount: income.currency === 'VND' ? incomeAmountVnd : income.amount,
        exchangeRate: income.currency === 'VND' ? 1 : income.exchangeRate,
      });
    }

    if (inputs.length === 0) {
      setError('Bật ít nhất một bước Chi phí hoặc Thu nhập để lưu giao dịch.');
      return;
    }

    const lookupTasks: Promise<unknown>[] = [];
    const attempted = new Set<string>();
    const saveLookup = (
      lookupKind: 'customers' | 'carriers' | 'goods_types',
      value: string,
      list: string[],
      setter: (values: string[]) => void,
    ) => {
      const trimmed = value.trim();
      if (!trimmed) return;
      const key = `${lookupKind}:${trimmed.toLowerCase()}`;
      if (attempted.has(key)) return;
      if (list.some((item) => item.toLowerCase() === trimmed.toLowerCase())) return;
      attempted.add(key);
      lookupTasks.push(
        api.lookups
          .add(lookupKind, trimmed)
          .then((values) => setter(values))
          .then(() => undefined),
      );
    };
    saveLookup('customers', decl.party, customers, setCustomers);
    if (expense.enabled) saveLookup('carriers', expense.carrier, carriers, setCarriers);
    if (income.enabled) saveLookup('carriers', income.carrier, carriers, setCarriers);
    saveLookup('goods_types', decl.goodsType, goodsTypes, setGoodsTypes);
    await Promise.all(lookupTasks).catch(() => undefined);

    setSaving(true);
    try {
      if (transaction) {
        const saved = await api.transactions.update(transaction.id, inputs[0]);
        toast(transaction.kind === 'expense' ? 'Đã cập nhật chi phí.' : 'Đã cập nhật thu nhập.');
        onSaved(saved);
        return;
      }

      const savedList: Transaction[] = [];
      try {
        for (const input of inputs) {
          savedList.push(await api.transactions.create(input));
        }
      } catch (err) {
        if (savedList.length > 0) {
          toast(
            `Đã lưu ${savedList.length} giao dịch, nhưng giao dịch tiếp theo lỗi: ${getErrorMessage(err)}`,
            'error',
          );
          onSaved(savedList[0]);
          return;
        }
        throw err;
      }

      if (pendingAttachments.length > 0) {
        try {
          await api.attachments.commit(
            savedList[0].id,
            pendingAttachments.map((attachment) => attachment.token),
          );
        } catch (attachmentError) {
          toast(
            `Giao dịch đã lưu nhưng chứng từ chưa đính kèm được: ${getErrorMessage(attachmentError)}`,
            'error',
          );
        }
      }
      toast(inputs.length > 1 ? 'Đã thêm giao dịch chi phí và thu nhập.' : 'Đã thêm giao dịch.');
      onSaved(savedList[0]);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (stepIndex < lastStep) {
      setStepIndex((current) => Math.min(lastStep, current + 1));
      return;
    }
    void submit();
  };

  const attachmentHint =
    !transaction && pendingAttachments.length === 0
      ? 'Chưa có chứng từ. Hỗ trợ ảnh PNG/JPG/WEBP/GIF và PDF, tối đa 10 MB. Tệp sẽ gắn với giao dịch đầu tiên được lưu.'
      : 'Chưa có chứng từ. Hỗ trợ ảnh PNG/JPG/WEBP/GIF và PDF, tối đa 10 MB.';

  return (
    <Modal
      title={transaction ? 'Sửa giao dịch' : 'Thêm giao dịch'}
      subtitle={`Bước ${stepIndex + 1}/${steps.length} · ${currentStep.label}`}
      onClose={onClose}
      width={640}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
            Huỷ
          </button>
          <div className="wizard-foot-actions">
            {stepIndex > 0 ? (
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => setStepIndex((current) => Math.max(0, current - 1))}
                disabled={saving}
              >
                Quay lại
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn-primary"
              disabled={saving}
              onClick={() => {
                if (stepIndex < lastStep) {
                  setStepIndex((current) => Math.min(lastStep, current + 1));
                } else {
                  void submit();
                }
              }}
            >
              {saving ? <LoaderCircle size={15} className="spin" /> : null}
              {stepIndex < lastStep ? 'Tiếp tục' : transaction ? 'Lưu thay đổi' : 'Thêm giao dịch'}
            </button>
          </div>
        </>
      }
    >
      <form id="transaction-form" onSubmit={handleSubmit} className="form">
        <ol
          className="wizard-steps"
          style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
        >
          {steps.map((step, index) => (
            <li key={step.key}>
              <button
                type="button"
                className={`wizard-step${index === stepIndex ? ' active' : ''}${
                  index < stepIndex ? ' done' : ''
                }`}
                onClick={() => setStepIndex(index)}
                aria-current={index === stepIndex ? 'step' : undefined}
              >
                <span className="wizard-step-num">
                  {index < stepIndex ? <Check size={11} strokeWidth={3} /> : index + 1}
                </span>
                <span className="wizard-step-text">
                  <strong>{step.label}</strong>
                  <small>{step.hint}</small>
                </span>
              </button>
            </li>
          ))}
        </ol>

        {currentStep.key === 'declaration' ? (
          <div className="wizard-page">
            <section className="form-section wizard-section">
              <div className="form-section-head">
                <span className="field-label">Thông tin tờ khai</span>
                <span className="form-section-hint">Thông tin lô hàng</span>
              </div>
              <div className="form-row">
                <label className="field">
                  <span className="field-label">Khách hàng</span>
                  <ComboBox
                    value={decl.party}
                    onChange={(value) => setDecl((current) => ({ ...current, party: value }))}
                    options={customers}
                    placeholder="Chọn hoặc nhập khách hàng mới"
                    ariaLabel="Khách hàng"
                  />
                </label>
                <label className="field">
                  <span className="field-label">Số tờ khai</span>
                  <input
                    className="input"
                    value={decl.reference}
                    maxLength={80}
                    placeholder="VD: 108674195011"
                    onChange={(event) =>
                      setDecl((current) => ({ ...current, reference: event.target.value }))
                    }
                  />
                </label>
              </div>
              <div className="form-row">
                <label className="field">
                  <span className="field-label">Cửa khẩu</span>
                  <input
                    className="input"
                    value={decl.port}
                    maxLength={80}
                    placeholder="VD: 15, HP"
                    onChange={(event) => setDecl((current) => ({ ...current, port: event.target.value }))}
                  />
                </label>
                <label className="field">
                  <span className="field-label">Tên hàng</span>
                  <input
                    className="input"
                    value={decl.goodsName}
                    maxLength={160}
                    placeholder="VD: DOF LTD"
                    onChange={(event) =>
                      setDecl((current) => ({ ...current, goodsName: event.target.value }))
                    }
                  />
                </label>
              </div>
              <div className="form-row">
                <label className="field">
                  <span className="field-label">Loại hàng</span>
                  <ComboBox
                    value={decl.goodsType}
                    onChange={(value) => setDecl((current) => ({ ...current, goodsType: value }))}
                    options={goodsTypes}
                    placeholder="VD: Phân bón"
                    ariaLabel="Loại hàng"
                  />
                </label>
                <label className="field">
                  <span className="field-label">Số container</span>
                  <input
                    className="input"
                    value={decl.containerNo}
                    maxLength={80}
                    placeholder="VD: FCIU5956792"
                    onChange={(event) =>
                      setDecl((current) => ({ ...current, containerNo: event.target.value }))
                    }
                  />
                </label>
              </div>
              <div className="form-row">
                <label className="field">
                  <span className="field-label">Số lượng cont</span>
                  <input
                    className="input"
                    inputMode="numeric"
                    value={decl.containerCountText}
                    maxLength={2}
                    placeholder="1"
                    onFocus={(event) => event.currentTarget.select()}
                    onChange={(event) => changeContainerCount(event.target.value)}
                    onBlur={normalizeContainerCount}
                  />
                </label>
                <label className="field">
                  <span className="field-label">Kích thước cont</span>
                  <Dropdown
                    value={decl.containerChoice}
                    onChange={changeContainerChoice}
                    options={[
                      { value: '20', label: "20'" },
                      { value: '40', label: "40'" },
                    ]}
                    size="md"
                    ariaLabel="Kích thước container"
                  />
                </label>
              </div>
              {!decl.containerDirty && transaction?.containerSize ? (
                <p className="hint no-pad">
                  Dữ liệu cũ: {transaction.containerSize}. Sửa số lượng/kích thước để thay thế.
                </p>
              ) : null}
            </section>

            <div className="attachments-block">
              <div className="attachments-head">
                <span className="field-label">
                  <Paperclip size={13} />
                  Chứng từ
                  {attachments.length + pendingAttachments.length > 0 ? (
                    <span className="attachment-count">
                      {attachments.length + pendingAttachments.length}
                    </span>
                  ) : null}
                </span>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={addAttachment}
                  disabled={attachmentBusy}
                >
                  {attachmentBusy ? <LoaderCircle size={13} className="spin" /> : <Paperclip size={13} />}
                  Thêm tệp
                </button>
              </div>
              {attachments.length + pendingAttachments.length === 0 ? (
                <p className="hint no-pad">{attachmentHint}</p>
              ) : (
                <div className="attachment-list">
                  {attachments.map((attachment) => (
                    <div className="attachment-item" key={attachment.id}>
                      <FileText size={15} />
                      <span className="attachment-name" title={attachment.fileName}>
                        {attachment.fileName}
                      </span>
                      <span className="attachment-size">{formatFileSize(attachment.size)}</span>
                      <button
                        type="button"
                        className="icon-btn sm"
                        aria-label="Mở chứng từ"
                        title="Mở chứng từ"
                        onClick={() =>
                          api.attachments
                            .open(attachment.id)
                            .catch((err) => toast(getErrorMessage(err), 'error'))
                        }
                      >
                        <ExternalLink size={14} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn sm danger"
                        aria-label="Xoá chứng từ"
                        title="Xoá chứng từ"
                        onClick={() => removeAttachment(attachment.id)}
                      >
                        <Trash size={14} />
                      </button>
                    </div>
                  ))}
                  {pendingAttachments.map((attachment) => (
                    <div className="attachment-item pending" key={attachment.token}>
                      <FileText size={15} />
                      <span className="attachment-name" title={attachment.fileName}>
                        {attachment.fileName}
                      </span>
                      <span className="attachment-badge">Chờ lưu</span>
                      <span className="attachment-size">{formatFileSize(attachment.size)}</span>
                      <button
                        type="button"
                        className="icon-btn sm danger"
                        aria-label="Bỏ chứng từ"
                        title="Bỏ chứng từ"
                        onClick={() => removePendingAttachment(attachment.token)}
                      >
                        <Trash size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}

        {currentStep.key === 'expense' ? (
          <div className="wizard-page">
            {!transaction ? (
              <Checkbox
                checked={expense.enabled}
                onChange={(enabled) => setExpense((current) => ({ ...current, enabled }))}
                label="Ghi nhận chi phí"
                description="Bật nếu lô hàng có phát sinh chi phí."
              />
            ) : null}

            {expense.enabled ? (
              <>
                <div className="form-row">
                  <label className="field">
                    <span className="field-label">Hình thức</span>
                    <Dropdown
                      value={expense.method}
                      onChange={(method) => setExpense((current) => ({ ...current, method }))}
                      options={METHOD_OPTIONS.map(([value, label]) => ({ value, label }))}
                      size="md"
                      ariaLabel="Hình thức thanh toán"
                    />
                  </label>
                  <label className="field">
                    <span className="field-label">Danh mục</span>
                    <Dropdown
                      value={expense.categoryId}
                      onChange={(categoryId) => setExpense((current) => ({ ...current, categoryId }))}
                      options={expenseOptions.map((category) => ({ value: category.id, label: category.name }))}
                      placeholder={expenseOptions.length === 0 ? 'Chưa có danh mục' : 'Chọn danh mục'}
                      disabled={expenseOptions.length === 0}
                      size="md"
                      ariaLabel="Danh mục chi phí"
                    />
                  </label>
                </div>

                <div className="form-section">
                  <div className="form-section-head">
                    <span className="field-label">Thông tin vận chuyển</span>
                    <span className="form-section-hint">Đơn vị và kho nhận</span>
                  </div>
                  <div className="form-row">
                    <label className="field">
                      <span className="field-label">Đơn vị vận chuyển</span>
                      <ComboBox
                        value={expense.carrier}
                        onChange={(value) => setExpense((current) => ({ ...current, carrier: value }))}
                        options={carriers}
                        placeholder="Chọn hoặc nhập đơn vị mới"
                        ariaLabel="Đơn vị vận chuyển"
                      />
                    </label>
                    <label className="field">
                      <span className="field-label">Ngày giao hàng</span>
                      <DateInput
                        value={expense.occurredOn}
                        max={todayIso()}
                        onChange={(event) =>
                          setExpense((current) => ({ ...current, occurredOn: event.target.value }))
                        }
                        aria-label="Ngày giao hàng"
                      />
                    </label>
                  </div>
                  <label className="field">
                    <span className="field-label">Địa chỉ kho</span>
                    <input
                      className="input"
                      value={expense.warehouseAddress}
                      maxLength={200}
                      placeholder="Địa chỉ kho nhận hàng"
                      onChange={(event) =>
                        setExpense((current) => ({ ...current, warehouseAddress: event.target.value }))
                      }
                    />
                  </label>
                  <label className="field">
                    <span className="field-label">Ghi chú</span>
                    <textarea
                      className="input textarea"
                      value={expense.note}
                      maxLength={500}
                      rows={2}
                      placeholder="Thông tin thêm về giao dịch (không bắt buộc)"
                      onChange={(event) =>
                        setExpense((current) => ({ ...current, note: event.target.value }))
                      }
                    />
                  </label>
                </div>

                <div className="form-section">
                  <div className="form-section-head">
                    <span className="field-label">Các khoản phí khác</span>
                    <span className="form-section-hint">Tiền xe tự động cộng</span>
                  </div>
                  <div className="form-row">
                    <label className="field">
                      <span className="field-label">Tiền xe</span>
                      <span className="readonly-value">{formatVnd(truckFee)}</span>
                    </label>
                    {expenseCostField('lift')}
                  </div>
                  <div className="form-row">
                    {expenseCostField('lower')}
                    {expenseCostField('far')}
                  </div>
                  <div className="form-row">
                    {expenseCostField('bot')}
                    {expenseCostField('other')}
                  </div>
                  <p className="hint no-pad">
                    Tiền xe = Phí nâng + Phí hạ + Phụ thu hạ xa + Phụ thu qua bot.
                  </p>
                </div>

                <div className="form-section">
                  <div className="form-section-head">
                    <span className="field-label">Chi phí</span>
                    <span className="form-section-hint">
                      Mặc định 6.300.000 đ/cont 20' · 7.300.000 đ/cont 40' + VAT 8%
                    </span>
                  </div>
                  <div className="form-row">
                    <label className="field">
                      <span className="field-label">Tiền cost (container)</span>
                      <span className="amount-wrap">
                        <input
                          className="input"
                          inputMode="numeric"
                          value={costDisplay}
                          placeholder="0"
                          onChange={(event) => updateCost(event.target.value)}
                        />
                        <span className="amount-suffix">đ</span>
                      </span>
                    </label>
                    <label className="field">
                      <span className="field-label">VAT của tiền cost</span>
                      <span className="amount-wrap">
                        <input
                          className="input"
                          inputMode="numeric"
                          value={vatDisplay}
                          placeholder="0"
                          onChange={(event) => updateVat(event.target.value)}
                        />
                        <span className="amount-suffix">đ</span>
                      </span>
                    </label>
                  </div>
                  <div className="expense-calc">
                    <div className="expense-calc-row">
                      <span>Phí dịch vụ (cost + VAT)</span>
                      <strong>{formatVnd(serviceFee)}</strong>
                    </div>
                    <div className="expense-calc-row">
                      <span>Tiền xe</span>
                      <strong>{formatVnd(truckFee)}</strong>
                    </div>
                    <div className="form-row">
                      {expenseCostField('customs')}
                      {expenseCostField('discount')}
                    </div>
                    <div className="expense-calc-row">
                      <span>Khác</span>
                      <strong>{formatVnd(costValue('other'))}</strong>
                    </div>
                    <div className="expense-calc-total">
                      <span>Còn lại</span>
                      <strong className={remaining <= 0 ? 'expense' : ''}>{formatVnd(remaining)}</strong>
                    </div>
                    <div className="expense-calc-row">
                      <span>Số tiền sẽ lưu</span>
                      <strong>{formatVnd(expenseAmount)}</strong>
                    </div>
                    {!expense.amountDirty && transaction?.kind === 'expense' &&
                    transaction.amount !== computedExpenseAmount ? (
                      <div className="expense-recalc">
                        <span>Đang giữ số tiền cũ {formatVnd(transaction.amount)}.</span>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => setExpense((current) => ({ ...current, amountDirty: true }))}
                        >
                          Tính lại theo phí mới
                        </button>
                      </div>
                    ) : null}
                    {remaining <= 0 ? (
                      <p className="expense-warning">Còn lại phải lớn hơn 0 để lưu giao dịch.</p>
                    ) : null}
                  </div>
                </div>

                {debtBlock(expense.debt, expenseAmount, (debt) =>
                  setExpense((current) => ({ ...current, debt })),
                )}
              </>
            ) : (
              <p className="hint no-pad">Không ghi nhận chi phí cho lô này.</p>
            )}
          </div>
        ) : null}

        {currentStep.key === 'income' ? (
          <div className="wizard-page">
            {!transaction ? (
              <Checkbox
                checked={income.enabled}
                onChange={(enabled) => setIncome((current) => ({ ...current, enabled }))}
                label="Ghi nhận thu nhập"
                description="Bật nếu lô hàng có phát sinh doanh thu."
              />
            ) : null}

            {income.enabled ? (
              <>
                <div className="field amount-field">
                  <div className="amount-head">
                    <span className="field-label">Số tiền</span>
                    <Dropdown
                      className="currency-select"
                      value={income.currency}
                      onChange={changeIncomeCurrency}
                      options={CURRENCY_OPTIONS}
                      ariaLabel="Tiền tệ"
                    />
                  </div>
                  <span className="amount-wrap">
                    <input
                      className="input amount-input"
                      inputMode="numeric"
                      placeholder="0"
                      value={income.amountText}
                      onChange={(event) => {
                        const parsed = parseAmount(event.target.value);
                        setIncome((current) => ({
                          ...current,
                          amount: parsed,
                          amountText: parsed > 0 ? formatNumber(parsed) : '',
                        }));
                      }}
                    />
                    <span className="amount-suffix">{CURRENCY_SUFFIX[income.currency]}</span>
                  </span>
                  {income.currency !== 'VND' ? (
                    <div className="fx-row">
                      <label className="fx-rate">
                        <span>Tỷ giá (VND / 1 {income.currency})</span>
                        <input
                          className="input"
                          type="number"
                          min="0.0001"
                          step="0.0001"
                          value={income.rateText}
                          onChange={(event) => {
                            const raw = event.target.value;
                            const parsed = Number(raw);
                            setIncome((current) => ({
                              ...current,
                              rateText: raw,
                              exchangeRate: Number.isFinite(parsed) && parsed > 0 ? parsed : 0,
                            }));
                          }}
                        />
                      </label>
                      <div className="fx-total">
                        <span>Quy đổi</span>
                        <strong>{formatVnd(incomeAmountVnd)}</strong>
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="form-row">
                  <label className="field">
                    <span className="field-label">Ngày giao dịch</span>
                    <DateInput
                      value={income.occurredOn}
                      max={todayIso()}
                      onChange={(event) =>
                        setIncome((current) => ({ ...current, occurredOn: event.target.value }))
                      }
                      aria-label="Ngày giao dịch"
                    />
                  </label>
                  <label className="field">
                    <span className="field-label">Hình thức</span>
                    <Dropdown
                      value={income.method}
                      onChange={(method) => setIncome((current) => ({ ...current, method }))}
                      options={METHOD_OPTIONS.map(([value, label]) => ({ value, label }))}
                      size="md"
                      ariaLabel="Hình thức thanh toán"
                    />
                  </label>
                </div>

                <div className="form-row">
                  <label className="field">
                    <span className="field-label">Danh mục</span>
                    <Dropdown
                      value={income.categoryId}
                      onChange={(categoryId) => setIncome((current) => ({ ...current, categoryId }))}
                      options={incomeOptions.map((category) => ({ value: category.id, label: category.name }))}
                      placeholder={incomeOptions.length === 0 ? 'Chưa có danh mục' : 'Chọn danh mục'}
                      disabled={incomeOptions.length === 0}
                      size="md"
                      ariaLabel="Danh mục thu nhập"
                    />
                  </label>
                  <label className="field">
                    <span className="field-label">Đối tác</span>
                    <input
                      className="input"
                      value={decl.party}
                      maxLength={160}
                      placeholder="Tên khách hàng, nhà cung cấp…"
                      onChange={(event) =>
                        setDecl((current) => ({ ...current, party: event.target.value }))
                      }
                    />
                  </label>
                </div>

                <label className="field">
                  <span className="field-label">Ghi chú</span>
                  <textarea
                    className="input textarea"
                    value={income.note}
                    maxLength={500}
                    rows={3}
                    placeholder="Thông tin thêm về giao dịch (không bắt buộc)"
                    onChange={(event) =>
                      setIncome((current) => ({ ...current, note: event.target.value }))
                    }
                  />
                </label>

                <div className="detail-list">
                  <div className="detail-list-head">
                    <span className="field-label">Chi tiết phí</span>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={addFeeRow}
                      disabled={income.feeRows.length >= 30}
                    >
                      <Plus size={13} />
                      Thêm khoản
                    </button>
                  </div>
                  {income.feeRows.length === 0 ? (
                    <p className="hint no-pad">Chưa có khoản phí. Bấm “Thêm khoản” để nhập.</p>
                  ) : (
                    <div className="fee-edit-rows" ref={feeRowsRef}>
                      <div className="fee-edit-head" aria-hidden="true">
                        <span>Tên khoản phí</span>
                        <span>Số tiền</span>
                        <span />
                      </div>
                      {income.feeRows.map((row, index) => (
                        <div className="fee-edit-row" key={index}>
                          <input
                            className="input"
                            value={row.label}
                            maxLength={60}
                            placeholder="Tên khoản phí (VD: Phí nâng)"
                            onChange={(event) => updateFeeRow(index, { label: event.target.value })}
                          />
                          <span className="amount-wrap">
                            <input
                              className="input"
                              inputMode="numeric"
                              placeholder="0"
                              value={row.text}
                              onChange={(event) => {
                                const parsed = parseAmount(event.target.value);
                                updateFeeRow(index, { text: parsed > 0 ? formatNumber(parsed) : '' });
                              }}
                            />
                            <span className="amount-suffix">đ</span>
                          </span>
                          <button
                            type="button"
                            className="icon-btn sm danger"
                            aria-label="Xoá khoản phí"
                            title="Xoá khoản phí"
                            onClick={() => removeFeeRow(index)}
                          >
                            <Trash size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {debtBlock(income.debt, incomeAmountVnd, (debt) =>
                  setIncome((current) => ({ ...current, debt })),
                )}

                <button
                  type="button"
                  className={`section-toggle${showIncomeExtras ? ' open' : ''}`}
                  onClick={() => setShowIncomeExtras((value) => !value)}
                  aria-expanded={showIncomeExtras}
                >
                  <span>Thông tin vận đơn</span>
                  <span className="section-toggle-hint">Không bắt buộc</span>
                  <ChevronDown size={15} />
                </button>

                {showIncomeExtras ? (
                  <div className="form-extra">
                    <div className="form-row">
                      <label className="field">
                        <span className="field-label">Số tờ khai</span>
                        <input
                          className="input"
                          value={decl.reference}
                          maxLength={80}
                          placeholder="VD: 108674195011"
                          onChange={(event) =>
                            setDecl((current) => ({ ...current, reference: event.target.value }))
                          }
                        />
                      </label>
                      <label className="field">
                        <span className="field-label">Cửa khẩu</span>
                        <input
                          className="input"
                          value={decl.port}
                          maxLength={80}
                          placeholder="VD: 15, HP"
                          onChange={(event) =>
                            setDecl((current) => ({ ...current, port: event.target.value }))
                          }
                        />
                      </label>
                    </div>
                    <div className="form-row">
                      <label className="field">
                        <span className="field-label">Tên hàng</span>
                        <input
                          className="input"
                          value={decl.goodsName}
                          maxLength={160}
                          placeholder="VD: DOF LTD"
                          onChange={(event) =>
                            setDecl((current) => ({ ...current, goodsName: event.target.value }))
                          }
                        />
                      </label>
                      <label className="field">
                        <span className="field-label">Loại hàng</span>
                        <input
                          className="input"
                          value={decl.goodsType}
                          maxLength={80}
                          placeholder="VD: Phân bón"
                          onChange={(event) =>
                            setDecl((current) => ({ ...current, goodsType: event.target.value }))
                          }
                        />
                      </label>
                    </div>
                    <div className="form-row">
                      <label className="field">
                        <span className="field-label">Số container</span>
                        <input
                          className="input"
                          value={decl.containerNo}
                          maxLength={80}
                          placeholder="VD: FCIU5956792"
                          onChange={(event) =>
                            setDecl((current) => ({ ...current, containerNo: event.target.value }))
                          }
                        />
                      </label>
                      <label className="field">
                        <span className="field-label">Kích thước cont</span>
                        <input
                          className="input"
                          value={income.containerSize}
                          maxLength={80}
                          placeholder="VD: 20' ×1 · 40' ×1"
                          onChange={(event) =>
                            setIncome((current) => ({ ...current, containerSize: event.target.value }))
                          }
                        />
                      </label>
                    </div>
                    <label className="field">
                      <span className="field-label">Đơn vị vận chuyển</span>
                      <input
                        className="input"
                        value={income.carrier}
                        maxLength={120}
                        placeholder="VD: Khôi Đạt"
                        onChange={(event) =>
                          setIncome((current) => ({ ...current, carrier: event.target.value }))
                        }
                      />
                    </label>
                    <label className="field">
                      <span className="field-label">Địa chỉ kho</span>
                      <input
                        className="input"
                        value={income.warehouseAddress}
                        maxLength={200}
                        placeholder="Địa chỉ kho nhận hàng"
                        onChange={(event) =>
                          setIncome((current) => ({ ...current, warehouseAddress: event.target.value }))
                        }
                      />
                    </label>
                  </div>
                ) : null}
              </>
            ) : (
              <p className="hint no-pad">Không ghi nhận thu nhập cho lô này.</p>
            )}
          </div>
        ) : null}

        {error ? <p className="form-error">{error}</p> : null}
      </form>
    </Modal>
  );
}

function formatFileSize(size: number): string {
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} MB`;
  if (size >= 1024) return `${Math.round(size / 1024)} KB`;
  return `${size} B`;
}
