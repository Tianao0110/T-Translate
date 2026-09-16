// Every icon name imported from lucide-react must exist in the installed
// version.
//
// This is a static check because the dynamic one does not work: an icon that
// lucide does not export imports as `undefined`, which eslint accepts (the
// named import resolves) and vite bundles happily. React only throws when the
// element is rendered — and if the icon sits behind a condition, a mount test
// never reaches it. That is exactly how a NotebookPen that lucide 0.303 does
// not have reached a user's machine.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import * as lucide from 'lucide-react';

const SRC = join(process.cwd(), 'src');

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(jsx?|tsx?)$/.test(entry)) out.push(full);
  }
  return out;
}

// import { A, B as C } from 'lucide-react'  — across newlines.
const IMPORT_RE = /import\s*\{([^}]*)\}\s*from\s*['"]lucide-react['"]/g;

function iconNames(code) {
  const names = [];
  for (const match of code.matchAll(IMPORT_RE)) {
    for (const part of match[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0].trim();
      if (name) names.push(name);
    }
  }
  return names;
}

describe('lucide-react icons', () => {
  const files = sourceFiles(SRC);

  it('finds the icon imports it is supposed to be checking', () => {
    const total = files.reduce((n, f) => n + iconNames(readFileSync(f, 'utf-8')).length, 0);
    expect(total).toBeGreaterThan(50);
  });

  it('every imported name exists in the installed lucide-react', () => {
    const missing = [];
    for (const file of files) {
      for (const name of iconNames(readFileSync(file, 'utf-8'))) {
        if (!(name in lucide)) missing.push(`${relative(SRC, file)}: ${name}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('would catch a name lucide does not export', () => {
    expect('NotebookPen' in lucide || 'ThisIconDoesNotExist' in lucide).toBe(
      'NotebookPen' in lucide
    );
    expect('ThisIconDoesNotExist' in lucide).toBe(false);
  });
});
