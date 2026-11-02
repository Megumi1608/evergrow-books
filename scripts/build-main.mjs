import { build } from 'esbuild';

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  sourcemap: false,
  minify: false,
  logLevel: 'info',
  external: ['electron'],
};

await build({
  ...shared,
  entryPoints: ['src/main/main.ts'],
  outfile: 'dist-electron/main.cjs',
  external: [...shared.external, 'exceljs', 'electron-updater'],
});

await build({
  ...shared,
  entryPoints: ['src/preload/preload.ts'],
  outfile: 'dist-electron/preload.cjs',
});
