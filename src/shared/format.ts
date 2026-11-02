const numberFormatter = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });

export function formatNumber(value: number): string {
  return numberFormatter.format(Math.round(value));
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
