// Sentence boundaries shared by segment splitting (document-parser.js) and
// PDF paragraph assembly (pdf-text.js).

const STOP_RUN = /[.!?。！？…]+["'”’」』)\]]*\s*/gu;
const CJK_STOP = /[。！？…]/;
const CLOSING_STOP = /[.!?。！？…:：]+["'”’」』)\]]*$/u;

// Lowercased, without the trailing dot.
const ABBREVIATIONS = new Set([
  'al', 'approx', 'ca', 'cf', 'ch', 'chap', 'co', 'corp', 'dept', 'dr', 'ed', 'eds',
  'eq', 'eqs', 'est', 'fig', 'figs', 'inc', 'jr', 'ltd', 'mr', 'mrs', 'ms', 'no', 'nos',
  'pp', 'prof', 'ref', 'refs', 'resp', 'sec', 'sr', 'st', 'tab', 'univ', 'vol', 'vols', 'vs',
]);

function isBoundary(text, index, run) {
  if (CJK_STOP.test(run)) return true;
  const end = index + run.length;
  if (end < text.length && !/\s$/.test(run)) return false;
  if (run[0] !== '.') return true;
  const token = (text.slice(Math.max(0, index - 24), index).match(/[\p{L}.]+$/u)?.[0] || '').toLowerCase();
  const last = token.split('.').pop();
  if (/^\p{L}$/u.test(last)) return false;
  if (ABBREVIATIONS.has(last)) return false;
  return !/^\p{Ll}/u.test(text.slice(end));
}

// Pieces keep their trailing whitespace, so joining them restores the text.
export function splitSentences(text) {
  const pieces = [];
  let start = 0;
  for (const m of text.matchAll(STOP_RUN)) {
    if (!isBoundary(text, m.index, m[0])) continue;
    const end = m.index + m[0].length;
    pieces.push(text.slice(start, end));
    start = end;
  }
  if (start < text.length) pieces.push(text.slice(start));
  return pieces;
}

// True when the text closes a sentence or a colon lead-in.
export function endsSentence(text) {
  const t = (text || '').trimEnd();
  const m = t.match(CLOSING_STOP);
  if (!m) return false;
  if (/[:：!?！？。…]/.test(m[0])) return true;
  return isBoundary(t, m.index, m[0]);
}
