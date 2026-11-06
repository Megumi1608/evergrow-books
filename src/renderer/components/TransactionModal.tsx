import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ExternalLink, FileText, LoaderCircle, Paperclip, Plus, Trash } from 'lucide-react';
import type {
  AttachmentMeta,
  Category,
  Currency,
  Method,
  StagedAttachment,
  Transaction,
  TxInput,
  TxKind,
} from '../../shared/types';
import { CURRENCIES, CURRENCY_LABELS, CURRENCY_SUFFIX, METHOD_LABELS } from '../../shared/types';
import { todayIso } from '../../shared/dates';
import { formatNumber, formatVnd, parseAmount } from '../../shared/format';
import { api, getErrorMessage } from '../api';
import { feeLabel, orderedDetailEntries } from './FeeBreakdown';
import { useToast } from './toast';
import { Checkbox, ComboBox, DateInput, Dropdown, Modal, Segmented } from './ui';

const METHOD_OPTIONS = Object.entries(METHOD_LABELS) as [Method, string][];
const CURRENCY_OPTIONS = CURRENCIES.map((value) => ({ value, label: CURRENCY_LABELS[value] }));

const CONTAINER_UNIT_FEE = { '20': 6_300_000, '40': 7_300_000 } as const;
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
  const [kind, setKind] = useState<TxKind>(transaction?.kind ?? 'expense');
  const initialCurrency = transaction?.currency ?? 'VND';
  const initialInputAmount =
    transaction && initialCurrency !== 'VND' ? transaction.originalAmount : (transaction?.amount ?? 0);
  const [currency, setCurrency] = useState<Currency>(initialCurrency);
  const [inputAmount, setInputAmount] = useState(initialInputAmount);
  const [amountText, setAmountText] = useState(initialInputAmount ? formatNumber(initialInputAmount) : '');
  const [exchangeRate, setExchangeRate] = useState(transaction?.exchangeRate ?? 1);
  const [rateText, setRateText] = useState(String(transaction?.exchangeRate ?? 1));
  const [occurredOn, setOccurredOn] = useState(transaction?.occurredOn ?? todayIso());
  const [categoryId, setCategoryId] = useState(transaction?.categoryId ?? 0);
  const [method, setMethod] = useState<Method>(transaction?.method ?? 'bank');
  const [party, setParty] = useState(transaction?.party ?? '');
  const [note, setNote] = useState(transaction?.note ?? '');
  const [reference, setReference] = useState(transaction?.reference ?? '');
  const [port, setPort] = useState(transaction?.port ?? '');
  const [goodsName, setGoodsName] = useState(transaction?.goodsName ?? '');
  const [goodsType, setGoodsType] = useState(transaction?.goodsType ?? '');
  const [containerNo, setContainerNo] = useState(transaction?.containerNo ?? '');
  const [containerSize, setContainerSize] = useState(transaction?.containerSize ?? '');
  const [carrier, setCarrier] = useState(transaction?.carrier ?? '');
  const [warehouseAddress, setWarehouseAddress] = useState(transaction?.warehouseAddress ?? '');
  const initialContainer = parseContainerInfo(transaction?.containerSize ?? '');
  const [containerChoice, setContainerChoice] = useState<ContainerChoice>(initialContainer.size || '20');
  const [containerCount, setContainerCount] = useState(initialContainer.count);
  const [containerDirty, setContainerDirty] = useState(!transaction);
  const [amountDirty, setAmountDirty] = useState(!transaction);
  const [expenseCosts, setExpenseCosts] = useState(() => readExpenseCosts(transaction?.details ?? {}));
  const [customers, setCustomers] = useState<string[]>([]);
  const [carriers, setCarriers] = useState<string[]>([]);
  const [goodsTypes, setGoodsTypes] = useState<string[]>([]);
  const [trackDebt, setTrackDebt] = useState(Boolean(transaction?.dueDate));
  const [dueDate, setDueDate] = useState(transaction?.dueDate ?? '');
  const [paidAmount, setPaidAmount] = useState(transaction?.dueDate ? transaction.paidAmount : 0);
  const [paidText, setPaidText] = useState(
    transaction?.dueDate && transaction.paidAmount ? formatNumber(transaction.paidAmount) : '',
  );
  const [feeRows, setFeeRows] = useState(() =>
    orderedDetailEntries(transaction?.details ?? {}).map(([label, value]) => ({
      label: feeLabel(label),
      text: value ? formatNumber(value) : '',
    })),
  );
  const feeRowsRef = useRef<HTMLDivElement>(null);
  const focusNewFee = useRef(false);
  const [attachments, setAttachments] = useState<AttachmentMeta[]>([]);
  const [pendingAttachments, setPendingAttachments] = useState<StagedAttachment[]>([]);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [showExtras, setShowExtras] = useState(
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
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const manualAmountVnd = currency === 'VND' ? inputAmount : Math.round(inputAmount * exchangeRate);
  const serviceFee = Math.round(CONTAINER_UNIT_FEE[containerChoice] * containerCount * 1.08);
  const costValue = (key: ExpenseCostKey) => parseAmount(expenseCosts[key]);
  const truckFee =
    costValue('lift') + costValue('lower') + costValue('far') + costValue('bot');
  const remaining =
    serviceFee - (truckFee + costValue('customs') + costValue('discount') + costValue('other'));
  const computedExpenseAmount = Math.max(0, Math.round(remaining));
  const expenseAmount = amountDirty ? computedExpenseAmount : (transaction?.amount ?? computedExpenseAmount);
  const amountVnd = kind === 'expense' ? expenseAmount : manualAmountVnd;

  useEffect(() => {
    let alive = true;
    api.categories
      .list()
      .then((list) => {
        if (!alive) return;
        setCategories(list);
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

  const options = useMemo(() => categories.filter((category) => category.kind === kind), [categories, kind]);

  useEffect(() => {
    if (options.length === 0) return;
    if (!options.some((category) => category.id === categoryId)) {
      setCategoryId(options[0].id);
    }
  }, [options, categoryId]);

  const switchKind = (next: TxKind) => {
    setKind(next);
    const nextOptions = categories.filter((category) => category.kind === next);
    setCategoryId(nextOptions[0]?.id ?? 0);
  };

  const changeCurrency = (next: Currency) => {
    if (next === currency) return;
    if (next === 'VND') {
      const converted = amountVnd;
      setInputAmount(converted);
      setAmountText(converted ? formatNumber(converted) : '');
      setExchangeRate(1);
      setRateText('1');
    } else {
      setInputAmount(0);
      setAmountText('');
      setExchangeRate(1);
      setRateText('1');
    }
    setCurrency(next);
  };

  const updateExpenseCost = (key: ExpenseCostKey, raw: string) => {
    const parsed = parseAmount(raw);
    setExpenseCosts((current) => ({
      ...current,
      [key]: parsed > 0 ? formatNumber(parsed) : '',
    }));
    setAmountDirty(true);
  };

  const changeContainerChoice = (choice: ContainerChoice) => {
    setContainerChoice(choice);
    setContainerDirty(true);
    setAmountDirty(true);
  };

  const changeContainerCount = (raw: string) => {
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return;
    setContainerCount(Math.min(10, Math.max(1, parsed)));
    setContainerDirty(true);
    setAmountDirty(true);
  };

  const toggleDebt = (enabled: boolean) => {
    setTrackDebt(enabled);
    if (enabled) {
      setPaidAmount(0);
      setPaidText('');
    } else {
      setDueDate('');
      setPaidAmount(0);
      setPaidText('');
    }
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

  const updateFeeRow = (index: number, patch: Partial<{ label: string; text: string }>) => {
    setFeeRows((rows) => rows.map((row, position) => (position === index ? { ...row, ...patch } : row)));
  };

  const addFeeRow = () => {
    focusNewFee.current = true;
    setFeeRows((rows) => (rows.length >= 30 ? rows : [...rows, { label: '', text: '' }]));
  };

  useEffect(() => {
    if (!focusNewFee.current) return;
    focusNewFee.current = false;
    const lastRow = feeRowsRef.current?.lastElementChild as HTMLElement | null;
    lastRow?.scrollIntoView({ block: 'nearest' });
    lastRow?.querySelector('input')?.focus();
  }, [feeRows.length]);

  const removeFeeRow = (index: number) => {
    setFeeRows((rows) => rows.filter((_, position) => position !== index));
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
          value={expenseCosts[key]}
          placeholder="0"
          onChange={(event) => updateExpenseCost(key, event.target.value)}
        />
        <span className="amount-suffix">đ</span>
      </span>
    </label>
  );

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (occurredOn > todayIso()) {
      setError('Ngày giao dịch không được ở tương lai.');
      return;
    }
    if (kind === 'income' && inputAmount <= 0) {
      setError('Nhập số tiền lớn hơn 0.');
      return;
    }
    if (kind === 'income' && currency !== 'VND' && (!Number.isFinite(exchangeRate) || exchangeRate <= 0)) {
      setError('Nhập tỷ giá lớn hơn 0.');
      return;
    }
    if (kind === 'expense' && (amountDirty || !transaction) && computedExpenseAmount <= 0) {
      setError('Còn lại phải lớn hơn 0. Kiểm tra lại phí dịch vụ và các khoản chi phí.');
      return;
    }
    if (!categoryId) {
      setError('Chọn danh mục cho giao dịch.');
      return;
    }
    if (trackDebt && !dueDate) {
      setError('Chọn hạn thanh toán để theo dõi công nợ.');
      return;
    }

    let details: Record<string, number>;
    if (kind === 'expense') {
      details =
        amountDirty || !transaction
          ? buildExpenseDetails(transaction?.details ?? {}, {
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
          : { ...(transaction?.details ?? {}) };
    } else {
      details = {};
      for (const row of feeRows) {
        const label = row.label.trim().slice(0, 60);
        const value = parseAmount(row.text);
        if (label && value > 0) details[label] = value;
      }
    }

    const lookupTasks: Promise<unknown>[] = [];
    const saveLookup = (
      lookupKind: 'customers' | 'carriers' | 'goods_types',
      value: string,
      list: string[],
      setter: (values: string[]) => void,
    ) => {
      const trimmed = value.trim();
      if (!trimmed || list.some((item) => item.toLowerCase() === trimmed.toLowerCase())) return;
      lookupTasks.push(
        api.lookups
          .add(lookupKind, trimmed)
          .then((values) => setter(values))
          .then(() => undefined),
      );
    };
    saveLookup('customers', party, customers, setCustomers);
    saveLookup('carriers', carrier, carriers, setCarriers);
    saveLookup('goods_types', goodsType, goodsTypes, setGoodsTypes);
    await Promise.all(lookupTasks).catch(() => undefined);

    const effectiveContainerSize =
      kind === 'expense'
        ? containerDirty || !transaction
          ? `${containerChoice}' ×${containerCount}`
          : transaction.containerSize
        : containerSize;
    const effectiveCurrency: Currency = kind === 'expense' ? 'VND' : currency;
    const effectiveOriginalAmount =
      kind === 'expense' ? amountVnd : currency === 'VND' ? amountVnd : inputAmount;
    const effectiveExchangeRate = kind === 'expense' ? 1 : currency === 'VND' ? 1 : exchangeRate;
    const effectivePaidAmount = trackDebt ? Math.min(paidAmount, amountVnd) : amountVnd;
    const input: TxInput = {
      kind,
      amount: amountVnd,
      occurredOn,
      categoryId,
      party,
      note,
      method,
      reference,
      port,
      goodsName,
      goodsType,
      containerNo,
      containerSize: effectiveContainerSize,
      carrier,
      warehouseAddress,
      details,
      dueDate: trackDebt ? dueDate : '',
      paidAmount: effectivePaidAmount,
      currency: effectiveCurrency,
      originalAmount: effectiveOriginalAmount,
      exchangeRate: effectiveExchangeRate,
    };
    setSaving(true);
    try {
      const saved = transaction
        ? await api.transactions.update(transaction.id, input)
        : await api.transactions.create(input);
      if (!transaction && pendingAttachments.length > 0) {
        try {
          await api.attachments.commit(
            saved.id,
            pendingAttachments.map((attachment) => attachment.token),
          );
        } catch (attachmentError) {
          toast(
            `Giao dịch đã lưu nhưng chứng từ chưa đính kèm được: ${getErrorMessage(attachmentError)}`,
            'error',
          );
        }
      }
      toast(transaction ? 'Đã cập nhật giao dịch.' : 'Đã thêm giao dịch.');
      onSaved(saved);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={transaction ? 'Sửa giao dịch' : 'Thêm giao dịch'}
      subtitle={transaction ? 'Cập nhật thông tin khoản thu hoặc chi.' : 'Ghi nhận một khoản thu hoặc chi mới.'}
      onClose={onClose}
      width={kind === 'expense' ? 620 : 540}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
            Huỷ
          </button>
          <button type="submit" form="transaction-form" className="btn btn-primary" disabled={saving}>
            {saving ? <LoaderCircle size={15} className="spin" /> : null}
            {transaction ? 'Lưu thay đổi' : 'Thêm giao dịch'}
          </button>
        </>
      }
    >
      <form id="transaction-form" onSubmit={submit} className="form">
        <Segmented
          value={kind}
          onChange={switchKind}
          ariaLabel="Loại giao dịch"
          options={[
            { value: 'expense', label: 'Chi phí' },
            { value: 'income', label: 'Thu nhập' },
          ]}
        />

        {kind === 'income' ? (
          <>
        <div className="field amount-field">
          <div className="amount-head">
            <span className="field-label">Số tiền</span>
            <Dropdown
              className="currency-select"
              value={currency}
              onChange={changeCurrency}
              options={CURRENCY_OPTIONS}
              ariaLabel="Tiền tệ"
            />
          </div>
          <span className="amount-wrap">
            <input
              className="input amount-input"
              inputMode="numeric"
              autoFocus
              placeholder="0"
              value={amountText}
              onChange={(event) => {
                const parsed = parseAmount(event.target.value);
                setInputAmount(parsed);
                setAmountText(parsed > 0 ? formatNumber(parsed) : '');
              }}
            />
            <span className="amount-suffix">{CURRENCY_SUFFIX[currency]}</span>
          </span>
          {currency !== 'VND' ? (
            <div className="fx-row">
              <label className="fx-rate">
                <span>Tỷ giá (VND / 1 {currency})</span>
                <input
                  className="input"
                  type="number"
                  min="0.0001"
                  step="0.0001"
                  value={rateText}
                  onChange={(event) => {
                    setRateText(event.target.value);
                    const parsed = Number(event.target.value);
                    setExchangeRate(Number.isFinite(parsed) && parsed > 0 ? parsed : 0);
                  }}
                />
              </label>
              <div className="fx-total">
                <span>Quy đổi</span>
                <strong>{formatVnd(amountVnd)}</strong>
              </div>
            </div>
          ) : null}
        </div>

        <div className="form-row">
          <label className="field">
            <span className="field-label">Ngày giao dịch</span>
            <DateInput
              value={occurredOn}
              max={todayIso()}
              onChange={(event) => setOccurredOn(event.target.value)}
              aria-label="Ngày giao dịch"
            />
          </label>
          <label className="field">
            <span className="field-label">Hình thức</span>
            <Dropdown
              value={method}
              onChange={setMethod}
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
              value={categoryId}
              onChange={setCategoryId}
              options={options.map((category) => ({ value: category.id, label: category.name }))}
              placeholder={options.length === 0 ? 'Chưa có danh mục' : 'Chọn danh mục'}
              disabled={options.length === 0}
              size="md"
              ariaLabel="Danh mục"
            />
          </label>
          <label className="field">
            <span className="field-label">Đối tác</span>
            <input
              className="input"
              value={party}
              maxLength={160}
              placeholder="Tên khách hàng, nhà cung cấp…"
              onChange={(event) => setParty(event.target.value)}
            />
          </label>
        </div>

        <label className="field">
          <span className="field-label">Ghi chú</span>
          <textarea
            className="input textarea"
            value={note}
            maxLength={500}
            rows={3}
            placeholder="Thông tin thêm về giao dịch (không bắt buộc)"
            onChange={(event) => setNote(event.target.value)}
          />
        </label>

        <div className="detail-list">
          <div className="detail-list-head">
            <span className="field-label">Chi tiết phí</span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={addFeeRow}
              disabled={feeRows.length >= 30}
            >
              <Plus size={13} />
              Thêm khoản
            </button>
          </div>
          {feeRows.length === 0 ? (
            <p className="hint no-pad">Chưa có khoản phí. Bấm “Thêm khoản” để nhập.</p>
          ) : (
            <div className="fee-edit-rows" ref={feeRowsRef}>
              <div className="fee-edit-head" aria-hidden="true">
                <span>Tên khoản phí</span>
                <span>Số tiền</span>
                <span />
              </div>
              {feeRows.map((row, index) => (
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
          </>
        ) : null}

        {kind === 'expense' ? (
          <>
            <div className="form-row">
              <label className="field">
                <span className="field-label">Hình thức</span>
                <Dropdown
                  value={method}
                  onChange={setMethod}
                  options={METHOD_OPTIONS.map(([value, label]) => ({ value, label }))}
                  size="md"
                  ariaLabel="Hình thức thanh toán"
                />
              </label>
              <label className="field">
                <span className="field-label">Danh mục</span>
                <Dropdown
                  value={categoryId}
                  onChange={setCategoryId}
                  options={options.map((category) => ({ value: category.id, label: category.name }))}
                  placeholder={options.length === 0 ? 'Chưa có danh mục' : 'Chọn danh mục'}
                  disabled={options.length === 0}
                  size="md"
                  ariaLabel="Danh mục"
                />
              </label>
            </div>

            <div className="form-section">
              <div className="form-section-head">
                <span className="field-label">Thông tin tờ khai</span>
                <span className="form-section-hint">Thông tin lô hàng</span>
              </div>
              <div className="form-row">
                <label className="field">
                  <span className="field-label">Khách hàng</span>
                  <ComboBox
                    value={party}
                    onChange={setParty}
                    options={customers}
                    placeholder="Chọn hoặc nhập khách hàng mới"
                    ariaLabel="Khách hàng"
                  />
                </label>
                <label className="field">
                  <span className="field-label">Số tờ khai</span>
                  <input
                    className="input"
                    value={reference}
                    maxLength={80}
                    placeholder="VD: 108674195011"
                    onChange={(event) => setReference(event.target.value)}
                  />
                </label>
              </div>
              <div className="form-row">
                <label className="field">
                  <span className="field-label">Cửa khẩu</span>
                  <input
                    className="input"
                    value={port}
                    maxLength={80}
                    placeholder="VD: 15, HP"
                    onChange={(event) => setPort(event.target.value)}
                  />
                </label>
                <label className="field">
                  <span className="field-label">Tên hàng</span>
                  <input
                    className="input"
                    value={goodsName}
                    maxLength={160}
                    placeholder="VD: DOF LTD"
                    onChange={(event) => setGoodsName(event.target.value)}
                  />
                </label>
              </div>
              <div className="form-row">
                <label className="field">
                  <span className="field-label">Loại hàng</span>
                  <ComboBox
                    value={goodsType}
                    onChange={setGoodsType}
                    options={goodsTypes}
                    placeholder="VD: Phân bón"
                    ariaLabel="Loại hàng"
                  />
                </label>
                <label className="field">
                  <span className="field-label">Số container</span>
                  <input
                    className="input"
                    value={containerNo}
                    maxLength={80}
                    placeholder="VD: FCIU5956792"
                    onChange={(event) => setContainerNo(event.target.value)}
                  />
                </label>
              </div>
              <div className="form-row">
                <label className="field">
                  <span className="field-label">Số lượng cont</span>
                  <input
                    className="input"
                    type="number"
                    min="1"
                    max="10"
                    step="1"
                    value={containerCount}
                    onChange={(event) => changeContainerCount(event.target.value)}
                  />
                </label>
                <label className="field">
                  <span className="field-label">Kích thước cont</span>
                  <Dropdown
                    value={containerChoice}
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
              {!containerDirty && transaction?.containerSize ? (
                <p className="hint no-pad">
                  Dữ liệu cũ: {transaction.containerSize}. Sửa số lượng/kích thước để thay thế.
                </p>
              ) : null}
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
                    value={carrier}
                    onChange={setCarrier}
                    options={carriers}
                    placeholder="Chọn hoặc nhập đơn vị mới"
                    ariaLabel="Đơn vị vận chuyển"
                  />
                </label>
                <label className="field">
                  <span className="field-label">Ngày giao hàng</span>
                  <DateInput
                    value={occurredOn}
                    max={todayIso()}
                    onChange={(event) => setOccurredOn(event.target.value)}
                    aria-label="Ngày giao hàng"
                  />
                </label>
              </div>
              <label className="field">
                <span className="field-label">Địa chỉ kho</span>
                <input
                  className="input"
                  value={warehouseAddress}
                  maxLength={200}
                  placeholder="Địa chỉ kho nhận hàng"
                  onChange={(event) => setWarehouseAddress(event.target.value)}
                />
              </label>
              <label className="field">
                <span className="field-label">Ghi chú</span>
                <textarea
                  className="input textarea"
                  value={note}
                  maxLength={500}
                  rows={2}
                  placeholder="Thông tin thêm về giao dịch (không bắt buộc)"
                  onChange={(event) => setNote(event.target.value)}
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
                  6.300.000 đ/cont 20' · 7.300.000 đ/cont 40' + VAT 8%
                </span>
              </div>
              <div className="expense-calc">
                <div className="expense-calc-row">
                  <span>Phí dịch vụ (gồm VAT 8%)</span>
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
                  <strong>{formatVnd(amountVnd)}</strong>
                </div>
                {!amountDirty && transaction && transaction.amount !== computedExpenseAmount ? (
                  <div className="expense-recalc">
                    <span>Đang giữ số tiền cũ {formatVnd(transaction.amount)}.</span>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setAmountDirty(true)}
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
          </>
        ) : null}

        <div className="debt-block">
          <Checkbox
            checked={trackDebt}
            onChange={toggleDebt}
            label="Theo dõi công nợ"
            description="Bật để nhập hạn thanh toán và số tiền đã trả."
          />
          {trackDebt ? (
            <>
              <div className="form-row">
                <label className="field">
                  <span className="field-label">Hạn thanh toán</span>
                  <DateInput
                    value={dueDate}
                    onChange={(event) => setDueDate(event.target.value)}
                    aria-label="Hạn thanh toán"
                  />
                </label>
                <label className="field">
                  <span className="field-label">Đã thanh toán (VND)</span>
                  <span className="amount-wrap">
                    <input
                      className="input"
                      inputMode="numeric"
                      value={paidText}
                      placeholder="0"
                      onChange={(event) => {
                        const parsed = Math.min(parseAmount(event.target.value), amountVnd);
                        setPaidAmount(parsed);
                        setPaidText(parsed > 0 ? formatNumber(parsed) : '');
                      }}
                    />
                    <span className="amount-suffix">đ</span>
                  </span>
                </label>
              </div>
              <div className="debt-summary">
                <span>Còn nợ</span>
                <strong className={amountVnd - paidAmount > 0 ? 'expense' : ''}>
                  {formatVnd(Math.max(0, amountVnd - paidAmount))}
                </strong>
              </div>
            </>
          ) : (
            <p className="hint no-pad">Không theo dõi công nợ: giao dịch được xem là đã thanh toán đủ.</p>
          )}
        </div>

        {kind === 'income' ? (
          <>
        <button
          type="button"
          className={`section-toggle${showExtras ? ' open' : ''}`}
          onClick={() => setShowExtras((value) => !value)}
          aria-expanded={showExtras}
        >
          <span>Thông tin vận đơn</span>
          <span className="section-toggle-hint">Không bắt buộc</span>
          <ChevronDown size={15} />
        </button>

        {showExtras ? (
          <div className="form-extra">
            <div className="form-row">
              <label className="field">
                <span className="field-label">Số tờ khai</span>
                <input
                  className="input"
                  value={reference}
                  maxLength={80}
                  placeholder="VD: 108674195011"
                  onChange={(event) => setReference(event.target.value)}
                />
              </label>
              <label className="field">
                <span className="field-label">Cửa khẩu</span>
                <input
                  className="input"
                  value={port}
                  maxLength={80}
                  placeholder="VD: 15, HP"
                  onChange={(event) => setPort(event.target.value)}
                />
              </label>
            </div>
            <div className="form-row">
              <label className="field">
                <span className="field-label">Tên hàng</span>
                <input
                  className="input"
                  value={goodsName}
                  maxLength={160}
                  placeholder="VD: DOF LTD"
                  onChange={(event) => setGoodsName(event.target.value)}
                />
              </label>
              <label className="field">
                <span className="field-label">Loại hàng</span>
                <input
                  className="input"
                  value={goodsType}
                  maxLength={80}
                  placeholder="VD: Phân bón"
                  onChange={(event) => setGoodsType(event.target.value)}
                />
              </label>
            </div>
            <div className="form-row">
              <label className="field">
                <span className="field-label">Số container</span>
                <input
                  className="input"
                  value={containerNo}
                  maxLength={80}
                  placeholder="VD: FCIU5956792"
                  onChange={(event) => setContainerNo(event.target.value)}
                />
              </label>
              <label className="field">
                <span className="field-label">Kích thước cont</span>
                <input
                  className="input"
                  value={containerSize}
                  maxLength={80}
                  placeholder="VD: 20' ×1 · 40' ×1"
                  onChange={(event) => setContainerSize(event.target.value)}
                />
              </label>
            </div>
            <label className="field">
              <span className="field-label">Đơn vị vận chuyển</span>
              <input
                className="input"
                value={carrier}
                maxLength={120}
                placeholder="VD: Khôi Đạt"
                onChange={(event) => setCarrier(event.target.value)}
              />
            </label>
            <label className="field">
              <span className="field-label">Địa chỉ kho</span>
              <input
                className="input"
                value={warehouseAddress}
                maxLength={200}
                placeholder="Địa chỉ kho nhận hàng"
                onChange={(event) => setWarehouseAddress(event.target.value)}
              />
            </label>
          </div>
        ) : null}
          </>
        ) : null}

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
            <p className="hint no-pad">
              Chưa có chứng từ. Hỗ trợ ảnh PNG/JPG/WEBP/GIF và PDF, tối đa 10 MB.
              {!transaction ? ' Tệp sẽ được lưu khi bạn thêm giao dịch.' : ''}
            </p>
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
                      api.attachments.open(attachment.id).catch((err) => toast(getErrorMessage(err), 'error'))
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
