// WebVTT → cues. Header, NOTE, STYLE and REGION blocks are skipped, cue
// settings ignored, voice / class / karaoke-timestamp tags stripped. YouTube's
// rolling repeats (the last line again at the top of the next cue) are kept;
// deduping them is the caller's call.

import { TIMING, parseClock, cleanMarkup, finishCues, splitLines } from './text.js';

export function parseVtt(text) {
  if (typeof text !== 'string') return [];
  const blocks = [];
  let block = [];
  for (const line of splitLines(text)) {
    if (line.trim()) block.push(line);
    else if (block.length) blocks.push(block), (block = []);
  }
  if (block.length) blocks.push(block);

  const cues = [];
  for (const b of blocks) {
    if (/^(?:NOTE|STYLE|REGION)(?:\s|$)/.test(b[0].trim())) continue;
    const at = b.findIndex((l) => l.includes('-->'));
    const m = at < 0 ? null : TIMING.exec(b[at]);
    if (!m) continue;
    // The identifier is the one line before the timing line, unless that is the header.
    const ident = at === 1 && !/^WEBVTT/.test(b[0]) ? b[0].trim() : '';
    cues.push({
      id: ident || String(cues.length),
      start: parseClock(m[1]),
      end: parseClock(m[2]),
      text: cleanMarkup(b.slice(at + 1).join('\n')),
    });
  }
  return finishCues(cues);
}
