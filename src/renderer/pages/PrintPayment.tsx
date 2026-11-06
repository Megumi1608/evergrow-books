import { useEffect, useMemo, useRef, useState } from 'react';
import type { PaymentRequestInput } from '../../shared/types';
import { formatDate, todayIso } from '../../shared/dates';
import { formatVnd } from '../../shared/format';
import { api, getErrorMessage } from '../api';
import { LOGO_LOCKUP } from '../../shared/brand';

const DIGITS = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];

function readGroup(group: number, hasHigher: boolean): string {
  const hundred = Math.floor(group / 100);
  const ten = Math.floor((group % 100) / 10);
  const unit = group % 10;
  const parts: string[] = [];
  if (hundred > 0 || hasHigher) parts.push(`${DIGITS[hundred]} trăm`);
  if (ten > 1) {
    parts.push(`${DIGITS[ten]} mươi`);
    if (unit === 1) parts.push('mốt');
    else if (unit === 5) parts.push('lăm');
    else if (unit > 0) parts.push(DIGITS[unit]);
  } else if (ten === 1) {
    parts.push('mười');
    if (unit === 5) parts.push('lăm');
    else if (unit > 0) parts.push(DIGITS[unit]);
  } else if (unit > 0) {
    if (hundred > 0 || hasHigher) parts.push('lẻ');
    parts.push(DIGITS[unit]);
  }
  return parts.join(' ');
}

function amountInWords(value: number): string {
  const amount = Math.round(value);
  if (!Number.isFinite(amount) || amount <= 0) return 'Không đồng';
  const groups: number[] = [];
  let rest = amount;
  while (rest > 0) {
    groups.push(rest % 1000);
    rest = Math.floor(rest / 1000);
  }
  const scales = ['', 'nghìn', 'triệu', 'tỷ', 'nghìn tỷ', 'triệu tỷ', 'tỷ tỷ'];
  let words = '';
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index];
    if (group === 0) continue;
    const hasHigher = words.length > 0;
    const read = readGroup(group, hasHigher);
    words += `${words ? ' ' : ''}${read}${scales[index] ? ` ${scales[index]}` : ''}`;
  }
  const result = `${words} đồng`;
  return `${result.charAt(0).toUpperCase()}${result.slice(1)}`;
}

function longDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  return `Ngày ${Number(day)} tháng ${Number(month)} năm ${year}`;
}

