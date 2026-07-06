// Bundles the main-process translation stack (src/stack/, ESM) into a single
// CJS artifact the unbundled-CJS main process can require.
// Why esbuild instead of electron-vite / vite-plugin-electron: those take over
// the whole dev/build pipeline; this repo only needs "ESM stack -> CJS file"
// (see gstack design doc main-process-migration-design-2026-07.md §2.1).
/* eslint-disable no-console */

const path = require('path');
const { buildSync } = require('esbuild');

const outfile = path.join(__dirname, '..', 'electron', 'generated', 'translation-stack.cjs');

buildSync({
  entryPoints: [path.join(__dirname, '..', 'src', 'stack', 'index.js')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22', // Electron 42 ships Node 22
  // The stack is dependency-injected (ctx) and must stay electron-free; this
  // external is a tripwire, not a feature — a direct electron import in stack
  // sources is a design violation.
  external: ['electron'],
  logLevel: 'info',
});

console.log(`Stack bundle written to ${path.relative(process.cwd(), outfile)}`);
