import { useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ListFilter,
  LoaderCircle,
  Plus,
  RotateCcw,
  Search,
  SquarePen,
  Trash,
  ArrowLeftRight,
  Upload,
} from 'lucide-react';
import type { Category, ImportPreview, Transaction, TxKind, TxPage } from '../../shared/types';
import { METHOD_LABELS } from '../../shared/types';
import { formatDate } from '../../shared/dates';
import { formatNumber, formatSignedVnd } from '../../shared/format';
import { api, getErrorMessage } from '../api';
import { transactionMeta, transactionTitle } from '../transactionText';
import { useApp } from '../context';
import { useDebounced } from '../hooks';
import { useToast } from '../components/toast';
import { ImportDialog } from '../components/ImportDialog';
import {
  ConfirmDialog,
  EmptyState,
  PageHeader,
  PageLoading,
  Segmented,
  Select,
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
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importing, setImporting] = useState(false);

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
              className="btn btn-outline btn-sm"
              onClick={() => exportFile('csv')}
              disabled={exporting !== null}
            >
              {exporting === 'csv' ? <LoaderCircle size={15} className="spin" /> : <Download size={15} />}
              CSV
            </button>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => exportFile('xlsx')}
              disabled={exporting !== null}
            >
              {exporting === 'xlsx' ? <LoaderCircle size={15} className="spin" /> : <Download size={15} />}
              Excel
            </button>
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
          <input className="input" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label className="filter-item">
          <span>Đến ngày</span>
          <input className="input" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
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
        <Select value={categoryId} onChange={(event) => setCategoryId(Number(event.target.value))}>
          <option value={0}>Tất cả danh mục</option>
          <optgroup label="Thu nhập">
            {incomeCategories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </optgroup>
          <optgroup label="Chi phí">
            {expenseCategories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </optgroup>
        </Select>
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
                  <th>Đối tác / ghi chú</th>
                  <th>Hình thức</th>
                  <th className="num">Số tiền</th>
                  <th className="row-actions-head" aria-label="Thao tác" />
                </tr>
              </thead>
              <tbody>
                {(data?.items ?? []).map((transaction) => (
                  <tr key={transaction.id}>
                    <td className="date-cell">{formatDate(transaction.occurredOn)}</td>
                    <td>
                      <span className="cat-cell">
                        <i className="dot" />
                        {transaction.categoryName}
                      </span>
                    </td>
                    <td>
                      <div className="tx-main">{transactionTitle(transaction)}</div>
                      {transactionMeta(transaction) ? (
                        <div className="tx-sub">{transactionMeta(transaction)}</div>
                      ) : null}
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
                        onClick={() => openTransaction(transaction)}
                      >
                        <SquarePen size={15} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn sm danger"
                        title="Xoá giao dịch"
                        aria-label="Xoá giao dịch"
                        onClick={() => setDeleteTarget(transaction)}
                      >
                        <Trash size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
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
