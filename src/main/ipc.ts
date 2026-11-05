import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Store } from './db';
import { buildCsv, periodLabel, writeXlsx } from './exporters';
import { commitImport, previewImport } from './importer';
import { backupNow, createBackup, getBackupInfo, openBackupFolder } from './backups';
import { checkForUpdates, getUpdateState, installUpdate, openReleases, RELEASES_URL } from './updater';
import { AiService } from './ai/service';
import {
  validateAiChatInput,
  validateAiConfigInput,
  validateAiSessionId,
  validateBudgetInput,
  validateCategoryInput,
  validateCompanySettings,
  validateConfirm,
  validateFilter,
  validateId,
  validateImportOptions,
  validateMonth,
  validatePaymentAmount,
  validateRange,
  validateReference,
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

const ATTACHMENT_TTL_MS = 30 * 60 * 1000;
const ATTACHMENT_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.pdf': 'application/pdf',
};

interface StagedAttachmentFile {
  fileName: string;
  mimeType: string;
  data: Buffer;
  expires: number;
}

const stagedAttachments = new Map<string, StagedAttachmentFile>();

function cleanupStagedAttachments(): void {
  const now = Date.now();
  for (const [token, file] of stagedAttachments) {
    if (file.expires < now) stagedAttachments.delete(token);
  }
}

function readAttachmentFile(file: string): { fileName: string; mimeType: string; data: Buffer } {
  const stat = fs.statSync(file);
  if (stat.size <= 0) throw new Error('Tệp chứng từ rỗng.');
  if (stat.size > 10 * 1024 * 1024) throw new Error('Chứng từ tối đa 10 MB.');
  const extension = path.extname(file).toLowerCase();
  const mimeType = ATTACHMENT_MIME[extension];
  if (!mimeType) throw new Error('Chỉ hỗ trợ ảnh PNG/JPG/WEBP/GIF và PDF.');
  return { fileName: path.basename(file), mimeType, data: fs.readFileSync(file) };
}

