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
import { Modal, Segmented, Select } from './ui';

const METHOD_OPTIONS = Object.entries(METHOD_LABELS) as [Method, string][];
const CURRENCY_OPTIONS = CURRENCIES.map((value) => ({ value, label: CURRENCY_LABELS[value] }));

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
        transaction?.carrier,
    ),
  );
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const amountVnd = currency === 'VND' ? inputAmount : Math.round(inputAmount * exchangeRate);

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

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (occurredOn > todayIso()) {
      setError('Ngày giao dịch không được ở tương lai.');
      return;
    }
    if (inputAmount <= 0) {
      setError('Nhập số tiền lớn hơn 0.');
      return;
    }
    if (currency !== 'VND' && (!Number.isFinite(exchangeRate) || exchangeRate <= 0)) {
      setError('Nhập tỷ giá lớn hơn 0.');
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
    if (trackDebt && paidAmount > amountVnd) {
      setError('Số tiền đã thanh toán không được vượt quá số tiền giao dịch.');
      return;
    }
    const details: Record<string, number> = {};
    for (const row of feeRows) {
      const label = row.label.trim().slice(0, 60);
      const value = parseAmount(row.text);
      if (label && value > 0) details[label] = value;
    }
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
      containerSize,
      carrier,
      details,
      dueDate: trackDebt ? dueDate : '',
      paidAmount: trackDebt ? paidAmount : amountVnd,
      currency,
      originalAmount: currency === 'VND' ? amountVnd : inputAmount,
      exchangeRate: currency === 'VND' ? 1 : exchangeRate,
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
      width={540}
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

        <div className="field amount-field">
          <div className="amount-head">
            <span className="field-label">Số tiền</span>
            <Select
              className="currency-select"
              value={currency}
              onChange={(event) => changeCurrency(event.target.value as Currency)}
              aria-label="Tiền tệ"
            >
              {CURRENCY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
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
            <input
              className="input"
              type="date"
              value={occurredOn}
              max={todayIso()}
              onChange={(event) => setOccurredOn(event.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-label">Hình thức</span>
            <Select value={method} onChange={(event) => setMethod(event.target.value as Method)}>
              {METHOD_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </label>
        </div>

        <div className="form-row">
          <label className="field">
            <span className="field-label">Danh mục</span>
            <Select value={categoryId} onChange={(event) => setCategoryId(Number(event.target.value))}>
              {options.length === 0 ? <option value={0}>Chưa có danh mục</option> : null}
              {options.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </Select>
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

        <div className="debt-block">
          <label className="check-row">
            <input
              type="checkbox"
              checked={trackDebt}
              onChange={(event) => toggleDebt(event.target.checked)}
            />
            <span>
              <strong>Theo dõi công nợ</strong>
              <small>Bật để nhập hạn thanh toán và số tiền đã trả.</small>
            </span>
          </label>
          {trackDebt ? (
            <>
              <div className="form-row">
                <label className="field">
                  <span className="field-label">Hạn thanh toán</span>
                  <input
                    className="input"
                    type="date"
                    value={dueDate}
                    onChange={(event) => setDueDate(event.target.value)}
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
          </div>
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
