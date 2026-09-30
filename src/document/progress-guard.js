// Document-panel progress restore guard: saved translations and notes come
// back only onto segments whose source text still matches, so a parser
// change that renumbers segments never lands text on the wrong paragraph.
// The panel (components/DocumentTranslator) stores and restores the blob.

export const PROGRESS_VERSION = 2;

// FNV-1a over UTF-16 code units, base 36.
export function segmentHash(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

// Source-text hash per noted segment id, stored beside the notes.
export function noteHashes(segments, notes) {
  const byId = new Map(segments.map((s) => [String(s.id), s]));
  const hashes = {};
  for (const id of Object.keys(notes || {})) {
    const seg = byId.get(id);
    if (seg) hashes[id] = segmentHash(seg.original || '');
  }
  return hashes;
}

// Saved blob → the entries that still line up with this parse, or null when
// the blob predates the guard.
export function matchSavedProgress(saved, segments) {
  if (!saved || saved.v !== PROGRESS_VERSION) return null;
  const byId = new Map(segments.map((s) => [String(s.id), s]));
  const fits = (id, hash) => {
    const seg = byId.get(String(id));
    return !!seg && !!hash && segmentHash(seg.original || '') === hash;
  };
  const segs = (saved.segs || []).filter((entry) => fits(entry.id, entry.h));
  const notes = {};
  for (const [id, note] of Object.entries(saved.notes || {})) {
    if (fits(id, saved.nh?.[id])) notes[id] = note;
  }
  const matched = { ...saved, segs };
  if (Object.keys(notes).length) matched.notes = notes;
  else delete matched.notes;
  return matched;
}
