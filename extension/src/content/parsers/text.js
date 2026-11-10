// Shared pieces of the subtitle parsers: clock times, cue text cleaning and
// the final pass every parser ends with. A cue is { id, start, end, text }
// in seconds (3 decimals) with plain one-line text.

// Han, kana, CJK punctuation and full-width forms: no space when a line
// break falls between two of them. Hangul is left out (Korean spaces words).
const CJK = '\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\u{3000}-\\u{303f}\\u{30fb}\\u{30fc}\\u{ff00}-\\u{ffef}';
const CJK_END = new RegExp(`[${CJK}]$`, 'u');
const CJK_START = new RegExp(`^[${CJK}]`, 'u');

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u{a0}',
  lrm: '\u{200e}', rlm: '\u{200f}', ndash: '\u{2013}', mdash: '\u{2014}', hellip: '\u{2026}',
  lsquo: '\u{2018}', rsquo: '\u{2019}', ldquo: '\u{201c}', rdquo: '\u{201d}',
  laquo: '\u{ab}', raquo: '\u{bb}', middot: '\u{b7}', copy: '\u{a9}', reg: '\u{ae}', trade: '\u{2122}',
};

// Tags (<i>, </c>, <v Name>, <font …>) and karaoke timestamps (<00:01.000>);
// a bare "<3" or "a < b" is text.
const TAG = /<\/?(?:[a-zA-Z][^<>]*|\d[\d:.]*)>/g;

// A VTT / SRT timing line: start and end clock, settings after them ignored.
const CLOCK = '(?:\\d+:)?\\d+:\\d{1,2}(?:[.,]\\d+)?';
export const TIMING = new RegExp(`^\\s*(${CLOCK})\\s*-->\\s*(${CLOCK})`);

// hh:mm:ss.mmm, mm:ss.mmm (minutes may pass 59), ',' or '.' before the fraction.
export function parseClock(s) {
  const m = /^\s*(?:(\d+):)?(\d+):(\d{1,2})(?:[.,](\d+))?\s*$/.exec(s);
  if (!m) return NaN;
  return (Number(m[1]) || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + (m[4] ? Number(`0.${m[4]}`) : 0);
}

export function decodeEntities(s) {
  return s.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (all, dec, hex, name) => {
    if (name) return Object.hasOwn(ENTITIES, name) ? ENTITIES[name] : all;
    const cp = dec ? Number(dec) : parseInt(hex, 16);
    return cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : all;
  });
}

// Lines joined by one space (none between CJK), whitespace runs collapsed, trimmed.
export function normalizeText(raw) {
  let out = '';
  for (const part of String(raw ?? '').split(/\r\n|\r|\n|\u{2028}/u)) {
    const line = part.replace(/\s+/g, ' ').trim();
    if (!line) continue;
    out = !out ? line : out + (CJK_END.test(out) && CJK_START.test(line) ? '' : ' ') + line;
  }
  return out;
}

// VTT / SRT cue text: <br> is a line break, ruby readings and tags go, as do
// {\an8}-style overrides; entities are decoded last so &lt;i&gt; stays text.
export function cleanMarkup(raw) {
  const stripped = String(raw ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<(rt|rp)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(TAG, '')
    .replace(/\{\\[^}]*\}/g, '');
  return normalizeText(decodeEntities(stripped));
}

const round3 = (x) => Math.round(x * 1000) / 1000;

// Drops empty or untimed cues, makes ids unique (id, id#2 …), rounds the
// times and sorts by start (stable, so overlaps keep their source order).
export function finishCues(cues) {
  const seen = new Set();
  const out = [];
  for (const c of cues) {
    if (!c.text || !Number.isFinite(c.start) || !Number.isFinite(c.end)) continue;
    let id = String(c.id);
    for (let n = 2; seen.has(id); n++) id = `${c.id}#${n}`;
    seen.add(id);
    out.push({ id, start: round3(c.start), end: round3(c.end), text: c.text });
  }
  return out.sort((a, b) => a.start - b.start);
}

export const splitLines = (text) => text.replace(/^\u{feff}/u, '').split(/\r\n|\r|\n/);
