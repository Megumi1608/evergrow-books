import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { Store } from './db';
import { buildCsv, periodLabel, writeXlsx } from './exporters';
import { commitImport, previewImport } from './importer';
import { checkForUpdates, getUpdateState, installUpdate, openReleases, RELEASES_URL } from './updater';
import {
  validateCategoryInput,
  validateCompanySettings,
  validateConfirm,
  validateFilter,
  validateId,
  validateImportOptions,
  validateMonth,
  validateRange,
  validateTheme,
  validateToken,
  validateTxInput,
} from './validation';
import { todayIso } from '../shared/dates';

interface IpcDeps {
  store: Store;
  getMainWindow: () => BrowserWindow | null;
  preloadPath: string;
  loadPrintRoute: (win: BrowserWindow, from: string, to: string) => Promise<void>;
  trustedUrlPrefixes: string[];
}

const printWaiters = new Map<number, () => void>();

export function registerIpc(deps: IpcDeps): void {
  const { store, getMainWindow, preloadPath, loadPrintRoute, trustedUrlPrefixes } = deps;

  const isTrusted = (event: IpcMainInvokeEvent): boolean => {
    const url = event.senderFrame?.url ?? '';
    return trustedUrlPrefixes.some((prefix) => (prefix.endsWith('://') ? url.startsWith(prefix) : url.startsWith(prefix)));
  };

  const handle = <T>(channel: string, fn: (...args: any[]) => T | Promise<T>): void => {
    ipcMain.handle(channel, async (event, ...args) => {
      if (!isTrusted(event)) throw new Error('Nguồn gọi không hợp lệ.');
      return fn(...args);
    });
  };

  ipcMain.on('print:ready', (event) => {
    if (!isTrusted(event as unknown as IpcMainInvokeEvent)) return;
    const resolve = printWaiters.get(event.sender.id);
    if (resolve) {
      printWaiters.delete(event.sender.id);
      resolve();
    }
  });

  const saveDialog = async (
    suggestedName: string,
    filterName: string,
    extensions: string[],
  ): Promise<string | undefined> => {
    const options = {
      title: 'Lưu tệp',
      defaultPath: path.join(app.getPath('documents'), suggestedName),
      filters: [{ name: filterName, extensions }],
      properties: ['showOverwriteConfirmation' as const],
    };
    const win = getMainWindow();
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
    return result.canceled || !result.filePath ? undefined : result.filePath;
  };

  const withExtension = (target: string, extension: string): string =>
    target.toLowerCase().endsWith(`.${extension}`) ? target : `${target}.${extension}`;

  handle('app:meta', () => ({
    version: app.getVersion(),
    dbPath: store.getDatabasePath(),
    isPackaged: app.isPackaged,
    releasesUrl: RELEASES_URL,
  }));

  handle('window:chrome', (input: unknown) => {
    const value = input as { background?: unknown; symbol?: unknown };
    const background = typeof value?.background === 'string' ? value.background : '';
    const symbol = typeof value?.symbol === 'string' ? value.symbol : '';
    if (!/^#[0-9a-fA-F]{6}$/.test(background) || !/^#[0-9a-fA-F]{6}$/.test(symbol)) {
      throw new Error('Màu thanh tiêu đề không hợp lệ.');
    }
    const win = getMainWindow();
    if (win && process.platform === 'win32') {
      win.setTitleBarOverlay({ color: background, symbolColor: symbol, height: 40 });
    }
  });

  handle('dashboard:get', (month: unknown) => store.dashboard(validateMonth(month)));

  handle('tx:list', (filter: unknown) => store.listTransactions(validateFilter(filter)));
  handle('tx:create', (input: unknown) => store.createTransaction(validateTxInput(input)));
  handle('tx:update', (id: unknown, input: unknown) =>
    store.updateTransaction(validateId(id, 'Giao dịch'), validateTxInput(input)),
  );
  handle('tx:delete', (id: unknown) => store.removeTransaction(validateId(id, 'Giao dịch')));

  handle('cat:list', () => store.listCategories());
  handle('cat:create', (input: unknown) => store.createCategory(validateCategoryInput(input)));
  handle('cat:update', (id: unknown, input: unknown) =>
    store.updateCategory(validateId(id, 'Danh mục'), validateCategoryInput(input)),
  );
  handle('cat:delete', (id: unknown) => store.removeCategory(validateId(id, 'Danh mục')));

  handle('settings:get', () => store.getSettings());
  handle('settings:save', (input: unknown) => store.saveSettings(validateCompanySettings(input)));
  handle('theme:get', () => store.getTheme());
  handle('theme:save', (input: unknown) => store.saveTheme(validateTheme(input)));

  handle('report:get', (range: unknown) => {
    const { from, to } = validateRange(range);
    return store.report(from, to);
  });

  handle('export:csv', async (filterInput: unknown) => {
    const filter = validateFilter(filterInput);
    const target = await saveDialog(`giao-dich_${filter.from ?? 'tat-ca'}_${filter.to ?? todayIso()}.csv`, 'CSV (UTF-8)', ['csv']);
    if (!target) return { saved: false };
    const file = withExtension(target, 'csv');
    fs.writeFileSync(file, buildCsv(store.exportTransactions(filter)), 'utf8');
    return { saved: true, path: file };
  });

  handle('export:xlsx', async (filterInput: unknown) => {
    const filter = validateFilter(filterInput);
    const target = await saveDialog(`giao-dich_${filter.from ?? 'tat-ca'}_${filter.to ?? todayIso()}.xlsx`, 'Excel Workbook', ['xlsx']);
    if (!target) return { saved: false };
    const file = withExtension(target, 'xlsx');
    const rows = store.exportTransactions(filter);
    await writeXlsx(file, rows, {
      companyName: store.getSettings().companyName,
      periodLabel: periodLabel(filter.from, filter.to),
    });
    return { saved: true, path: file };
  });

  handle('export:pdf', async (filterInput: unknown) => {
    const filter = validateFilter(filterInput);
    const { from, to } = validateRange({ from: filter.from, to: filter.to });
    const target = await saveDialog(`bao-cao_${from}_${to}.pdf`, 'PDF', ['pdf']);
    if (!target) return { saved: false };
    const file = withExtension(target, 'pdf');

    const win = new BrowserWindow({
      show: false,
      width: 940,
      height: 1280,
      backgroundColor: '#ffffff',
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    try {
      const ready = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          printWaiters.delete(win.webContents.id);
          reject(new Error('Hết thời gian tạo báo cáo PDF.'));
        }, 25000);
        printWaiters.set(win.webContents.id, () => {
          clearTimeout(timeout);
          resolve();
        });
        win.webContents.once('render-process-gone', () => {
          clearTimeout(timeout);
          reject(new Error('Không thể dựng trang báo cáo.'));
        });
      });
      await loadPrintRoute(win, from, to);
      await ready;
      const pdf = await win.webContents.printToPDF({
        printBackground: true,
        pageSize: 'A4',
        preferCSSPageSize: true,
      });
      fs.writeFileSync(file, pdf);
      return { saved: true, path: file };
    } finally {
      printWaiters.delete(win.webContents.id);
      if (!win.isDestroyed()) win.destroy();
    }
  });

  handle('data:backup', async () => {
    const target = await saveDialog(`evergrow-books-backup_${todayIso()}.db`, 'SQLite Database', ['db']);
    if (!target) return { saved: false };
    const file = withExtension(target, 'db');
    await store.backupTo(file);
    return { saved: true, path: file };
  });

  handle('import:preview', async () => {
    const win = getMainWindow();
    const options = {
      title: 'Chọn tệp Excel thu chi',
      filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
      properties: ['openFile' as const],
    };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return { canceled: true };
    const preview = await previewImport(result.filePaths[0], store);
    return { canceled: false, preview };
  });

  handle('import:commit', (token: unknown, options: unknown) =>
    commitImport(validateToken(token), validateImportOptions(options), store),
  );

  handle('data:restore', async () => {
    const win = getMainWindow();
    const options = {
      title: 'Chọn tệp sao lưu',
      filters: [{ name: 'SQLite Database', extensions: ['db', 'sqlite', 'sqlite3'] }],
      properties: ['openFile' as const],
    };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return { restored: false };
    await store.restoreFrom(result.filePaths[0]);
    return { restored: true };
  });

  handle('data:open-folder', async () => {
    shell.showItemInFolder(store.getDatabasePath());
  });

  handle('data:seed', () => store.seedDemo());
  handle('data:reset', (confirm: unknown) => {
    validateConfirm(confirm);
    store.resetAll();
  });
  handle('data:stats', () => store.stats());

  handle('update:get', () => getUpdateState());
  handle('update:check', () => checkForUpdates());
  handle('update:install', () => installUpdate());
  handle('update:open-releases', () => openReleases());
}
