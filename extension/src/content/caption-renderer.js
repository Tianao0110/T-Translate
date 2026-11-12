// What the page shows: cues with their translations, drawn either as the
// native TextTrack ('track') or the overlay ('overlay'), as original and
// translation on two lines or either one alone. Fed by the page hooks (site
// subtitles) and by the media pipeline's events through applyMediaEvent.

import { createCaptionTrack } from './caption-track.js';
import { DEFAULT_SIZE, SIZES } from './caption-size.js';
import { createOverlay } from './overlay.js';
import { normalizeText } from './parsers/text.js';
import { sameText } from '../shared/subtitle-export.js';

export const MODES = ['track', 'overlay'];
export const DISPLAYS = ['bilingual', 'translation', 'original'];
export { SIZES };

export function createCaptionRenderer({
  video,
  mode = 'track',
  display = 'bilingual',
  size = DEFAULT_SIZE,
  controlsTop = null,
  lang = '',
  label,
  addTextTrack,
  createCue,
  makeOverlay = createOverlay,
}) {
  if (!MODES.includes(mode)) mode = 'track';
  if (!DISPLAYS.includes(display)) display = 'bilingual';
  if (!SIZES.includes(size)) size = DEFAULT_SIZE;
  let entries = new Map();
  let hidden = false;
  let offset = 0; // seconds every cue is shown later (negative: earlier)
  const makeView = (m) => {
    const v = m === 'overlay' ? makeOverlay({ video, size, controlsTop }) : createCaptionTrack({ video, lang, label, addTextTrack, createCue, size });
    if (hidden) v.setHidden?.(true);
    return v;
  };
  let view = makeView(mode);

  // The translation stands in for a missing original, never the other way
  // round; one that only repeats the original shows once.
  function textOf(e) {
    if (display === 'original' || !e.translation) return e.text;
    if (display === 'translation') return e.translation;
    return sameText(e.text, e.translation) ? e.text : `${e.text}\n${e.translation}`;
  }
  const viewCue = (e) => ({ id: e.id, start: Math.max(0, e.start + offset), end: Math.max(0, e.end + offset), text: textOf(e) });

  // A cue's translation survives a re-set as long as its text is unchanged.
  function entryOf(c) {
    const id = String(c.id);
    const text = normalizeText(c.text);
    const old = entries.get(id);
    return { id, start: Number(c.start), end: Number(c.end), text, translation: old && old.text === text ? old.translation : null };
  }

  return {
    get mode() {
      return mode;
    },
    get display() {
      return display;
    },
    get size() {
      return size;
    },
    get offset() {
      return offset;
    },
    get view() {
      return view;
    },
    list: () => [...entries.values()].map((e) => ({ ...e })),

    setCues(list) {
      const next = new Map();
      for (const c of list || []) {
        const e = entryOf(c);
        if (e.text) next.set(e.id, e);
      }
      entries = next;
      view.set([...entries.values()].map(viewCue));
    },

    upsert(cue) {
      const e = entryOf(cue);
      if (!e.text) return;
      entries.set(e.id, e);
      view.upsert(viewCue(e));
    },

    // 'pending' (not done) is the server's placeholder and changes nothing; a
    // done translation without text failed and falls back to the original.
    setTranslation(id, text, done = false) {
      const e = entries.get(String(id));
      if (!e) return;
      const t = typeof text === 'string' && text !== 'pending' ? normalizeText(text) : '';
      if (!t && !done) return;
      const next = t || null;
      if (next === e.translation) return;
      e.translation = next;
      view.updateText(e.id, textOf(e));
    },

    setDisplay(next) {
      if (!DISPLAYS.includes(next) || next === display) return;
      display = next;
      for (const e of entries.values()) view.updateText(e.id, textOf(e));
    },

    setSize(next) {
      if (!SIZES.includes(next) || next === size) return;
      size = next;
      view.setSize?.(size);
    },

    // Every cue moved by s seconds (the list keeps the times it was given).
    setOffset(s) {
      const next = Number.isFinite(s) ? s : 0;
      if (next === offset) return;
      offset = next;
      view.set([...entries.values()].map(viewCue));
    },

    // Nothing shows while an ad plays in the video; the cues stay.
    setHidden(on) {
      if (!!on === hidden) return;
      hidden = !!on;
      view.setHidden?.(hidden);
    },

    setMode(next) {
      if (!MODES.includes(next) || next === mode) return;
      view.destroy();
      mode = next;
      view = makeView(mode);
      view.set([...entries.values()].map(viewCue));
    },

    destroy() {
      view.destroy();
      entries.clear();
    },
  };
}

// MEDIA_EVENT payloads from the offscreen pipeline; true when the event
// touched the captions.
export function applyMediaEvent(renderer, event) {
  if (event?.type === 'segment') {
    renderer.upsert({ id: String(event.id), start: event.start, end: event.end, text: event.text });
    return true;
  }
  if (event?.type === 'translation') {
    renderer.setTranslation(String(event.id), event.text, !!event.done);
    return true;
  }
  return false;
}
