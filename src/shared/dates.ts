export function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function currentMonth(): string {
  return todayIso().slice(0, 7);
}

export function monthBounds(month: string): { from: string; to: string } {
  const [year, monthNumber] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${pad(lastDay)}` };
}

export function shiftMonth(month: string, delta: number): string {
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`;
}

export function formatDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  return `${day}/${month}/${year}`;
}

export function formatMonthLabel(month: string): string {
  const [year, monthNumber] = month.split('-');
  return `Tháng ${Number(monthNumber)}, ${year}`;
}

export function monthLabelShort(month: string): string {
  const [year, monthNumber] = month.split('-');
  return `T${Number(monthNumber)}/${year.slice(2)}`;
}

export function rangePreset(preset: 'month' | 'quarter' | 'year'): { from: string; to: string } {
  const today = todayIso();
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  if (preset === 'month') return monthBounds(today.slice(0, 7));
  if (preset === 'quarter') {
    const startMonth = Math.floor((month - 1) / 3) * 3 + 1;
    const endMonth = startMonth + 2;
    const from = `${year}-${pad(startMonth)}-01`;
    const to = endMonth === 12 ? `${year}-12-31` : monthBounds(`${year}-${pad(endMonth)}`).to;
    return { from, to };
  }
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}
