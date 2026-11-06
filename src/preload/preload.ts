import { contextBridge, ipcRenderer } from 'electron';
import type { AiEvent, EvergrowApi, TxFilter, UpdateState } from '../shared/types';

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
  lookups: {
    list: (kind) => ipcRenderer.invoke('lookup:list', kind),
    add: (kind, value) => ipcRenderer.invoke('lookup:add', kind, value),
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
    stage: () => ipcRenderer.invoke('attachments:stage'),
    commit: (transactionId, tokens) => ipcRenderer.invoke('attachments:commit', transactionId, tokens),
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
  ai: {
    config: () => ipcRenderer.invoke('ai:config:get'),
    saveConfig: (input) => ipcRenderer.invoke('ai:config:save', input),
    clearKey: () => ipcRenderer.invoke('ai:config:clear-key'),
    test: () => ipcRenderer.invoke('ai:test'),
    sessions: () => ipcRenderer.invoke('ai:sessions'),
    messages: (sessionId) => ipcRenderer.invoke('ai:messages', sessionId),
    chat: (input) => ipcRenderer.invoke('ai:chat', input),
    abort: (requestId) => ipcRenderer.invoke('ai:abort', requestId),
    approve: (changeId) => ipcRenderer.invoke('ai:approve', changeId),
    reject: (changeId) => ipcRenderer.invoke('ai:reject', changeId),
    changes: (sessionId) => ipcRenderer.invoke('ai:changes', sessionId),
    revertChange: (changeId) => ipcRenderer.invoke('ai:revert-change', changeId),
    revertSession: (sessionId) => ipcRenderer.invoke('ai:revert-session', sessionId),
    onEvent: (callback: (event: AiEvent) => void) => {
      const listener = (_event: unknown, payload: AiEvent) => callback(payload);
      ipcRenderer.on('ai:event', listener);
      return () => ipcRenderer.removeListener('ai:event', listener);
    },
  },
  printReady: () => ipcRenderer.send('print:ready'),
};

contextBridge.exposeInMainWorld('api', api);
