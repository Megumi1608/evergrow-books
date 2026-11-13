import { useEffect, useState } from 'react';
import {
  ArrowLeftRight,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Percent,
  Plus,
  Receipt,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import type { DashboardData, DataStats } from '../../shared/types';
import { currentMonth, formatDate, formatMonthLabel, shiftMonth } from '../../shared/dates';
import { formatNumber, formatSignedVnd, formatVnd, percentChange } from '../../shared/format';
import { api, getErrorMessage } from '../api';
import { useApp } from '../context';
import { useToast } from '../components/toast';
import { CategoryBars, MoneyChart } from '../components/charts';
import { EmptyState, PageHeader, PageLoading, StatCard } from '../components/ui';
import { transactionMeta, transactionTitle } from '../transactionText';

export function DashboardPage() {
  const { revision, bump, openTransaction } = useApp();
  const toast = useToast();
  const [month, setMonth] = useState(currentMonth());
  const [data, setData] = useState<DashboardData | null>(null);
  const [stats, setStats] = useState<DataStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .dashboard(month)
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

  useEffect(() => {
    let alive = true;
    api.data
      .stats()
      .then((result) => {
        if (alive) setStats(result);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [revision]);

  const seed = async () => {
    setSeeding(true);
    try {
      const result = await api.data.seedDemo();
      toast(`Đã thêm ${result.inserted} giao dịch mẫu.`);
      bump();
    } catch (error) {
      toast(getErrorMessage(error), 'error');
    } finally {
      setSeeding(false);
    }
  };

  if (loading && !data) return <PageLoading />;

  const current = currentMonth();
  const count = data?.count ?? 0;

  return (
    <div className="page">
      <PageHeader
        title="Tổng quan"
        subtitle="Dòng tiền của công ty trong tháng."
        actions={
          <>
            <div className="month-nav">
              <button
                type="button"
                className="icon-btn"
                aria-label="Tháng trước"
                onClick={() => setMonth(shiftMonth(month, -1))}
              >
                <ChevronLeft size={17} />
              </button>
              <span className="month-label">{formatMonthLabel(month)}</span>
              <button
                type="button"
                className="icon-btn"
                aria-label="Tháng sau"
                disabled={month >= current}
                onClick={() => setMonth(shiftMonth(month, 1))}
              >
                <ChevronRight size={17} />
              </button>
            </div>
            <button type="button" className="btn btn-primary" onClick={() => openTransaction()}>
              <Plus size={16} />
              Thêm giao dịch
            </button>
          </>
        }
      />

      <section className="kpi-grid">
        <StatCard
          label="Thu nhập"
          value={formatVnd(data?.income ?? 0)}
          tone="income"
          icon={<TrendingUp size={16} />}
          foot={`${percentChange(data?.income ?? 0, data?.prevIncome ?? 0)} so với tháng trước`}
        />
        <StatCard
          label="Chi phí"
          value={formatVnd(data?.expense ?? 0)}
          tone="expense"
          icon={<TrendingDown size={16} />}
          foot={`${percentChange(data?.expense ?? 0, data?.prevExpense ?? 0)} so với tháng trước`}
        />
        <StatCard
          label="Hải quan & chiết khấu"
          value={formatVnd(data?.deductions ?? 0)}
          tone="warning"
          icon={<Percent size={16} />}
          foot="Trừ vào lợi nhuận"
        />
        <StatCard
          label="Lợi nhuận"
          value={formatSignedVnd(data?.net ?? 0)}
          tone={(data?.net ?? 0) >= 0 ? 'warning' : 'expense'}
          icon={<Wallet size={16} />}
          foot="Sau hải quan & chiết khấu"
        />
        <StatCard
          label="Số giao dịch"
          value={formatNumber(count)}
          tone="neutral"
          icon={<ArrowLeftRight size={16} />}
          foot="Giao dịch trong tháng"
        />
      </section>

      {count === 0 ? (
        <div className="card onboarding">
          <EmptyState
            icon={<Receipt size={22} />}
            title={`Chưa có giao dịch trong ${formatMonthLabel(month).toLowerCase()}`}
            description="Ghi nhận khoản thu hoặc chi đầu tiên, hoặc xem thử giao diện với dữ liệu mẫu."
          >
            <button type="button" className="btn btn-primary" onClick={() => openTransaction()}>
              <Plus size={16} />
              Thêm giao dịch
            </button>
            {stats?.transactions === 0 ? (
              <button type="button" className="btn btn-outline" onClick={seed} disabled={seeding}>
                {seeding ? <Sparkles size={16} className="spin" /> : <Sparkles size={16} />}
                Dùng dữ liệu mẫu
              </button>
            ) : null}
          </EmptyState>
        </div>
      ) : (
        <>
          <div className="dash-grid">
            <div className="card chart-card">
              <div className="card-head">
                <div>
                  <h2>Dòng tiền 6 tháng</h2>
                  <p>So sánh thu nhập và chi phí theo tháng.</p>
                </div>
                <div className="legend">
                  <span className="legend-item income">
                    <i />
                    Thu
                  </span>
                  <span className="legend-item expense">
                    <i />
                    Chi
                  </span>
                </div>
              </div>
              <MoneyChart data={data?.series ?? []} />
            </div>

            <div className="card category-card">
              <div className="card-head">
                <div>
                  <h2>Chi phí theo danh mục</h2>
                  <p>Top khoản chi lớn nhất trong tháng.</p>
                </div>
                <span className="card-total">{formatVnd(data?.expense ?? 0)}</span>
              </div>
              <CategoryBars items={data?.topExpense ?? []} />
            </div>
          </div>

          <div className="card recent-card">
            <div className="card-head">
              <div>
                <h2>Giao dịch gần đây</h2>
                <p>Cập nhật mới nhất trong tháng.</p>
              </div>
              <a className="link" href="#/transactions">
                Xem tất cả
                <ArrowRight size={14} />
              </a>
            </div>
            <table className="mini-table">
              <thead>
                <tr>
                  <th>Ngày</th>
                  <th>Danh mục</th>
                  <th>Đối tác / ghi chú</th>
                  <th className="num">Số tiền</th>
                </tr>
              </thead>
              <tbody>
                {(data?.recent ?? []).map((transaction) => (
                  <tr key={transaction.id} onClick={() => openTransaction(transaction)} className="clickable">
                    <td className="date-cell">{formatDate(transaction.occurredOn)}</td>
                    <td>
                      <span className="cat-cell">
                        <i className="dot" style={{ background: transaction.categoryColor }} />
                        {transaction.categoryName}
                      </span>
                    </td>
                    <td>
                      <div className="tx-main">{transactionTitle(transaction)}</div>
                      {transactionMeta(transaction) ? (
                        <div className="tx-sub">{transactionMeta(transaction)}</div>
                      ) : null}
                    </td>
                    <td className={`num amount ${transaction.kind === 'income' ? 'income' : 'expense'}`}>
                      {transaction.kind === 'income' ? '+' : '−'}
                      {formatNumber(transaction.amount)} đ
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
