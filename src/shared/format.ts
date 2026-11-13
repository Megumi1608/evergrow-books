const numberFormatter = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });
const decimalFormatter = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 });

export function formatNumber(value: number): string {
  return numberFormatter.format(Math.round(value));
}

export function formatDecimal(value: number): string {
  return decimalFormatter.format(value);
}

export function formatCurrencyAmount(value: number, currency: string): string {
  if (currency === 'VND') return `${formatNumber(value)} đ`;
  return `${decimalFormatter.format(value)} ${currency}`;
}

export function formatVnd(value: number): string {
  return `${formatNumber(value)} đ`;
}

export function formatSignedVnd(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${formatNumber(Math.abs(value))} đ`;
}

export function formatCompactVnd(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} tỷ`;
  }
  if (abs >= 1_000_000) {
    return `${(value / 1_000_000).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} tr`;
  }
  if (abs >= 1_000) {
    return `${(value / 1_000).toLocaleString('vi-VN', { maximumFractionDigits: 0 })} ng`;
  }
  return numberFormatter.format(value);
}

export function parseAmount(value: string): number {
  const digits = value.replace(/[^\d]/g, '');
  if (!digits) return 0;
  const amount = Number(digits);
  return Number.isSafeInteger(amount) ? amount : 0;
}

export function formatAmountInput(value: number): string {
  return value > 0 ? formatNumber(value) : '';
}

export function percentChange(current: number, previous: number): string {
  if (previous === 0) return current === 0 ? '0%' : '—';
  const change = ((current - previous) / previous) * 100;
  const sign = change > 0 ? '+' : '';
  return `${sign}${change.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`;
}

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

export function amountInWords(value: number): string {
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
