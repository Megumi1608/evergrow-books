import type { Transaction } from '../shared/types';

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
  return parts.join(' · ');
}
