// Captions as a native 'subtitles' TextTrack on the video. A track cannot be
// removed from its video, so one left by an earlier run (same label) is
// emptied and reused instead of piling up in the player's caption menu. The
// size factor reaches the browser's cue box through one page stylesheet keyed
// on a data attribute of the video.

import { DEFAULT_SIZE, SIZE_SCALES, SIZES } from './caption-size.js';

const MIN_CUE_S = 0.5;
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

// VTTCue needs start < end; a zero-length or reversed cue gets half a second.
export const cueTimes = (start, end) => (end > start ? [start, end] : [start, start + MIN_CUE_S]);

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
  const cues = new Map();

  const remove = (cue) => {
    try {
      track.removeCue(cue);
    } catch {} // already gone
  };

  function upsert({ id, start, end, text }) {
    const [s, e] = cueTimes(start, end);
    const old = cues.get(id);
    if (old && old.startTime === s && old.endTime === e) return updateText(id, text);
    if (old) remove(old);
    const cue = createCue(s, e, escapeCueText(text));
    cue.id = id;
    track.addCue(cue);
    cues.set(id, cue);
  }

  const isActive = (cue) => Array.from(track.activeCues || []).includes(cue);

  // A cue on screen is not always repainted when its text changes (real
  // players' videos kept the old text), so an active cue is swapped for a
  // fresh one; the rest change in place.
  function updateText(id, text) {
    const cue = cues.get(id);
    const t = escapeCueText(text);
    if (!cue || cue.text === t) return;
    if (!isActive(cue)) {
      cue.text = t;
      return;
    }
    remove(cue);
    const fresh = createCue(cue.startTime, cue.endTime, t);
    fresh.id = id;
    track.addCue(fresh);
    cues.set(id, fresh);
  }

  function clear() {
    for (const c of cues.values()) remove(c);
    cues.clear();
  }

  return {
    track,
    set(list) {
      clear();
      for (const c of list) upsert(c);
    },
    upsert,
    updateText,
    clear,
    setSize,
    destroy() {
      clear();
      track.mode = 'disabled';
      video.removeAttribute?.(SIZE_ATTR);
    },
  };
}
