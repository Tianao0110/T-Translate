// Subtitle auto-save: file naming, same-minute collisions, and the cap on
// how many files are kept.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';

const require = createRequire(import.meta.url);
const { createListenAutosave, safeName } = require('../../electron/utils/listen-autosave.js');

describe('listen autosave', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-listen-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('turns a process image name into a safe file stem', () => {
    expect(safeName('chrome.exe')).toBe('chrome');
    expect(safeName('a<b>:c?.exe')).toBe('a-b-c');
    expect(safeName('')).toBe('system');
    expect(safeName('   ')).toBe('system');
  });

  it('creates the folder, names by program and minute, suffixes collisions', () => {
    const now = () => new Date(2026, 8, 7, 21, 30);
    const store = createListenAutosave({ dir: path.join(dir, 'listen'), now });
    const first = store.save('1\n', 'chrome.exe');
    const second = store.save('2\n', 'chrome.exe');
    expect(path.basename(first)).toBe('chrome-2026-09-07-2130.srt');
    expect(path.basename(second)).toBe('chrome-2026-09-07-2130-2.srt');
    expect(fs.readFileSync(second, 'utf8')).toBe('2\n');
  });

  it('keeps only the newest files', () => {
    let minute = 0;
    const store = createListenAutosave({ dir, maxFiles: 3, now: () => new Date(2026, 0, 1, 0, minute) });
    for (minute = 0; minute < 5; minute++) {
      const file = store.save(`${minute}`, 'p');
      // Distinct, old modification times so the prune order is not left to
      // the file system's timestamp resolution.
      const t = new Date(2026, 0, 1, 0, minute);
      fs.utimesSync(file, t, t);
    }
    const left = fs.readdirSync(dir).sort();
    expect(left).toEqual(['p-2026-01-01-0002.srt', 'p-2026-01-01-0003.srt', 'p-2026-01-01-0004.srt']);
  });
});
