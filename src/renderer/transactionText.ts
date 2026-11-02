import type { Transaction } from '../shared/types';
import { formatCurrencyAmount, formatDecimal, formatVnd } from '../shared/format';

export function transactionTitle(transaction: Transaction): string {
  return transaction.party || transaction.note || transaction.goodsName || '—';
}

export function transactionMeta(transaction: Transaction): string {
  const parts: string[] = [];
  if (transaction.reference) parts.push(`TK ${transaction.reference}`);
  if (transaction.containerNo) parts.push(`Cont ${transaction.containerNo}`);
  if (transaction.containerSize) parts.push(transaction.containerSize);
  if (transaction.port) parts.push(`Cửa ${transaction.port}`);
  if (transaction.goodsType) parts.push(transaction.goodsType);
  if (transaction.goodsName && transaction.goodsName !== transaction.party) parts.push(transaction.goodsName);
  if (transaction.note && transaction.note !== transaction.party) parts.push(transaction.note);
  if (transaction.currency !== 'VND') {
    parts.push(
      `${formatCurrencyAmount(transaction.originalAmount, transaction.currency)} × ${formatDecimal(transaction.exchangeRate)}`,
    );
  }
  if (transaction.dueDate && transaction.paidAmount < transaction.amount) {
    parts.push(`Còn nợ ${formatVnd(transaction.amount - transaction.paidAmount)}`);
  }
  if (transaction.attachmentCount > 0) {
    parts.push(`${transaction.attachmentCount} chứng từ`);
  }
  return parts.join(' · ');
}
