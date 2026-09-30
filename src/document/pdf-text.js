// PDF text-layer reconstruction: pdf.js text items become lines
// (readPageLayout), lines become paragraphs with page locations
// (buildParagraphs). parsePDF in document-parser.js turns the paragraphs
// into segments. Rules and thresholds: docs/design/renderer.md §5.

import { endsSentence } from './sentence-breaks.js';

const RIGHT_ANGLE_TOLERANCE_DEG = 2;
const SCRIPT_SIZE_RATIO = 0.85;
const SIZE_CHANGE_RATIO = 0.12;
const PARAGRAPH_GAP_RATIO = 1.45;
const HEADING_SIZE_RATIO = 1.15;
const DEFAULT_PITCH_RATIO = 1.2;
const RUNNING_BAND_RATIO = 0.12;
const RUNNING_MIN_PAGES = 3;
const RUNNING_MIN_SHARE = 0.4;
const GARBLED_MIN_CHARS = 10;
const GARBLED_MIN_RATIO = 0.1;
const MAX_HEADING_LEVEL = 6;

const CJK = /[\u{3000}-\u{30ff}\u{3400}-\u{4dbf}\u{4e00}-\u{9fff}\u{ac00}-\u{d7af}\u{f900}-\u{faff}\u{ff00}-\u{ffef}]/u;
const GARBLED_CHAR = /[\p{Co}\p{Cc}\u{fffd}]/u;
const CONTROL_CHARS = /(?![\t\n\r])\p{Cc}/gu;
const BULLET_START = /^[•·▪◦‣●○■□►▸✓✔]/u;
const NUMBERED_START = /^\(?(?:\d{1,2}|[a-z]|[ivx]{1,4})[.)]\s/iu;
const PAGE_NUMBER = /^[\s\-–—·•|]*(?:page\s*|p\.\s*|第\s*)?\d{1,4}(?:\s*(?:\/|of|共)\s*\d{1,4})?\s*页?[\s\-–—·•|]*$/iu;

const SUPERSCRIPT = {
  0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹',
  '+': '⁺', '-': '⁻', '−': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ', i: 'ⁱ',
};
const SUBSCRIPT = {
  0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉',
  '+': '₊', '-': '₋', '−': '₋', '=': '₌', '(': '₍', ')': '₎',
};

// Spacing accents that TeX-style PDFs emit inside a word, ahead of their
// letter. Acute and grave are left out: web text uses them as apostrophes.
const COMBINING = {
  '¨': '\u{308}', '¯': '\u{304}', '¸': '\u{327}', 'ˆ': '\u{302}', 'ˇ': '\u{30c}', '˘': '\u{306}',
  '˙': '\u{307}', '˚': '\u{30a}', '˛': '\u{328}', '˜': '\u{303}', '˝': '\u{30b}',
};
const MARK_INSIDE_WORD = /(?<=\p{L})([¨¯¸ˆˇ˘˙˚˛˜˝])(\p{L})/gu;

const firstChar = (s) => s.trimStart().charAt(0);
const lastChar = (s) => s.trimEnd().slice(-1);
const round = (n) => Math.round(n * 2) / 2;

function mode(weights) {
  let best = null;
  let bestWeight = -1;
  for (const [key, weight] of weights) {
    if (weight > bestWeight) { best = key; bestWeight = weight; }
  }
  return best;
}

function addWeight(map, key, weight) {
  map.set(key, (map.get(key) || 0) + weight);
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function rotation(snap) {
  const rad = (snap * Math.PI) / 180;
  return { cos: Math.round(Math.cos(rad)), sin: Math.round(Math.sin(rad)) };
}

// Frame coordinates: u runs along the text, v points up.
function toFrame(x, y, { cos, sin }) {
  return { u: x * cos + y * sin, v: -x * sin + y * cos };
}

function toUser(u, v, { cos, sin }) {
  return { x: u * cos - v * sin, y: u * sin + v * cos };
}

function frameBounds(view, rot) {
  const [x0, y0, x1, y1] = view;
  const corners = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => toFrame(x, y, rot));
  return {
    uMin: Math.min(...corners.map((c) => c.u)),
    uMax: Math.max(...corners.map((c) => c.u)),
    vMin: Math.min(...corners.map((c) => c.v)),
    vMax: Math.max(...corners.map((c) => c.v)),
  };
}

