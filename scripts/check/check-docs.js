#!/usr/bin/env node
// Checks that what the docs point at still exists: repo paths, `npm run`
// script names and relative markdown links. Part of check:all.
//
// Usage: npm run check:docs
//
// Narrative files (CHANGELOG, TODOS) are left out on purpose: they describe
// the past. Design notes: docs/design/tooling.md §1.
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

// Top-level folders a quoted path may start with.
const ROOTS = ['src', 'electron', 'scripts', 'tests', 'docs', 'public', 'installer', 'native', 'resources', '.github'];

// Build outputs and fetched assets: gitignored, so absent on CI.
const UNTRACKED_PREFIXES = ['electron/generated', 'resources/'];

// Made-up names the guides use as "your new file goes here".
const EXAMPLES = new Set([
  'src/stack/providers/my-provider.js',
  'src/assets/provider-icons/my-provider.svg',
  'src/stack/ocr/my-ocr.js',
  'src/i18n/locales/ja.js',
]);
const EXAMPLE_SCRIPTS = new Set(['smoke:xxx']);

function docFiles() {
  const files = ['README.md', 'README.zh-CN.md', 'CLAUDE.md', 'native/sherpa-onnx-webgpu/README.md'];
  for (const dir of ['docs', 'docs/design']) {
    for (const name of fs.readdirSync(path.join(ROOT, dir))) {
      if (name.endsWith('.md')) files.push(`${dir}/${name}`);
    }
  }
  return files.filter((f) => fs.existsSync(path.join(ROOT, f)));
}

const pathRe = new RegExp(
  `(?<![\\w./\\\\-])(?:${ROOTS.map((r) => r.replace('.', '\\.')).join('|')})/[A-Za-z0-9_./\\-]+`,
  'g'
);

function problemsIn(doc) {
  const full = path.join(ROOT, doc);
  const found = new Set();
  fs.readFileSync(full, 'utf8').split(/\r?\n/).forEach((line, i) => {
    const at = `${doc}:${i + 1}`;

    for (const m of line.matchAll(pathRe)) {
      // A placeholder right after the match (<id>, *, {a,b}) means a pattern, not a path.
      if (/^[<*{]/.test(line.slice(m.index + m[0].length))) continue;
      const p = m[0].replace(/[.,:;)]+$/, '').replace(/:\d+$/, '').replace(/\/$/, '');
      if (EXAMPLES.has(p) || UNTRACKED_PREFIXES.some((u) => p.startsWith(u) || `${p}/` === u)) continue;
      if (!fs.existsSync(path.join(ROOT, p))) found.add(`${at}  path not found: ${p}`);
    }

    for (const m of line.matchAll(/npm run ([a-z][a-z0-9:_-]*)/g)) {
      if (!pkg.scripts[m[1]] && !EXAMPLE_SCRIPTS.has(m[1])) found.add(`${at}  no such npm script: ${m[1]}`);
    }

    for (const m of line.matchAll(/\]\((?!https?:|#|mailto:)([^)\s]+)\)/g)) {
      const target = m[1].split('#')[0].replace(/:\d+$/, '');
      if (!target) continue;
      const resolved = path.join(path.dirname(full), decodeURIComponent(target));
      const rel = path.relative(ROOT, resolved).replace(/\\/g, '/');
      if (UNTRACKED_PREFIXES.some((u) => rel.startsWith(u))) continue;
      if (!fs.existsSync(resolved)) found.add(`${at}  broken link: ${m[1]}`);
    }
  });
  return [...found];
}

// The user guide quotes interface labels: 「…」 in the Chinese one, "…" in the
// English one. Each quote has to be a string the app can actually show.
const MANUALS = [
  { doc: 'docs/MANUAL.zh.md', quote: /「([^」\n]{2,30})」/g, locale: 'src/i18n/locales/zh.js', show: (q) => `「${q}」` },
  { doc: 'docs/MANUAL.en.md', quote: /"([^"\n]{2,40})"/g, locale: 'src/i18n/locales/en.js', show: (q) => `"${q}"` },
];
// Text the app shows that lives outside the renderer locales: native menus
// and dialogs, tray labels, the Explorer context menu.
const OTHER_LABEL_SOURCES = ['electron/shared/main-i18n.js', 'electron/shared/tray-labels.js', 'installer/installer.nsh'];

function labelProblemsIn({ doc, quote, locale, show }) {
  const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const shown = [locale, ...OTHER_LABEL_SOURCES].map(read).join('\n');
  const lines = read(doc).split(/\r?\n/);
  // A quote may also name a section of the guide itself.
  const ownTitles = lines
    .flatMap((l) => [...l.matchAll(/^#+\s+(.+)$/g), ...l.matchAll(/\*\*([^*]+)\*\*/g)])
    .map((m) => m[1].replace(/^[\d.]+\s*/, '').trim());

  const found = [];
  let inFence = false;
  lines.forEach((line, i) => {
    if (/^\s*```/.test(line)) { inFence = !inFence; return; }
    if (inFence) return;
    for (const m of line.matchAll(quote)) {
      const q = m[1].trim();
      // An arrow means a menu path or a formula, not one label.
      if (q.includes('→')) continue;
      if (shown.includes(q) || ownTitles.includes(q)) continue;
      found.push(`${doc}:${i + 1}  not a label the app shows: ${show(q)}`);
    }
  });
  return found;
}

const docs = docFiles();
const problems = docs.flatMap(problemsIn);
const labelProblems = MANUALS.flatMap(labelProblemsIn);

if (problems.length) {
  console.log('Docs point at things that no longer exist:\n');
  for (const p of problems) console.log(`  ${p}`);
  console.log('\nFix the doc, or add a deliberate example name to EXAMPLES in scripts/check/check-docs.js.');
}
if (labelProblems.length) {
  console.log(`${problems.length ? '\n' : ''}The user guide quotes labels the interface does not have (check wording and capitals against the locale file):\n`);
  for (const p of labelProblems) console.log(`  ${p}`);
}
if (problems.length || labelProblems.length) process.exit(1);

console.log(`check:docs OK — ${docs.length} docs: every path, npm script and relative link resolves, and every label the user guide quotes exists.`);
