import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const electronPath = require('electron');

export function launchElectron(args, extraEnv = {}) {
  const env = { ...process.env, ...extraEnv };
  delete env.ELECTRON_RUN_AS_NODE;
  return spawn(electronPath, args, { env, stdio: 'inherit' });
}

export function waitForServer(url, timeoutMs = 30000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const res = await fetch(url);
        if (res.ok) return resolve();
      } catch {
        /* not ready */
      }
      if (Date.now() - started > timeoutMs) return reject(new Error(`Vite không khởi động tại ${url}`));
      setTimeout(tick, 300);
    };
    tick();
  });
}

export const rootDir = path.resolve(import.meta.dirname, '..');
