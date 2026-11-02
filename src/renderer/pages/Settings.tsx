import { useEffect, useState } from 'react';
import {
  CircleAlert,
  CircleCheck,
  Database,
  FileClock,
  FolderOpen,
  HardDriveDownload,
  Info,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Trash,
  Undo2,
} from 'lucide-react';
import type { BackupInfo, DataStats, ImportBatch } from '../../shared/types';
import { LOGO_LOCKUP } from '../../shared/brand';
import { formatNumber } from '../../shared/format';
import { api, getErrorMessage } from '../api';
import { useApp } from '../context';
import { useToast } from '../components/toast';
import { ConfirmDialog, PageHeader, ProgressBar } from '../components/ui';

type BusyAction = 'backup' | 'restore' | 'seed' | null;

export function SettingsPage() {
  const { meta, companyName, revision, reloadSettings, bump, updateState } = useApp();
  const toast = useToast();
  const [companyInput, setCompanyInput] = useState(companyName);
  const [savingCompany, setSavingCompany] = useState(false);
  const [stats, setStats] = useState<DataStats | null>(null);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [checking, setChecking] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [backupInfo, setBackupInfo] = useState<BackupInfo | null>(null);
  const [autoBackupBusy, setAutoBackupBusy] = useState(false);
  const [history, setHistory] = useState<ImportBatch[]>([]);
  const [undoTarget, setUndoTarget] = useState<ImportBatch | null>(null);
  const [undoing, setUndoing] = useState(false);

  useEffect(() => {
    setCompanyInput(companyName);
  }, [companyName]);

  useEffect(() => {
    let alive = true;
    api.data
      .stats()
      .then((result) => {
        if (alive) setStats(result);
      })
      .catch(() => undefined);
    api.data
      .backupInfo()
      .then((result) => {
        if (alive) setBackupInfo(result);
      })
      .catch(() => undefined);
    api.importFile
      .history()
      .then((result) => {
        if (alive) setHistory(result);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [revision]);

  const saveCompany = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!companyInput.trim()) {
      toast('Tên công ty không được để trống.', 'error');
      return;
    }
    setSavingCompany(true);
    try {
      await api.settings.save({ companyName: companyInput.trim() });
      await reloadSettings();
      toast('Đã lưu thông tin công ty.');
    } catch (error) {
      toast(getErrorMessage(error), 'error');
    } finally {
      setSavingCompany(false);
    }
  };

  const backup = async () => {
    setBusy('backup');
    try {
      const result = await api.data.backup();
      if (result.saved && result.path) toast(`Đã sao lưu tại ${result.path}`);
    } catch (error) {
      toast(getErrorMessage(error), 'error');
    } finally {
      setBusy(null);
    }
  };

  const restore = async () => {
    setBusy('restore');
    try {
      const result = await api.data.restore();
      if (result.restored) {
        await reloadSettings();
        bump();
        toast('Đã phục hồi dữ liệu từ tệp sao lưu.');
      }
    } catch (error) {
      toast(getErrorMessage(error), 'error');
    } finally {
      setBusy(null);
    }
  };

  const backupNow = async () => {
    setAutoBackupBusy(true);
    try {
      const info = await api.data.backupNow();
      setBackupInfo(info);
      toast('Đã sao lưu dữ liệu.');
    } catch (error) {
      toast(getErrorMessage(error), 'error');
    } finally {
      setAutoBackupBusy(false);
    }
  };

  const openBackupFolder = async () => {
    try {
      await api.data.openBackupFolder();
    } catch (error) {
      toast(getErrorMessage(error), 'error');
    }
  };

  const undoImport = async () => {
    if (!undoTarget) return;
    setUndoing(true);
    try {
      const result = await api.importFile.undo(undoTarget.id);
      toast(
        `Đã hoàn tác ${result.removed} giao dịch${result.categoriesRemoved ? `, xoá ${result.categoriesRemoved} danh mục trống` : ''}.`,
      );
      setUndoTarget(null);
      bump();
    } catch (error) {
      toast(getErrorMessage(error), 'error');
    } finally {
      setUndoing(false);
    }
  };

  const seed = async () => {
    setBusy('seed');
    try {
      const result = await api.data.seedDemo();
      bump();
      toast(`Đã thêm ${result.inserted} giao dịch mẫu.`);
    } catch (error) {
      toast(getErrorMessage(error), 'error');
    } finally {
      setBusy(null);
    }
  };

  const reset = async () => {
    setResetting(true);
    try {
      await api.data.resetAll('XOA');
      bump();
      setResetOpen(false);
      toast('Đã xoá toàn bộ giao dịch.');
    } catch (error) {
      toast(getErrorMessage(error), 'error');
    } finally {
      setResetting(false);
    }
  };

  const checkUpdates = async () => {
    setChecking(true);
    try {
      await api.updater.check();
    } catch (error) {
      toast(getErrorMessage(error), 'error');
    } finally {
      setChecking(false);
    }
  };

  const installUpdate = async () => {
    try {
      await api.updater.install();
    } catch (error) {
      toast(getErrorMessage(error), 'error');
    }
  };

  const updateBusy = checking || updateState.status === 'checking' || updateState.status === 'downloading';
  const downloadable = updateState.status === 'downloaded';
  const unsupported = updateState.status === 'unsupported';
  const updateLabel =
    updateState.status === 'checking'
      ? 'Đang kiểm tra…'
      : updateState.status === 'downloading'
        ? `Đang tải ${Math.round(updateState.percent ?? 0)}%`
        : updateState.status === 'available'
          ? 'Đang chuẩn bị tải…'
          : 'Kiểm tra cập nhật';

  const updateStatus = describeUpdate(updateState.status, updateState.version, updateState.message);
  const StatusIcon =
    updateStatus.tone === 'error' ? CircleAlert : updateStatus.tone === 'muted' ? Info : CircleCheck;

  return (
    <div className="page">
      <PageHeader title="Cài đặt" subtitle="Thông tin công ty, dữ liệu cục bộ và cập nhật ứng dụng." />

      <div className="settings-grid">
        <div className="settings-col">
          <section className="card">
            <div className="card-head">
              <div>
                <h2>Thông tin công ty</h2>
                <p>Tên hiển thị trên báo cáo và các tệp xuất.</p>
              </div>
            </div>
            <form className="settings-form" onSubmit={saveCompany}>
              <label className="field">
                <span className="field-label">Tên công ty</span>
                <input
                  className="input"
                  value={companyInput}
                  maxLength={120}
                  onChange={(event) => setCompanyInput(event.target.value)}
                />
              </label>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={savingCompany || !companyInput.trim() || companyInput.trim() === companyName}
              >
                {savingCompany ? <LoaderCircle size={15} className="spin" /> : null}
                Lưu tên
              </button>
            </form>
          </section>

          <section className="card">
            <div className="card-head">
              <div>
                <h2>Dữ liệu</h2>
                <p>Toàn bộ dữ liệu nằm trong một tệp SQLite trên máy này.</p>
              </div>
              <Database size={17} className="card-icon" />
            </div>
            <div className="data-path">
              <div>
                <span className="field-label">Tệp cơ sở dữ liệu</span>
                <code title={meta?.dbPath ?? ''}>{meta?.dbPath ?? 'Đang tải…'}</code>
              </div>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => api.data.openFolder()}>
                <FolderOpen size={15} />
                Mở thư mục
              </button>
            </div>
            <div className="stats-inline">
              <span>
                <strong>{formatNumber(stats?.transactions ?? 0)}</strong> giao dịch
              </span>
              <span>
                <strong>{formatNumber(stats?.categories ?? 0)}</strong> danh mục
              </span>
              <span>SQLite · WAL</span>
            </div>
            <div className="data-actions">
              <button
                type="button"
                className="btn btn-outline"
                onClick={backup}
                disabled={busy !== null}
              >
                {busy === 'backup' ? <LoaderCircle size={15} className="spin" /> : <HardDriveDownload size={15} />}
                Sao lưu
              </button>
              <button
                type="button"
                className="btn btn-outline"
                onClick={restore}
                disabled={busy !== null}
              >
                {busy === 'restore' ? <LoaderCircle size={15} className="spin" /> : <RotateCcw size={15} />}
                Phục hồi
              </button>
            </div>
            <p className="hint">Phục hồi sẽ thay thế toàn bộ dữ liệu hiện tại bằng tệp sao lưu đã chọn.</p>
            <div className="auto-backup">
              <div className="auto-backup-head">
                <div>
                  <strong>Sao lưu tự động</strong>
                  <p>
                    Tự tạo bản sao lưu mỗi ngày khi mở app, giữ 14 bản gần nhất. Chứng từ đính kèm nằm trong
                    cùng tệp SQLite.
                  </p>
                </div>
                <FileClock size={17} />
              </div>
              <div className="auto-backup-meta">
                <span>Bản gần nhất: {formatDateTime(backupInfo?.lastBackup ?? null)}</span>
                <span>{formatNumber(backupInfo?.count ?? 0)} bản sao lưu</span>
              </div>
              <div className="data-actions no-pad">
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={backupNow}
                  disabled={autoBackupBusy}
                >
                  {autoBackupBusy ? <LoaderCircle size={14} className="spin" /> : <HardDriveDownload size={14} />}
                  Sao lưu ngay
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={openBackupFolder}>
                  <FolderOpen size={14} />
                  Mở thư mục sao lưu
                </button>
              </div>
            </div>
          </section>

          <section className="card import-history-card">
            <div className="card-head">
              <div>
                <h2>Lịch sử nhập Excel</h2>
                <p>Hoàn tác một lần nhập nếu dữ liệu không đúng.</p>
              </div>
              <FileClock size={17} className="card-icon" />
            </div>
            {history.length === 0 ? (
              <p className="muted-note import-history-empty">Chưa có lần nhập Excel nào.</p>
            ) : (
              <div className="import-history">
                {history.map((batch) => (
                  <div className="import-history-row" key={batch.id}>
                    <div className="import-history-info">
                      <strong title={batch.fileName}>{batch.fileName}</strong>
                      <span>
                        {formatDateTime(batch.createdAt)} · {formatNumber(batch.inserted)} giao dịch · thu{' '}
                        {formatNumber(batch.income)} đ · chi {formatNumber(batch.expense)} đ
                      </span>
                    </div>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setUndoTarget(batch)}
                    >
                      <Undo2 size={14} />
                      Hoàn tác
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="card danger-card">
            <div className="card-head">
              <div>
                <h2>Dữ liệu mẫu & dọn dẹp</h2>
                <p>Dùng thử nhanh hoặc làm mới sổ giao dịch.</p>
              </div>
            </div>
            <div className="danger-row">
              <div>
                <strong>Dữ liệu mẫu</strong>
                <p>
                  {stats && stats.transactions > 0
                    ? 'Chỉ khả dụng khi sổ đang trống.'
                    : 'Thêm giao dịch mẫu của 5 tháng gần nhất để trải nghiệm.'}
                </p>
              </div>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={seed}
                disabled={busy !== null || (stats?.transactions ?? 0) > 0}
              >
                {busy === 'seed' ? <LoaderCircle size={15} className="spin" /> : <Sparkles size={15} />}
                Tải dữ liệu mẫu
              </button>
            </div>
            <div className="danger-row">
              <div>
                <strong>Xoá toàn bộ giao dịch</strong>
                <p>Danh mục và thông tin công ty được giữ lại. Không thể hoàn tác.</p>
              </div>
              <button
                type="button"
                className="btn btn-danger-outline btn-sm"
                onClick={() => setResetOpen(true)}
                disabled={busy !== null}
              >
                <Trash size={15} />
                Xoá giao dịch
              </button>
            </div>
          </section>
        </div>

        <div className="settings-col">
          <section className="card update-card">
            <div className="card-head">
              <div>
                <h2>Cập nhật ứng dụng</h2>
                <p>Tự động kiểm tra bản phát hành mới trên GitHub.</p>
              </div>
              <span className="version-pill">v{meta?.version ?? '1.0.0'}</span>
            </div>

            <div className={`update-status tone-${updateStatus.tone}`}>
              <StatusIcon size={16} />
              <span>{updateStatus.text}</span>
            </div>

            {updateState.status === 'downloading' ? (
              <div className="update-progress">
                <ProgressBar percent={updateState.percent ?? 0} />
                <span>{Math.round(updateState.percent ?? 0)}%</span>
              </div>
            ) : null}

            <div className="update-actions">
              {downloadable ? (
                <button type="button" className="btn btn-primary" onClick={installUpdate}>
                  <RefreshCw size={15} />
                  Khởi động lại & cập nhật
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={checkUpdates}
                  disabled={updateBusy || unsupported}
                >
                  {updateBusy ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />}
                  {checking && updateState.status === 'idle' ? 'Đang kiểm tra…' : updateLabel}
                </button>
              )}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => api.updater.openReleases()}>
                <Info size={14} />
                Bản phát hành
              </button>
            </div>

            <p className="hint">
              Kiểm tra khi mở ứng dụng và 4 giờ một lần. Bản mới được tải ngầm; bấm khởi động lại để cài đặt.
            </p>
          </section>

          <section className="card about-card">
            <div className="about-brand">
              <img className="about-logo" src={LOGO_LOCKUP} alt="Evergrow" />
              <div>
                <h2>Evergrow Books</h2>
                <p>Sổ thu chi doanh nghiệp</p>
              </div>
            </div>
            <p className="about-copy">
              Dữ liệu được lưu cục bộ trên máy của bạn và không gửi lên máy chủ. Chỉ thông tin phiên bản được
              kiểm tra với GitHub khi cập nhật.
            </p>
            <div className="about-meta">
              <span>Electron · React · SQLite</span>
              <a href="https://github.com/Megumi1608/evergrow-books" target="_blank" rel="noreferrer">
                Mã nguồn
              </a>
            </div>
          </section>
        </div>
      </div>

      {resetOpen ? (
        <ConfirmDialog
          title="Xoá toàn bộ giao dịch?"
          description="Tất cả giao dịch sẽ bị xoá vĩnh viễn. Danh mục và thông tin công ty vẫn được giữ lại. Hãy sao lưu nếu cần."
          confirmLabel="Xoá toàn bộ"
          danger
          requireText="XOA"
          busy={resetting}
          onClose={() => setResetOpen(false)}
          onConfirm={reset}
        />
      ) : null}

      {undoTarget ? (
        <ConfirmDialog
          title="Hoàn tác lần nhập Excel?"
          description={
            <>
              Sẽ xoá <strong>{formatNumber(undoTarget.inserted)} giao dịch</strong> từ tệp{' '}
              <strong>{undoTarget.fileName}</strong>, gồm cả chứng từ đính kèm. Các danh mục do lần nhập này tạo
              sẽ bị xoá nếu không còn giao dịch. Một bản sao lưu được tạo trước khi hoàn tác.
            </>
          }
          confirmLabel="Hoàn tác"
          danger
          busy={undoing}
          onClose={() => setUndoTarget(null)}
          onConfirm={undoImport}
        />
      ) : null}
    </div>
  );
}

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('vi-VN', { hour12: false });
}

function describeUpdate(
  status: string,
  version?: string,
  message?: string,
): { text: string; tone: 'ok' | 'muted' | 'accent' | 'error' } {
  switch (status) {
    case 'checking':
      return { text: 'Đang kiểm tra bản phát hành mới…', tone: 'muted' };
    case 'available':
      return { text: `Có bản mới v${version ?? ''} đang được tải về.`, tone: 'accent' };
    case 'downloading':
      return { text: 'Đang tải bản cập nhật về máy.', tone: 'accent' };
    case 'downloaded':
      return { text: `v${version ?? ''} đã sẵn sàng. Khởi động lại để cài đặt.`, tone: 'ok' };
    case 'up-to-date':
      return { text: 'Bạn đang dùng phiên bản mới nhất.', tone: 'ok' };
    case 'error':
      return { text: message ?? 'Không thể kiểm tra cập nhật.', tone: 'error' };
    case 'unsupported':
      return { text: message ?? 'Bản phát triển chưa hỗ trợ tự cập nhật.', tone: 'muted' };
    default:
      return { text: 'Sẵn sàng kiểm tra cập nhật.', tone: 'muted' };
  }
}
