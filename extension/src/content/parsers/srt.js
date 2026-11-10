// SubRip → cues. Read line by line so a missing blank line between entries
// still splits them; the sequence number becomes the id.

import { TIMING, parseClock, cleanMarkup, finishCues, splitLines } from './text.js';

const SEQ = /^\s*\d+\s*$/;

export function parseSrt(text) {
  if (typeof text !== 'string') return [];
  const cues = [];
  let cur = null;
  let seq = '';
  const flush = () => {
    if (cur) cues.push({ id: cur.id, start: cur.start, end: cur.end, text: cleanMarkup(cur.lines.join('\n')) });
    cur = null;
  };
  for (const line of splitLines(text)) {
    const m = TIMING.exec(line);
    if (m) {
      // No blank line before this entry: its number ended up as the last text line.
      if (cur && cur.lines.length && SEQ.test(cur.lines[cur.lines.length - 1])) seq = cur.lines.pop().trim();
      flush();
      cur = { id: seq || String(cues.length), start: parseClock(m[1]), end: parseClock(m[2]), lines: [] };
      seq = '';
    } else if (!line.trim()) {
      flush();
    } else if (cur) {
      cur.lines.push(line);
    } else if (SEQ.test(line)) {
      seq = line.trim();
    }
  }
  flush();
  return finishCues(cues);
}
