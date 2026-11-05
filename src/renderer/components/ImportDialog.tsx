import { useState } from 'react';
import { FileSpreadsheet, LoaderCircle } from 'lucide-react';
import type { ImportPreview, ImportResult, Method, MissingDatePolicy } from '../../shared/types';
import { METHOD_LABELS } from '../../shared/types';
import { formatDate } from '../../shared/dates';
import { formatNumber } from '../../shared/format';
import { api, getErrorMessage } from '../api';
import { useToast } from './toast';
import { Modal, Select, Segmented } from './ui';

const METHOD_OPTIONS = Object.entries(METHOD_LABELS) as [Method, string][];

export function ImportDialog({
  preview,
  onClose,
  onImported,
}: {
  preview: ImportPreview;
  onClose: () => void;
  onImported: (result: ImportResult) => void;
}) {
  const toast = useToast();
  const [missingDate, setMissingDate] = useState<MissingDatePolicy>('previous');
  const [method, setMethod] = useState<Method>('bank');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const freshRows = Math.max(0, preview.rows - preview.duplicates);

  const commit = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await api.importFile.commit(preview.token, { missingDate, method });
      toast(
        `Đã nhập ${result.inserted} giao dịch${result.duplicates ? `, bỏ qua ${result.duplicates} dòng trùng` : ''}.`,
      );
      onImported(result);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Nhập từ Excel"
      subtitle={preview.fileName}
      onClose={onClose}
      width={720}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Huỷ
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={commit}
            disabled={busy || freshRows === 0 || (preview.missingDates > 0 && missingDate === 'skip' && preview.rows === preview.missingDates)}
          >
            {busy ? <LoaderCircle size={15} className="spin" /> : <FileSpreadsheet size={15} />}
            Nhập {freshRows} giao dịch
          </button>
        </>
      }
    >
      <div className="import-body">
        <div className="import-summary">
          <div>
            <span>Tệp</span>
            <strong title={preview.fileName}>{preview.fileName}</strong>
          </div>
          <div>
            <span>Giao dịch</span>
            <strong>{formatNumber(preview.rows)}</strong>
          </div>
          <div>
            <span>Thu nhập</span>
            <strong className="income">{formatNumber(preview.income)} đ</strong>
          </div>
          <div>
            <span>Chi phí</span>
            <strong className="expense">{formatNumber(preview.expense)} đ</strong>
          </div>
          <div>
            <span>Dòng trùng</span>
            <strong className={preview.duplicates ? 'warning' : ''}>{formatNumber(preview.duplicates)}</strong>
          </div>
        </div>

        <div className="import-sheets">
          {preview.sheets.map((sheet) => (
            <div className="import-sheet" key={sheet.name}>
              <span className={`dot`} />
              <div>
                <strong>{sheet.name}</strong>
                <span>
                  {sheet.kind === 'income' ? 'Thu nhập' : 'Chi phí'} · {sheet.rows} dòng ·{' '}
                  {formatNumber(sheet.total)} đ
                </span>
              </div>
              <span className="import-sheet-range">
                {sheet.from ? `${formatDate(sheet.from)} – ${formatDate(sheet.to)}` : 'Thiếu ngày'}
              </span>
            </div>
          ))}
        </div>

        {preview.categories.length > 0 ? (
          <div className="import-categories">
            <span className="field-label">Danh mục sẽ dùng / tạo mới</span>
            <div className="import-chips">
              {preview.categories.map((category) => (
                <span className="import-chip" key={category}>
                  {category}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        <div className="import-table-wrap">
          <table className="mini-table import-table">
            <thead>
              <tr>
                <th>Ngày</th>
                <th>Loại</th>
                <th>Số TK</th>
                <th>Đối tác</th>
                <th>Danh mục</th>
                <th className="num">Số tiền</th>
              </tr>
            </thead>
            <tbody>
              {preview.samples.map((row, index) => (
                <tr key={`${row.reference}-${row.amount}-${index}`}>
                  <td className="date-cell">{row.date ? formatDate(row.date) : '—'}</td>
                  <td className={row.kind === 'income' ? 'income' : 'expense'}>
                    {row.kind === 'income' ? 'Thu' : 'Chi'}
                  </td>
                  <td>{row.reference || '—'}</td>
                  <td>{row.party || '—'}</td>
                  <td>{row.category}</td>
                  <td className={`num amount ${row.kind}`}>
                    {row.kind === 'income' ? '+' : '−'}
                    {formatNumber(row.amount)} đ
                    {Object.keys(row.details).length > 0 ? (
                      <span className="amount-sub" title={Object.keys(row.details).join(', ')}>
                        {Object.keys(row.details).length} khoản phí
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="import-options">
          <div className="field">
            <span className="field-label">Hình thức thanh toán mặc định</span>
            <Select value={method} onChange={(event) => setMethod(event.target.value as Method)}>
              {METHOD_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
          {preview.missingDates > 0 ? (
            <div className="field">
              <span className="field-label">
                {preview.missingDates} dòng thiếu ngày — xử lý thế nào?
              </span>
              <Segmented
                value={missingDate}
                onChange={setMissingDate}
                options={[
                  { value: 'previous', label: 'Lấy ngày dòng trước' },
                  { value: 'skip', label: 'Bỏ qua dòng thiếu' },
                ]}
              />
            </div>
          ) : null}
        </div>

        {preview.warnings.length > 0 ? (
          <div className="import-warnings">
            <span className="field-label">Lưu ý</span>
            <ul>
              {preview.warnings.slice(0, 8).map((warning, index) => (
                <li key={`${warning.sheet}-${warning.row}-${index}`}>
                  {warning.sheet}
                  {warning.row ? ` · dòng ${warning.row}` : ''}: {warning.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <p className="hint no-pad">
          Các giao dịch đã nhập trước đó sẽ được bỏ qua tự động. Dữ liệu được ghi trong một lần, không
          làm thay đổi giao dịch hiện có.
        </p>

        {error ? <p className="form-error">{error}</p> : null}
      </div>
    </Modal>
  );
}
