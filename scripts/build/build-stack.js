// Bundles the main-process translation stack (src/stack/, ESM) into a single
// CJS artifact the unbundled-CJS main process can require.
/* eslint-disable no-console */

const path = require('path');
const { buildSync } = require('esbuild');

const outfile = path.join(__dirname, '..', '..', 'electron', 'generated', 'translation-stack.cjs');

buildSync({
  entryPoints: [path.join(__dirname, '..', '..', 'src', 'stack', 'index.js')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22', // Electron 42 ships Node 22
  // Tripwire: the stack must stay electron-free.
  external: ['electron'],
  logLevel: 'info',
});

console.log(`Stack bundle written to ${path.relative(process.cwd(), outfile)}`);
