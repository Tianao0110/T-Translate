// Context-menu argv parsing: supported extensions only, flags and non-files
// skipped, existence checked, first hit wins.

import { describe, it, expect } from 'vitest';
import { extractOpenableFile } from '../../electron/utils/open-with.js';

const existsAll = () => true;

describe('extractOpenableFile', () => {
  it('finds a supported file among launcher noise', () => {
    const argv = ['C:\\app\\T-Translate.exe', '--startup', 'C:\\docs\\paper.pdf'];
    expect(extractOpenableFile(argv, existsAll)).toBe('C:\\docs\\paper.pdf');
  });

  it.each([
    ['C:\\a.docx'],
    ['C:\\a.txt'],
    ['C:\\A.PDF'],
  ])('accepts %s', (p) => {
    expect(extractOpenableFile([p], existsAll)).toBe(p);
  });

  it('ignores unsupported extensions — dev argv never matches', () => {
    const argv = ['electron.exe', 'F:\\T-Translate\\electron\\main.js', 'C:\\x.exe', 'C:\\x.md'];
    expect(extractOpenableFile(argv, existsAll)).toBe(null);
  });

  it('skips flags even when they end in a supported extension', () => {
    expect(extractOpenableFile(['--file=C:\\a.pdf'], existsAll)).toBe(null);
  });

  it('skips paths that do not exist', () => {
    const exists = (p) => p === 'C:\\real.pdf';
    expect(extractOpenableFile(['C:\\gone.pdf', 'C:\\real.pdf'], exists)).toBe('C:\\real.pdf');
  });

  it('returns the first hit when several qualify', () => {
    expect(extractOpenableFile(['C:\\1.txt', 'C:\\2.pdf'], existsAll)).toBe('C:\\1.txt');
  });

  it('survives garbage input', () => {
    expect(extractOpenableFile(null)).toBe(null);
    expect(extractOpenableFile([null, undefined, 42, ''], existsAll)).toBe(null);
    expect(extractOpenableFile([], existsAll)).toBe(null);
  });

  it('an exists() that throws is treated as a miss', () => {
    const boom = () => { throw new Error('EACCES'); };
    expect(extractOpenableFile(['C:\\a.pdf'], boom)).toBe(null);
  });
});
