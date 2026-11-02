import { contextBridge, ipcRenderer } from 'electron';
import type { EvergrowApi, TxFilter, UpdateState } from '../shared/types';

const api: EvergrowApi = {
  getMeta: () => ipcRenderer.invoke('app:meta'),
  setWindowChrome: (input) => ipcRenderer.invoke('window:chrome', input),
  dashboard: (month) => ipcRenderer.invoke('dashboard:get', month),
  transactions: {
    list: (filter: TxFilter) => ipcRenderer.invoke('tx:list', filter),
    create: (input) => ipcRenderer.invoke('tx:create', input),
    update: (id, input) => ipcRenderer.invoke('tx:update', id, input),
    remove: (id) => ipcRenderer.invoke('tx:delete', id),
  },
  categories: {
    list: () => ipcRenderer.invoke('cat:list'),
    create: (input) => ipcRenderer.invoke('cat:create', input),
    update: (id, input) => ipcRenderer.invoke('cat:update', id, input),
    remove: (id) => ipcRenderer.invoke('cat:delete', id),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (input) => ipcRenderer.invoke('settings:save', input),
  },
  theme: {
    get: () => ipcRenderer.invoke('theme:get'),
    save: (input) => ipcRenderer.invoke('theme:save', input),
  },
  report: (range) => ipcRenderer.invoke('report:get', range),
  exportFile: (format, filter) => ipcRenderer.invoke(`export:${format}`, filter),
  importFile: {
    preview: () => ipcRenderer.invoke('import:preview'),
    commit: (token, options) => ipcRenderer.invoke('import:commit', token, options),
    history: () => ipcRenderer.invoke('import:history'),
    undo: (batchId) => ipcRenderer.invoke('import:undo', batchId),
  },
  shipments: {
    list: (filter) => ipcRenderer.invoke('shipments:list', filter),
    get: (reference) => ipcRenderer.invoke('shipments:get', reference),
  },
  debts: {
    list: () => ipcRenderer.invoke('debts:list'),
    pay: (id, amount) => ipcRenderer.invoke('debts:pay', id, amount),
  },
  attachments: {
    list: (transactionId) => ipcRenderer.invoke('attachments:list', transactionId),
    add: (transactionId) => ipcRenderer.invoke('attachments:add', transactionId),
    open: (id) => ipcRenderer.invoke('attachments:open', id),
    remove: (id) => ipcRenderer.invoke('attachments:remove', id),
  },
  budgets: {
    get: (month) => ipcRenderer.invoke('budgets:get', month),
    save: (input) => ipcRenderer.invoke('budgets:save', input),
    remove: (categoryId, month) => ipcRenderer.invoke('budgets:remove', categoryId, month),
    copyPrevious: (month) => ipcRenderer.invoke('budgets:copy-previous', month),
  },
  data: {
    backup: () => ipcRenderer.invoke('data:backup'),
    backupInfo: () => ipcRenderer.invoke('data:backup-info'),
    backupNow: () => ipcRenderer.invoke('data:backup-now'),
    openBackupFolder: () => ipcRenderer.invoke('data:open-backup-folder'),
    restore: () => ipcRenderer.invoke('data:restore'),
    openFolder: () => ipcRenderer.invoke('data:open-folder'),
    seedDemo: () => ipcRenderer.invoke('data:seed'),
    resetAll: (confirm) => ipcRenderer.invoke('data:reset', confirm),
    stats: () => ipcRenderer.invoke('data:stats'),
  },
  updater: {
    getState: () => ipcRenderer.invoke('update:get'),
    check: () => ipcRenderer.invoke('update:check'),
    install: () => ipcRenderer.invoke('update:install'),
    openReleases: () => ipcRenderer.invoke('update:open-releases'),
    onState: (callback: (state: UpdateState) => void) => {
      const listener = (_event: unknown, state: UpdateState) => callback(state);
      ipcRenderer.on('update:state', listener);
      return () => ipcRenderer.removeListener('update:state', listener);
    },
  },
  printReady: () => ipcRenderer.send('print:ready'),
};

contextBridge.exposeInMainWorld('api', api);
