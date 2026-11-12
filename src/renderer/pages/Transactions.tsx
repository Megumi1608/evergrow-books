import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  EyeOff,
  ListFilter,
  LoaderCircle,
  Plus,
  ReceiptText,
  RotateCcw,
  Search,
  SquarePen,
  Trash,
  ArrowLeftRight,
  Upload,
} from 'lucide-react';
import type { Category, ImportPreview, Transaction, TxInput, TxKind, TxPage } from '../../shared/types';
import { METHOD_LABELS } from '../../shared/types';
import { formatDate } from '../../shared/dates';
import {
  formatCurrencyAmount,
  formatDecimal,
  formatNumber,
  formatSignedVnd,
  formatVnd,
  parseAmount,
} from '../../shared/format';
import { api, getErrorMessage } from '../api';
import { useApp } from '../context';
import { useDebounced } from '../hooks';
import { useToast } from '../components/toast';
import { ImportDialog } from '../components/ImportDialog';
import { feeLabel, orderedDetailEntries } from '../components/FeeBreakdown';
import {
  ConfirmDialog,
  DateInput,
  Dropdown,
  EmptyState,
  PageHeader,
  PageLoading,
  Segmented,
} from '../components/ui';

const PAGE_SIZE = 50;

export function TransactionsPage() {
  const { revision, bump, openTransaction } = useApp();
  const toast = useToast();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [kind, setKind] = useState<'all' | TxKind>('all');
  const [categoryId, setCategoryId] = useState(0);
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounced(query, 250);
  const [page, setPage] = useState(0);
  const [data, setData] = useState<TxPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<Category[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<Transaction | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState<'csv' | 'xlsx' | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importing, setImporting] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    let alive = true;
    api.categories
      .list()
      .then((list) => {
        if (alive) setCategories(list);
      })
      .catch((error) => toast(getErrorMessage(error), 'error'));
    return () => {
      alive = false;
    };
  }, [revision, toast]);

  useEffect(() => {
    setPage(0);
  }, [debouncedQuery]);

  useEffect(() => {
    if (!exportOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!exportRef.current?.contains(event.target as Node)) setExportOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExportOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [exportOpen]);

  const filter = useMemo(
    () => ({
      from: from || undefined,
      to: to || undefined,
      kind,
      categoryId: categoryId || undefined,
      q: debouncedQuery.trim() || undefined,
    }),
    [from, to, kind, categoryId, debouncedQuery],
  );

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.transactions
      .list({ ...filter, limit: PAGE_SIZE, offset: page * PAGE_SIZE })
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
  }, [filter, page, revision, toast]);

  useEffect(() => {
    if (data && data.items.length === 0 && page > 0) setPage((current) => current - 1);
  }, [data, page]);

  const hasFilters = Boolean(from || to) || kind !== 'all' || categoryId !== 0 || Boolean(query.trim());

  const resetFilters = () => {
    setFrom('');
    setTo('');
    setKind('all');
    setCategoryId(0);
    setQuery('');
    setPage(0);
  };

  const exportFile = async (format: 'csv' | 'xlsx') => {
    setExporting(format);
    try {
      const result = await api.exportFile(format, filter);
      if (result.saved && result.path) toast(`Đã lưu ${result.path}`);
    } catch (error) {
      toast(getErrorMessage(error), 'error');
    } finally {
      setExporting(null);
    }
  };

  const startImport = async () => {
    setImporting(true);
    try {
      const result = await api.importFile.preview();
      if (!result.canceled && result.preview) setImportPreview(result.preview);
    } catch (error) {
      toast(getErrorMessage(error), 'error');
    } finally {
      setImporting(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.transactions.remove(deleteTarget.id);
      toast('Đã xoá giao dịch.');
      setDeleteTarget(null);
      bump();
    } catch (error) {
      toast(getErrorMessage(error), 'error');
    } finally {
      setDeleting(false);
    }
  };

  const saveFee = async (transaction: Transaction, label: string, value: number) => {
    try {
      await api.transactions.update(
        transaction.id,
        transactionInput(transaction, { ...transaction.details, [label]: value }),
      );
      toast('Đã cập nhật phí.');
      bump();
    } catch (error) {
      toast(getErrorMessage(error), 'error');
    }
  };

  const total = data?.total ?? 0;
  const start = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const end = Math.min((page + 1) * PAGE_SIZE, total);
  const rangeLabel =
    from && to
      ? `${formatDate(from)} – ${formatDate(to)}`
      : from
        ? `từ ${formatDate(from)}`
        : to
          ? `đến ${formatDate(to)}`
          : 'tất cả thời gian';
  const subtitle = `${formatNumber(total)} giao dịch · ${rangeLabel}`;
  const incomeCategories = categories.filter((category) => category.kind === 'income');
  const expenseCategories = categories.filter((category) => category.kind === 'expense');

  return (
    <div className="page">
      <PageHeader
        title="Giao dịch"
        subtitle={subtitle}
        actions={
          <>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setShowDetails((value) => !value)}
              aria-pressed={showDetails}
            >
              {showDetails ? <EyeOff size={15} /> : <Eye size={15} />}
              {showDetails ? 'Ẩn chi tiết' : 'Hiện chi tiết'}
            </button>
            <div className="export-menu" ref={exportRef}>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => setExportOpen((value) => !value)}
                disabled={exporting !== null}
                aria-haspopup="menu"
                aria-expanded={exportOpen}
              >
                {exporting ? <LoaderCircle size={15} className="spin" /> : <Download size={15} />}
                Xuất
                <ChevronDown size={14} />
              </button>
              {exportOpen ? (
                <div className="export-menu-pop" role="menu">
                  <button
                    type="button"
                    className="export-menu-item"
                    role="menuitem"
                    disabled={exporting !== null}
                    onClick={() => {
                      setExportOpen(false);
                      void exportFile('csv');
                    }}
                  >
                    CSV (.csv)
                  </button>
                  <button
                    type="button"
                    className="export-menu-item"
                    role="menuitem"
                    disabled={exporting !== null}
                    onClick={() => {
                      setExportOpen(false);
                      void exportFile('xlsx');
                    }}
                  >
                    Excel (.xlsx)
                  </button>
                </div>
              ) : null}
            </div>
            <button type="button" className="btn btn-outline" onClick={startImport} disabled={importing}>
              {importing ? <LoaderCircle size={15} className="spin" /> : <Upload size={15} />}
              Nhập Excel
            </button>
            <button type="button" className="btn btn-primary" onClick={() => openTransaction()}>
              <Plus size={16} />
              Thêm giao dịch
            </button>
          </>
        }
      />

      <div className="summary-strip">
        <div>
          <span>Thu nhập</span>
          <strong className="income">{formatNumber(data?.income ?? 0)} đ</strong>
        </div>
        <div>
          <span>Chi phí</span>
          <strong className="expense">{formatNumber(data?.expense ?? 0)} đ</strong>
        </div>
        <div>
          <span>Chênh lệch</span>
          <strong>{formatSignedVnd((data?.income ?? 0) - (data?.expense ?? 0))}</strong>
        </div>
      </div>

      <div className="filters card">
        <div className="search-wrap">
          <Search size={15} />
          <input
            className="search-input"
            placeholder="Tìm đối tác, số tờ khai, container…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <label className="filter-item">
          <span>Từ ngày</span>
          <DateInput value={from} onChange={(event) => setFrom(event.target.value)} aria-label="Từ ngày" />
        </label>
        <label className="filter-item">
          <span>Đến ngày</span>
          <DateInput value={to} onChange={(event) => setTo(event.target.value)} aria-label="Đến ngày" />
        </label>
        <Segmented
          value={kind}
          onChange={setKind}
          ariaLabel="Lọc theo loại"
          options={[
            { value: 'all', label: 'Tất cả' },
            { value: 'income', label: 'Thu' },
            { value: 'expense', label: 'Chi' },
          ]}
        />
        <Dropdown
          value={categoryId}
          onChange={setCategoryId}
          ariaLabel="Lọc theo danh mục"
          groups={[
            { options: [{ value: 0, label: 'Tất cả danh mục' }] },
            {
              label: 'Thu nhập',
              options: incomeCategories.map((category) => ({ value: category.id, label: category.name })),
            },
            {
              label: 'Chi phí',
              options: expenseCategories.map((category) => ({ value: category.id, label: category.name })),
            },
          ]}
        />
        {hasFilters ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={resetFilters}>
            <RotateCcw size={14} />
            Xoá lọc
          </button>
        ) : (
          <span className="filter-state">
            <ListFilter size={13} />
            Không lọc
          </span>
        )}
      </div>

      {loading && !data ? (
        <PageLoading />
      ) : total === 0 ? (
        <div className="card">
          <EmptyState
            icon={<ArrowLeftRight size={22} />}
            title="Chưa có giao dịch"
            description={
              hasFilters ? 'Không có giao dịch nào khớp bộ lọc hiện tại.' : 'Bắt đầu ghi nhận thu chi cho công ty.'
            }
          >
            {hasFilters ? (
              <button type="button" className="btn btn-outline" onClick={resetFilters}>
                <RotateCcw size={15} />
                Xoá bộ lọc
              </button>
            ) : null}
            <button type="button" className="btn btn-outline" onClick={startImport} disabled={importing}>
              {importing ? <LoaderCircle size={15} className="spin" /> : <Upload size={15} />}
              Nhập Excel
            </button>
            <button type="button" className="btn btn-primary" onClick={() => openTransaction()}>
              <Plus size={16} />
              Thêm giao dịch
            </button>
          </EmptyState>
        </div>
      ) : (
        <div className="card table-card">
          <div className="table-wrap">
            <table className="tx-table">
              <thead>
                <tr>
                  <th>Ngày</th>
                  <th>Danh mục</th>
                  <th>Đối tác / hàng hóa</th>
                  <th>Số tờ khai</th>
                  <th>Container</th>
                  <th>Hình thức</th>
                  <th className="num">Số tiền</th>
                  <th className="row-actions-head" aria-label="Thao tác" />
                </tr>
              </thead>
              <tbody>
                {(data?.items ?? []).map((transaction) => {
                  const expandable = showDetails && hasInlineInfo(transaction);
                  return (
                    <Fragment key={transaction.id}>
                      <tr
                        className={`clickable${expandable ? ' has-detail' : ''}`}
                        onClick={() => openTransaction(transaction)}
                        title="Bấm để sửa giao dịch"
                      >
                        <td className="date-cell">{formatDate(transaction.occurredOn)}</td>
                        <td>
                          <span className="cat-cell">
                            <i className="dot" style={{ background: transaction.categoryColor }} />
                            {transaction.categoryName}
                          </span>
                        </td>
                        <td>
                          <div className="tx-main">{transaction.party || transaction.goodsName || '—'}</div>
                          <div className="tx-sub">
                            {[transaction.goodsType, transaction.goodsName].filter(Boolean).join(' · ') || '—'}
                          </div>
                        </td>
                        <td className="ref-cell">{transaction.reference || '—'}</td>
                        <td className="container-cell">
                          {[transaction.containerNo, transaction.containerSize].filter(Boolean).join(' · ') || '—'}
                        </td>
                        <td className="method-cell">{METHOD_LABELS[transaction.method]}</td>
                        <td className={`num amount ${transaction.kind === 'income' ? 'income' : 'expense'}`}>
                          {transaction.kind === 'income' ? '+' : '−'}
                          {formatNumber(transaction.amount)} đ
                        </td>
                        <td className="row-actions">
                          <button
                            type="button"
                            className="icon-btn sm"
                            title="Sửa giao dịch"
                            aria-label="Sửa giao dịch"
                            onClick={(event) => {
                              event.stopPropagation();
                              openTransaction(transaction);
                            }}
                          >
                            <SquarePen size={15} />
                          </button>
                          <button
                            type="button"
                            className="icon-btn sm danger"
                            title="Xoá giao dịch"
                            aria-label="Xoá giao dịch"
                            onClick={(event) => {
                              event.stopPropagation();
                              setDeleteTarget(transaction);
                            }}
                          >
                            <Trash size={15} />
                          </button>
                        </td>
                      </tr>
                      {expandable ? (
                        <tr
                          className={`tx-inline-row ${transaction.kind} clickable`}
                          onClick={() => openTransaction(transaction)}
                          title="Bấm để sửa giao dịch và cập nhật phí"
                        >
                          <td colSpan={8}>
                            <TransactionInline transaction={transaction} onSaveFee={saveFee} />
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="table-foot">
            <span>
              {start}–{end} / {formatNumber(total)} giao dịch
            </span>
            <div className="pager">
              <button
                type="button"
                className="icon-btn sm"
                aria-label="Trang trước"
                disabled={page === 0}
                onClick={() => setPage((current) => Math.max(0, current - 1))}
              >
                <ChevronLeft size={16} />
              </button>
              <span>Trang {page + 1}</span>
              <button
                type="button"
                className="icon-btn sm"
                aria-label="Trang sau"
                disabled={end >= total}
                onClick={() => setPage((current) => current + 1)}
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </div>
      )}

      {importPreview ? (
        <ImportDialog
          preview={importPreview}
          onClose={() => setImportPreview(null)}
          onImported={() => {
            const dates = importPreview.sheets
              .flatMap((sheet) => [sheet.from, sheet.to])
              .filter(Boolean)
              .sort();
            if (dates.length > 0) {
              setFrom(dates[0]);
              setTo(dates[dates.length - 1]);
              setPage(0);
            }
            setImportPreview(null);
            bump();
          }}
        />
      ) : null}

      {deleteTarget ? (
        <ConfirmDialog
          title="Xoá giao dịch?"
          description={
            <>
              Giao dịch <strong>{formatNumber(deleteTarget.amount)} đ</strong> ngày{' '}
              {formatDate(deleteTarget.occurredOn)} sẽ bị xoá vĩnh viễn.
            </>
          }
          confirmLabel="Xoá giao dịch"
          danger
          busy={deleting}
          onClose={() => setDeleteTarget(null)}
          onConfirm={confirmDelete}
        />
      ) : null}
    </div>
  );
}

function transactionInput(transaction: Transaction, details: Record<string, number>): TxInput {
  return {
    kind: transaction.kind,
    amount: transaction.amount,
    occurredOn: transaction.occurredOn,
    categoryId: transaction.categoryId,
    party: transaction.party,
    note: transaction.note,
    method: transaction.method,
    reference: transaction.reference,
    port: transaction.port,
    goodsName: transaction.goodsName,
    goodsType: transaction.goodsType,
    containerNo: transaction.containerNo,
    containerSize: transaction.containerSize,
    carrier: transaction.carrier,
    warehouseAddress: transaction.warehouseAddress,
    serviceRevenue: transaction.serviceRevenue,
    customerFar: transaction.customerFar,
    otherIncome: transaction.otherIncome,
    customerLift: transaction.customerLift,
    customerLower: transaction.customerLower,
    customerFees: transaction.customerFees,
    details,
    dueDate: transaction.dueDate,
    paidAmount: transaction.paidAmount,
    currency: transaction.currency,
    originalAmount: transaction.originalAmount,
    exchangeRate: transaction.exchangeRate,
  };
}

function hasInlineInfo(transaction: Transaction): boolean {
  return (
    Object.keys(transaction.details).length > 0 ||
    Boolean(transaction.port || transaction.carrier || transaction.note || transaction.dueDate) ||
    transaction.currency !== 'VND' ||
    transaction.attachmentCount > 0
  );
}

function TransactionInline({
  transaction,
  onSaveFee,
}: {
  transaction: Transaction;
  onSaveFee: (transaction: Transaction, label: string, value: number) => Promise<void>;
}) {
  const [editing, setEditing] = useState<{ label: string; text: string } | null>(null);
  const cancelled = useRef(false);
  const fees = orderedDetailEntries(transaction.details);
  const meta: { label: string; value: string; tone?: 'expense' }[] = [];
  if (transaction.port) meta.push({ label: 'Cửa khẩu', value: transaction.port });
  if (transaction.carrier) meta.push({ label: 'Vận chuyển', value: transaction.carrier });
  if (transaction.warehouseAddress) meta.push({ label: 'Kho', value: transaction.warehouseAddress });
  if (transaction.currency !== 'VND') {
    meta.push({
      label: 'Nguyên tệ',
      value: `${formatCurrencyAmount(transaction.originalAmount, transaction.currency)} × ${formatDecimal(transaction.exchangeRate)}`,
    });
  }
  if (transaction.dueDate) {
    const remaining = Math.max(0, transaction.amount - transaction.paidAmount);
    meta.push({ label: 'Hạn TT', value: formatDate(transaction.dueDate) });
    meta.push({ label: 'Còn nợ', value: formatVnd(remaining), tone: remaining > 0 ? 'expense' : undefined });
  }
  if (transaction.attachmentCount > 0) {
    meta.push({ label: 'Chứng từ', value: `${transaction.attachmentCount} tệp` });
  }
  if (transaction.note) meta.push({ label: 'Ghi chú', value: transaction.note });

  const commitFee = async () => {
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    if (!editing) return;
    const value = parseAmount(editing.text);
    const current = transaction.details[editing.label] ?? 0;
    setEditing(null);
    if (value <= 0 || value === current) return;
    await onSaveFee(transaction, editing.label, value);
  };

  return (
    <div className="tx-inline">
      {meta.length > 0 ? (
        <div className="tx-inline-meta">
          {meta.map((item) => (
            <span className="meta-chip" key={item.label}>
              <i>{item.label}</i>
              <strong className={item.tone}>{item.value}</strong>
            </span>
          ))}
        </div>
      ) : null}
      {fees.length > 0 ? (
        <div className="tx-inline-fees">
          <span className="tx-inline-label">
            <ReceiptText size={12} />
            Chi tiết phí
            <span className="tx-inline-count">{fees.length}</span>
          </span>
          {fees.map(([label, value]) => {
            if (editing?.label === label) {
              return (
                <span
                  className="fee-chip fee-chip-editing"
                  key={label}
                  onClick={(event) => event.stopPropagation()}
                >
                  <span>{feeLabel(label)}</span>
                  <input
                    className="fee-cell-input"
                    autoFocus
                    inputMode="numeric"
                    value={editing.text}
                    style={{ width: `${Math.max(4, editing.text.length + 1)}ch` }}
                    onChange={(event) =>
                      setEditing({ label, text: event.target.value.replace(/\D/g, '') })
                    }
                    onFocus={(event) => event.currentTarget.select()}
                    onBlur={commitFee}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        event.currentTarget.blur();
                      } else if (event.key === 'Escape') {
                        event.preventDefault();
                        cancelled.current = true;
                        setEditing(null);
                      }
                    }}
                  />
                  <span className="fee-chip-suffix">đ</span>
                </span>
              );
            }
            return (
              <button
                type="button"
                className="fee-chip fee-chip-button"
                key={label}
                title={`Bấm để sửa ${feeLabel(label)}`}
                onClick={(event) => {
                  event.stopPropagation();
                  cancelled.current = false;
                  setEditing({ label, text: String(value) });
                }}
              >
                <span>{feeLabel(label)}</span>
                <strong>{formatNumber(value)} đ</strong>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
