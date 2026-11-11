// Companion finals cut into caption-sized pieces before they are numbered and
// translated: at sentence ends first, then at clause marks or pauses for any
// piece still too wide; narrow leftovers join a neighbour. Times come from the
// recognizer's token starts, or are shared out by width when there are none
// (the high-accuracy tier). Rules: docs/design/listen.md §11.

const MAX_WIDTH = 64; // a CJK character counts 2
const MIN_WIDTH = 16;
const PAUSE_S = 0.7;
const LEAD_S = 0.1;

const WIDE = /[\u{1100}-\u{11FF}\u{2E80}-\u{9FFF}\u{AC00}-\u{D7AF}\u{F900}-\u{FAFF}\u{FF00}-\u{FFEF}]/u;
// Wide script written without spaces (Hangul has them): any two characters part.
const UNSPACED = /[\u{2E80}-\u{9FFF}\u{F900}-\u{FAFF}\u{FF00}-\u{FFEF}]/u;
const SENTENCE_END = /[.?!\u{3002}\u{FF1F}\u{FF01}\u{2026}]["'\u{201D}\u{2019})\u{FF09}\u{300D}\u{300F}]*$/u;
const CLAUSE_END = /[,;:\u{FF0C}\u{FF1B}\u{FF1A}\u{3001}]$/u;
const LEADING_PUNCT = /^\s*[\p{P}]/u;
const UNIT_RE = /\s*(?:[\u{1100}-\u{11FF}\u{2E80}-\u{9FFF}\u{AC00}-\u{D7AF}\u{F900}-\u{FAFF}\u{FF00}-\u{FFEF}]|[^\s\u{1100}-\u{11FF}\u{2E80}-\u{9FFF}\u{AC00}-\u{D7AF}\u{F900}-\u{FAFF}\u{FF00}-\u{FFEF}]+)/gu;

const round2 = (n) => Math.round(n * 100) / 100;

function widthOf(s) {
  let w = 0;
  for (const ch of s.trim()) w += WIDE.test(ch) ? 2 : 1;
  return w;
}

// Token units with start times when the marks spell exactly the final's text.
function unitsFromMarks(text, marks) {
  const tokens = marks?.tokens;
  const times = marks?.timestamps;
  if (!Array.isArray(tokens) || !Array.isArray(times) || !tokens.length || tokens.length !== times.length) return null;
  if (!times.every((t, i) => Number.isFinite(t) && (i === 0 || t >= times[i - 1]))) return null;
  const units = tokens.map((tok, i) => ({ s: String(tok).replace(/\u{2581}/gu, ' '), t: times[i] }));
  return units.map((u) => u.s).join('').trim() === text ? units : null;
}

const unitsFromText = (text) => (text.match(UNIT_RE) || []).map((s) => ({ s, t: null }));

// How good a cut between units k and k + 1 is: 3 sentence end, 2 clause mark
// or pause, 1 word boundary, 0 none (inside a word, or before punctuation).
function strengthAfter(units, k) {
  const a = units[k].s;
  const b = units[k + 1].s;
  if (LEADING_PUNCT.test(b)) return 0;
  const tail = a.trimEnd();
  if (SENTENCE_END.test(tail)) return 3;
  if (CLAUSE_END.test(tail)) return 2;
  const boundary = /^\s/.test(b) || UNSPACED.test(tail.slice(-1)) || UNSPACED.test(b.trim()[0] || '');
  if (!boundary) return 0;
  if (units[k].t !== null && units[k + 1].t - units[k].t >= PAUSE_S) return 2;
  return 1;
}

// Splits [i, j) at its best inner cut until every piece fits.
function splitWide(units, widths, strengths, i, j, out) {
  let total = 0;
  for (let k = i; k < j; k++) total += widths[k];
  if (total <= MAX_WIDTH) return void out.push([i, j]);
  let best = -1;
  let bestKey = null;
  let left = 0;
  for (let k = i; k < j - 1; k++) {
    left += widths[k];
    const st = strengths[k];
    if (!st) continue;
    const fits = left >= MIN_WIDTH && total - left >= MIN_WIDTH ? 1 : 0;
    const key = [fits, fits ? st : 0, -Math.abs(left - total / 2)];
    if (!bestKey || key[0] > bestKey[0] || (key[0] === bestKey[0] && (key[1] > bestKey[1] || (key[1] === bestKey[1] && key[2] > bestKey[2])))) {
      best = k;
      bestKey = key;
    }
  }
  if (best < 0) return void out.push([i, j]);
  splitWide(units, widths, strengths, i, best + 1, out);
  splitWide(units, widths, strengths, best + 1, j, out);
}

function pieceRanges(units) {
  const widths = units.map((u, k) => (k === 0 ? widthOf(u.s) : widthOf(u.s) + (/^\s/.test(u.s) ? 1 : 0)));
  const strengths = units.slice(0, -1).map((_, k) => strengthAfter(units, k));
  const ranges = [];
  let start = 0;
  for (let k = 0; k < units.length; k++) {
    if (k === units.length - 1 || strengths[k] === 3) {
      splitWide(units, widths, strengths, start, k + 1, ranges);
      start = k + 1;
    }
  }
  const sum = ([a, b]) => widths.slice(a, b).reduce((x, y) => x + y, 0);
  const merged = [];
  for (const r of ranges) {
    const prev = merged[merged.length - 1];
    if (prev && (sum(prev) < MIN_WIDTH || sum(r) < MIN_WIDTH) && sum(prev) + sum(r) <= MAX_WIDTH) prev[1] = r[1];
    else merged.push([...r]);
  }
  return { ranges: merged, widths };
}

// rec: the worker's segment record; marks: { tokens, timestamps } (seconds
// from the segment start) or null. Returns one record per piece; a final that
// stays whole comes back as it was.
function splitFinal(rec, marks) {
  const text = typeof rec?.text === 'string' ? rec.text.trim() : '';
  if (!text) return [rec];
  const timed = unitsFromMarks(text, marks);
  const units = timed || unitsFromText(text);
  if (units.length < 2) return [rec];
  const { ranges, widths } = pieceRanges(units);
  if (ranges.length < 2) return [rec];

  const dur = Number(rec.segDurS) || 0;
  const total = widths.reduce((x, y) => x + y, 0) || 1;
  let acc = 0;
  const starts = ranges.map(([a, b]) => {
    const at = timed ? Math.min(dur, Math.max(0, units[a].t - LEAD_S)) : (dur * acc) / total;
    acc += widths.slice(a, b).reduce((x, y) => x + y, 0);
    return at;
  });
  return ranges.map(([a, b], n) => {
    const piece = units
      .slice(a, b)
      .map((u) => u.s)
      .join('')
      .trim();
    const from = n === 0 ? Math.min(starts[0], dur) : starts[n];
    const to = n === ranges.length - 1 ? dur : Math.max(from, starts[n + 1]);
    return { ...rec, segStartS: round2(rec.segStartS + from), segDurS: round2(to - from), text: piece, textLen: piece.length };
  });
}

module.exports = { splitFinal, MAX_WIDTH, MIN_WIDTH };
