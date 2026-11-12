import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ExternalLink, FileText, LoaderCircle, Paperclip, Plus, Trash } from 'lucide-react';
import type {
  AttachmentMeta,
  Category,
  Currency,
  Method,
  StagedAttachment,
  Transaction,
  TransactionDraft,
  TxInput,
} from '../../shared/types';
import { CURRENCIES, CURRENCY_LABELS, CURRENCY_SUFFIX, METHOD_LABELS } from '../../shared/types';
import {
  buildContainerSize,
  containerSummary,
  parseContainerCounts,
  splitContainerNos,
} from '../../shared/containers';
import { todayIso, formatDate } from '../../shared/dates';
import { formatNumber, formatSignedVnd, formatVnd, parseAmount } from '../../shared/format';
import { api, getErrorMessage } from '../api';
import { feeLabel, orderedDetailEntries } from './FeeBreakdown';
import { useToast } from './toast';
import { Checkbox, ComboBox, ConfirmDialog, DateInput, Dropdown, Modal } from './ui';

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
  containerCount20: number;
  containerCount20Text: string;
  containerCount40: number;
  containerCount40Text: string;
  containerDirty: boolean;
  serviceFee20Text: string;
  serviceFee40Text: string;
  customerLiftText: string;
  customerLowerText: string;
  customerFarText: string;
  otherIncomeText: string;
  serviceFeeDirty: boolean;
}

