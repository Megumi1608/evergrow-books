import { useEffect, useState } from 'react';
import {
  ChevronRight,
  Container,
  ListFilter,
  RotateCcw,
  Search,
  SquarePen,
} from 'lucide-react';
import type { ShipmentDetail, ShipmentSummary, Transaction } from '../../shared/types';
import { METHOD_LABELS } from '../../shared/types';
import { formatDate } from '../../shared/dates';
import { formatNumber, formatSignedVnd, formatVnd } from '../../shared/format';
import { api, getErrorMessage } from '../api';
import { useApp } from '../context';
import { useDebounced } from '../hooks';
import { useToast } from '../components/toast';
import { EmptyState, Modal, PageHeader, PageLoading } from '../components/ui';

export function ShipmentsPage() {
  const { revision, openTransaction } = useApp();
  const toast = useToast();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounced(query, 250);
  const [data, setData] = useState<ShipmentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<ShipmentDetail | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.shipments
      .list({
        from: from || undefined,
        to: to || undefined,
        q: debouncedQuery.trim() || undefined,
      })
      .then((rows) => {
        if (alive) setData(rows);
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
  }, [from, to, debouncedQuery, revision, toast]);

  const hasFilters = Boolean(from || to || query.trim());
  const resetFilters = () => {
    setFrom('');
    setTo('');
    setQuery('');
  };

  const openDetail = async (reference: string) => {
    try {
      const shipment = await api.shipments.get(reference);
      setDetail(shipment);
    } catch (error) {
      toast(getErrorMessage(error), 'error');
    }
  };

  const totals = data.reduce(
    (sum, row) => ({
      income: sum.income + row.income,
      expense: sum.expense + row.expense,
      profit: sum.profit + row.profit,
    }),
    { income: 0, expense: 0, profit: 0 },
  );
  const lossCount = data.filter((row) => row.profit < 0).length;
  const margin = totals.income > 0 ? (totals.profit / totals.income) * 100 : 0;

  if (loading && data.length === 0) return <PageLoading />;

  return (
    <div className="page">
      <PageHeader
        title="Lô hàng"
        subtitle="Gộp thu và chi theo Số tờ khai để xem lợi nhuận từng lô."
      />

      <div className="summary-strip">
        <div>
          <span>Lô hàng</span>
          <strong>{formatNumber(data.length)}</strong>
        </div>
        <div>
          <span>Tổng thu</span>
          <strong className="income">{formatVnd(totals.income)}</strong>
        </div>
        <div>
          <span>Tổng chi</span>
          <strong className="expense">{formatVnd(totals.expense)}</strong>
        </div>
        <div>
          <span>Lợi nhuận</span>
          <strong className={totals.profit >= 0 ? 'warning' : 'expense'}>
            {formatSignedVnd(totals.profit)}
          </strong>
        </div>
        <div>
          <span>Biên lợi nhuận</span>
          <strong className="warning">{margin.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%</strong>
        </div>
      </div>

      <div className="filters card">
        <div className="search-wrap">
          <Search size={15} />
          <input
            className="search-input"
            placeholder="Số tờ khai, khách hàng, container…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <label className="filter-item">
          <span>Từ ngày</span>
          <input className="input" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label className="filter-item">
          <span>Đến ngày</span>
          <input className="input" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        </label>
        {hasFilters ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={resetFilters}>
            <RotateCcw size={14} />
            Xoá lọc
          </button>
        ) : (
          <span className="filter-state">
            <ListFilter size={13} />
            Không lọc
          </span>
        )}
        <span className="filter-state filter-note">
          {lossCount > 0 ? `${lossCount} lô đang lỗ` : 'Không có lô lỗ'}
        </span>
      </div>

      {data.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Container size={22} />}
            title="Chưa có lô hàng"
            description="Lô hàng được tạo từ các giao dịch có nhập Số tờ khai."
          />
        </div>
      ) : (
        <div className="card table-card">
          <div className="table-wrap">
            <table className="tx-table shipment-table">
              <thead>
                <tr>
                  <th>Số tờ khai</th>
                  <th>Ngày</th>
                  <th>Khách hàng / hàng hóa</th>
                  <th>Container</th>
                  <th className="num">Thu</th>
                  <th className="num">Chi</th>
                  <th className="num">Lợi nhuận</th>
                  <th className="num">Biên</th>
                  <th aria-label="Chi tiết" />
                </tr>
              </thead>
              <tbody>
                {data.map((row) => (
                  <tr key={row.reference} className="clickable" onClick={() => openDetail(row.reference)}>
                    <td className="ref-cell">{row.reference}</td>
                    <td className="date-cell">
                      {formatDate(row.firstDate)}
                      {row.lastDate !== row.firstDate ? ` – ${formatDate(row.lastDate)}` : ''}
                    </td>
                    <td>
                      <div className="tx-main">{row.customer || '—'}</div>
                      <div className="tx-sub">
                        {[row.goodsType, ...row.goodsNames].filter(Boolean).join(' · ') || 'Chưa có thông tin hàng'}
                      </div>
                    </td>
                    <td className="container-cell">
                      {row.containers.slice(0, 2).join(', ') || '—'}
                      {row.containers.length > 2 ? ` +${row.containers.length - 2}` : ''}
                    </td>
                    <td className="num amount income">{formatNumber(row.income)} đ</td>
                    <td className="num amount expense">{formatNumber(row.expense)} đ</td>
                    <td className={`num amount ${row.profit >= 0 ? 'warning' : 'expense'}`}>
                      {formatSignedVnd(row.profit)}
                    </td>
                    <td className="num margin-cell">{row.margin.toLocaleString('vi-VN')}%</td>
                    <td className="row-actions">
                      <span className="icon-btn sm" aria-hidden="true">
                        <ChevronRight size={16} />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {detail ? (
        <ShipmentModal
          detail={detail}
          onClose={() => setDetail(null)}
          onEdit={(transaction) => {
            setDetail(null);
            openTransaction(transaction);
          }}
        />
      ) : null}
    </div>
  );
}

function ShipmentModal({
  detail,
  onClose,
  onEdit,
}: {
  detail: ShipmentDetail;
  onClose: () => void;
  onEdit: (transaction: Transaction) => void;
}) {
  const { summary } = detail;
  return (
    <Modal
      title={`Lô hàng ${summary.reference}`}
      subtitle={`${formatDate(summary.firstDate)}${summary.lastDate !== summary.firstDate ? ` – ${formatDate(summary.lastDate)}` : ''} · ${summary.count} giao dịch`}
      onClose={onClose}
      width={760}
      footer={
        <button type="button" className="btn btn-primary" onClick={onClose}>
          Đóng
        </button>
      }
    >
      <div className="shipment-detail">
        <div className="import-summary">
          <div>
            <span>Thu nhập</span>
            <strong className="income">{formatVnd(summary.income)}</strong>
          </div>
          <div>
            <span>Chi phí</span>
            <strong className="expense">{formatVnd(summary.expense)}</strong>
          </div>
          <div>
            <span>Lợi nhuận</span>
            <strong className={summary.profit >= 0 ? 'warning' : 'expense'}>
              {formatSignedVnd(summary.profit)}
            </strong>
          </div>
          <div>
            <span>Biên lợi nhuận</span>
            <strong className="warning">{summary.margin.toLocaleString('vi-VN')}%</strong>
          </div>
        </div>

        <div className="shipment-meta">
          <div>
            <span>Khách hàng</span>
            <strong>{summary.customer || '—'}</strong>
          </div>
          <div>
            <span>Loại hàng</span>
            <strong>{summary.goodsType || '—'}</strong>
          </div>
          <div>
            <span>Container</span>
            <strong>{summary.containers.join(', ') || '—'}</strong>
          </div>
        </div>

        <div className="import-table-wrap">
          <table className="mini-table import-table">
            <thead>
              <tr>
                <th>Ngày</th>
                <th>Loại</th>
                <th>Danh mục</th>
                <th>Đối tác</th>
                <th>Hình thức</th>
                <th className="num">Số tiền</th>
                <th aria-label="Sửa" />
              </tr>
            </thead>
            <tbody>
              {detail.transactions.map((transaction) => (
                <tr key={transaction.id}>
                  <td className="date-cell">{formatDate(transaction.occurredOn)}</td>
                  <td className={transaction.kind === 'income' ? 'income' : 'expense'}>
                    {transaction.kind === 'income' ? 'Thu' : 'Chi'}
                  </td>
                  <td>{transaction.categoryName}</td>
                  <td>
                    <div>{transaction.party || '—'}</div>
                    {transaction.note ? <div className="tx-sub">{transaction.note}</div> : null}
                  </td>
                  <td>{METHOD_LABELS[transaction.method]}</td>
                  <td className={`num amount ${transaction.kind}`}>
                    {transaction.kind === 'income' ? '+' : '−'}
                    {formatNumber(transaction.amount)} đ
                  </td>
                  <td className="row-actions">
                    <button
                      type="button"
                      className="icon-btn sm"
                      aria-label="Sửa giao dịch"
                      onClick={() => onEdit(transaction)}
                    >
                      <SquarePen size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}
