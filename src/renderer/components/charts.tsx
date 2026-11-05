import { useState } from 'react';
import type { MonthPoint } from '../../shared/types';
import { formatCompactVnd, formatNumber, formatVnd } from '../../shared/format';
import { formatMonthLabel, monthLabelShort } from '../../shared/dates';

function niceCeil(value: number): number {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const normalized = value / power;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * power;
}

export function MoneyChart({ data }: { data: MonthPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 760;
  const height = 252;
  const left = 56;
  const right = 14;
  const top = 18;
  const bottom = 34;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const rawMax = Math.max(1, ...data.map((point) => Math.max(point.income, point.expense)));
  const max = niceCeil(rawMax);
  const slot = plotWidth / Math.max(1, data.length);
  const barWidth = Math.min(34, Math.max(16, slot * 0.18));
  const gap = 6;
  const active = hover ?? data.length - 1;
  const focused = data[active];
  const empty = data.every((point) => point.income === 0 && point.expense === 0);

  return (
    <div className="chart">
      <div className="chart-readout">
        {focused ? (
          <>
            <span className="chart-month">{formatMonthLabel(focused.month)}</span>
            <span className="legend-item income">
              <i />
              Thu {formatNumber(focused.income)} đ
            </span>
            <span className="legend-item expense">
              <i />
              Chi {formatNumber(focused.expense)} đ
            </span>
          </>
        ) : null}
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="chart-svg"
        role="img"
        aria-label="Biểu đồ thu chi theo tháng"
      >
        {[0, 0.5, 1].map((ratio) => {
          const y = top + plotHeight * ratio;
          return (
            <g key={ratio}>
              <line x1={left} x2={width - right} y1={y} y2={y} className={ratio === 1 ? 'chart-axis' : 'chart-grid'} />
              <text x={left - 10} y={y + 3.5} className="chart-tick" textAnchor="end">
                {formatCompactVnd(max * (1 - ratio))}
              </text>
            </g>
          );
        })}
        {data.map((point, index) => {
          const center = left + slot * index + slot / 2;
          const incomeHeight = (point.income / max) * plotHeight;
          const expenseHeight = (point.expense / max) * plotHeight;
          const dim = hover !== null && hover !== index;
          return (
            <g
              key={point.month}
              onMouseEnter={() => setHover(index)}
              onMouseLeave={() => setHover(null)}
              className={dim ? 'chart-group dim' : 'chart-group'}
            >
              <rect x={left + slot * index} y={top} width={slot} height={plotHeight} fill="transparent" />
              <rect
                x={center - barWidth - gap / 2}
                y={top + plotHeight - incomeHeight}
                width={barWidth}
                height={Math.max(incomeHeight, point.income > 0 ? 2 : 0)}
                rx={3}
                className="chart-bar income"
                style={{ animationDelay: `${index * 45}ms` }}
              >
                <title>{`${formatMonthLabel(point.month)} · Thu ${formatVnd(point.income)}`}</title>
              </rect>
              <rect
                x={center + gap / 2}
                y={top + plotHeight - expenseHeight}
                width={barWidth}
                height={Math.max(expenseHeight, point.expense > 0 ? 2 : 0)}
                rx={3}
                className="chart-bar expense"
                style={{ animationDelay: `${index * 45}ms` }}
              >
                <title>{`${formatMonthLabel(point.month)} · Chi ${formatVnd(point.expense)}`}</title>
              </rect>
              <text
                x={center}
                y={height - 12}
                textAnchor="middle"
                className={index === active ? 'chart-label active' : 'chart-label'}
              >
                {monthLabelShort(point.month)}
              </text>
            </g>
          );
        })}
        {empty ? (
          <text x={left + plotWidth / 2} y={top + plotHeight / 2} textAnchor="middle" className="chart-empty">
            Chưa có dữ liệu trong 6 tháng
          </text>
        ) : null}
      </svg>
    </div>
  );
}

export function CategoryBars({
  items,
}: {
  items: { name: string; color: string; total: number; count?: number }[];
}) {
  const total = items.reduce((sum, item) => sum + item.total, 0);
  if (items.length === 0) {
    return <p className="muted-note">Chưa có khoản chi nào trong tháng.</p>;
  }
  return (
    <div className="cat-bars">
      {items.map((item, index) => {
        const percent = total === 0 ? 0 : (item.total / total) * 100;
        return (
          <div className="cat-row" key={`${item.name}-${index}`}>
            <div className="cat-row-top">
              <span className="cat-name">
                <i className="dot" />
                {item.name}
              </span>
              <span className="cat-amount expense">{formatVnd(item.total)}</span>
            </div>
            <div className="bar-track">
              <div
                className="bar-fill"
                style={{
                  width: `${Math.max(percent, 2)}%`,
                  opacity: Math.max(0.35, 0.9 - index * 0.12),
                  animationDelay: `${index * 45}ms`,
                }}
              />
            </div>
            <div className="cat-meta">
              {percent.toLocaleString('vi-VN', { maximumFractionDigits: 0 })}% tổng chi
              {item.count !== undefined ? ` · ${item.count} giao dịch` : ''}
            </div>
          </div>
        );
      })}
    </div>
  );
}
