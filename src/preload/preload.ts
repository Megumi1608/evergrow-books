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
  },
  data: {
    backup: () => ipcRenderer.invoke('data:backup'),
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
