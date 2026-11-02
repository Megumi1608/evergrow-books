import { useEffect, useState } from 'react';
import {
  ArrowLeftRight,
  ChartColumn,
  Download,
  FileText,
  LoaderCircle,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import type { ReportData, TxKind } from '../../shared/types';
import { currentMonth, formatDate, monthBounds, rangePreset } from '../../shared/dates';
import { formatNumber, formatSignedVnd, formatVnd } from '../../shared/format';
import { api, getErrorMessage } from '../api';
import { useApp } from '../context';
import { useToast } from '../components/toast';
import { MoneyChart } from '../components/charts';
import { EmptyState, PageHeader, PageLoading, Segmented, StatCard } from '../components/ui';

type Preset = 'month' | 'quarter' | 'year' | 'custom';

export function ReportsPage() {
  const { revision } = useApp();
  const toast = useToast();
  const initial = monthBounds(currentMonth());
  const [preset, setPreset] = useState<Preset>('month');
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<'csv' | 'xlsx' | 'pdf' | null>(null);

  const invalidRange = Boolean(from && to && from > to);

  useEffect(() => {
    if (!from || !to || invalidRange) return;
    let alive = true;
    setLoading(true);
    api
      .report({ from, to })
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
  }, [from, to, invalidRange, revision, toast]);

  const applyPreset = (next: Exclude<Preset, 'custom'>) => {
    const range = rangePreset(next);
    setPreset(next);
    setFrom(range.from);
    setTo(range.to);
  };

  const exportFile = async (format: 'csv' | 'xlsx' | 'pdf') => {
    if (invalidRange) return;
    setExporting(format);
    try {
      const result = await api.exportFile(format, { from, to });
      if (result.saved && result.path) toast(`Đã lưu ${result.path}`);
    } catch (error) {
      toast(getErrorMessage(error), 'error');
    } finally {
      setExporting(null);
    }
  };

  if (loading && !data) return <PageLoading />;

  const incomeItems = (data?.byCategory ?? []).filter((item) => item.kind === 'income');
  const expenseItems = (data?.byCategory ?? []).filter((item) => item.kind === 'expense');
  const count = data?.count ?? 0;

  return (
    <div className="page">
      <PageHeader
        title="Báo cáo"
        subtitle={
          data
            ? `${formatDate(from)} – ${formatDate(to)} · ${formatNumber(count)} giao dịch`
            : 'Tổng hợp thu chi theo khoảng thời gian.'
        }
        actions={
          <>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => exportFile('csv')}
              disabled={exporting !== null || invalidRange}
            >
              {exporting === 'csv' ? <LoaderCircle size={15} className="spin" /> : <Download size={15} />}
              CSV
            </button>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => exportFile('xlsx')}
              disabled={exporting !== null || invalidRange}
            >
              {exporting === 'xlsx' ? <LoaderCircle size={15} className="spin" /> : <Download size={15} />}
              Excel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => exportFile('pdf')}
              disabled={exporting !== null || invalidRange}
            >
              {exporting === 'pdf' ? <LoaderCircle size={16} className="spin" /> : <FileText size={16} />}
              Xuất PDF
            </button>
          </>
        }
      />

      <div className="card range-card">
        <Segmented
          value={preset === 'custom' ? ('custom' as Preset) : preset}
          onChange={(value) => {
            if (value !== 'custom') applyPreset(value as Exclude<Preset, 'custom'>);
          }}
          ariaLabel="Khoảng thời gian nhanh"
          options={[
            { value: 'month' as Preset, label: 'Tháng này' },
            { value: 'quarter' as Preset, label: 'Quý này' },
            { value: 'year' as Preset, label: 'Năm nay' },
            ...(preset === 'custom' ? [{ value: 'custom' as Preset, label: 'Tuỳ chọn' }] : []),
          ]}
        />
        <div className="range-dates">
          <label className="filter-item">
            <span>Từ ngày</span>
            <input
              className="input"
              type="date"
              value={from}
              onChange={(event) => {
                setFrom(event.target.value);
                setPreset('custom');
              }}
            />
          </label>
          <span className="range-dash">–</span>
          <label className="filter-item">
            <span>Đến ngày</span>
            <input
              className="input"
              type="date"
              value={to}
              onChange={(event) => {
                setTo(event.target.value);
                setPreset('custom');
              }}
            />
          </label>
        </div>
        {invalidRange ? <p className="inline-error">Ngày bắt đầu phải trước ngày kết thúc.</p> : null}
      </div>

      <section className="kpi-grid">
        <StatCard
          label="Thu nhập"
          value={formatVnd(data?.income ?? 0)}
          tone="income"
          icon={<TrendingUp size={16} />}
          foot="Trong khoảng đã chọn"
        />
        <StatCard
          label="Chi phí"
          value={formatVnd(data?.expense ?? 0)}
          tone="expense"
          icon={<TrendingDown size={16} />}
          foot="Trong khoảng đã chọn"
        />
        <StatCard
          label="Chênh lệch"
          value={formatSignedVnd(data?.net ?? 0)}
          tone={(data?.net ?? 0) >= 0 ? 'warning' : 'expense'}
          icon={<Wallet size={16} />}
          foot="Thu nhập trừ chi phí"
        />
        <StatCard
          label="Số giao dịch"
          value={formatNumber(count)}
          tone="neutral"
          icon={<ArrowLeftRight size={16} />}
          foot="Đã ghi nhận"
        />
      </section>

      {invalidRange ? null : count === 0 ? (
        <div className="card">
          <EmptyState
            icon={<ChartColumn size={22} />}
            title="Không có dữ liệu trong khoảng này"
            description="Chọn khoảng thời gian khác hoặc ghi nhận thêm giao dịch."
          >
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => applyPreset('month')}
            >
              Về tháng này
            </button>
          </EmptyState>
        </div>
      ) : (
        <>
          <div className="card chart-card">
            <div className="card-head">
              <div>
                <h2>Thu chi theo tháng</h2>
                <p>Dòng tiền trong khoảng thời gian đã chọn.</p>
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
            <MoneyChart data={data?.byMonth ?? []} />
          </div>

          <div className="breakdown-grid">
            <BreakdownTable
              title="Cơ cấu thu nhập"
              kind="income"
              items={incomeItems}
              total={data?.income ?? 0}
            />
            <BreakdownTable
              title="Cơ cấu chi phí"
              kind="expense"
              items={expenseItems}
              total={data?.expense ?? 0}
            />
          </div>
        </>
      )}
    </div>
  );
}

