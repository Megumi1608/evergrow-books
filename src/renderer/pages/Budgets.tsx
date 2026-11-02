import { useEffect, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  LoaderCircle,
  PiggyBank,
  SquarePen,
  Target,
  Trash,
} from 'lucide-react';
import type { BudgetData, BudgetRow } from '../../shared/types';
import { currentMonth, formatMonthLabel, shiftMonth } from '../../shared/dates';
import { formatNumber, formatVnd, parseAmount } from '../../shared/format';
import { api, getErrorMessage } from '../api';
import { useApp } from '../context';
import { useToast } from '../components/toast';
import { EmptyState, Modal, PageHeader, PageLoading } from '../components/ui';

export function BudgetsPage() {
  const { revision, bump } = useApp();
  const toast = useToast();
  const [month, setMonth] = useState(currentMonth());
  const [data, setData] = useState<BudgetData | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<BudgetRow | null>(null);
  const [copying, setCopying] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.budgets
      .get(month)
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
  }, [month, revision, toast]);

  const copyPrevious = async () => {
    setCopying(true);
    try {
      const result = await api.budgets.copyPrevious(month);
      setData(result);
      toast('Đã sao chép ngân sách tháng trước.');
    } catch (error) {
      toast(getErrorMessage(error), 'error');
    } finally {
      setCopying(false);
    }
  };

  const removeBudget = async (row: BudgetRow) => {
    try {
      const result = await api.budgets.remove(row.categoryId, month);
      setData(result);
      toast('Đã xoá ngân sách.');
    } catch (error) {
      toast(getErrorMessage(error), 'error');
    }
  };

  if (loading && !data) return <PageLoading />;

  const rows = data?.rows ?? [];
  const totalBudget = data?.totalBudget ?? 0;
  const totalSpent = data?.totalSpent ?? 0;
  const remaining = totalBudget - totalSpent;
  const overCount = rows.filter((row) => row.budget > 0 && row.usage > 100).length;

  return (
    <div className="page">
      <PageHeader
        title="Ngân sách"
        subtitle="Đặt hạn mức chi phí theo danh mục và theo dõi mức sử dụng."
        actions={
          <>
            <div className="month-nav">
              <button type="button" className="icon-btn" aria-label="Tháng trước" onClick={() => setMonth(shiftMonth(month, -1))}>
                <ChevronLeft size={17} />
              </button>
              <span className="month-label">{formatMonthLabel(month)}</span>
              <button type="button" className="icon-btn" aria-label="Tháng sau" onClick={() => setMonth(shiftMonth(month, 1))}>
                <ChevronRight size={17} />
              </button>
            </div>
            <button type="button" className="btn btn-outline" onClick={copyPrevious} disabled={copying}>
              {copying ? <LoaderCircle size={15} className="spin" /> : <Copy size={15} />}
              Sao chép tháng trước
            </button>
          </>
        }
      />

      <div className="summary-strip">
        <div>
          <span>Tổng ngân sách</span>
          <strong>{formatVnd(totalBudget)}</strong>
        </div>
        <div>
          <span>Đã chi trong ngân sách</span>
          <strong className="expense">{formatVnd(totalSpent)}</strong>
        </div>
        <div>
          <span>Còn lại</span>
          <strong className={remaining >= 0 ? 'warning' : 'expense'}>{formatVnd(remaining)}</strong>
        </div>
        <div>
          <span>Danh mục vượt</span>
          <strong className={overCount > 0 ? 'expense' : ''}>{overCount}</strong>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Target size={22} />}
            title="Chưa có danh mục chi phí"
            description="Tạo danh mục chi phí trước khi đặt ngân sách."
          />
        </div>
      ) : (
        <div className="card table-card">
          <div className="table-wrap">
            <table className="tx-table budget-table">
              <thead>
                <tr>
                  <th>Danh mục</th>
                  <th className="num">Ngân sách</th>
                  <th className="num">Đã chi</th>
                  <th className="num">Còn lại</th>
                  <th>Tiến độ</th>
                  <th aria-label="Thao tác" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const left = row.budget - row.spent;
                  const progress = row.budget > 0 ? Math.min(100, row.usage) : 0;
                  const tone = row.budget > 0 && row.usage > 100 ? 'expense' : row.budget > 0 && row.usage >= 80 ? 'warning' : 'normal';
                  return (
                    <tr key={row.categoryId}>
                      <td>
                        <span className="cat-cell">
                          <i className="dot" />
                          {row.categoryName}
                        </span>
                      </td>
                      <td className="num">{row.budget > 0 ? `${formatNumber(row.budget)} đ` : '—'}</td>
                      <td className="num amount expense">{formatNumber(row.spent)} đ</td>
                      <td className={`num ${row.budget > 0 && left < 0 ? 'amount expense' : ''}`}>
                        {row.budget > 0 ? `${formatNumber(left)} đ` : '—'}
                      </td>
                      <td className="budget-progress">
                        {row.budget > 0 ? (
                          <>
                            <div className="bar-track">
                              <div className={`bar-fill budget-fill ${tone}`} style={{ width: `${progress}%` }} />
                            </div>
                            <span className={`budget-usage ${tone}`}>
                              {row.usage.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%
                            </span>
                          </>
                        ) : (
                          <span className="muted-note">Chưa đặt ngân sách</span>
                        )}
                      </td>
                      <td className="row-actions">
                        <button
                          type="button"
                          className="icon-btn sm"
                          aria-label="Đặt ngân sách"
                          title="Đặt ngân sách"
                          onClick={() => setEditing(row)}
                        >
                          <SquarePen size={15} />
                        </button>
                        {row.budget > 0 ? (
                          <button
                            type="button"
                            className="icon-btn sm danger"
                            aria-label="Xoá ngân sách"
                            title="Xoá ngân sách"
                            onClick={() => removeBudget(row)}
                          >
                            <Trash size={15} />
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editing ? (
        <BudgetModal
          row={editing}
          month={month}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            bump();
          }}
        />
      ) : null}
    </div>
  );
}

