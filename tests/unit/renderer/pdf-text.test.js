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
    expect(paras.every((p) => p.row)).toBe(true);
  });

  it('folds lines that continue wrapped cells into the row above', () => {
    const paras = buildParagraphs([page(1, [
      ['Site', 50, 500], ['Area', 150, 500], ['Reference', 250, 500],
      ['Stewarts Ck', 50, 488], ['1156', 150, 488], ['Nandakumar and', 250, 488],
      ['Mein, 1993', 250, 476],
      ['Glendhu', 50, 464], ['310', 150, 464], ['Fahey and', 250, 464],
      ['(km2)', 150, 452], ['Jackson, 1997', 250, 452],
    ])]);
    expect(texts(paras)).toEqual([
      'Site | Area | Reference',
      'Stewarts Ck | 1156 | Nandakumar and Mein, 1993',
      'Glendhu | 310 (km2) | Fahey and Jackson, 1997',
    ]);
    expect(paras.every((p) => p.row)).toBe(true);
  });

  it('keeps a first-column heading, a full row, a line across cells and text after a gap out of the row above', () => {
    const paras = buildParagraphs([page(1, [
      ['Site', 50, 500], ['Area', 150, 500], ['Depth', 250, 500],
      ['Pine Ck', 50, 488], ['320', 150, 488], ['1.0', 250, 488],
      ['Victoria', 50, 476],
      ['Oak Ck', 50, 464], ['12', 150, 464], ['2.0', 250, 464],
      ['spans the area and depth columns', 150, 452],
      ['Values are annual means.', 150, 420],
    ])]);
    expect(texts(paras)).toEqual([
      'Site | Area | Depth', 'Pine Ck | 320 | 1.0', 'Victoria', 'Oak Ck | 12 | 2.0',
      'spans the area and depth columns', 'Values are annual means.',
    ]);
  });

  it('folds a wrapped first-column entry that reads as the rest of it', () => {
    const paras = buildParagraphs([page(1, [
      ['Site', 50, 500], ['Area', 170, 500], ['Reference', 250, 500],
      ['Stewarts Creek', 50, 488], ['1156', 170, 488], ['Nandakumar and', 250, 488],
      ['catchment (Vic)', 50, 476], ['Mein, 1993', 250, 476],
      ['Pine Ck', 50, 464], ['320', 170, 464], ['Smith, 2001', 250, 464],
      ['(Vic)', 50, 452],
    ])]);
    expect(texts(paras)).toEqual([
      'Site | Area | Reference',
      'Stewarts Creek catchment (Vic) | 1156 | Nandakumar and Mein, 1993',
      'Pine Ck (Vic) | 320 | Smith, 2001',
    ]);
  });

  it('folds a capitalised first-column line only when it sits tighter than the rows', () => {
    const paras = buildParagraphs([page(1, [
      ['Site', 50, 500], ['Area', 150, 500], ['Depth', 250, 500],
      ['Lake Eildon', 50, 484], ['540', 150, 484], ['0.3', 250, 484],
      ['North Arm', 50, 472],
      ['Pine Ck', 50, 456], ['320', 150, 456], ['1.0', 250, 456],
      ['Victoria', 50, 440],
    ])]);
    expect(texts(paras)).toEqual([
      'Site | Area | Depth', 'Lake Eildon North Arm | 540 | 0.3', 'Pine Ck | 320 | 1.0', 'Victoria',
    ]);
  });

  it('splits cells a narrow column gap ran together on the column edges other rows share', () => {
    const paras = buildParagraphs([page(1, [
      ['Subject', 50, 500], ['Course Title', 130, 500], ['Campus', 260, 500], ['Grade', 310, 500],
      ['CPRG 305', 50, 488], ['Testing', 130, 488], ['MC', 260, 488], ['A', 310, 488],
      ['CPRG 303', 50, 476], ['Mobile Apps', 130, 476], ['MC', 260, 476], ['A+', 310, 476],
      ['CPSY 300', 50, 464], ['Cloud Computing for SD', 130, 464], ['MC', 260, 464], ['A', 310, 464],
      ['Values are annual means over the full', 50, 430], ['record.', 260, 430],
    ])]);
    expect(texts(paras)).toEqual([
      'Subject | Course Title | Campus | Grade',
      'CPRG 305 | Testing | MC | A',
      'CPRG 303 | Mobile Apps | MC | A+',
      'CPSY 300 | Cloud Computing for SD | MC | A',
      'Values are annual means over the full record.',
    ]);
  });

  it('keeps empty cells in their columns so rows line up under the header; empty columns at the end are left off', () => {
    const paras = buildParagraphs([page(1, [
      ['Subject', 50, 500], ['Title', 130, 500], ['Midterm', 230, 500], ['Final', 290, 500], ['Notes', 350, 500], ['Hours', 430, 500], ['Action', 500, 500],
      ['CPRG 305', 50, 488], ['Testing', 130, 488], ['A', 290, 488], ['3.000', 430, 488],
      ['CPRG 303', 50, 476], ['Mobile', 130, 476], ['B+', 230, 476], ['A+', 290, 476], ['3.000', 430, 476],
      ['MATH 237', 50, 464], ['Math', 130, 464], ['B', 290, 464], ['Late', 350, 464], ['3.000', 430, 464],
      ['Values are annual means over the full', 50, 430], ['record.', 260, 430],
    ])]);
    expect(texts(paras)).toEqual([
      'Subject | Title | Midterm | Final | Notes | Hours | Action',
      'CPRG 305 | Testing | | A | | 3.000',
      'CPRG 303 | Mobile | B+ | A+ | | 3.000',
      'MATH 237 | Math | | B | Late | 3.000',
      'Values are annual means over the full record.',
    ]);
    expect(paras.slice(0, 4).every((p) => p.row)).toBe(true);
  });

  it('leaves a sparse row alone rather than guess a grid for it', () => {
    const paras = buildParagraphs([page(1, [
      ['Subject', 50, 500], ['Title', 140, 500], ['Midterm', 230, 500], ['Final', 310, 500], ['Notes', 380, 500], ['Hours', 450, 500], ['Action', 530, 500],
      ['CPRG 305', 50, 488], ['Testing', 140, 488], ['B+', 230, 488], ['A', 310, 488], ['Fine', 380, 488], ['3.000', 450, 488], ['View', 530, 488],
      ['Total', 50, 476], ['Credits', 230, 476], ['6.000', 450, 476],
    ])]);
    expect(texts(paras)).toEqual([
      'Subject | Title | Midterm | Final | Notes | Hours | Action',
      'CPRG 305 | Testing | B+ | A | Fine | 3.000 | View',
      // Three of seven columns filled: left alone.
      'Total | Credits | 6.000',
    ]);
  });

  it('puts a row of vertically centred cells back together across its baselines', () => {
    const paras = buildParagraphs([page(1, [
      ['Site', 50, 500], ['Area', 150, 500], ['Change', 250, 500], ['Reference', 350, 500],
      ['Stewarts Creek', 50, 481], ['Nandakumar and', 350, 481],
      ['1156', 150, 475], ['0.42', 250, 475],
      ['catchment (Vic)', 50, 469], ['Mein, 1993', 350, 469],
      ['Pine Ck', 50, 450], ['320', 150, 450], ['1.00', 250, 450], ['Smith, 2001', 350, 450],
      ['Victoria', 50, 431],
      ['Glendhu', 50, 412],
      ['experimental', 50, 400], ['310', 150, 400], ['0.80', 250, 400], ['Fahey, 1997', 350, 400],
      ['basin', 50, 388],
      ['Total', 50, 369], ['1882', 150, 369], ['2.37', 250, 369],
    ])]);
    expect(texts(paras)).toEqual([
      'Site | Area | Change | Reference',
      'Stewarts Creek catchment (Vic) | 1156 | 0.42 | Nandakumar and Mein, 1993',
      'Pine Ck | 320 | 1.00 | Smith, 2001',
      'Victoria',
      'Glendhu experimental basin | 310 | 0.80 | Fahey, 1997',
      'Total | 1882 | 2.37',
    ]);
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

describe('buildParagraphs with layout blocks', () => {
  // Blocks are in PDF user space ([x0, y0, x1, y1], y up) like parsePDF hands them over.
  const block = (label, order, box) => ({ label, order, box });
  const withBlocks = (rows, blocks) => ({ ...page(1, rows), blocks });

  it('drops formula and figure text and keeps one paragraph per text block', () => {
    const paras = buildParagraphs([withBlocks([
      [`Body text starts here and ${FILLER}`, 50, 700],
      [`and ends inside the block ${FILLER}.`, 50, 688],
      ['Q% Z a C b', 100, 650],
      ['Left camera Right camera', 60, 600],
      [`Second paragraph ${FILLER}.`, 50, 560],
    ], [
      block('text', 0, [40, 680, 560, 715]),
      block('display_formula', 1, [90, 640, 300, 665]),
      block('chart', 2, [40, 580, 400, 630]),
      block('text', 3, [40, 550, 560, 575]),
    ])]);
    expect(texts(paras).map((t) => t.slice(0, 18))).toEqual(['Body text starts h', 'Second paragraph t']);
  });

  it('keeps rule-based order and headings: title labels on web user names do not count', () => {
    const paras = buildParagraphs([withBlocks([
      ['Doppel11 • 5d ago', 50, 700, 9],
      [`Is there any mod for this laptop ${FILLER}?`, 50, 680],
    ], [
      block('text', 0, [40, 670, 560, 695]),
      block('paragraph_title', 1, [40, 695, 200, 710]),
    ])]);
    expect(paras.map((p) => [p.text.slice(0, 12), p.heading || 0])).toEqual([['Doppel11 • 5', 0], ['Is there any', 0]]);
  });

  it('turns every line of a table block into a table row and folds wrapped cells back in', () => {
    const paras = buildParagraphs([withBlocks([
      ['Site', 50, 500], ['Area', 150, 500],
      ['Pine Ck', 50, 488], ['Nandakumar and', 150, 488],
      ['Mein, 1993', 150, 476],
      ['Note', 50, 464],
    ], [block('table', 0, [40, 460, 300, 515])])]);
    expect(paras.map((p) => [p.text, !!p.row])).toEqual([
      ['Site | Area', true], ['Pine Ck | Nandakumar and Mein, 1993', true], ['Note', true],
    ]);
  });

  it('inline formulas claim no line', () => {
    const paras = buildParagraphs([withBlocks([
      [`Second block with x = y inside ${FILLER}.`, 50, 500],
    ], [
      block('text', 0, [40, 490, 560, 515]),
      block('inline_formula', 1, [40, 495, 560, 510]),
    ])]);
    expect(paras).toHaveLength(1);
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
