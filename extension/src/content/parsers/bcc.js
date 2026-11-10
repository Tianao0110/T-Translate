// Bilibili subtitle JSON ("bcc": { body: [{ from, to, content }] }, seconds)
// → cues; entries without text or times skip.

import { normalizeText, finishCues } from './text.js';

export function parseBcc(input) {
  let data = input;
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input.replace(/^\u{feff}/u, ''));
    } catch {
      return [];
    }
  }
  const body = data && Array.isArray(data.body) ? data.body : [];
  const cues = [];
  body.forEach((e, i) => {
    if (!e || typeof e.content !== 'string' || typeof e.from !== 'number' || typeof e.to !== 'number') return;
    cues.push({ id: String(i), start: e.from, end: e.to, text: normalizeText(e.content) });
  });
  return finishCues(cues);
}
