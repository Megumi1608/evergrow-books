import { Check, LoaderCircle, RotateCcw, X } from 'lucide-react';
import type { AiChange, AiChangeStatus } from '../../shared/types';

const OPERATION_LABEL: Record<AiChange['operation'], string> = {
  create_transaction: 'Thêm giao dịch',
  update_transaction: 'Sửa giao dịch',
  delete_transaction: 'Xoá giao dịch',
  pay_debt: 'Thanh toán công nợ',
};

const STATUS_LABEL: Record<AiChangeStatus, string> = {
  pending: 'Chờ duyệt',
  approved: 'Đã áp dụng',
  rejected: 'Đã từ chối',
  reverted: 'Đã hoàn tác',
};

export function AiDiffList({ change }: { change: AiChange }) {
  if (change.diff.length === 0) return null;
  return (
    <div className="ai-diff">
      {change.diff.map((row, index) => (
        <div className="ai-diff-row" key={`${row.label}-${index}`}>
          <span className="ai-diff-label">{row.label}</span>
          <span className="ai-diff-values">
            <span className="ai-diff-before">{row.before}</span>
            <span className="ai-diff-arrow">→</span>
            <strong className="ai-diff-after">{row.after}</strong>
          </span>
        </div>
      ))}
    </div>
  );
}

export function AiChangeCard({
  change,
  mode = 'approval',
  busy = false,
  onApprove,
  onReject,
  onRevert,
}: {
  change: AiChange;
  mode?: 'approval' | 'history';
  busy?: boolean;
  onApprove?: () => void;
  onReject?: () => void;
  onRevert?: () => void;
}) {
  const showApprove = mode === 'approval' && change.status === 'pending' && onApprove && onReject;
  const showRevert = mode === 'history' && change.status === 'approved' && onRevert;
  return (
    <div className={`ai-change ai-change-${change.status}`}>
      <div className="ai-change-head">
        <span className="ai-change-op">{OPERATION_LABEL[change.operation]}</span>
        <span className={`ai-status ai-status-${change.status}`}>{STATUS_LABEL[change.status]}</span>
      </div>
      <p className="ai-change-summary">{change.summary}</p>
      {change.attachmentCount > 0 ? (
        <p className="ai-change-note">Kèm {change.attachmentCount} chứng từ — sẽ được backup để hoàn tác.</p>
      ) : null}
      <AiDiffList change={change} />
      {showApprove ? (
        <div className="ai-change-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onReject} disabled={busy}>
            <X size={14} />
            Từ chối
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={onApprove} disabled={busy}>
            {busy ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />}
            Áp dụng
          </button>
        </div>
      ) : null}
      {showRevert ? (
        <div className="ai-change-actions">
          <button type="button" className="btn btn-outline btn-sm" onClick={onRevert} disabled={busy}>
            {busy ? <LoaderCircle size={14} className="spin" /> : <RotateCcw size={14} />}
            Hoàn tác thay đổi này
          </button>
        </div>
      ) : null}
    </div>
  );
}
