// PDF text-layer reconstruction: lines, paragraphs, running headers,
// headings, tables, cleanup (src/document/pdf-text.js).

import { describe, it, expect } from 'vitest';
import {
  readPageLayout,
  buildParagraphs,
  isGarbledPage,
  cleanText,
} from '../../../src/document/pdf-text.js';

const VIEW = [0, 0, 600, 800];

function item(str, x, y, size = 10, { font = 'body', width, angle = 0 } = {}) {
  const rad = (angle * Math.PI) / 180;
  const cos = Math.cos(rad) * size;
  const sin = Math.sin(rad) * size;
  return {
    str,
    transform: [cos, sin, -sin, cos, x, y],
    width: width ?? str.length * size * 0.5,
    height: size,
    fontName: font,
    dir: 'ltr',
    hasEOL: false,
  };
}

// rows: [text, x, y, size?, font?]
function page(n, rows) {
  const items = rows.map(([text, x, y, size, font]) => item(text, x, y, size, { font }));
  return { page: n, layout: readPageLayout(items, VIEW) };
}

const texts = (paras) => paras.map((p) => p.text);
const FILLER = 'this sentence keeps the line running well across the column';

describe('readPageLayout', () => {
  it('keeps superscript markers inside their line', () => {
    const { lines } = readPageLayout([
      item('Lane', 100, 500, 12),
      item('a,c', 124, 505, 8),
      item(', Alice', 137, 500, 12),
    ], VIEW);
    expect(texts(lines)).toEqual(['Lane a,c, Alice']);
  });

  it('maps numeric superscripts and subscripts', () => {
    const { lines } = readPageLayout([
      item('r', 100, 500),
      item('2', 105, 504, 6),
      item('H', 100, 400),
      item('2', 105, 397, 6),
      item('O', 108.6, 400),
    ], VIEW);
    expect(texts(lines)).toEqual(['r²', 'H₂O']);
  });

  it('drops diagonal watermarks and leaves them out of the character count', () => {
    const layout = readPageLayout([
      item('Hello world', 100, 500),
      item('CONFIDENTIAL', 150, 300, 40, { angle: 45 }),
    ], VIEW);
    expect(texts(layout.lines)).toEqual(['Hello world']);
    expect(layout.chars).toBe(10);
  });

  it('orders a single-column page top-down', () => {
    const { lines, multiColumn } = readPageLayout([
      item('Second line of the page', 50, 300),
      item('First line of the page', 50, 500),
    ], VIEW);
    expect(multiColumn).toBe(false);
    expect(lines[0].text).toBe('First line of the page');
  });

  it('keeps stream order on a two-column page', () => {
    const items = [];
    for (const [x, label] of [[50, 'left'], [320, 'right']]) {
      for (let i = 0; i < 6; i += 1) items.push(item(`${label} column line ${i}`, x, 700 - 12 * i));
    }
    const { lines, multiColumn } = readPageLayout(items, VIEW);
    expect(multiColumn).toBe(true);
    expect(lines.slice(0, 6).every((l) => l.text.startsWith('left'))).toBe(true);
  });

  it('flags a text layer made of private-use characters', () => {
    const junk = String.fromCodePoint(0xe001).repeat(30);
    expect(isGarbledPage(readPageLayout([item(junk, 50, 500)], VIEW))).toBe(true);
    expect(isGarbledPage(readPageLayout([item('Plain readable text here', 50, 500)], VIEW))).toBe(false);
  });
});