interface ExpenseDraft {
  enabled: boolean;
  occurredOn: string;
  categoryId: number;
  method: Method;
  costs: Record<ExpenseCostKey, string>;
  extraCosts: FeeRow[];
  amountDirty: boolean;
  carrier: string;
  warehouseAddress: string;
  note: string;
  cost20Text: string;
  cost40Text: string;
  vatText: string;
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

type StepKey = 'declaration' | 'expense' | 'income' | 'profit';

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

function readExtraCosts(details: Record<string, number>): FeeRow[] {
  const aliases = new Set(Object.values(EXPENSE_DETAIL_ALIASES).flat());
  return Object.entries(details)
    .filter(([label]) => !aliases.has(normalizeDetailLabel(label)))
    .map(([label, value]) => ({ label, text: value ? formatNumber(value) : '' }));
}

function buildExpenseDetails(
  values: Record<ExpenseCostKey | 'service' | 'truck', number>,
): Record<string, number> {
  const details: Record<string, number> = {};
  for (const key of Object.keys(EXPENSE_DETAIL_NAMES) as (ExpenseCostKey | 'service' | 'truck')[]) {
    const value = values[key];
    if (value > 0) details[EXPENSE_DETAIL_NAMES[key]] = Math.round(value);
  }
  return details;
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
  const counts = transaction
    ? parseContainerCounts(transaction.containerSize)
    : { count20: 1, count40: 0 };
  const totalCount = counts.count20 + counts.count40;
  const rate =
    transaction?.serviceRevenue && totalCount > 0
      ? Math.round(transaction.serviceRevenue / totalCount)
      : 0;
  return {
    party: transaction?.party ?? '',
    reference: transaction?.reference ?? '',
    port: transaction?.port ?? '',
    goodsName: transaction?.goodsName ?? '',
    goodsType: transaction?.goodsType ?? '',
    containerNo: transaction?.containerNo ?? '',
    containerCount20: counts.count20,
    containerCount20Text: String(counts.count20),
    containerCount40: counts.count40,
    containerCount40Text: String(counts.count40),
    containerDirty: !transaction,
    serviceFee20Text: transaction
      ? counts.count20 > 0 && rate > 0
        ? formatNumber(rate)
        : ''
      : formatNumber(CONTAINER_UNIT_FEE['20']),
    serviceFee40Text: transaction
      ? counts.count40 > 0 && rate > 0
        ? formatNumber(rate)
        : ''
      : formatNumber(CONTAINER_UNIT_FEE['40']),
    customerLiftText: transaction?.customerLift ? formatNumber(transaction.customerLift) : '',
    customerLowerText: transaction?.customerLower ? formatNumber(transaction.customerLower) : '',
    customerFarText: transaction?.customerFar ? formatNumber(transaction.customerFar) : '',
    otherIncomeText: transaction?.otherIncome ? formatNumber(transaction.otherIncome) : '',
    serviceFeeDirty: !transaction,
  };
}

function initialExpense(transaction: Transaction | null): ExpenseDraft {
  const isExpense = transaction?.kind === 'expense';
  const details = isExpense ? transaction.details : {};
  const storedService = detailValue(details, EXPENSE_DETAIL_ALIASES.service);
  const storedCost = storedService > 0 ? Math.round(storedService / (1 + VAT_RATE)) : 0;
  const storedVat = storedService > 0 ? storedService - storedCost : 0;
  const counts = parseContainerCounts(transaction?.containerSize ?? '');
  const standardCost =
    counts.count20 * CONTAINER_UNIT_FEE['20'] + counts.count40 * CONTAINER_UNIT_FEE['40'];
  const scale = storedCost > 0 && standardCost > 0 ? storedCost / standardCost : 1;
  return {
    enabled: transaction ? isExpense : true,
    occurredOn: isExpense ? transaction.occurredOn : todayIso(),
    categoryId: isExpense ? transaction.categoryId : 0,
    method: isExpense ? transaction.method : 'bank',
    costs: readExpenseCosts(details),
    extraCosts: readExtraCosts(details),
    amountDirty: !transaction,
    carrier: isExpense ? transaction.carrier : '',
    warehouseAddress: isExpense ? transaction.warehouseAddress : '',
    note: isExpense ? transaction.note : '',
    cost20Text: formatNumber(Math.round(CONTAINER_UNIT_FEE['20'] * scale)),
    cost40Text: formatNumber(Math.round(CONTAINER_UNIT_FEE['40'] * scale)),
    vatText: storedService > 0 ? formatNumber(storedVat) : '',
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

interface DraftSnapshot {
  version: 1;
  decl: DeclarationDraft;
  expense: ExpenseDraft;
  income: IncomeDraft;
  stepIndex: number;
  showIncomeExtras: boolean;
}

function readDraftSnapshot(draft: TransactionDraft): DraftSnapshot | null {
  const payload = draft.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const data = payload as Partial<DraftSnapshot>;
  if (!data.decl || typeof data.decl !== 'object') return null;
  if (!data.expense || typeof data.expense !== 'object') return null;
  if (!data.income || typeof data.income !== 'object') return null;
  const baseDecl = initialDeclaration(null);
  const baseExpense = initialExpense(null);
  const baseIncome = initialIncome(null);
  const expenseData = data.expense as Partial<ExpenseDraft>;
  const incomeData = data.income as Partial<IncomeDraft>;
  return {
    version: 1,
    decl: { ...baseDecl, ...data.decl },
    expense: {
      ...baseExpense,
      ...expenseData,
      costs: { ...baseExpense.costs, ...expenseData.costs },
      extraCosts: Array.isArray(expenseData.extraCosts)
        ? expenseData.extraCosts
        : baseExpense.extraCosts,
      debt: { ...baseExpense.debt, ...expenseData.debt },
    },
    income: {
      ...baseIncome,
      ...incomeData,
      feeRows: Array.isArray(incomeData.feeRows) ? incomeData.feeRows : baseIncome.feeRows,
      debt: { ...baseIncome.debt, ...incomeData.debt },
    },
    stepIndex: Number.isInteger(data.stepIndex)
      ? Math.max(0, Math.min(9, Number(data.stepIndex)))
      : 0,
    showIncomeExtras: Boolean(data.showIncomeExtras),
  };
}

export function TransactionModal({
  transaction,
  draft = null,
  onClose,
  onSaved,
}: {
  transaction: Transaction | null;
  draft?: TransactionDraft | null;
  onClose: () => void;
  onSaved: (transaction: Transaction) => void;
}) {
  const toast = useToast();
  const draftSnapshot = useMemo(() => (draft ? readDraftSnapshot(draft) : null), [draft]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [decl, setDecl] = useState<DeclarationDraft>(
    () => draftSnapshot?.decl ?? initialDeclaration(transaction),
  );
  const [expense, setExpense] = useState<ExpenseDraft>(
    () => draftSnapshot?.expense ?? initialExpense(transaction),
  );
  const [income, setIncome] = useState<IncomeDraft>(
    () => draftSnapshot?.income ?? initialIncome(transaction),
  );
  const [customers, setCustomers] = useState<string[]>([]);
  const [carriers, setCarriers] = useState<string[]>([]);
  const [goodsTypes, setGoodsTypes] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<AttachmentMeta[]>([]);
  const [pendingAttachments, setPendingAttachments] = useState<StagedAttachment[]>([]);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [draftSaving, setDraftSaving] = useState(false);
  const [stepIndex, setStepIndex] = useState(() => draftSnapshot?.stepIndex ?? 0);
  const [showIncomeExtras, setShowIncomeExtras] = useState(
    () =>
      draftSnapshot?.showIncomeExtras ??
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
  const draftId = useRef<number | null>(draft?.id ?? null);
  const closingRef = useRef(false);

  const steps = useMemo<{ key: StepKey; label: string; hint: string }[]>(() => {
    const declaration: { key: StepKey; label: string; hint: string } = {
      key: 'declaration',
      label: 'Thông tin tờ khai',
      hint: 'Thông tin lô hàng',
    };
    const expenseStep: { key: StepKey; label: string; hint: string } = {
      key: 'expense',
      label: 'Chi phí',
      hint: 'Các khoản chi của lô',
    };
    const profitStep: { key: StepKey; label: string; hint: string } = {
      key: 'profit',
      label: 'Lợi nhuận',
      hint: 'Thu nhập trừ chi phí',
    };
    if (transaction?.kind === 'income') {
      return [
        declaration,
        { key: 'income', label: 'Thu nhập', hint: 'Doanh thu của lô' },
      ];
    }
    return [declaration, expenseStep, profitStep];
  }, [transaction]);
  const currentStep = steps[Math.min(stepIndex, steps.length - 1)];
  const lastStep = steps.length - 1;

  useEffect(() => {
    setStepIndex((current) => Math.min(current, lastStep));
  }, [lastStep]);

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

  const costValue = (key: ExpenseCostKey) => parseAmount(expense.costs[key]);
  const liftFee = costValue('lift');
  const lowerFee = costValue('lower');
  const farFee = costValue('far');
  const botFee = costValue('bot');
  const customsFee = costValue('customs');
  const discountFee = costValue('discount');
  const otherFee = costValue('other');
  const extraCostTotal = expense.extraCosts.reduce(
    (sum, row) => (row.label.trim() ? sum + parseAmount(row.text) : sum),
    0,
  );
  const costAmount =
    decl.containerCount20 * parseAmount(expense.cost20Text) +
    decl.containerCount40 * parseAmount(expense.cost40Text);
  const autoVat = Math.round(costAmount * VAT_RATE);
  const vatAmount = expense.vatDirty ? parseAmount(expense.vatText) : autoVat;
  const vatDisplay = expense.vatDirty ? expense.vatText : formatNumber(autoVat);
  const containerLabel = containerSummary(decl.containerCount20, decl.containerCount40);
  const containerNumbers = splitContainerNos(decl.containerNo);
  const containerTotal = decl.containerCount20 + decl.containerCount40;
  const containerOverflow = containerNumbers.length > containerTotal;
  const costLabel = `Tiền cost (${containerLabel})`;
  const serviceFee = costAmount + vatAmount;
  const handlingFee = liftFee + lowerFee;
  const transportFee = handlingFee + farFee + botFee;
  const totalExpense =
    serviceFee +
    handlingFee +
    farFee +
    botFee +
    customsFee +
    discountFee +
    otherFee +
    extraCostTotal;
  const computedExpenseAmount = Math.max(0, Math.round(totalExpense));
  const savedExpenseAmount = transaction?.kind === 'expense' ? transaction.amount : undefined;
  const expenseAmount =
    expense.amountDirty || savedExpenseAmount === undefined ? computedExpenseAmount : savedExpenseAmount;
  const incomeAmountVnd =
    income.currency === 'VND' ? income.amount : Math.round(income.amount * income.exchangeRate);
  const computedServiceRevenue = Math.round(
    decl.containerCount20 * parseAmount(decl.serviceFee20Text) +
      decl.containerCount40 * parseAmount(decl.serviceFee40Text),
  );
  const serviceRevenue =
    transaction && !decl.serviceFeeDirty ? transaction.serviceRevenue : computedServiceRevenue;
  const serviceRevenueLabel = `Phí dịch vụ thu khách (${containerLabel})`;
  const serviceVat = Math.round(serviceRevenue * VAT_RATE);
  const customerLift = parseAmount(decl.customerLiftText);
  const customerLower = parseAmount(decl.customerLowerText);
  const customerHandling = customerLift + customerLower;
  const customerFar = parseAmount(decl.customerFarText);
  const otherIncome = parseAmount(decl.otherIncomeText);
  const totalIncome =
    serviceRevenue + serviceVat + customerHandling + customerFar + otherIncome;
  const profit = totalIncome - totalExpense;
  const showRevenueSummary = !transaction || transaction.kind === 'expense';
  const draftBaseline = useMemo(
    () =>
      JSON.stringify({
        decl: initialDeclaration(null),
        expense: initialExpense(null),
        income: initialIncome(null),
      }),
    [],
  );
  const draftHasContent = useMemo(
    () => JSON.stringify({ decl, expense, income }) !== draftBaseline,
    [decl, expense, income, draftBaseline],
  );

  const changeContainerCount = (size: ContainerChoice, raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, 2);
    const parsed = digits ? Math.min(10, Number(digits)) : 0;
    setDecl((current) => ({
      ...current,
      ...(size === '20'
        ? { containerCount20: parsed, containerCount20Text: digits }
        : { containerCount40: parsed, containerCount40Text: digits }),
      containerDirty: true,
      serviceFeeDirty: true,
    }));
    setExpense((current) => ({ ...current, amountDirty: true, vatDirty: false }));
  };

  const updateServiceFee = (size: ContainerChoice, raw: string) => {
    const parsed = parseAmount(raw);
    setDecl((current) => ({
      ...current,
      [size === '20' ? 'serviceFee20Text' : 'serviceFee40Text']:
        parsed > 0 ? formatNumber(parsed) : '',
      serviceFeeDirty: true,
    }));
  };

  const normalizeContainerCount = (size: ContainerChoice) => {
    setDecl((current) => ({
      ...current,
      ...(size === '20'
        ? { containerCount20Text: String(current.containerCount20) }
        : { containerCount40Text: String(current.containerCount40) }),
    }));
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

  const updateCost = (size: ContainerChoice, raw: string) => {
    const parsed = parseAmount(raw);
    setExpense((current) => ({
      ...current,
      [size === '20' ? 'cost20Text' : 'cost40Text']: parsed > 0 ? formatNumber(parsed) : '',
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

  const updateExtraCost = (index: number, patch: Partial<FeeRow>) => {
    setExpense((current) => ({
      ...current,
      extraCosts: current.extraCosts.map((row, position) =>
        position === index ? { ...row, ...patch } : row,
      ),
      amountDirty: true,
    }));
  };

  const addExtraCost = () => {
    setExpense((current) =>
      current.extraCosts.length >= 30
        ? current
        : { ...current, extraCosts: [...current.extraCosts, { label: '', text: '' }] },
    );
  };

  const removeExtraCost = (index: number) => {
    setExpense((current) => ({
      ...current,
      extraCosts: current.extraCosts.filter((_, position) => position !== index),
      amountDirty: true,
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
      ? buildContainerSize(decl.containerCount20, decl.containerCount40)
      : transaction.containerSize;

  const removeDraft = async () => {
    if (!draftId.current) return;
    const id = draftId.current;
    draftId.current = null;
    await api.drafts.remove(id).catch(() => undefined);
  };

  const submit = async () => {
    setError('');
    if (containerOverflow) {
      setError(
        `Đã nhập ${containerNumbers.length} số container, vượt quá tổng ${containerTotal} container (20' + 40').`,
      );
      return;
    }
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
        setError('Tổng chi phí phải lớn hơn 0. Kiểm tra lại tiền cost, VAT và các khoản chi phí.');
        return;
      }
      if (expense.debt.track && !expense.debt.dueDate) {
        setError('Chọn hạn thanh toán cho chi phí.');
        return;
      }
      const baseDetails = transaction?.kind === 'expense' ? transaction.details : {};
      const details =
        expense.amountDirty || transaction?.kind !== 'expense'
          ? buildExpenseDetails({
              service: serviceFee,
              truck: transportFee,
              lift: liftFee,
              lower: lowerFee,
              far: farFee,
              bot: botFee,
              customs: customsFee,
              discount: discountFee,
              other: otherFee,
            })
          : { ...baseDetails };
      if (expense.amountDirty || transaction?.kind !== 'expense') {
        for (const row of expense.extraCosts) {
          const label = row.label.trim().slice(0, 60);
          const value = parseAmount(row.text);
          if (label && value > 0) details[label] = value;
        }
      }
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
        serviceRevenue,
        customerFar,
        otherIncome,
        customerLift,
        customerLower,
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
        serviceRevenue,
        customerFar,
        otherIncome,
        customerLift,
        customerLower,
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
          await removeDraft();
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
      await removeDraft();
      toast(inputs.length > 1 ? 'Đã thêm giao dịch chi phí và thu nhập.' : 'Đã thêm giao dịch.');
      onSaved(savedList[0]);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const containerError = `Đã nhập ${containerNumbers.length} số container, vượt quá tổng ${containerTotal} container (20' + 40').`;
  const goNext = () => {
    if (currentStep.key === 'declaration' && containerOverflow) {
      setError(containerError);
      return;
    }
    if (stepIndex < lastStep) {
      setError('');
      setStepIndex((current) => Math.min(lastStep, current + 1));
      return;
    }
    void submit();
  };

  const moveStep = (delta: -1 | 1) => {
    if (delta === 1) {
      if (stepIndex >= lastStep) return;
      if (currentStep.key === 'declaration' && containerOverflow) {
        setError(containerError);
        return;
      }
      setError('');
      setStepIndex((current) => Math.min(lastStep, current + 1));
      return;
    }
    if (stepIndex <= 0) return;
    setError('');
    setStepIndex((current) => Math.max(0, current - 1));
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.defaultPrevented) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (
        target &&
        (target.isContentEditable ||
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT')
      ) {
        return;
      }
      if (document.querySelector('[role="listbox"]')) return;
      if (document.querySelectorAll('[role="dialog"]').length > 1) return;
      const next = event.key === 'ArrowRight' ? 1 : -1;
      const canMove =
        next === 1 ? stepIndex < lastStep : stepIndex > 0;
      if (!canMove) return;
      event.preventDefault();
      moveStep(next);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [stepIndex, lastStep, currentStep.key, containerOverflow, containerError]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    goNext();
  };

  const persistDraft = async (): Promise<'saved' | 'removed' | 'empty'> => {
    if (transaction) return 'empty';
    if (!draftHasContent) {
      if (!draftId.current) return 'empty';
      await removeDraft();
      return 'removed';
    }
    const label = (
      decl.reference
        ? `${decl.reference}${decl.party ? ` · ${decl.party}` : ''}`
        : decl.party || decl.goodsName || decl.containerNo || 'Nháp mới'
    ).slice(0, 160);
    const saved = await api.drafts.save({
      id: draftId.current ?? undefined,
      label,
      step: stepIndex,
      payload: { version: 1, decl, expense, income, stepIndex, showIncomeExtras },
    });
    draftId.current = saved.id;
    return 'saved';
  };

  const draftSavedMessage =
    pendingAttachments.length > 0
      ? 'Đã lưu nháp. Chứng từ chưa được giữ.'
      : 'Đã lưu nháp.';

  const handleSaveDraft = async () => {
    if (draftSaving || saving) return;
    setDraftSaving(true);
    try {
      const result = await persistDraft();
      if (result === 'saved') toast(draftSavedMessage);
      else if (result === 'removed') toast('Đã xoá nháp trống.');
      else toast('Chưa có thông tin để lưu nháp.', 'info');
    } catch (error) {
      toast(getErrorMessage(error), 'error');
    } finally {
      setDraftSaving(false);
    }
  };

  const closeWithDraft = () => {
    if (closingRef.current || saving) return;
    if (transaction) {
      onClose();
      return;
    }
    closingRef.current = true;
    void persistDraft()
      .then((result) => {
        if (result === 'saved') toast(draftSavedMessage);
        onClose();
      })
      .catch((error) => {
        toast(getErrorMessage(error), 'error');
        onClose();
      });
  };

  const attachmentHint =
    !transaction && pendingAttachments.length === 0
      ? 'Chưa có chứng từ. Hỗ trợ ảnh PNG/JPG/WEBP/GIF và PDF, tối đa 10 MB. Tệp sẽ gắn với giao dịch đầu tiên được lưu.'
      : 'Chưa có chứng từ. Hỗ trợ ảnh PNG/JPG/WEBP/GIF và PDF, tối đa 10 MB.';

  return (
    <Modal
      title={transaction ? 'Sửa giao dịch' : 'Thêm giao dịch'}
      subtitle={`Bước ${stepIndex + 1}/${steps.length} · ${currentStep.label}`}
      onClose={closeWithDraft}
      width={860}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={closeWithDraft} disabled={saving}>
            Huỷ
          </button>
          {!transaction ? (
            <button
              type="button"
              className="btn btn-outline"
              onClick={handleSaveDraft}
              disabled={saving || draftSaving || !draftHasContent}
            >
              {draftSaving ? <LoaderCircle size={14} className="spin" /> : null}
              Lưu nháp
            </button>
          ) : null}
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
              onClick={goNext}
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
                onClick={() => {
                  if (index > stepIndex && currentStep.key === 'declaration' && containerOverflow) {
                    setError(containerError);
                    return;
                  }
                  setStepIndex(index);
                }}
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
                    maxLength={400}
                    placeholder="VD: FCIU5956792, TGHU1234567"
                    onChange={(event) =>
                      setDecl((current) => ({ ...current, containerNo: event.target.value }))
                    }
                  />
                </label>
              </div>
              <p className={`hint no-pad${containerOverflow ? ' expense-warning' : ''}`}>
                {containerOverflow
                  ? `Đã nhập ${containerNumbers.length} số container, vượt quá tổng ${containerTotal} container (20' + 40').`
                  : `Nhập nhiều số container, cách nhau bằng dấu phẩy. Đã nhập ${containerNumbers.length}/${containerTotal}.`}
              </p>
              <div className="form-row">
                <label className="field">
                  <span className="field-label">Số lượng cont 20'</span>
                  <input
                    className="input"
                    inputMode="numeric"
                    value={decl.containerCount20Text}
                    maxLength={2}
                    placeholder="0"
                    onFocus={(event) => event.currentTarget.select()}
                    onChange={(event) => changeContainerCount('20', event.target.value)}
                    onBlur={() => normalizeContainerCount('20')}
                  />
                </label>
                <label className="field">
                  <span className="field-label">Số lượng cont 40'</span>
                  <input
                    className="input"
                    inputMode="numeric"
                    value={decl.containerCount40Text}
                    maxLength={2}
                    placeholder="0"
                    onFocus={(event) => event.currentTarget.select()}
                    onChange={(event) => changeContainerCount('40', event.target.value)}
                    onBlur={() => normalizeContainerCount('40')}
                  />
                </label>
              </div>
              {!decl.containerDirty && transaction?.containerSize ? (
                <p className="hint no-pad">
                  Dữ liệu cũ: {transaction.containerSize}. Sửa số lượng để thay thế.
                </p>
              ) : null}
              {showRevenueSummary ? (
                <>
                  <div className="form-row">
                    <label className="field">
                      <span className="field-label">Phí dịch vụ sẽ thu khách / cont 20'</span>
                      <span className="amount-wrap">
                        <input
                          className="input"
                          inputMode="numeric"
                          value={decl.serviceFee20Text}
                          placeholder="0"
                          onChange={(event) => updateServiceFee('20', event.target.value)}
                        />
                        <span className="amount-suffix">đ</span>
                      </span>
                    </label>
                    <label className="field">
                      <span className="field-label">Phí dịch vụ sẽ thu khách / cont 40'</span>
                      <span className="amount-wrap">
                        <input
                          className="input"
                          inputMode="numeric"
                          value={decl.serviceFee40Text}
                          placeholder="0"
                          onChange={(event) => updateServiceFee('40', event.target.value)}
                        />
                        <span className="amount-suffix">đ</span>
                      </span>
                    </label>
                  </div>
                  <p className="hint no-pad">
                    Nhập đơn giá thu khách mỗi container. Tổng thu tự tính = số lượng × đơn giá +
                    VAT 8% + phí nâng/hạ thu khách + các khoản thu khác.
                  </p>
                  <div className="form-row">
                    <label className="field">
                      <span className="field-label">Phí nâng khách hàng</span>
                      <span className="amount-wrap">
                        <input
                          className="input"
                          inputMode="numeric"
                          value={decl.customerLiftText}
                          placeholder="0"
                          onChange={(event) => {
                            const parsed = parseAmount(event.target.value);
                            setDecl((current) => ({
                              ...current,
                              customerLiftText: parsed > 0 ? formatNumber(parsed) : '',
                            }));
                          }}
                        />
                        <span className="amount-suffix">đ</span>
                      </span>
                    </label>
                    <label className="field">
                      <span className="field-label">Phí hạ khách hàng</span>
                      <span className="amount-wrap">
                        <input
                          className="input"
                          inputMode="numeric"
                          value={decl.customerLowerText}
                          placeholder="0"
                          onChange={(event) => {
                            const parsed = parseAmount(event.target.value);
                            setDecl((current) => ({
                              ...current,
                              customerLowerText: parsed > 0 ? formatNumber(parsed) : '',
                            }));
                          }}
                        />
                        <span className="amount-suffix">đ</span>
                      </span>
                    </label>
                  </div>
                  <div className="form-row">
                    <label className="field">
                      <span className="field-label">Phụ thu hạ xa khách hàng</span>
                      <span className="amount-wrap">
                        <input
                          className="input"
                          inputMode="numeric"
                          value={decl.customerFarText}
                          placeholder="0"
                          onChange={(event) => {
                            const parsed = parseAmount(event.target.value);
                            setDecl((current) => ({
                              ...current,
                              customerFarText: parsed > 0 ? formatNumber(parsed) : '',
                            }));
                          }}
                        />
                        <span className="amount-suffix">đ</span>
                      </span>
                    </label>
                    <label className="field">
                      <span className="field-label">Phí khác (thu khách)</span>
                      <span className="amount-wrap">
                        <input
                          className="input"
                          inputMode="numeric"
                          value={decl.otherIncomeText}
                          placeholder="0"
                          onChange={(event) => {
                            const parsed = parseAmount(event.target.value);
                            setDecl((current) => ({
                              ...current,
                              otherIncomeText: parsed > 0 ? formatNumber(parsed) : '',
                            }));
                          }}
                        />
                        <span className="amount-suffix">đ</span>
                      </span>
                    </label>
                  </div>
                  <div className="expense-calc">
                    <div className="expense-calc-row">
                      <span>{serviceRevenueLabel}</span>
                      <strong>{formatVnd(serviceRevenue)}</strong>
                    </div>
                    <div className="expense-calc-row">
                      <span>VAT thu khách (8%)</span>
                      <strong>{formatVnd(serviceVat)}</strong>
                    </div>
                    <div className="expense-calc-row">
                      <span>Phí nâng khách hàng</span>
                      <strong>{formatVnd(customerLift)}</strong>
                    </div>
                    <div className="expense-calc-row">
                      <span>Phí hạ khách hàng</span>
                      <strong>{formatVnd(customerLower)}</strong>
                    </div>
                    <div className="expense-calc-row">
                      <span>Phụ thu hạ xa khách hàng</span>
                      <strong>{formatVnd(customerFar)}</strong>
                    </div>
                    <div className="expense-calc-row">
                      <span>Phí khác (thu khách)</span>
                      <strong>{formatVnd(otherIncome)}</strong>
                    </div>
                    <div className="expense-calc-total">
                      <span>Tổng thu nhập</span>
                      <strong>{formatVnd(totalIncome)}</strong>
                    </div>
                  </div>
                </>
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
                    <span className="field-label">Chi phí</span>
                    <span className="form-section-hint">
                      Mặc định 6.300.000 đ/cont 20' · 7.300.000 đ/cont 40' + VAT 8%
                    </span>
                  </div>
                  <div className="form-row">
                    <label className="field">
                      <span className="field-label">Tiền cost / cont 20'</span>
                      <span className="amount-wrap">
                        <input
                          className="input"
                          inputMode="numeric"
                          value={expense.cost20Text}
                          placeholder="0"
                          onChange={(event) => updateCost('20', event.target.value)}
                        />
                        <span className="amount-suffix">đ</span>
                      </span>
                    </label>
                    <label className="field">
                      <span className="field-label">Tiền cost / cont 40'</span>
                      <span className="amount-wrap">
                        <input
                          className="input"
                          inputMode="numeric"
                          value={expense.cost40Text}
                          placeholder="0"
                          onChange={(event) => updateCost('40', event.target.value)}
                        />
                        <span className="amount-suffix">đ</span>
                      </span>
                    </label>
                  </div>
                  <div className="form-row">
                    <label className="field">
                      <span className="field-label">{costLabel}</span>
                      <span className="readonly-value">{formatVnd(costAmount)}</span>
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
                  <div className="form-row">
                    {expenseCostField('lift')}
                    {expenseCostField('lower')}
                  </div>
                  <div className="form-row">
                    {expenseCostField('far')}
                    {expenseCostField('bot')}
                  </div>
                  <div className="form-row">
                    {expenseCostField('customs')}
                    {expenseCostField('discount')}
                  </div>
                  <div className="form-row">{expenseCostField('other')}</div>
                  <div className="detail-list">
                    <div className="detail-list-head">
                      <span className="field-label">Chi phí phát sinh</span>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={addExtraCost}
                        disabled={expense.extraCosts.length >= 30}
                      >
                        <Plus size={13} />
                        Thêm chi phí
                      </button>
                    </div>
                    {expense.extraCosts.length === 0 ? (
                      <p className="hint no-pad">Chưa có chi phí phát sinh. Bấm “Thêm chi phí” để nhập.</p>
                    ) : (
                      <div className="fee-edit-rows">
                        <div className="fee-edit-head" aria-hidden="true">
                          <span>Tên chi phí</span>
                          <span>Số tiền</span>
                          <span />
                        </div>
                        {expense.extraCosts.map((row, index) => (
                          <div className="fee-edit-row" key={index}>
                            <input
                              className="input"
                              value={row.label}
                              maxLength={60}
                              placeholder="Tên chi phí (VD: Phí lưu bãi)"
                              onChange={(event) =>
                                updateExtraCost(index, { label: event.target.value })
                              }
                            />
                            <span className="amount-wrap">
                              <input
                                className="input"
                                inputMode="numeric"
                                placeholder="0"
                                value={row.text}
                                onChange={(event) => {
                                  const parsed = parseAmount(event.target.value);
                                  updateExtraCost(index, {
                                    text: parsed > 0 ? formatNumber(parsed) : '',
                                  });
                                }}
                              />
                              <span className="amount-suffix">đ</span>
                            </span>
                            <button
                              type="button"
                              className="icon-btn sm danger"
                              aria-label="Xoá chi phí phát sinh"
                              title="Xoá chi phí phát sinh"
                              onClick={() => removeExtraCost(index)}
                            >
                              <Trash size={13} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="expense-calc">
                    <div className="expense-calc-row">
                      <span>Phí dịch vụ (cost + VAT)</span>
                      <strong>{formatVnd(serviceFee)}</strong>
                    </div>
                    <div className="expense-calc-row">
                      <span>Phí nâng + phí hạ</span>
                      <strong>{formatVnd(handlingFee)}</strong>
                    </div>
                    <div className="expense-calc-row">
                      <span>Phụ thu hạ xa + qua bot</span>
                      <strong>{formatVnd(farFee + botFee)}</strong>
                    </div>
                    <div className="expense-calc-row">
                      <span>Phí hải quan</span>
                      <strong>{formatVnd(customsFee)}</strong>
                    </div>
                    <div className="expense-calc-row">
                      <span>Chiết khấu</span>
                      <strong>{formatVnd(discountFee)}</strong>
                    </div>
                    <div className="expense-calc-row">
                      <span>Khác</span>
                      <strong>{formatVnd(otherFee)}</strong>
                    </div>
                    <div className="expense-calc-row">
                      <span>Chi phí phát sinh</span>
                      <strong>{formatVnd(extraCostTotal)}</strong>
                    </div>
                    <div className="expense-calc-total">
                      <span>Tổng chi phí tiền xe</span>
                      <strong className={computedExpenseAmount <= 0 ? 'expense' : ''}>
                        {formatVnd(computedExpenseAmount)}
                      </strong>
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
                    {computedExpenseAmount <= 0 ? (
                      <p className="expense-warning">Tổng chi phí phải lớn hơn 0 để lưu giao dịch.</p>
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
                          maxLength={400}
                          placeholder="VD: FCIU5956792, TGHU1234567"
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
                    <p className={`hint no-pad${containerOverflow ? ' expense-warning' : ''}`}>
                      {containerOverflow
                        ? `Đã nhập ${containerNumbers.length} số container, vượt quá tổng ${containerTotal} container (20' + 40').`
                        : `Nhập nhiều số container, cách nhau bằng dấu phẩy. Đã nhập ${containerNumbers.length}/${containerTotal}.`}
                    </p>
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

        {currentStep.key === 'profit' ? (
          <div className="wizard-page">
            <section className="form-section wizard-section">
              <div className="form-section-head">
                <span className="field-label">Lợi nhuận lô hàng</span>
                <span className="form-section-hint">Tổng thu nhập − tổng chi phí</span>
              </div>
              <div className="expense-calc">
                <div className="expense-calc-row">
                  <span>{serviceRevenueLabel}</span>
                  <strong>{formatVnd(serviceRevenue)}</strong>
                </div>
                <div className="expense-calc-row">
                  <span>VAT thu khách (8%)</span>
                  <strong>{formatVnd(serviceVat)}</strong>
                </div>
                <div className="expense-calc-row">
                  <span>Phí nâng khách hàng</span>
                  <strong>{formatVnd(customerLift)}</strong>
                </div>
                <div className="expense-calc-row">
                  <span>Phí hạ khách hàng</span>
                  <strong>{formatVnd(customerLower)}</strong>
                </div>
                <div className="expense-calc-row">
                  <span>Phụ thu hạ xa khách hàng</span>
                  <strong>{formatVnd(customerFar)}</strong>
                </div>
                <div className="expense-calc-row">
                  <span>Phí khác (thu khách)</span>
                  <strong>{formatVnd(otherIncome)}</strong>
                </div>
                <div className="expense-calc-row">
                  <span>Tổng thu nhập</span>
                  <strong>{formatVnd(totalIncome)}</strong>
                </div>
                <div className="expense-calc-row">
                  <span>Tổng chi phí tiền xe</span>
                  <strong>{formatVnd(totalExpense)}</strong>
                </div>
                <div className="expense-calc-total">
                  <span>Lợi nhuận</span>
                  <strong className={profit >= 0 ? 'income' : 'expense'}>
                    {formatSignedVnd(profit)}
                  </strong>
                </div>
              </div>
              <p className="hint no-pad">
                Tổng thu nhập = phí dịch vụ + VAT 8% + nâng/hạ + phụ thu hạ xa + phí khác. Tổng chi
                phí tiền xe = cost + VAT + nâng + hạ + hạ xa + bot + hải quan + chiết khấu + khác +
                phát sinh.
              </p>
              <p className="hint no-pad">
                Giao dịch chi phí sẽ lưu vào sổ: {formatVnd(expenseAmount)}.
              </p>
            </section>
          </div>
        ) : null}

        {error ? <p className="form-error">{error}</p> : null}
      </form>
    </Modal>
  );
}

const DRAFT_STEP_LABELS = ['Thông tin tờ khai', 'Chi phí', 'Lợi nhuận', 'Thu nhập'];

function formatDraftTime(value: string): string {
  const [date, time] = value.split(' ');
  if (!date) return '';
  return `${formatDate(date)}${time ? ` ${time.slice(0, 5)}` : ''}`;
}

export function TransactionDraftPicker({
  drafts,
  onClose,
  onCreate,
  onResume,
  onDelete,
}: {
  drafts: TransactionDraft[];
  onClose: () => void;
  onCreate: () => void;
  onResume: (draft: TransactionDraft) => void;
  onDelete: (draft: TransactionDraft) => Promise<void>;
}) {
  const toast = useToast();
  const [deleteTarget, setDeleteTarget] = useState<TransactionDraft | null>(null);
  const [deleting, setDeleting] = useState(false);

  return (
    <>
      <Modal
        title="Giao dịch nháp"
        subtitle="Chọn nháp để tiếp tục chỉnh sửa hoặc tạo giao dịch mới."
        onClose={onClose}
        width={560}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Đóng
            </button>
            <button type="button" className="btn btn-primary" onClick={onCreate}>
              Tạo giao dịch mới
            </button>
          </>
        }
      >
        {drafts.length === 0 ? (
          <p className="hint no-pad">Không có nháp nào.</p>
        ) : (
          <div className="attachment-list draft-list">
            {drafts.map((draft) => (
              <div className="attachment-item draft-item" key={draft.id}>
                <FileText size={15} />
                <div className="draft-info">
                  <strong title={draft.label}>{draft.label || 'Nháp mới'}</strong>
                  <span>
                    {DRAFT_STEP_LABELS[draft.step] ?? 'Nháp'} · Cập nhật{' '}
                    {formatDraftTime(draft.updatedAt)}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={() => onResume(draft)}
                >
                  Tiếp tục
                </button>
                <button
                  type="button"
                  className="icon-btn sm"
                  aria-label="Xoá nháp"
                  title="Xoá nháp"
                  onClick={() => setDeleteTarget(draft)}
                >
                  <Trash size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </Modal>
      {deleteTarget ? (
        <ConfirmDialog
          title="Xoá nháp?"
          description={
            <>
              Nháp <strong>{deleteTarget.label || 'Nháp mới'}</strong> sẽ bị xoá vĩnh viễn.
            </>
          }
          confirmLabel="Xoá nháp"
          danger
          busy={deleting}
          onClose={() => {
            if (!deleting) setDeleteTarget(null);
          }}
          onConfirm={() => {
            if (deleting) return;
            setDeleting(true);
            void onDelete(deleteTarget)
              .then(() => setDeleteTarget(null))
              .catch((error) => toast(getErrorMessage(error), 'error'))
              .finally(() => setDeleting(false));
          }}
        />
      ) : null}
    </>
  );
}

function formatFileSize(size: number): string {
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} MB`;
  if (size >= 1024) return `${Math.round(size / 1024)} KB`;
  return `${size} B`;
}
