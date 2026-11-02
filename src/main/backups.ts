import fs from 'node:fs';
import path from 'node:path';
import { app, shell } from 'electron';
import type { BackupInfo } from '../shared/types';
import type { Store } from './db';
import { todayIso } from '../shared/dates';

const KEEP_AUTO_BACKUPS = 14;

export function backupsDirectory(): string {
  return path.join(app.getPath('userData'), 'backups');
}

function backupFiles(): string[] {
  try {
    return fs
      .readdirSync(backupsDirectory())
      .filter((name) => name.endsWith('.db'))
      .map((name) => path.join(backupsDirectory(), name))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  } catch {
    return [];
  }
}

function timestamp(): string {
  const now = new Date();
  const part = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${part(now.getMonth() + 1)}-${part(now.getDate())}_${part(now.getHours())}${part(now.getMinutes())}${part(now.getSeconds())}`;
}

function pruneBackups(): void {
  const files = backupFiles();
  const autos = files.filter((file) => path.basename(file).startsWith('auto-'));
  const operations = files.filter((file) => path.basename(file).startsWith('pre-'));
  for (const file of [...autos.slice(KEEP_AUTO_BACKUPS), ...operations.slice(10)]) {
    try {
      fs.rmSync(file);
    } catch {
      /* ignore */
    }
  }
}

export async function createBackup(store: Store, reason: string): Promise<string> {
  const directory = backupsDirectory();
  fs.mkdirSync(directory, { recursive: true });
  const target = path.join(directory, `${reason}-${timestamp()}.db`);
  await store.backupTo(target);
  pruneBackups();
  return target;
}

export async function ensureDailyBackup(store: Store): Promise<void> {
  const prefix = `auto-${todayIso()}`;
  const exists = backupFiles().some((file) => path.basename(file).startsWith(prefix));
  if (!exists) await createBackup(store, 'auto');
}

export function getBackupInfo(): BackupInfo {
  const files = backupFiles();
  const latest = files[0];
  return {
    directory: backupsDirectory(),
    lastBackup: latest ? new Date(fs.statSync(latest).mtimeMs).toISOString() : null,
    count: files.length,
  };
}

export async function backupNow(store: Store): Promise<BackupInfo> {
  await createBackup(store, 'manual');
  return getBackupInfo();
}

export async function openBackupFolder(): Promise<void> {
  fs.mkdirSync(backupsDirectory(), { recursive: true });
  await shell.openPath(backupsDirectory());
}