describe('buildParagraphs', () => {
  it('breaks on a first-line indent after a closed sentence', () => {
    const paras = buildParagraphs([page(1, [
      [`Alpha opens here and ${FILLER}`, 50, 700],
      [`and carries on while ${FILLER}`, 50, 688],
      ['and the paragraph ends here.', 50, 676],
      [`Beta starts indented and ${FILLER}`, 62, 664],
      [`then it continues as ${FILLER}.`, 50, 652],
    ])]);
    expect(paras).toHaveLength(2);
    expect(paras[1].text.startsWith('Beta starts')).toBe(true);
  });

  it('breaks on a vertical gap unless an open sentence resumes in lowercase', () => {
    const closed = buildParagraphs([page(1, [
      [`First block ${FILLER}.`, 50, 700],
      [`Second block ${FILLER}.`, 50, 660],
    ])]);
    expect(closed).toHaveLength(2);
    const resumed = buildParagraphs([page(1, [
      [`The value is given by ${FILLER}`, 50, 700],
      ['where the terms follow the equation.', 50, 660],
    ])]);
    expect(resumed).toHaveLength(1);
  });

  it('rejoins hyphenated line breaks and keeps real compounds', () => {
    const [para] = buildParagraphs([page(1, [
      ['The model was estab-', 50, 700],
      ['lished using well-', 50, 688],
      ['known methods, a goodness-', 50, 676],
      ['of-fit test and a well-known trick.', 50, 664],
    ])]);
    expect(para.text).toBe('The model was established using well-known methods, a goodness-of-fit test and a well-known trick.');
  });

  it('joins CJK lines without a space', () => {
    const [para] = buildParagraphs([page(1, [
      ['这是第一行中文内容没有', 50, 700],
      ['结束的句子。', 50, 688],
    ])]);
    expect(para.text).toBe('这是第一行中文内容没有结束的句子。');
  });

  it('drops running headers and page numbers repeated across pages', () => {
    const pages = [1, 2, 3, 4].map((n) => page(n, [
      [`Journal of Tests 12 (2024) ${100 + n}`, 50, 780, 8],
      [`Body text on page ${n} stays in place.`, 50, 400],
      [String(n), 300, 20, 8],
    ]));
    expect(texts(buildParagraphs(pages))).toEqual([1, 2, 3, 4].map((n) => `Body text on page ${n} stays in place.`));
  });

  it('keeps a header seen on too few pages but still drops page numbers', () => {
    const pages = [1, 2].map((n) => page(n, [
      ['Journal of Tests', 50, 780, 8],
      [`Body on page ${n}.`, 50, 400],
      [String(n), 300, 20, 8],
    ]));
    expect(texts(buildParagraphs(pages))).toEqual(['Journal of Tests', 'Body on page 1.', 'Journal of Tests', 'Body on page 2.']);
  });

  it('continues an open sentence across a page break and records both pages', () => {
    const open = buildParagraphs([
      page(1, [[`It opens and ${FILLER} a b`, 50, 700], [`as described in the model proposed by ${FILLER}`, 50, 688]]),
      page(2, [['Smith and Jones in 2001.', 50, 700]]),
    ]);
    expect(open).toHaveLength(1);
    expect(open[0].parts.map((p) => p.page)).toEqual([1, 2]);
    const closed = buildParagraphs([
      page(1, [[`It opens and ${FILLER} ab`, 50, 700], [`and the sentence ends ${FILLER}.`, 50, 688]]),
      page(2, [['Smith and Jones in 2001.', 50, 700]]),
    ]);
    expect(closed).toHaveLength(2);
  });

  it('continues across columns with one location part per column', () => {
    const rows = [];
    for (let i = 0; i < 6; i += 1) rows.push([`left column body line ${i} ${FILLER}`.slice(0, 50), 50, 700 - 12 * i]);
    rows[5][0] = 'left column ends mid sentence and the text runs';
    for (let i = 0; i < 6; i += 1) rows.push([`${i === 0 ? 'on' : 'and'} into the right column ${i}`.padEnd(50, ' x'), 320, 700 - 12 * i]);
    const paras = buildParagraphs([page(1, rows)]);
    expect(paras).toHaveLength(1);
    expect(paras[0].parts).toHaveLength(2);
    expect(paras[0].parts.every((p) => p.page === 1 && p.box.length === 4)).toBe(true);
  });

  it('marks headings by size, by their own font, and by all-caps numbering', () => {
    const body = (y) => [`Body text ${FILLER} ${FILLER}.`, 50, y];
    const paras = buildParagraphs([page(1, [
      ['A Study of Things', 50, 760, 16],
      ['1. Introduction', 50, 730, 10, 'bold'],
      body(716),
      ['1.1. Scope', 50, 690, 10, 'bold'],
      body(676),
      ['II. BACKGROUND', 200, 650, 8],
      body(636),
      body(624),
    ])]);
    const headings = paras.filter((p) => p.heading).map((p) => [p.text, p.heading]);
    expect(headings).toEqual([
      ['A Study of Things', 1],
      ['1. Introduction', 2],
      ['1.1. Scope', 3],
      ['II. BACKGROUND', 2],
    ]);
  });

  it('turns each table row into one paragraph with cell separators', () => {
    const paras = buildParagraphs([page(1, [
      ['Site', 50, 500], ['Area', 150, 500], ['Depth', 250, 500],
      ['Pine Ck', 50, 488], ['320', 150, 488], ['1.0', 250, 488],
    ])]);
    expect(texts(paras)).toEqual(['Site | Area | Depth', 'Pine Ck | 320 | 1.0']);
  });

  it('reads a rotated table in its own direction', () => {
    const items = [
      item(`Normal body text ${FILLER}.`, 50, 700),
      item(`More normal body text ${FILLER}.`, 50, 688),
      item('Site', 500, 100, 10, { angle: 90 }),
      item('Area', 500, 200, 10, { angle: 90 }),
      item('Depth', 500, 300, 10, { angle: 90 }),
    ];
    const paras = buildParagraphs([{ page: 1, layout: readPageLayout(items, VIEW) }]);
    expect(texts(paras)).toContain('Site | Area | Depth');
  });

  it('passes OCR text through as blank-line separated paragraphs', () => {
    const paras = buildParagraphs([{ page: 3, text: 'First block\nstill first\n\nSecond block' }]);
    expect(paras).toEqual([
      { text: 'First block\nstill first', parts: [{ page: 3 }] },
      { text: 'Second block', parts: [{ page: 3 }] },
    ]);
  });
});

describe('cleanText', () => {
  it('merges spacing accents inside words only', () => {
    expect(cleanText('J˛edrzej')).toBe('Jędrzej');
    expect(cleanText('na¨ıve')).toBe('naïve');
    expect(cleanText('I´ve')).toBe('I´ve');
    expect(cleanText('/˜smith')).toBe('/˜smith');
  });

  it('strips control characters and soft hyphens but keeps line breaks', () => {
    const nul = String.fromCharCode(0);
    const soft = String.fromCharCode(0xad);
    expect(cleanText(`x ${nul} y`)).toBe('x y');
    expect(cleanText(`co${soft}operate\nnext`)).toBe('cooperate\nnext');
  });
});
