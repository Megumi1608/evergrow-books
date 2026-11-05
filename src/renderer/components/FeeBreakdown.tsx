import type { Transaction } from '../../shared/types';

const PREFERRED_ORDER = [
  'dongia',
  'phinang',
  'phiha',
  'taxi',
  'phuthuhaxa',
  'phuthu',
  'dichvu',
  'tienxe',
  'thanhtoantienxe',
  'haiquan',
  'chietkhau',
  'tienkhac',
];

function normalize(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

const DISPLAY_LABELS: Record<string, string> = {
  dongia: 'Đơn giá',
  phinang: 'Phí nâng',
  phiha: 'Phí hạ',
  taxi: 'Taxi',
  phuthuhaxa: 'Phụ thu hạ xa',
  phuthu: 'Phụ thu',
  dichvu: 'Dịch vụ',
  tienxe: 'Tiền xe',
  thanhtoantienxe: 'Thanh toán tiền xe',
  haiquan: 'Hải quan',
  chietkhau: 'Chiết khấu',
  tienkhac: 'Tiền khác',
};

export function feeLabel(label: string): string {
  return DISPLAY_LABELS[normalize(label)] ?? label;
}

function orderIndex(label: string): number {
  const index = PREFERRED_ORDER.indexOf(normalize(label));
  return index === -1 ? PREFERRED_ORDER.length : index;
}

export function orderedDetailEntries(details: Record<string, number>): [string, number][] {
  return Object.entries(details).sort(
    (a, b) => orderIndex(a[0]) - orderIndex(b[0]) || a[0].localeCompare(b[0], 'vi'),
  );
}

export interface FeeTotal {
  label: string;
  income: number;
  expense: number;
  count: number;
}

export function aggregateFees(transactions: Transaction[]): FeeTotal[] {
  const totals = new Map<string, FeeTotal>();
  for (const transaction of transactions) {
    for (const [label, value] of Object.entries(transaction.details)) {
      const key = normalize(label);
      const row = totals.get(key) ?? { label: feeLabel(label), income: 0, expense: 0, count: 0 };
      if (transaction.kind === 'income') row.income += value;
      else row.expense += value;
      row.count += 1;
      totals.set(key, row);
    }
  }
  return [...totals.values()].sort(
    (a, b) => orderIndex(a.label) - orderIndex(b.label) || a.label.localeCompare(b.label, 'vi'),
  );
}
