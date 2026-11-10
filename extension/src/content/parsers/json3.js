// YouTube timedtext json3 → cues. One cue per event (auto captions come one
// word per seg); an aAppend event continues the window's last cue and
// stretches its end; events without segs or dDurationMs (window setup) skip.

import { normalizeText, finishCues } from './text.js';

export function parseJson3(input) {
  let data = input;
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input.replace(/^\u{feff}/u, ''));
    } catch {
      return [];
    }
  }
  const events = data && Array.isArray(data.events) ? data.events : [];
  const cues = [];
  const lastByWindow = new Map();
  for (const ev of events) {
    if (!ev || !Array.isArray(ev.segs) || !Number.isFinite(ev.dDurationMs)) continue;
    const startMs = Number.isFinite(ev.tStartMs) ? ev.tStartMs : 0;
    const end = (startMs + ev.dDurationMs) / 1000;
    const raw = ev.segs.map((s) => (s && typeof s.utf8 === 'string' ? s.utf8 : '')).join('');
    const win = ev.wWinId ?? '';
    const prev = lastByWindow.get(win);
    if (ev.aAppend && prev) {
      prev.raw += raw;
      prev.end = Math.max(prev.end, end);
      continue;
    }
    const cue = { id: String(cues.length), start: startMs / 1000, end, raw };
    cues.push(cue);
    if (raw.trim()) lastByWindow.set(win, cue);
  }
  return finishCues(cues.map((c) => ({ id: c.id, start: c.start, end: c.end, text: normalizeText(c.raw) })));
}
