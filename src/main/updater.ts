import { app, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { UpdateState } from '../shared/types';

export const RELEASES_URL = 'https://github.com/Megumi1608/evergrow-books/releases';

type Notify = (state: UpdateState) => void;

let notify: Notify = () => {};
let initialized = false;
let state: UpdateState = { status: 'idle' };

function publish(next: UpdateState): void {
  state = next;
  notify(state);
}

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/404|not found|latest\.yml/i.test(message)) return 'Chưa có bản phát hành nào trên GitHub.';
  if (/net::|ENOTFOUND|ECONN|ETIMEDOUT|network/i.test(message)) return 'Không thể kết nối tới GitHub. Kiểm tra mạng và thử lại.';
  return message.split('\n')[0].slice(0, 160);
}

export function initUpdater(sender: Notify): void {
  notify = sender;
  if (initialized) return;
  initialized = true;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on('checking-for-update', () => publish({ status: 'checking' }));
  autoUpdater.on('update-available', (info) => publish({ status: 'available', version: info.version }));
  autoUpdater.on('update-not-available', () => publish({ status: 'up-to-date', checkedAt: new Date().toISOString() }));
  autoUpdater.on('download-progress', (progress) =>
    publish({ status: 'downloading', percent: Math.round(progress.percent) }),
  );
  autoUpdater.on('update-downloaded', (info) => publish({ status: 'downloaded', version: info.version }));
  autoUpdater.on('error', (error) => publish({ status: 'error', message: friendlyError(error) }));

  if (!app.isPackaged) {
    publish({ status: 'unsupported', message: 'Bản phát triển chưa hỗ trợ tự cập nhật.' });
    return;
  }

  setTimeout(() => {
    void checkForUpdates();
  }, 6000);
  setInterval(() => {
    void checkForUpdates();
  }, 4 * 60 * 60 * 1000);
}

export function getUpdateState(): UpdateState {
  return state;
}

export async function checkForUpdates(): Promise<UpdateState> {
  if (!app.isPackaged) {
    publish({ status: 'unsupported', message: 'Bản phát triển chưa hỗ trợ tự cập nhật.' });
    return state;
  }
  try {
    publish({ status: 'checking' });
    await autoUpdater.checkForUpdates();
  } catch (error) {
    publish({ status: 'error', message: friendlyError(error) });
  }
  return state;
}

export function installUpdate(): UpdateState {
  if (state.status !== 'downloaded') return state;
  setImmediate(() => autoUpdater.quitAndInstall(true, true));
  return state;
}

export async function openReleases(): Promise<void> {
  await shell.openExternal(RELEASES_URL);
}
