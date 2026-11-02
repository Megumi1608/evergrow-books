import { useEffect, useRef, useState } from 'react';
import type { ReportData } from '../../shared/types';
import { METHOD_LABELS } from '../../shared/types';
import { formatDate, todayIso } from '../../shared/dates';
import { formatNumber, formatSignedVnd } from '../../shared/format';
import { api, getErrorMessage } from '../api';
import { LOGO_LOCKUP } from '../../shared/brand';

export function PrintReport({ params }: { params: URLSearchParams }) {
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const [report, setReport] = useState<ReportData | null>(null);
  const [company, setCompany] = useState('');
  const [error, setError] = useState('');
  const readySent = useRef(false);

  useEffect(() => {
    let alive = true;
    Promise.all([api.report({ from, to }), api.settings.get()])
      .then(([reportData, settings]) => {
        if (!alive) return;
        setCompany(settings.companyName);
        setReport(reportData);
      })
      .catch((err) => {
        if (alive) setError(getErrorMessage(err));
      });
    return () => {
      alive = false;
    };
  }, [from, to]);

  useEffect(() => {
    if (!report && !error) return;
    let cancelled = false;
    const prepare = async () => {
      await document.fonts.ready;
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      if (!cancelled && !readySent.current) {
        readySent.current = true;
        api.printReady();
      }
    };
    void prepare();
    return () => {
      cancelled = true;
    };
  }, [report, error]);

  if (error) {
    return (
      <div className="print-root">
        <article className="print-sheet">
          <h1>Không thể tạo báo cáo</h1>
          <p className="print-error">{error}</p>
        </article>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="print-root print-loading">
        <p>Đang chuẩn bị báo cáo…</p>
      </div>
    );
  }

  const incomeRows = report.byCategory.filter((item) => item.kind === 'income');
  const expenseRows = report.byCategory.filter((item) => item.kind === 'expense');

  return (
    <div className="print-root">
      <article className="print-sheet">
        <header className="print-head">
          <div className="print-brand">
            <img className="print-logo" src={LOGO_LOCKUP} alt="Evergrow" />
            <div className="print-company">
              <strong>{company}</strong>
              <span>Sổ thu chi doanh nghiệp</span>
            </div>
          </div>
          <div className="print-generated">Lập ngày {formatDate(todayIso())}</div>
        </header>

        <h1>Báo cáo thu chi</h1>
        <p className="print-period">
          Kỳ báo cáo: {formatDate(report.from)} – {formatDate(report.to)} · {formatNumber(report.count)} giao dịch
        </p>

        <section className="print-summary">
          <div>
            <span>Thu nhập</span>
            <strong>{formatNumber(report.income)} đ</strong>
          </div>
          <div>
            <span>Chi phí</span>
            <strong>{formatNumber(report.expense)} đ</strong>
          </div>
          <div>
            <span>Chênh lệch</span>
            <strong>{formatSignedVnd(report.net)}</strong>
          </div>
        </section>

        <section className="print-section">
          <h2>Cơ cấu theo danh mục</h2>
          <table className="print-table">
            <thead>
              <tr>
                <th>Danh mục</th>
                <th>Loại</th>
                <th className="num">Số giao dịch</th>
                <th className="num">Số tiền</th>
              </tr>
            </thead>
            <tbody>
              {report.byCategory.length === 0 ? (
                <tr>
                  <td colSpan={4} className="print-empty">
                    Không có giao dịch trong kỳ.
                  </td>
                </tr>
              ) : null}
              {[...incomeRows, ...expenseRows].map((item) => (
                <tr key={`${item.kind}-${item.name}`}>
                  <td>{item.name}</td>
                  <td>{item.kind === 'income' ? 'Thu nhập' : 'Chi phí'}</td>
                  <td className="num">{item.count}</td>
                  <td className="num">{formatNumber(item.total)} đ</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="print-section">
          <h2>Chi tiết theo tháng</h2>
          <table className="print-table">
            <thead>
              <tr>
                <th>Tháng</th>
                <th className="num">Thu nhập</th>
                <th className="num">Chi phí</th>
                <th className="num">Chênh lệch</th>
              </tr>
            </thead>
            <tbody>
              {report.byMonth.map((point) => (
                <tr key={point.month}>
                  <td>{point.month.split('-').reverse().join('/')}</td>
                  <td className="num">{formatNumber(point.income)} đ</td>
                  <td className="num">{formatNumber(point.expense)} đ</td>
                  <td className="num">{formatSignedVnd(point.income - point.expense)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="print-section">
          <h2>Danh sách giao dịch</h2>
          <table className="print-table print-tx">
            <thead>
              <tr>
                <th>Ngày</th>
                <th>Số TK</th>
                <th>Loại</th>
                <th>Danh mục</th>
                <th>Đối tác / hàng hóa</th>
                <th>Hình thức</th>
                <th className="num">Số tiền</th>
              </tr>
            </thead>
            <tbody>
              {report.transactions.map((transaction) => (
                <tr key={transaction.id}>
                  <td>{formatDate(transaction.occurredOn)}</td>
                  <td>{transaction.reference || '—'}</td>
                  <td>{transaction.kind === 'income' ? 'Thu' : 'Chi'}</td>
                  <td>{transaction.categoryName}</td>
                  <td>
                    {transaction.party || '—'}
                    {transaction.containerNo ? (
                      <span className="print-note"> · Cont {transaction.containerNo}</span>
                    ) : null}
                    {transaction.containerSize ? (
                      <span className="print-note"> · {transaction.containerSize}</span>
                    ) : null}
                    {transaction.note ? <span className="print-note"> · {transaction.note}</span> : null}
                  </td>
                  <td>{METHOD_LABELS[transaction.method]}</td>
                  <td className={`num ${transaction.kind === 'income' ? 'income' : 'expense'}`}>
                    {transaction.kind === 'income' ? '+' : '−'}
                    {formatNumber(transaction.amount)} đ
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <footer className="print-foot">
          <span>Được tạo bởi Evergrow Books</span>
          <span>{formatDate(todayIso())}</span>
        </footer>
      </article>
    </div>
  );
}
