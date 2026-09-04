import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { normalizeCapturedText } = require('../../electron/utils/captured-text.js');

describe('normalizeCapturedText', () => {
  it('turns Windows line endings into plain newlines', () => {
    expect(normalizeCapturedText('To all staff,\r\n\r\nThis email\r\nis short.')).toBe('To all staff,\n\nThis email\nis short.');
    expect(normalizeCapturedText('old mac\rline')).toBe('old mac\nline');
  });

  it('keeps one blank line between paragraphs and no more', () => {
    expect(normalizeCapturedText('a\n\n\n\nb')).toBe('a\n\nb');
    expect(normalizeCapturedText('a\r\n\r\n\r\nb')).toBe('a\n\nb');
  });

  it('drops trailing spaces before a break but not indentation', () => {
    expect(normalizeCapturedText('title   \n  body')).toBe('title\n  body');
  });

  it('still expands ligatures and NBSP', () => {
    expect(normalizeCapturedText('ﬁle ﬂow')).toBe('file flow');
  });
});