function mapScript(text, table) {
  const chars = [...text];
  if (!chars.length || chars.some((c) => !(c in table))) return null;
  return chars.map((c) => table[c]).join('');
}

function separator(out, prev, item, em) {
  const text = item.text;
  if (!out || /\s$/.test(out) || /^\s/.test(text)) return '';
  if (prev.role === 'sup' && !prev.mapped && /^[\p{L}\p{N}]/u.test(text)) return ' ';
  const a = lastChar(out);
  const b = firstChar(text);
  const gap = item.u0 - prev.u1;
  if (CJK.test(a) && CJK.test(b)) return '';
  if (CJK.test(a) || CJK.test(b)) return gap > 0.5 * em ? ' ' : '';
  return item.spaceBefore || gap > 0.2 * em ? ' ' : '';
}

function lineText(items, size) {
  let out = '';
  let prev = null;
  for (const item of items) {
    if (item.role === 'sup' || item.role === 'sub') {
      const raw = item.text.trim();
      const mapped = mapScript(raw, item.role === 'sup' ? SUPERSCRIPT : SUBSCRIPT);
      item.mapped = !!mapped;
      if (mapped) out = out.trimEnd() + mapped;
      else out += (item.role === 'sup' && /[\p{L}\p{N}]$/u.test(out) ? ' ' : '') + raw;
    } else {
      out += (prev ? separator(out, prev, item, size) : '') + item.text;
    }
    prev = item;
  }
  return out.replace(/\s+/g, ' ').trim();
}

function finishLine(line, rot) {
  const { items } = line;
  const sizeWeights = new Map();
  for (const item of items) addWeight(sizeWeights, round(item.size), item.text.length);
  const size = mode(sizeWeights);
  const base = median(items.filter((i) => Math.abs(round(i.size) - size) < 0.01).map((i) => i.base));
  for (const item of items) {
    item.role = 'text';
    if (item.size < size * SCRIPT_SIZE_RATIO) {
      if (item.base > base + 0.15 * size) item.role = 'sup';
      else if (item.base < base - 0.1 * size) item.role = 'sub';
    }
  }
  if (!items.some((i) => i.rtl)) items.sort((a, b) => a.u0 - b.u0);

  const fontWeights = new Map();
  const letterFonts = new Set();
  for (const item of items) {
    if (item.role !== 'text' || !/\p{L}/u.test(item.text)) continue;
    addWeight(fontWeights, item.font, item.text.length);
    letterFonts.add(item.font);
  }
  const u0 = Math.min(...items.map((i) => i.u0));
  const u1 = Math.max(...items.map((i) => i.u1));
  const corners = [toUser(u0, line.vBottom, rot), toUser(u1, line.vTop, rot)];
  return {
    text: lineText(items, size),
    size,
    base,
    u0,
    u1,
    vTop: line.vTop,
    vBottom: line.vBottom,
    font: mode(fontWeights),
    fontUniform: letterFonts.size === 1,
    box: [
      Math.min(corners[0].x, corners[1].x), Math.min(corners[0].y, corners[1].y),
      Math.max(corners[0].x, corners[1].x), Math.max(corners[0].y, corners[1].y),
    ],
  };
}

function joinsLine(line, item) {
  const top = item.base + 0.8 * item.size;
  const bottom = item.base - 0.2 * item.size;
  const overlap = Math.min(line.vTop, top) - Math.max(line.vBottom, bottom);
  if (overlap <= 0) return false;
  const script = item.size < line.size * SCRIPT_SIZE_RATIO || line.size < item.size * SCRIPT_SIZE_RATIO;
  if (!script && overlap < 0.5 * Math.min(line.size, item.size)) return false;
  const em = Math.max(line.size, item.size);
  if (item.u0 < line.u1 - em) return false;
  return item.u0 - line.u1 <= 3 * em;
}

function buildLines(items, rot) {
  const lines = [];
  let line = null;
  for (const item of items) {
    const top = item.base + 0.8 * item.size;
    const bottom = item.base - 0.2 * item.size;
    if (line && joinsLine(line, item)) {
      line.items.push(item);
      line.vTop = Math.max(line.vTop, top);
      line.vBottom = Math.min(line.vBottom, bottom);
      line.u1 = Math.max(line.u1, item.u1);
      line.size = Math.max(line.size, item.size);
    } else {
      line = { items: [item], vTop: top, vBottom: bottom, u1: item.u1, size: item.size };
      lines.push(line);
    }
  }
  return lines.map((l) => finishLine(l, rot)).filter((l) => l.text);
}

