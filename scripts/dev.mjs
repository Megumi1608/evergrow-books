import { spawn } from 'node:child_process';
import path from 'node:path';
import { launchElectron, rootDir, waitForServer } from './launch.mjs';

const viteBin = path.join(rootDir, 'node_modules', 'vite', 'bin', 'vite.js');
const vite = spawn(process.execPath, [viteBin], { cwd: rootDir, stdio: 'inherit' });

await waitForServer('http://localhost:5173/');
console.log('[dev] Vite sẵn sàng, mở Electron…');

const electron = launchElectron(['.'], { VITE_DEV_SERVER_URL: 'http://localhost:5173/' });

const shutdown = () => {
  if (!vite.killed) vite.kill();
};
electron.on('exit', (code) => {
  shutdown();
  process.exit(code ?? 0);
});
process.on('SIGINT', () => {
  electron.kill();
  shutdown();
});