function BreakdownTable({
  title,
  kind,
  items,
  total,
}: {
  title: string;
  kind: TxKind;
  items: { name: string; color: string; total: number; count: number }[];
  total: number;
}) {
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>{title}</h2>
          <p>{items.length} danh mục</p>
        </div>
        <span className={`card-total ${kind}`}>{formatVnd(total)}</span>
      </div>
      {items.length === 0 ? (
        <p className="muted-note">Chưa có dữ liệu trong khoảng này.</p>
      ) : (
        <table className="breakdown-table">
          <thead>
            <tr>
              <th>Danh mục</th>
              <th className="num">Số tiền</th>
              <th className="num">Tỷ trọng</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const percent = total === 0 ? 0 : (item.total / total) * 100;
              return (
                <tr key={`${item.name}-${item.color}`}>
                  <td>
                    <span className="cat-cell">
                      <i className="dot" />
                      {item.name}
                    </span>
                    <span className="breakdown-count">{item.count} giao dịch</span>
                  </td>
                  <td className="num">{formatNumber(item.total)} đ</td>
                  <td className="num">{percent.toLocaleString('vi-VN', { maximumFractionDigits: 0 })}%</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td>Tổng cộng</td>
              <td className="num">{formatNumber(total)} đ</td>
              <td className="num">100%</td>
            </tr>
          </tfoot>
        </table>
      )}
    </section>
  );
}
