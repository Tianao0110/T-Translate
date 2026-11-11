// Captions as a native 'subtitles' TextTrack on the video. A track cannot be
// removed from its video, so one left by an earlier run (same label) is
// emptied and reused instead of piling up in the player's caption menu. Like
// the overlay it shows one cue at a time (cue-timing.js): each drawn cue ends
// when it has been read or the next one starts, so the browser never stacks
// two. The size factor reaches the browser's cue box through one page
// stylesheet keyed on a data attribute of the video.

import { DEFAULT_SIZE, SIZE_SCALES, SIZES } from './caption-size.js';
import { cueTimes, holdUntil } from './cue-timing.js';

export { cueTimes };
const MIN_DRAWN_S = 0.05;
const SIZE_ATTR = 'data-tc-cap-size';
const SIZE_STYLE_ID = 'tc-cap-cue-size';

function ensureSizeStyle(doc) {
  if (!doc || doc.getElementById(SIZE_STYLE_ID)) return;
  const st = doc.createElement('style');
  st.id = SIZE_STYLE_ID;
  st.textContent = Object.entries(SIZE_SCALES)
    .map(([name, k]) => `video[${SIZE_ATTR}="${name}"]::cue { font-size: ${Math.round(k * 100)}%; }`)
    .join('\n');
  (doc.head || doc.documentElement).append(st);
}

// VTTCue.text is cue markup: '<' and '&' would be read as tags and entities.
export const escapeCueText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function createCaptionTrack({
  video,
  label = 'T-Caption',
  lang = '',
  addTextTrack = (v, kind, l, language) => v.addTextTrack(kind, l, language),
  createCue = (s, e, t) => new VTTCue(s, e, t),
  size = DEFAULT_SIZE,
}) {
  function setSize(next) {
    ensureSizeStyle(video.ownerDocument);
    video.setAttribute?.(SIZE_ATTR, SIZES.includes(next) ? next : DEFAULT_SIZE);
  }
  setSize(size);

  let track = Array.from(video.textTracks || []).find((t) => t.kind === 'subtitles' && t.label === label);
  if (track) {
    track.mode = 'hidden'; // a disabled track lists no cues
    for (const c of Array.from(track.cues || [])) track.removeCue(c);
  } else {
    track = addTextTrack(video, 'subtitles', label, lang);
  }
  track.mode = 'showing';
  const items = new Map(); // id -> { id, start, end, text, seq } as given
  const drawn = new Map(); // id -> the VTTCue on the track
  let order = []; // items by start, the later given first among equal starts
  let index = new Map(); // id -> position in order
  let seq = 0;

  const remove = (cue) => {
    try {
      track.removeCue(cue);
    } catch {} // already gone
  };
  const isActive = (cue) => Array.from(track.activeCues || []).includes(cue);

  function resort() {
    order = [...items.values()].sort((a, b) => a.start - b.start || a.seq - b.seq);
    index = new Map(order.map((c, i) => [c.id, i]));
  }

  // From its start until it has been read or the next cue starts; null when
  // the next one starts right away.
  function windowOf(c) {
    const next = order[index.get(c.id) + 1];
    const end = Math.min(holdUntil(c), next ? next.start : Infinity);
    return end - c.start >= MIN_DRAWN_S ? [c.start, end] : null;
  }

  // A cue on screen is not always repainted when its text or times change
  // (real players' videos kept the old text), so an active cue is swapped for
  // a fresh one; the rest change in place.
  function draw(id) {
    const c = items.get(id);
    const old = drawn.get(id);
    const win = c ? windowOf(c) : null;
    if (!win) {
      if (old) remove(old);
      drawn.delete(id);
      return;
    }
    const t = escapeCueText(c.text);
    if (old && old.startTime === win[0] && old.endTime === win[1]) {
      if (old.text === t) return;
      if (!isActive(old)) {
        old.text = t;
        return;
      }
    }
    if (old) remove(old);
    const cue = createCue(win[0], win[1], t);
    cue.id = id;
    track.addCue(cue);
    drawn.set(id, cue);
  }

  const before = (id) => order[index.get(id) - 1]?.id;

  function upsert({ id, start, end, text }) {
    const [s, e] = cueTimes(start, end);
    const prevBefore = items.has(id) ? before(id) : undefined;
    items.set(id, { id, start: s, end: e, text: String(text ?? ''), seq: seq++ });
    resort();
    for (const k of new Set([prevBefore, before(id), id])) if (k !== undefined) draw(k);
  }

  function updateText(id, text) {
    const c = items.get(id);
    if (!c) return;
    c.text = String(text ?? '');
    draw(id);
  }

  function clear() {
    for (const c of drawn.values()) remove(c);
    drawn.clear();
    items.clear();
    resort();
  }

  return {
    track,
    set(list) {
      clear();
      for (const { id, start, end, text } of list) {
        const [s, e] = cueTimes(start, end);
        items.set(id, { id, start: s, end: e, text: String(text ?? ''), seq: seq++ });
      }
      resort();
      for (const c of order) draw(c.id);
    },
    upsert,
    updateText,
    clear,
    setSize,
    // A hidden track keeps its cues.
    setHidden(on) {
      track.mode = on ? 'hidden' : 'showing';
    },
    destroy() {
      clear();
      track.mode = 'disabled';
      video.removeAttribute?.(SIZE_ATTR);
    },
  };
}
