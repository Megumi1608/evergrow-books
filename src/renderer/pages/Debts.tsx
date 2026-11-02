import { useEffect, useMemo, useState } from 'react';
import { CircleAlert, CircleDollarSign, LoaderCircle, SquarePen, WalletCards } from 'lucide-react';
import type { DebtData, DebtItem, DebtStatus } from '../../shared/types';
import { formatDate } from '../../shared/dates';
import { formatNumber, formatVnd, parseAmount } from '../../shared/format';
import { api, getErrorMessage } from '../api';
import { useApp } from '../context';
import { useToast } from '../components/toast';
import { EmptyState, Modal, PageHeader, PageLoading, Segmented } from '../components/ui';

type DebtTab = 'all' | 'receivable' | 'payable' | 'overdue' | 'paid';

const STATUS_LABEL: Record<DebtStatus, string> = {
  unpaid: 'Chưa thanh toán',
  partial: 'Thanh toán một phần',
  overdue: 'Quá hạn',
  paid: 'Đã tất toán',
};

export function DebtsPage() {
  const { revision, bump, openTransaction } = useApp();
  const toast = useToast();
  const [data, setData] = useState<DebtData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<DebtTab>('all');
  const [paymentTarget, setPaymentTarget] = useState<DebtItem | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.debts
      .list()
      .then((result) => {
        if (alive) setData(result);
      })
      .catch((error) => {
        if (alive) toast(getErrorMessage(error), 'error');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [revision, toast]);

  const items = useMemo(() => {
    const list = data?.items ?? [];
    switch (tab) {
      case 'receivable':
        return list.filter((item) => item.transaction.kind === 'income');
      case 'payable':
        return list.filter((item) => item.transaction.kind === 'expense');
      case 'overdue':
        return list.filter((item) => item.outstanding > 0 && item.daysOverdue > 0);
      case 'paid':
        return list.filter((item) => item.outstanding <= 0);
      default:
        return list;
    }
  }, [data, tab]);

  if (loading && !data) return <PageLoading />;

  return (
    <div className="page">
      <PageHeader
        title="Công nợ"
        subtitle="Theo dõi khoản phải thu, phải trả và hạn thanh toán."
      />

      <div className="summary-strip">
        <div>
          <span>Phải thu</span>
          <strong className="income">{formatVnd(data?.receivable ?? 0)}</strong>
        </div>
        <div>
          <span>Phải trả</span>
          <strong className="expense">{formatVnd(data?.payable ?? 0)}</strong>
        </div>
        <div>
          <span>Quá hạn phải thu</span>
          <strong className={(data?.overdueReceivable ?? 0) > 0 ? 'expense' : ''}>
            {formatVnd(data?.overdueReceivable ?? 0)}
          </strong>
        </div>
        <div>
          <span>Quá hạn phải trả</span>
          <strong className={(data?.overduePayable ?? 0) > 0 ? 'expense' : ''}>
            {formatVnd(data?.overduePayable ?? 0)}
          </strong>
        </div>
        <div>
          <span>Đang theo dõi</span>
          <strong>{formatNumber(data?.tracked ?? 0)} khoản</strong>
        </div>
      </div>

      <div className="debt-aging card">
        <div className="card-head">
          <div>
            <h2>Tuổi nợ</h2>
            <p>{data?.overdueCount ?? 0} khoản đã quá hạn cần chú ý.</p>
          </div>
          <CircleAlert size={17} className="card-icon" />
        </div>
        <div className="aging-grid">
          {data?.aging.map((bucket) => (
            <div key={bucket.label} className="aging-item">
              <span>{bucket.label}</span>
              <strong className={bucket.receivable > 0 ? 'income' : ''}>
                Thu {formatNumber(bucket.receivable)} đ
              </strong>
              <strong className={bucket.payable > 0 ? 'expense' : ''}>
                Chi {formatNumber(bucket.payable)} đ
              </strong>
            </div>
          ))}
        </div>
      </div>

      <div className="filters card debt-tabs">
        <Segmented
          value={tab}
          onChange={setTab}
          ariaLabel="Lọc công nợ"
          options={[
            { value: 'all', label: 'Tất cả' },
            { value: 'receivable', label: 'Phải thu' },
            { value: 'payable', label: 'Phải trả' },
            { value: 'overdue', label: 'Quá hạn' },
            { value: 'paid', label: 'Đã tất toán' },
          ]}
        />
        <span className="filter-state filter-note">
          {data?.tracked ? `${data.tracked} giao dịch có theo dõi công nợ` : 'Chưa có giao dịch theo dõi công nợ'}
        </span>
      </div>

      {items.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<WalletCards size={22} />}
            title="Chưa có khoản công nợ"
            description="Bật “Theo dõi công nợ”, nhập hạn thanh toán và số tiền đã trả trong giao dịch để bắt đầu."
          />
        </div>
      ) : (
        <div className="card table-card">
          <div className="table-wrap">
            <table className="tx-table debt-table">
              <thead>
                <tr>
                  <th>Hạn</th>
                  <th>Trạng thái</th>
                  <th>Loại</th>
                  <th>Đối tác / nội dung</th>
                  <th>Số TK</th>
                  <th className="num">Tổng</th>
                  <th className="num">Đã trả</th>
                  <th className="num">Còn nợ</th>
                  <th aria-label="Thao tác" />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <DebtRow
                    key={item.transaction.id}
                    item={item}
                    onEdit={() => openTransaction(item.transaction)}
                    onPay={() => setPaymentTarget(item)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {paymentTarget ? (
        <PaymentModal
          item={paymentTarget}
          onClose={() => setPaymentTarget(null)}
          onPaid={() => {
            setPaymentTarget(null);
            bump();
          }}
        />
      ) : null}
    </div>
  );
}

function DebtRow({ item, onEdit, onPay }: { item: DebtItem; onEdit: () => void; onPay: () => void }) {
  const transaction = item.transaction;
  const remaining = item.outstanding;
  return (
    <tr>
      <td className={`date-cell${item.daysOverdue > 0 && remaining > 0 ? ' overdue-date' : ''}`}>
        {formatDate(transaction.dueDate)}
        {item.daysOverdue > 0 && remaining > 0 ? (
          <span className="overdue-days">+{item.daysOverdue} ngày</span>
        ) : null}
      </td>
      <td>
        <span className={`status-badge status-${item.status}`}>{STATUS_LABEL[item.status]}</span>
      </td>
      <td className={transaction.kind === 'income' ? 'income' : 'expense'}>
        {transaction.kind === 'income' ? 'Phải thu' : 'Phải trả'}
      </td>
      <td>
        <div className="tx-main">{transaction.party || transaction.categoryName}</div>
        <div className="tx-sub">
          {[transaction.categoryName, transaction.goodsName].filter(Boolean).join(' · ')}
        </div>
      </td>
      <td className="ref-cell">{transaction.reference || '—'}</td>
      <td className="num amount">{formatNumber(transaction.amount)} đ</td>
      <td className="num">{formatNumber(transaction.paidAmount)} đ</td>
      <td className={`num amount ${remaining > 0 ? 'expense' : ''}`}>{formatNumber(remaining)} đ</td>
      <td className="row-actions">
        {remaining > 0 ? (
          <button
            type="button"
            className="icon-btn sm"
            aria-label="Ghi thanh toán"
            title="Ghi thanh toán"
            onClick={onPay}
          >
            <CircleDollarSign size={15} />
          </button>
        ) : null}
        <button
          type="button"
          className="icon-btn sm"
          aria-label="Sửa giao dịch"
          title="Sửa giao dịch"
          onClick={onEdit}
        >
          <SquarePen size={15} />
        </button>
      </td>
    </tr>
  );
}

function PaymentModal({
  item,
  onClose,
  onPaid,
}: {
  item: DebtItem;
  onClose: () => void;
  onPaid: () => void;
}) {
  const toast = useToast();
  const [amountText, setAmountText] = useState(formatNumber(item.outstanding));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const amount = parseAmount(amountText);
  const transaction = item.transaction;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (amount <= 0 || amount > item.outstanding) {
      setError('Số tiền phải lớn hơn 0 và không vượt quá số còn nợ.');
      return;
    }
    setBusy(true);
    try {
      await api.debts.pay(transaction.id, amount);
      toast('Đã ghi nhận thanh toán.');
      onPaid();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Ghi nhận thanh toán"
      subtitle={`${transaction.kind === 'income' ? 'Phải thu' : 'Phải trả'} · ${transaction.party || transaction.categoryName}`}
      onClose={onClose}
      width={420}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Huỷ
          </button>
          <button type="submit" form="payment-form" className="btn btn-primary" disabled={busy}>
            {busy ? <LoaderCircle size={15} className="spin" /> : null}
            Ghi thanh toán
          </button>
        </>
      }
    >
      <form id="payment-form" className="form" onSubmit={submit}>
        <div className="debt-summary">
          <span>Còn nợ hiện tại</span>
          <strong>{formatVnd(item.outstanding)}</strong>
        </div>
        <label className="field">
          <span className="field-label">Số tiền thanh toán</span>
          <span className="amount-wrap">
            <input
              className="input"
              inputMode="numeric"
              autoFocus
              value={amountText}
              onChange={(event) => {
                const parsed = parseAmount(event.target.value);
                setAmountText(parsed > 0 ? formatNumber(parsed) : '');
              }}
            />
            <span className="amount-suffix">đ</span>
          </span>
        </label>
        <p className="hint no-pad">
          Ghi nhận từng phần bằng cách nhập số nhỏ hơn số còn nợ. Giao dịch sẽ tất toán khi đã trả đủ.
        </p>
        {error ? <p className="form-error">{error}</p> : null}
      </form>
    </Modal>
  );
}
