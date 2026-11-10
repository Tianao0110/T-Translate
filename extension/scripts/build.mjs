// Builds the extension into extension/dist/ (or --out <dir>): esbuild bundles
// the six scripts and two stylesheets, the pages, _locales and icons are
// copied, and manifest.json gets the version from the root package.json.
// Missing source icons are drawn first with @napi-rs/canvas. extraHosts (the
// real-browser scripts only) adds host permissions to that build's manifest:
// a headless browser cannot answer the permission dialog.
//
//   node extension/scripts/build.mjs [--out <dir>] [--watch]

import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(EXT, '..');
export const DEFAULT_OUT = path.join(EXT, 'dist');
export const ICON_SIZES = [16, 32, 48, 128];
const ICON_COLOR = '#2f6fed';

const src = (p) => path.join(EXT, 'src', p);
const ESM_ENTRIES = [
  { in: src('sw/index.js'), out: 'sw' },
  { in: src('offscreen/index.js'), out: 'offscreen' },
  { in: src('options/index.js'), out: 'options' },
  { in: src('popup/index.js'), out: 'popup' },
];
// Content scripts cannot be ES modules.
const IIFE_ENTRIES = [
  { in: src('content/main-world.js'), out: 'content-main' },
  { in: src('content/isolated.js'), out: 'content-isolated' },
];
const CSS_ENTRIES = [
  { in: src('options/index.css'), out: 'options' },
  { in: src('popup/index.css'), out: 'popup' },
];
const PAGES = {
  'offscreen.html': 'offscreen/index.html',
  'options.html': 'options/index.html',
  'popup.html': 'popup/index.html',
};

// Chrome takes 1–4 dot-separated integers; a prerelease tag goes to version_name.
export function manifestVersion(version) {
  const numeric = String(version).split(/[-+]/)[0];
  return numeric === version ? { version } : { version: numeric, version_name: version };
}

function roundedSquare(g, size, r) {
  g.beginPath();
  g.moveTo(r, 0);
  g.arcTo(size, 0, size, size, r);
  g.arcTo(size, size, 0, size, r);
  g.arcTo(0, size, 0, 0, r);
  g.arcTo(0, 0, size, 0, r);
  g.closePath();
}

// Placeholder icons: a rounded square with a T built from two bars (no font needed).
async function ensureIcons() {
  const dir = path.join(EXT, 'icons');
  const missing = ICON_SIZES.filter((s) => !fs.existsSync(path.join(dir, `icon-${s}.png`)));
  if (!missing.length) return [];
  const { createCanvas } = await import('@napi-rs/canvas');
  fs.mkdirSync(dir, { recursive: true });
  for (const size of missing) {
    const canvas = createCanvas(size, size);
    const g = canvas.getContext('2d');
    roundedSquare(g, size, size * 0.22);
    g.fillStyle = ICON_COLOR;
    g.fill();
    const bar = Math.max(2, 2 * Math.round(size * 0.09));
    const left = Math.round(size * 0.22);
    const top = Math.round(size * 0.24);
    g.fillStyle = '#ffffff';
    g.fillRect(left, top, size - 2 * left, bar);
    g.fillRect((size - bar) / 2, top, bar, Math.round(size * 0.76) - top);
    fs.writeFileSync(path.join(dir, `icon-${size}.png`), await canvas.encode('png'));
  }
  return missing;
}

const appVersion = () => JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')).version;

function copyStatic(outDir, extraHosts = []) {
  for (const [out, from] of Object.entries(PAGES)) fs.copyFileSync(src(from), path.join(outDir, out));
  fs.cpSync(path.join(EXT, '_locales'), path.join(outDir, '_locales'), { recursive: true });
  fs.cpSync(path.join(EXT, 'icons'), path.join(outDir, 'icons'), { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
  Object.assign(manifest, manifestVersion(appVersion()));
  if (extraHosts.length) manifest.host_permissions = [...new Set([...manifest.host_permissions, ...extraHosts])];
  fs.writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

function listFiles(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? listFiles(p, base) : [path.relative(base, p).replace(/\\/g, '/')];
  });
}

// Resolves { outDir, files } after a one-off build; with watch, { outDir, stop }.
export async function build({ outDir = DEFAULT_OUT, watch = false, logLevel = 'warning', extraHosts = [] } = {}) {
  outDir = path.resolve(outDir);
  const rel = path.relative(outDir, EXT);
  if (!rel || (!rel.startsWith('..') && !path.isAbsolute(rel))) throw new Error(`refusing to clean ${outDir}: it holds the extension sources`);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  await ensureIcons();

  const common = {
    bundle: true,
    target: 'chrome116',
    sourcemap: false,
    minify: false,
    outdir: outDir,
    logLevel,
    charset: 'utf8',
    define: { __TC_VERSION__: JSON.stringify(appVersion()) },
  };
  const configs = [
    { ...common, entryPoints: ESM_ENTRIES, format: 'esm' },
    { ...common, entryPoints: IIFE_ENTRIES, format: 'iife' },
    { ...common, entryPoints: CSS_ENTRIES },
  ];

  if (!watch) {
    await Promise.all(configs.map((c) => esbuild.build(c)));
    copyStatic(outDir, extraHosts);
    return { outDir, files: listFiles(outDir).sort() };
  }

  const recopy = { name: 'copy-static', setup: (b) => b.onEnd(() => copyStatic(outDir)) };
  const contexts = await Promise.all(configs.map((c) => esbuild.context({ ...c, plugins: [recopy] })));
  await Promise.all(contexts.map((c) => c.watch()));
  let timer = null;
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(() => copyStatic(outDir), 100);
  };
  const watchers = [
    fs.watch(path.join(EXT, 'src'), { recursive: true }, (_e, f) => f && f.endsWith('.html') && later()),
    fs.watch(path.join(EXT, '_locales'), { recursive: true }, later),
    fs.watch(path.join(EXT, 'manifest.json'), later),
  ];
  return {
    outDir,
    async stop() {
      watchers.forEach((w) => w.close());
      await Promise.all(contexts.map((c) => c.dispose()));
    },
  };
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const argv = process.argv.slice(2);
  const at = argv.indexOf('--out');
  const watch = argv.includes('--watch');
  build({ outDir: at > -1 ? argv[at + 1] : DEFAULT_OUT, watch, logLevel: 'info' }).then(
    (r) => {
      const where = path.relative(process.cwd(), r.outDir) || r.outDir;
      if (watch) console.log(`watching, output in ${where} (Ctrl+C to stop)`);
      else console.log(`built ${r.files.length} files into ${where}`);
    },
    (e) => {
      console.error(e);
      process.exitCode = 1;
    }
  );
}