function verticalOverlap(a, b) {
  return Math.min(a.vTop, b.vTop) - Math.max(a.vBottom, b.vBottom);
}

function isMultiColumn(lines) {
  const eligible = lines.filter((l) => l.text.length >= 15);
  let paired = 0;
  for (const a of eligible) {
    const hasNeighbour = eligible.some((b) => b !== a
      && verticalOverlap(a, b) > 0.5 * Math.min(a.size, b.size)
      && (b.u0 > a.u1 + a.size || a.u0 > b.u1 + b.size));
    if (hasNeighbour) paired += 1;
  }
  return paired >= 4 && paired >= 0.3 * eligible.length;
}

function readingOrder(a, b) {
  if (Math.abs(a.base - b.base) < 0.3 * Math.min(a.size, b.size)) return a.u0 - b.u0;
  return b.base - a.base;
}

// One page of pdf.js text items → ordered lines in the page's dominant text
// direction, plus line groups in other right-angle directions (rotated
// tables, margin stamps).
export function readPageLayout(items, view = [0, 0, 612, 792]) {
  const groups = new Map();
  let chars = 0;
  let garbled = 0;
  for (const raw of items || []) {
    const str = raw?.str;
    if (!str || !Array.isArray(raw.transform)) continue;
    const [a, b, c, d, e, f] = raw.transform;
    const angle = (Math.atan2(b, a) * 180) / Math.PI;
    const nearest = Math.round(angle / 90) * 90;
    if (Math.abs(angle - nearest) > RIGHT_ANGLE_TOLERANCE_DEG) continue;
    const snap = ((nearest % 360) + 360) % 360;
    if (!groups.has(snap)) groups.set(snap, { items: [], pendingSpace: false, chars: 0 });
    const group = groups.get(snap);
    if (!str.trim()) {
      group.pendingSpace = true;
      continue;
    }
    for (const ch of str) {
      if (/\s/u.test(ch)) continue;
      chars += 1;
      group.chars += 1;
      if (GARBLED_CHAR.test(ch)) garbled += 1;
    }
    const rot = rotation(snap);
    const size = raw.height || Math.hypot(c, d) || Math.hypot(a, b) || 1;
    const { u, v } = toFrame(e, f, rot);
    group.items.push({
      text: str,
      u0: u,
      u1: u + (raw.width || str.length * size * 0.5),
      base: v,
      size,
      font: raw.fontName || '',
      rtl: raw.dir === 'rtl',
      spaceBefore: group.pendingSpace,
    });
    group.pendingSpace = false;
  }

  let dominant = 0;
  let most = -1;
  for (const [snap, group] of groups) {
    if (group.chars > most) { dominant = snap; most = group.chars; }
  }
  const rot = rotation(dominant);
  const lines = groups.has(dominant) ? buildLines(groups.get(dominant).items, rot) : [];
  const multiColumn = isMultiColumn(lines);
  if (!multiColumn) lines.sort(readingOrder);
  const strays = [];
  for (const [snap, group] of groups) {
    if (snap === dominant) continue;
    const stray = buildLines(group.items, rotation(snap));
    if (!isMultiColumn(stray)) stray.sort(readingOrder);
    if (stray.length) strays.push(stray);
  }
  return { lines, strays, frame: frameBounds(view, rot), chars, garbled, multiColumn };
}

// Text layers from fonts without a usable Unicode map read as private-use
// or control characters.
export function isGarbledPage(layout) {
  return layout.garbled >= GARBLED_MIN_CHARS && layout.garbled >= GARBLED_MIN_RATIO * layout.chars;
}