export function PrintPayment({ params }: { params: URLSearchParams }) {
  const [company, setCompany] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const readySent = useRef(false);

  const data = useMemo<PaymentRequestInput | null>(() => {
    const raw = params.get('data');
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as PaymentRequestInput;
      if (!parsed || typeof parsed !== 'object') return null;
      return parsed;
    } catch {
      return null;
    }
  }, [params]);

  useEffect(() => {
    if (!data) {
      setError('Thiếu dữ liệu yêu cầu thanh toán.');
      setLoading(false);
      return;
    }
    api.settings
      .get()
      .then((settings) => {
        setCompany(settings.companyName);
        setLoading(false);
      })
      .catch((err) => {
        setError(getErrorMessage(err));
        setLoading(false);
      });
  }, [data]);

  useEffect(() => {
    if (loading) return;
    let cancelled = false;
    const prepare = async () => {
      await document.fonts.ready;
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      if (!cancelled && !readySent.current) {
        readySent.current = true;
        api.printReady();
      }
    };
    void prepare();
    return () => {
      cancelled = true;
    };
  }, [loading]);

  if (error || !data) {
    return (
      <div className="print-root">
        <article className="print-sheet">
          <h1>Không thể tạo yêu cầu thanh toán</h1>
          <p className="print-error">{error || 'Thiếu dữ liệu yêu cầu thanh toán.'}</p>
        </article>
      </div>
    );
  }

  const today = todayIso();
  const total = data.serviceRevenue + data.truckFee;
  const companyName = company || 'Evergrow Books';
  const documentNo = data.reference ? `${data.reference}/YCTT` : `YCTT-${today.replace(/-/g, '')}`;

  return (
    <div className="print-root">
      <article className="print-sheet payment-sheet">
        <header className="payment-doc-head">
          <div className="print-brand">
            <img className="print-logo" src={LOGO_LOCKUP} alt="Evergrow" />
            <div className="print-company">
              <strong>{companyName}</strong>
              <span>Sổ thu chi doanh nghiệp</span>
            </div>
          </div>
          <div className="payment-motto">
            <strong>CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</strong>
            <span>Độc lập – Tự do – Hạnh phúc</span>
          </div>
        </header>
        <div className="payment-rule" />

        <h1 className="payment-title">Yêu cầu thanh toán</h1>
        <div className="payment-doc-meta">
          <span>Số: {documentNo}</span>
          <span>{longDate(today)}</span>
        </div>

        <p className="payment-salutation">
          <strong>Kính gửi:</strong> {data.customer || 'Quý Công ty'}
        </p>

        <p className="payment-intro">
          {companyName} trân trọng thông báo và đề nghị Quý Công ty thanh toán các khoản phí cho lô
          hàng theo thông tin dưới đây:
        </p>

        <h2 className="payment-section-title">I. Thông tin lô hàng</h2>
        <table className="payment-decl-table">
          <tbody>
            <tr>
              <td>Số tờ khai</td>
              <td>{data.reference || '—'}</td>
            </tr>
            <tr>
              <td>Cửa khẩu</td>
              <td>{data.port || '—'}</td>
            </tr>
            <tr>
              <td>Tên hàng</td>
              <td>{data.goodsName || '—'}</td>
            </tr>
            <tr>
              <td>Loại hàng</td>
              <td>{data.goodsType || '—'}</td>
            </tr>
            <tr>
              <td>Số container</td>
              <td>{data.containerNo || '—'}</td>
            </tr>
            <tr>
              <td>Kích thước container</td>
              <td>{data.containerSize || '—'}</td>
            </tr>
            {data.deliveryDate ? (
              <tr>
                <td>Ngày giao hàng</td>
                <td>{formatDate(data.deliveryDate)}</td>
              </tr>
            ) : null}
          </tbody>
        </table>

        <h2 className="payment-section-title">II. Nội dung thanh toán</h2>
        <table className="payment-amounts">
          <thead>
            <tr>
              <th className="stt">STT</th>
              <th>Nội dung</th>
              <th className="num">Số tiền (VND)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="stt">1</td>
              <td>Phí dịch vụ container</td>
              <td className="num">{formatVnd(data.serviceRevenue)}</td>
            </tr>
            <tr>
              <td className="stt">2</td>
              <td>Phí vận chuyển (tiền xe)</td>
              <td className="num">{formatVnd(data.truckFee)}</td>
            </tr>
            <tr className="total">
              <td colSpan={2}>Tổng cộng</td>
              <td className="num">{formatVnd(total)}</td>
            </tr>
          </tbody>
        </table>
        <p className="payment-words">
          <em>Số tiền bằng chữ:</em> <strong>{amountInWords(total)}</strong>
        </p>

        {data.note ? (
          <p className="payment-note">
            <strong>Ghi chú:</strong> {data.note}
          </p>
        ) : null}

        <p className="payment-intro">
          Đề nghị Quý Công ty thanh toán số tiền trên theo thông tin tờ khai đã cung cấp. Trường hợp
          cần đối chiếu, vui lòng liên hệ bộ phận kế toán của {companyName}.
        </p>
        <p className="payment-closing">Trân trọng cảm ơn.</p>

        <div className="payment-sign">
          <div>
            <strong>Người lập phiếu</strong>
            <span>(Ký, họ tên)</span>
          </div>
          <div>
            <strong>Giám đốc</strong>
            <span>(Ký, họ tên, đóng dấu)</span>
          </div>
        </div>

        <footer className="print-foot">
          <span>{companyName}</span>
          <span>{formatDate(today)}</span>
        </footer>
      </article>
    </div>
  );
}
