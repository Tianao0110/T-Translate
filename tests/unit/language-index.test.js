// The letter index follows the UI language: a Chinese reader looks for 荷兰语
// under H (hélán), an English reader looks for Dutch under D. Same language,
// different letter — which is why a stored "last letter" has to be dropped
// when the interface language changes.

import { describe, it, expect } from 'vitest';
import { LANGUAGES, indexLetter, pinyinInitial } from '../../src/config/languages.js';

const byCode = Object.fromEntries(LANGUAGES.map((l) => [l.code, l]));
const real = LANGUAGES.filter((l) => l.code !== 'auto');

describe('indexLetter', () => {
  it('files a language under a different letter in each UI language', () => {
    expect(indexLetter(byCode.nl, 'zh')).toBe('H');   // 荷兰语
    expect(indexLetter(byCode.nl, 'en')).toBe('D');   // Dutch
    expect(indexLetter(byCode.de, 'zh')).toBe('D');   // 德语
    expect(indexLetter(byCode.de, 'en')).toBe('G');   // German
    expect(indexLetter(byCode.ja, 'zh')).toBe('R');   // 日语
    expect(indexLetter(byCode.ja, 'en')).toBe('J');   // Japanese
  });

  it('reads the pinyin of characters that are easy to get wrong', () => {
    expect(pinyinInitial('宿务语')).toBe('S');   // sù, not xiǔ
    expect(pinyinInitial('爪哇语')).toBe('Z');   // zhǎo, not zhuǎ
    expect(pinyinInitial('巽他语')).toBe('X');   // xùn
    expect(pinyinInitial('鞑靼语')).toBe('D');   // dá
    expect(pinyinInitial('僧伽罗语')).toBe('S'); // sēng
    expect(pinyinInitial('聪加语')).toBe('C');   // cōng
  });

  it('covers every name in the catalogue — an unmapped one hides in "#"', () => {
    const orphans = real.filter((l) => pinyinInitial(l.name) === '#');
    expect(orphans.map((l) => l.name)).toEqual([]);
  });

  it('produces index strips that fit one row in both languages', () => {
    // The design drops the collapsible index because the strip fits. If a
    // future catalogue breaks that, this is where it shows up.
    for (const ui of ['zh', 'en']) {
      const letters = new Set(real.map((l) => indexLetter(l, ui)));
      expect(letters.size, ui).toBeLessThanOrEqual(28);
      expect(letters.has('#'), `${ui} has unfiled languages`).toBe(false);
    }
  });

  it('keeps the largest group small enough to wrap rather than scroll', () => {
    // Horizontal scrolling per group was considered and dropped on this basis.
    for (const ui of ['zh', 'en']) {
      const counts = {};
      real.forEach((l) => { const k = indexLetter(l, ui); counts[k] = (counts[k] || 0) + 1; });
      expect(Math.max(...Object.values(counts)), ui).toBeLessThanOrEqual(20);
    }
  });

  it('does not throw on junk', () => {
    expect(indexLetter(null, 'zh')).toBe('#');
    expect(indexLetter({ name: '', en: '' }, 'en')).toBe('#');
  });
});
