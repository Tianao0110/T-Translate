// TTML / DFXP → cues through DOMParser (content scripts and jsdom have it).
// One cue per <p>; begin / end / dur on body and div offset their children;
// <span> text is inlined, <br/> is a line break; regions and styles are ignored.

import { normalizeText, finishCues } from './text.js';

// Attribute by local name, whatever prefix the file bound its namespace to.
function attr(el, name) {
  for (const a of el.attributes) if (a.localName === name) return a.value;
  return null;
}

function ratesOf(tt) {
  const num = (name, def) => {
    const v = Number(attr(tt, name));
    return v > 0 ? v : def;
  };
  const frameRate = num('frameRate', 30);
  const [n, d] = (attr(tt, 'frameRateMultiplier') || '').trim().split(/\s+/).map(Number);
  const fps = frameRate * (n > 0 && d > 0 ? n / d : 1);
  const subFrameRate = num('subFrameRate', 1);
  const tickRate = num('tickRate', attr(tt, 'frameRate') ? fps * subFrameRate : 1);
  return { fps, subFrameRate, tickRate };
}

const UNIT_S = { h: 3600, m: 60, s: 1, ms: 0.001 };

// Clock (hh:mm:ss.fff, hh:mm:ss:ff[.sub]) or offset (12.5s, 500ms, 30f, 9000t) in seconds.
export function parseTtmlTime(value, rates = { fps: 30, subFrameRate: 1, tickRate: 1 }) {
  const s = String(value ?? '').trim();
  let m = /^(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/.exec(s);
  if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  m = /^(\d+):(\d{1,2}):(\d{1,2}):(\d+)(?:\.(\d+))?$/.exec(s);
  if (m) {
    const frames = Number(m[4]) + (m[5] ? Number(m[5]) / rates.subFrameRate : 0);
    return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + frames / rates.fps;
  }
  m = /^(\d+(?:\.\d+)?)(h|ms|m|s|f|t)$/.exec(s);
  if (!m) return NaN;
  const v = Number(m[1]);
  if (m[2] === 'f') return v / rates.fps;
  if (m[2] === 't') return v / rates.tickRate;
  return v * UNIT_S[m[2]];
}

// [begin, end] of el in seconds; begin and end count from the parent's begin.
function interval(el, parentBegin, parentEnd, rates) {
  const b = attr(el, 'begin');
  const e = attr(el, 'end');
  const d = attr(el, 'dur');
  const begin = b === null ? parentBegin : parentBegin + parseTtmlTime(b, rates);
  let end = e !== null ? parentBegin + parseTtmlTime(e, rates) : d !== null ? begin + parseTtmlTime(d, rates) : parentEnd;
  if (end > parentEnd) end = parentEnd;
  return [begin, end];
}

// A <p> timed only through its spans ends with the last of them.
function latestEnd(el, begin, rates) {
  let max = -Infinity;
  for (const child of el.children) {
    const [b, e] = interval(child, begin, Infinity, rates);
    if (Number.isFinite(e) && e > max) max = e;
    max = Math.max(max, latestEnd(child, b, rates));
  }
  return max;
}

function textOf(el) {
  let s = '';
  for (const n of el.childNodes) {
    if (n.nodeType === 3 || n.nodeType === 4) s += n.data;
    else if (n.nodeType === 1 && n.localName === 'br') s += '\n';
    else if (n.nodeType === 1 && n.localName === 'span') s += textOf(n);
  }
  return s;
}

export function parseTtml(text) {
  if (typeof text !== 'string' || typeof DOMParser !== 'function') return [];
  const doc = new DOMParser().parseFromString(text.replace(/^\u{feff}/u, ''), 'application/xml');
  const tt = doc.documentElement;
  if (!tt || tt.localName !== 'tt' || doc.getElementsByTagNameNS('*', 'parsererror').length) return [];
  const rates = ratesOf(tt);
  const cues = [];
  const walk = (el, begin, end) => {
    for (const child of el.children) {
      const name = child.localName;
      if (name !== 'body' && name !== 'div' && name !== 'p') continue;
      const [b, e] = interval(child, begin, end, rates);
      if (name !== 'p') {
        walk(child, b, e);
        continue;
      }
      const last = e === Infinity ? latestEnd(child, b, rates) : e;
      cues.push({ id: attr(child, 'id') || String(cues.length), start: b, end: last, text: normalizeText(textOf(child)) });
    }
  };
  walk(tt, 0, Infinity);
  return finishCues(cues);
}
