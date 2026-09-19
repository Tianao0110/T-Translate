// Every key the main process asks main-i18n for has an entry, in both tables.
//
// Regression: a menu cleanup removed 'menu.ok' as an unused menu label while
// the safe-mode dialog still used it for its button, so the button read
// "menu.ok". A missing key fails silently (t() falls back to the key itself),
// which is why this scans the call sites instead of trusting a review.

import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import { messages } from '../../../electron/shared/main-i18n.js';

const ELECTRON_DIR = path.join(__dirname, '..', '..', '..', 'electron');
const SKIP_DIRS = new Set(['generated', 'node_modules']);

function sourceFiles(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) found.push(...sourceFiles(path.join(dir, entry.name)));
    } else if (entry.name.endsWith('.js')) {
      found.push(path.join(dir, entry.name));
    }
  }
  return found;
}

// Call sites of main-i18n's t(): a literal dotted key as the first argument,
// in a file that requires the module.
function usedKeys() {
  const used = new Map();
  for (const file of sourceFiles(ELECTRON_DIR)) {
    const source = fs.readFileSync(file, 'utf8');
    if (!source.includes('main-i18n')) continue;
    for (const match of source.matchAll(/(?<![\w.])t\(\s*'([A-Za-z]\w*(?:\.\w+)+)'/g)) {
      if (!used.has(match[1])) used.set(match[1], path.relative(ELECTRON_DIR, file));
    }
  }
  return used;
}

describe('main-process i18n keys', () => {
  const used = usedKeys();

  it('finds the call sites, so the checks below are not vacuous', () => {
    expect(used.size).toBeGreaterThan(20);
    expect(used.has('menu.ok')).toBe(true);
  });

  it('every key in use exists in both tables', () => {
    const missing = [];
    for (const [key, file] of used) {
      if (!(key in messages.zh)) missing.push(`zh: ${key} (${file})`);
      if (!(key in messages.en)) missing.push(`en: ${key} (${file})`);
    }
    expect(missing).toEqual([]);
  });

  it('the two tables hold the same keys', () => {
    expect(Object.keys(messages.en).sort()).toEqual(Object.keys(messages.zh).sort());
  });
});
