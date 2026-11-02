import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, LoaderCircle } from 'lucide-react';
import type { Category, Method, Transaction, TxInput, TxKind } from '../../shared/types';
import { METHOD_LABELS } from '../../shared/types';
import { todayIso } from '../../shared/dates';
import { formatNumber, parseAmount } from '../../shared/format';
import { api, getErrorMessage } from '../api';
import { useToast } from './toast';
import { Modal, Segmented, Select } from './ui';

const METHOD_OPTIONS = Object.entries(METHOD_LABELS) as [Method, string][];

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
  const [amount, setAmount] = useState(transaction?.amount ?? 0);
  const [amountText, setAmountText] = useState(transaction ? formatNumber(transaction.amount) : '');
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

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (occurredOn > todayIso()) {
      setError('Ngày giao dịch không được ở tương lai.');
      return;
    }
    if (amount <= 0) {
      setError('Nhập số tiền lớn hơn 0.');
      return;
    }
    if (!categoryId) {
      setError('Chọn danh mục cho giao dịch.');
      return;
    }
    const input: TxInput = {
      kind,
      amount,
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
      details: transaction?.details ?? {},
    };
    setSaving(true);
    try {
      const saved = transaction
        ? await api.transactions.update(transaction.id, input)
        : await api.transactions.create(input);
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

        <label className="field amount-field">
          <span className="field-label">Số tiền</span>
          <span className="amount-wrap">
            <input
              className="input amount-input"
              inputMode="numeric"
              autoFocus
              placeholder="0"
              value={amountText}
              onChange={(event) => {
                const parsed = parseAmount(event.target.value);
                setAmount(parsed);
                setAmountText(parsed > 0 ? formatNumber(parsed) : '');
              }}
            />
            <span className="amount-suffix">đ</span>
          </span>
        </label>

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

        {transaction && Object.keys(transaction.details).length > 0 ? (
          <div className="detail-list">
            <span className="field-label">Chi tiết phí (nhập từ Excel)</span>
            <div className="detail-rows">
              {Object.entries(transaction.details).map(([label, value]) => (
                <div className="detail-row" key={label}>
                  <span>{label}</span>
                  <strong>{formatNumber(value)} đ</strong>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {error ? <p className="form-error">{error}</p> : null}
      </form>
    </Modal>
  );
}