export function registerIpc(deps: IpcDeps): void {
  const { store, getMainWindow, preloadPath, loadPrintRoute, trustedUrlPrefixes } = deps;
  const ai = new AiService(store, path.join(app.getPath('userData'), 'ai-settings.json'), (event) => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) win.webContents.send('ai:event', event);
  });

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

  handle('shipments:list', (filterInput: unknown) => {
    const filter = validateFilter(filterInput);
    return store.listShipments({ from: filter.from, to: filter.to, q: filter.q });
  });

  handle('shipments:get', (reference: unknown) => store.getShipment(validateReference(reference)));

  handle('debts:list', () => store.listDebts());
  handle('debts:pay', (id: unknown, amount: unknown) =>
    store.payDebt(validateId(id, 'Giao dịch'), validatePaymentAmount(amount)),
  );

  handle('attachments:list', (id: unknown) => store.listAttachments(validateId(id, 'Giao dịch')));
  const pickAttachmentFile = async (): Promise<string | null> => {
    const win = getMainWindow();
    const options = {
      title: 'Chọn chứng từ',
      filters: [{ name: 'Chứng từ (ảnh, PDF)', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'pdf'] }],
      properties: ['openFile' as const],
    };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  };

  handle('attachments:add', async (id: unknown) => {
    const transactionId = validateId(id, 'Giao dịch');
    const file = await pickAttachmentFile();
    if (!file) return null;
    const attachment = readAttachmentFile(file);
    return store.addAttachment(transactionId, attachment.fileName, attachment.mimeType, attachment.data);
  });

  handle('attachments:stage', async () => {
    cleanupStagedAttachments();
    const file = await pickAttachmentFile();
    if (!file) return null;
    const attachment = readAttachmentFile(file);
    const token = randomUUID();
    stagedAttachments.set(token, { ...attachment, expires: Date.now() + ATTACHMENT_TTL_MS });
    return { token, fileName: attachment.fileName, size: attachment.data.length };
  });

  handle('attachments:commit', (id: unknown, tokens: unknown) => {
    const transactionId = validateId(id, 'Giao dịch');
    if (!Array.isArray(tokens) || tokens.length === 0) return;
    if (tokens.length > 20) throw new Error('Tối đa 20 chứng từ cho mỗi giao dịch.');
    cleanupStagedAttachments();
    const staged = tokens.map((token) => {
      if (typeof token !== 'string') throw new Error('Chứng từ không hợp lệ.');
      const attachment = stagedAttachments.get(token);
      if (!attachment) throw new Error('Chứng từ đã hết hạn. Vui lòng chọn lại tệp.');
      return { token, attachment };
    });
    for (const item of staged) {
      store.addAttachment(
        transactionId,
        item.attachment.fileName,
        item.attachment.mimeType,
        item.attachment.data,
      );
      stagedAttachments.delete(item.token);
    }
  });

  handle('attachments:open', async (id: unknown) => {
    const attachment = store.getAttachment(validateId(id, 'Chứng từ'));
    if (!attachment) throw new Error('Không tìm thấy chứng từ.');
    const directory = path.join(app.getPath('temp'), 'evergrow-books-attachments');
    fs.mkdirSync(directory, { recursive: true });
    const safeName = path.basename(attachment.meta.fileName).replace(/[^\w.\- ()]/g, '_');
    const target = path.join(directory, `${attachment.meta.id}-${safeName}`);
    fs.writeFileSync(target, Buffer.from(attachment.data));
    const error = await shell.openPath(target);
    if (error) throw new Error(error);
  });

  handle('attachments:remove', (id: unknown) => store.removeAttachment(validateId(id, 'Chứng từ')));

  handle('budgets:get', (month: unknown) => store.getBudgets(validateMonth(month)));
  handle('budgets:save', (input: unknown) => store.saveBudget(validateBudgetInput(input)));
  handle('budgets:remove', (categoryId: unknown, month: unknown) =>
    store.removeBudget(validateId(categoryId, 'Danh mục'), validateMonth(month)),
  );
  handle('budgets:copy-previous', (month: unknown) => store.copyPreviousBudgets(validateMonth(month)));

  handle('import:history', () => store.listImportBatches());
  handle('import:undo', async (batchId: unknown) => {
    if (typeof batchId !== 'string' || !batchId) throw new Error('Lần nhập không hợp lệ.');
    await createBackup(store, 'pre-undo');
    return store.undoImportBatch(batchId);
  });

  handle('data:backup-info', () => getBackupInfo());
  handle('data:backup-now', () => backupNow(store));
  handle('data:open-backup-folder', () => openBackupFolder());

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

  handle('import:commit', async (token: unknown, options: unknown) => {
    const validToken = validateToken(token);
    const validOptions = validateImportOptions(options);
    await createBackup(store, 'pre-import');
    return commitImport(validToken, validOptions, store);
  });

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
  handle('data:reset', async (confirm: unknown) => {
    validateConfirm(confirm);
    await createBackup(store, 'pre-reset');
    store.resetAll();
  });
  handle('data:stats', () => store.stats());

  handle('update:get', () => getUpdateState());
  handle('update:check', () => checkForUpdates());
  handle('update:install', () => installUpdate());
  handle('update:open-releases', () => openReleases());

  handle('ai:config:get', () => ai.config());
  handle('ai:config:save', (input: unknown) => ai.saveConfig(validateAiConfigInput(input)));
  handle('ai:config:clear-key', () => ai.clearKey());
  handle('ai:test', () => ai.test());
  handle('ai:sessions', () => ai.sessions());
  handle('ai:messages', (sessionId: unknown) => ai.messages(validateAiSessionId(sessionId)));
  handle('ai:chat', (input: unknown) => ai.chat(validateAiChatInput(input)));
  handle('ai:abort', (requestId: unknown) => {
    if (typeof requestId !== 'string' || requestId.length < 8 || requestId.length > 80) {
      throw new Error('Yêu cầu dừng không hợp lệ.');
    }
    ai.abort(requestId);
  });
  handle('ai:approve', (id: unknown) => store.approveAiChange(validateId(id, 'Đề xuất')));
  handle('ai:reject', (id: unknown) => store.rejectAiChange(validateId(id, 'Đề xuất')));
  handle('ai:changes', (sessionId: unknown) => store.listAiChanges(validateAiSessionId(sessionId)));
  handle('ai:revert-change', (id: unknown) => store.revertAiChange(validateId(id, 'Thay đổi')));
  handle('ai:revert-session', (sessionId: unknown) =>
    store.revertAiSession(validateAiSessionId(sessionId)),
  );
}