export function cleanText(text) {
  return text
    .replace(CONTROL_CHARS, '')
    .replace(/\u{ad}/gu, '')
    .replace(MARK_INSIDE_WORD, (_, mark, letter) => (letter === 'ı' ? 'i' : letter) + COMBINING[mark])
    .normalize('NFC')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

// Letters only, so page numbers inside a running header don't split it;
// letterless lines (dates, "3 / 24") compare with digits folded.
function lineKey(text) {
  const letters = (text.match(/\p{L}+/gu) || []).join('').toLowerCase();
  return letters || text.replace(/\d+/gu, '#').replace(/\s+/gu, '');
}

function inRunningBand(line, frame) {
  const band = RUNNING_BAND_RATIO * (frame.vMax - frame.vMin);
  return line.vBottom >= frame.vMax - band || line.vTop <= frame.vMin + band;
}

function runningKeys(layoutPages) {
  const keys = new Set();
  if (layoutPages.length < RUNNING_MIN_PAGES) return keys;
  const seen = new Map();
  for (const { page, layout } of layoutPages) {
    for (const line of layout.lines) {
      if (!inRunningBand(line, layout.frame)) continue;
      const key = lineKey(line.text);
      if (!key) continue;
      if (!seen.has(key)) seen.set(key, new Set());
      seen.get(key).add(page);
    }
  }
  const needed = Math.max(RUNNING_MIN_PAGES, Math.ceil(RUNNING_MIN_SHARE * layoutPages.length));
  for (const [key, pages] of seen) if (pages.size >= needed) keys.add(key);
  return keys;
}

// Small print at the page edge (footnotes, a first-page copyright line) that
// a paragraph running onto the next page skips over.
function isMarginNote(para, frame, stats) {
  return para.lines.length <= 3
    && para.lines.every((l) => inRunningBand(l, frame) && l.size < 0.9 * stats.bodySize);
}

function isRunningLine(line, frame, keys) {
  if (!inRunningBand(line, frame)) return false;
  return keys.has(lineKey(line.text)) || PAGE_NUMBER.test(line.text);
}

function documentStats(layoutPages) {
  const sizeWeights = new Map();
  const ratios = new Map();
  const all = [];
  for (const { layout } of layoutPages) {
    layout.lines.forEach((line, i) => {
      addWeight(sizeWeights, line.size, line.text.length);
      const next = layout.lines[i + 1];
      if (!next || next.size !== line.size) return;
      const ratio = (line.base - next.base) / line.size;
      if (ratio > 0.8 && ratio < 2.5) {
        if (!ratios.has(line.size)) ratios.set(line.size, []);
        ratios.get(line.size).push(ratio);
        all.push(ratio);
      }
    });
  }
  const bodySize = mode(sizeWeights) || 10;
  const fontWeights = new Map();
  for (const { layout } of layoutPages) {
    for (const line of layout.lines) {
      if (line.font && Math.abs(line.size - bodySize) < 0.5) addWeight(fontWeights, line.font, line.text.length);
    }
  }
  const pitch = new Map([...ratios].map(([size, list]) => [size, median(list)]));
  return { bodySize, bodyFont: mode(fontWeights), pitch, defaultPitch: median(all) || DEFAULT_PITCH_RATIO };
}

function wordForms(layoutPages) {
  const plain = new Set();
  const hyphenated = new Set();
  for (const { layout } of layoutPages) {
    for (const line of layout.lines) {
      for (const token of line.text.match(/\p{L}+(?:[-\u{2010}]\p{L}+)*/gu) || []) {
        const lower = token.toLowerCase().replace(/\u{2010}/gu, '-');
        (lower.includes('-') ? hyphenated : plain).add(lower);
      }
    }
  }
  return { plain, hyphenated };
}

function expectedPitch(stats, size) {
  return (stats.pitch.get(size) || stats.defaultPitch) * size;
}

const HEADING_NUMBER = /^(?:\d+(?:\.\d+)*\.?|[IVX]+\.|[A-Z]\.)\s+/u;

// A lone unnumbered Latin word needs six letters: "Methods" yes, a "Reply"
// button no.
function headingShaped(line, maxLength) {
  const text = line.text.trim();
  const loneWord = !HEADING_NUMBER.test(text) && /^[\p{Script=Latin}]+$/u.test(text);
  return !line.joined
    && text.length <= maxLength
    && /^[\p{L}\p{N}]/u.test(text)
    && (/\p{L}{3}/u.test(text) || (CJK.test(text) && (text.match(/\p{L}/gu) || []).length >= 2))
    && !(loneWord && text.length < 6)
    && !/[.。!！,，;；:：]$/u.test(text)
    && !/^\p{Ll}/u.test(text);
}

// Lines near body size that still read as headings: set in a font of their
// own, or short all-caps lines ("II. BACKGROUND", often small caps).
function isHeadingLine(line, bodySize, bodyFont) {
  if (line.inTable) return false;
  const ratio = line.size / bodySize;
  if (ratio < 0.75 || ratio > HEADING_SIZE_RATIO) return false;
  if (ratio >= 0.85 && bodyFont && line.fontUniform && line.font !== bodyFont && headingShaped(line, 100)) {
    return true;
  }
  const title = line.text.trim().replace(HEADING_NUMBER, '');
  return (title.match(/\p{L}/gu) || []).length >= 4
    && !/[\p{Ll}\p{N}|]/u.test(title)
    && !/[.!?]\s/u.test(title)
    && !line.full
    && headingShaped(line, 80);
}

// Three or more cells on one baseline, or any line the layout model put in
// a table.
function isTableRow(line) {
  return (line.cells || 0) >= 3 || !!line.inTable;
}

function startsBlock(line, prev) {
  if (isTableRow(line) || isTableRow(prev)) return true;
  if (BULLET_START.test(line.text)) return true;
  return NUMBERED_START.test(line.text) && endsSentence(prev.text);
}

// Consecutive lines on one baseline become one line; three or more of them
// read as a table row, cells kept apart by " | ".
function mergeRows(lines, stats) {
  const out = [];
  let run = [];
  const flush = () => {
    if (run.length === 1) out.push(run[0]);
    if (run.length < 2) return;
    const cells = run.length;
    const u0 = Math.min(...run.map((l) => l.u0));
    out.push({
      ...run[0],
      text: run.map((l) => l.text).join(cells >= 3 ? ' | ' : ' '),
      u0,
      u1: Math.max(...run.map((l) => l.u1)),
      vTop: Math.max(...run.map((l) => l.vTop)),
      vBottom: Math.min(...run.map((l) => l.vBottom)),
      fontUniform: run.every((l) => l.fontUniform && l.font === run[0].font),
      box: [
        Math.min(...run.map((l) => l.box[0])), Math.min(...run.map((l) => l.box[1])),
        Math.max(...run.map((l) => l.box[2])), Math.max(...run.map((l) => l.box[3])),
      ],
      cells: cells >= 3 ? cells : 0,
      joined: true,
    });
  };
  for (const line of lines) {
    const first = run[0];
    const sameRow = first
      && Math.abs(first.size - line.size) <= SIZE_CHANGE_RATIO * Math.max(first.size, line.size)
      && Math.abs(first.base - line.base) < 0.3 * expectedPitch(stats, Math.max(first.size, line.size));
    if (!sameRow) {
      flush();
      run = [];
    }
    run.push(line);
  }
  flush();
  return out;
}

// Per page: the column right edge each line sits against, whether it runs
// to that edge, and whether it reads as a heading.
function markLines(lines, stats) {
  const fontWeights = new Map();
  let bodyChars = 0;
  for (const line of lines) {
    if (!line.font || Math.abs(line.size - stats.bodySize) >= 0.5) continue;
    addWeight(fontWeights, line.font, line.text.length);
    bodyChars += line.text.length;
  }
  const bodyFont = bodyChars >= 200 ? mode(fontWeights) : stats.bodyFont;
  for (const line of lines) {
    const em = line.size;
    const width = line.u1 - line.u0;
    let right = line.u1;
    for (const other of lines) {
      const overlap = Math.min(line.u1, other.u1) - Math.max(line.u0, other.u0);
      if (other.u0 <= line.u0 + 3 * em && overlap >= 0.5 * width
          && Math.abs(other.size - line.size) < 0.25 * Math.max(other.size, line.size)) {
        right = Math.max(right, other.u1);
      }
    }
    line.colRight = right;
    line.full = line.u1 >= right - 1.5 * em;
  }
  for (const line of lines) line.headingLike = isHeadingLine(line, stats.bodySize, bodyFont);
  return lines;
}

function continuesAcrossFlow(prev, next) {
  if (prev.headingLike || next.headingLike || startsBlock(next, prev)) return false;
  if (Math.abs(next.size - prev.size) > SIZE_CHANGE_RATIO * Math.max(prev.size, next.size)) return false;
  if (endsSentence(prev.text)) return false;
  if (/\p{L}[-\u{2010}\u{ad}]$/u.test(prev.text) || /^["'“‘([]?\p{Ll}/u.test(next.text)) return true;
  return prev.full;
}

const CONTINUE = 'continue';
const FLOW = 'flow';
const BREAK = 'break';

function relation(prev, line, stats) {
  const size = Math.max(prev.size, line.size);
  if (Math.abs(line.size - prev.size) > SIZE_CHANGE_RATIO * size) return BREAK;
  if (prev.headingLike || line.headingLike) return BREAK;
  if (startsBlock(line, prev)) return BREAK;
  const pitch = expectedPitch(stats, size);
  const dv = prev.base - line.base;
  if (Math.abs(dv) < 0.3 * pitch) return CONTINUE;
  if (dv < 0) return continuesAcrossFlow(prev, line) ? FLOW : BREAK;
  if (dv > PARAGRAPH_GAP_RATIO * pitch) {
    return !endsSentence(prev.text) && /^["'“‘([]?\p{Ll}/u.test(line.text) ? CONTINUE : BREAK;
  }
  const closed = endsSentence(prev.text);
  const em = line.size;
  if (closed && Math.abs(line.u0 - prev.u0) > 0.8 * em) return BREAK;
  if (closed && prev.u1 < prev.colRight - 2.5 * em) return BREAK;
  return CONTINUE;
}

function joinText(a, b, words) {
  const hyphen = a.match(/(\p{L}+)([-\u{2010}\u{ad}])$/u);
  const right = b.match(/^\p{Ll}\p{L}*/u);
  if (hyphen && right) {
    const [, left, mark] = hyphen;
    const compound = /^\p{L}+-\p{L}/u.test(b);
    const keep = mark !== '\u{ad}' && !words.plain.has((left + right[0]).toLowerCase())
      && (compound || words.hyphenated.has(`${left}-${right[0]}`.toLowerCase()));
    return a.slice(0, -1) + (keep ? '-' : '') + b;
  }
  if (CJK.test(lastChar(a)) && CJK.test(firstChar(b))) return a + b;
  return `${a} ${b}`;
}

function startParagraph(line, page) {
  return { lines: [line], text: line.text, parts: [{ page, box: [...line.box] }] };
}

function appendLine(para, line, page, newPart, words) {
  para.text = joinText(para.text, line.text, words);
  para.lines.push(line);
  const part = para.parts[para.parts.length - 1];
  if (newPart || part.page !== page || !part.box) {
    para.parts.push({ page, box: [...line.box] });
  } else {
    part.box = [
      Math.min(part.box[0], line.box[0]), Math.min(part.box[1], line.box[1]),
      Math.max(part.box[2], line.box[2]), Math.max(part.box[3], line.box[3]),
    ];
  }
}

function pageParagraphs(lines, page, stats, words) {
  const paras = [];
  let current = null;
  for (const line of lines) {
    if (!current) {
      current = startParagraph(line, page);
      continue;
    }
    const kind = relation(current.lines[current.lines.length - 1], line, stats);
    if (kind === BREAK) {
      paras.push(current);
      current = startParagraph(line, page);
    } else {
      appendLine(current, line, page, kind === FLOW, words);
    }
  }
  if (current) paras.push(current);
  return paras;
}

function paragraphSize(para) {
  const weights = new Map();
  for (const line of para.lines) addWeight(weights, line.size, line.text.length);
  return mode(weights);
}

// "2.3." → 2; IEEE style: "II." → 1, "B." → 2.
function numberingDepth(text) {
  const m = text.match(/^(\d+(?:\.\d+)*)\.?\s/u);
  if (m) return m[1].split('.').length;
  if (/^[IVX]+\.\s/u.test(text)) return 1;
  return /^[A-Z]\.\s/u.test(text) ? 2 : 1;
}

// Layout labels whose text never becomes a segment: formulas, figure
// labels, page furniture.
const LAYOUT_DROP = new Set(['display_formula', 'formula_number', 'chart', 'image', 'header', 'footer',
  'number', 'header_image', 'footer_image', 'seal']);

function blockArea(block) {
  return (block.box[2] - block.box[0]) * (block.box[3] - block.box[1]);
}

// The smallest block holding the line's centre; inline formulas sit inside
// running text and never claim a line.
function blockOf(line, blocks) {
  const cx = (line.box[0] + line.box[2]) / 2;
  const cy = (line.box[1] + line.box[3]) / 2;
  let best = null;
  for (const block of blocks) {
    if (block.label === 'inline_formula') continue;
    const [x0, y0, x1, y1] = block.box;
    if (cx < x0 || cx > x1 || cy < y0 || cy > y1) continue;
    if (!best || blockArea(block) < blockArea(best)) best = block;
  }
  return best;
}

// Layout blocks on a page: lines inside formulas, figures and page furniture
// go, lines inside a table block are marked as table rows. Paragraphs,
// headings and order stay rule-based: on web pages the model's title labels
// fire on user names and badges.
function placeInLayout(lines, blocks) {
  const kept = [];
  for (const line of lines) {
    const block = blockOf(line, blocks);
    if (block && LAYOUT_DROP.has(block.label)) continue;
    if (block?.label === 'table') line.inTable = true;
    kept.push(line);
  }
  return kept;
}

function markHeadings(paras, stats) {
  const bySize = (p) => p.lines
    && !isTableRow(p.lines[0])
    && p.size >= stats.bodySize * HEADING_SIZE_RATIO
    && p.text.length <= 200
    && p.lines.length <= 3
    && !/[,，;；]$/u.test(p.text);
  const levels = [...new Set(paras.filter(bySize).map((p) => p.size))].sort((a, b) => b - a);
  for (const para of paras) {
    if (!para.lines) continue;
    if (bySize(para)) {
      para.heading = Math.min(MAX_HEADING_LEVEL, levels.indexOf(para.size) + 1);
    } else if (para.lines.length === 1 && para.lines[0].headingLike) {
      para.heading = Math.min(MAX_HEADING_LEVEL, levels.length + numberingDepth(para.text));
    }
  }
}

// pages: [{ page, layout, blocks? }] from readPageLayout (blocks: layout
// model output in PDF user space, [{ label, box, order }]), or
// [{ page, text }] for pages read by OCR. Returns paragraphs in reading
// order; box is in PDF user space, `row` marks a table row whose cells are
// joined by " | ".
export function buildParagraphs(pages) {
  const layoutPages = pages.filter((p) => p.layout);
  const stats = documentStats(layoutPages);
  const keys = runningKeys(layoutPages);
  const words = wordForms(layoutPages);
  const out = [];
  let tail = null;

  for (const entry of pages) {
    if (!entry.layout) {
      for (const block of (entry.text || '').split(/\n\s*\n/)) {
        if (block.trim()) out.push({ text: block.trim(), parts: [{ page: entry.page }] });
      }
      tail = null;
      continue;
    }
    const { layout, page, blocks } = entry;
    let kept = layout.lines.filter((l) => !isRunningLine(l, layout.frame, keys));
    if (blocks?.length) kept = placeInLayout(kept, blocks);
    const lines = markLines(mergeRows(kept, stats), stats);
    const paras = pageParagraphs(lines, page, stats, words);
    const flow = paras.filter((p) => !isMarginNote(p, layout.frame, stats));
    if (tail && flow.length && continuesAcrossFlow(tail.lines[tail.lines.length - 1], flow[0].lines[0])) {
      const head = flow.shift();
      tail.text = joinText(tail.text, head.text, words);
      tail.lines.push(...head.lines);
      tail.parts.push(...head.parts);
      paras.splice(paras.indexOf(head), 1);
    }
    out.push(...paras);
    if (flow.length) tail = flow[flow.length - 1];
    for (const group of layout.strays) {
      const strayLines = blocks?.length ? placeInLayout(group, blocks) : group;
      out.push(...pageParagraphs(markLines(mergeRows(strayLines, stats), stats), page, stats, words));
    }
  }

  for (const para of out) if (para.lines) para.size = paragraphSize(para);
  markHeadings(out, stats);
  return out
    .map((para) => ({
      text: cleanText(para.text),
      parts: para.parts,
      ...(para.heading ? { heading: para.heading } : {}),
      ...(para.lines?.length === 1 && isTableRow(para.lines[0]) ? { row: true } : {}),
    }))
    .filter((para) => para.text);
}