function BudgetModal({
  row,
  month,
  onClose,
  onSaved,
}: {
  row: BudgetRow;
  month: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [amountText, setAmountText] = useState(row.budget > 0 ? formatNumber(row.budget) : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const amount = parseAmount(amountText);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (amount <= 0) {
      setError('Nhập ngân sách lớn hơn 0.');
      return;
    }
    setSaving(true);
    try {
      await api.budgets.save({ categoryId: row.categoryId, month, amount });
      toast('Đã lưu ngân sách.');
      onSaved();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Đặt ngân sách"
      subtitle={`${row.categoryName} · ${formatMonthLabel(month)}`}
      onClose={onClose}
      width={420}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
            Huỷ
          </button>
          <button type="submit" form="budget-form" className="btn btn-primary" disabled={saving}>
            {saving ? <LoaderCircle size={15} className="spin" /> : <PiggyBank size={15} />}
            Lưu ngân sách
          </button>
        </>
      }
    >
      <form id="budget-form" className="form" onSubmit={submit}>
        <div className="debt-summary">
          <span>Đã chi trong tháng</span>
          <strong className="expense">{formatVnd(row.spent)}</strong>
        </div>
        <label className="field">
          <span className="field-label">Hạn mức chi phí tháng</span>
          <span className="amount-wrap">
            <input
              className="input"
              inputMode="numeric"
              autoFocus
              value={amountText}
              placeholder="0"
              onChange={(event) => {
                const parsed = parseAmount(event.target.value);
                setAmountText(parsed > 0 ? formatNumber(parsed) : '');
              }}
            />
            <span className="amount-suffix">đ</span>
          </span>
        </label>
        {error ? <p className="form-error">{error}</p> : null}
      </form>
    </Modal>
  );
}
