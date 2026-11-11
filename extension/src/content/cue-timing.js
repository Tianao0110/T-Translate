// When a cue shows and for how long, for both views (caption-track.js,
// overlay.js): one cue on screen at a time, each held past its end until it
// has had time to be read or the next one starts.

const MIN_CUE_S = 0.5;
const LINGER_S = 1;
const READ_BASE_S = 0.6;
const READ_WIDTH_PER_S = 20; // a CJK character counts 2

const WIDE = /[\u{1100}-\u{11FF}\u{2E80}-\u{9FFF}\u{AC00}-\u{D7AF}\u{F900}-\u{FAFF}\u{FF00}-\u{FFEF}]/u;

// VTTCue needs start < end; a zero-length or reversed cue gets half a second.
export const cueTimes = (start, end) => (end > start ? [start, end] : [start, start + MIN_CUE_S]);

// When a cue may leave the screen: a beat after its end, or once its text has
// had time to be read, whichever is later.
export function holdUntil({ start, end, text }) {
  let w = 0;
  for (const ch of String(text).replace(/\s+/g, ' ').trim()) w += WIDE.test(ch) ? 2 : 1;
  return Math.max(end + LINGER_S, start + READ_BASE_S + w / READ_WIDTH_PER_S);
}
