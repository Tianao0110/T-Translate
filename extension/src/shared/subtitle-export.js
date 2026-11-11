// Cues as SRT / WebVTT files. Cues are the renderer's list ({ id, start,
// end, text, translation }); display picks the lines the way the renderer
// does: bilingual (original over translation), translation (the original
// when there is none) or original. Sorted by start, numbered from 1, cues
// with nothing to show left out.

const pad = (n, w = 2) => String(n).padStart(w, '0');

function clock(s, sep) {
  const ms = Math.max(0, Math.round((Number(s) || 0) * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor(ms / 60000) % 60;
  const sec = Math.floor(ms / 1000) % 60;
  return `${pad(h)}:${pad(m)}:${pad(sec)}${sep}${pad(ms % 1000, 3)}`;
}

// One cue's text may not hold a blank line (it would end the cue).
const line = (s) => (typeof s === 'string' ? s.replace(/\r\n?/g, '\n').replace(/\n\s*\n+/g, '\n').trim() : '');

// The same words but for case, spaces and punctuation: a translation that
// only repeats its original (the video already in the target language).
const bare = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
export const sameText = (a, b) => !!bare(a) && bare(a) === bare(b);

export function cueText(cue, display = 'bilingual') {
  const text = line(cue?.text);
  const tr = line(cue?.translation);
  if (display === 'original') return text;
  if (display === 'translation') return tr || text;
  if (sameText(text, tr)) return text;
  return [text, tr].filter(Boolean).join('\n');
}

function prepared(cues, display) {
  const out = [];
  for (const c of Array.isArray(cues) ? cues : []) {
    if (!c || !Number.isFinite(c.start)) continue;
    const text = cueText(c, display);
    if (text) out.push({ start: c.start, end: Number.isFinite(c.end) ? Math.max(c.end, c.start) : c.start, text });
  }
  return out.sort((a, b) => a.start - b.start);
}

export function toSrt(cues, { display = 'bilingual' } = {}) {
  return prepared(cues, display)
    .map((c, i) => `${i + 1}\n${clock(c.start, ',')} --> ${clock(c.end, ',')}\n${c.text}\n`)
    .join('\n');
}

// Cue text is markup in WebVTT: & < > are escaped.
const escapeVtt = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function toVtt(cues, { display = 'bilingual' } = {}) {
  const body = prepared(cues, display)
    .map((c, i) => `${i + 1}\n${clock(c.start, '.')} --> ${clock(c.end, '.')}\n${escapeVtt(c.text)}\n`)
    .join('\n');
  return `WEBVTT\n\n${body}`;
}

// t-caption-<site>-<mediaId>.<ext>, anything a file name cannot hold as '_'.
export function exportFileName({ site, mediaId } = {}, ext = 'srt') {
  const part = (s, fallback) => String(s || fallback).replace(/[<>:"/\\|?*\p{Cc}\s]+/gu, '_').replace(/^[._]+|[._]+$/g, '').slice(0, 100) || fallback;
  return `t-caption-${part(site, 'site')}-${part(mediaId, 'video')}.${ext}`;
}
