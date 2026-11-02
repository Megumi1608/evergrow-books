import { app, BrowserWindow, dialog, Menu, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { Store } from './db';
import { registerIpc } from './ipc';
import { initUpdater } from './updater';

const devServerUrl = process.env.VITE_DEV_SERVER_URL;
const preloadPath = path.join(__dirname, 'preload.cjs');
const rendererIndex = path.join(__dirname, '..', 'dist', 'renderer', 'index.html');

let mainWindow: BrowserWindow | null = null;
let store: Store | null = null;

app.setAppUserModelId('com.evergrow.books');
app.commandLine.appendSwitch('lang', 'vi-VN');

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(bootstrap);
}

async function bootstrap(): Promise<void> {
  Menu.setApplicationMenu(null);
  try {
    const dbPath = path.join(app.getPath('userData'), 'evergrow-books.db');
    store = new Store(dbPath);
  } catch (error) {
    dialog.showErrorBox('Không thể mở cơ sở dữ liệu', String(error instanceof Error ? error.message : error));
    app.quit();
    return;
  }

  createWindow();
  registerIpc({
    store,
    getMainWindow: () => mainWindow,
    preloadPath,
    loadPrintRoute,
    trustedUrlPrefixes: devServerUrl ? [devServerUrl, 'file://'] : ['file://'],
  });
  initUpdater((state) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update:state', state);
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

function createWindow(): void {
  const iconPath = path.join(__dirname, '..', 'build', 'icon.ico');
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 720,
    show: false,
    backgroundColor: '#F5F4F0',
    title: 'Evergrow Books',
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#F5F4F0', symbolColor: '#55554E', height: 40 },
    ...(fs.existsSync(iconPath) ? { icon: iconPath } : {}),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://github.com/Megumi1608/evergrow-books')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow?.webContents.getURL()) event.preventDefault();
  });

  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (!app.isPackaged && input.type === 'keyDown' && input.key === 'F12') {
      mainWindow?.webContents.toggleDevTools();
    }
  });

  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
  } else {
    void mainWindow.loadFile(rendererIndex);
  }
}

async function loadPrintRoute(win: BrowserWindow, from: string, to: string): Promise<void> {
  const hash = `/print?${new URLSearchParams({ from, to }).toString()}`;
  if (devServerUrl) {
    await win.loadURL(`${devServerUrl}#${hash}`);
  } else {
    await win.loadFile(rendererIndex, { hash });
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  store?.close();
  store = null;
});

process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
