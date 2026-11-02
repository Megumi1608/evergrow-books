import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { launchElectron, rootDir } from './launch.mjs';

const build = spawnSync(process.execPath, [path.join(rootDir, 'scripts', 'build-main.mjs')], {
  cwd: rootDir,
  stdio: 'inherit',
});
if (build.status !== 0) process.exit(build.status ?? 1);

const renderer = spawnSync(
  process.execPath,
  [path.join(rootDir, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'],
  { cwd: rootDir, stdio: 'inherit' },
);
if (renderer.status !== 0) process.exit(renderer.status ?? 1);

const electron = launchElectron(['.']);
electron.on('exit', (code) => process.exit(code ?? 0));
