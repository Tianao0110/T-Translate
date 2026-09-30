// Document progress restore guard (src/document/progress-guard.js): saved
// work only lands on segments whose source text is unchanged.

import { describe, it, expect } from 'vitest';
import {
  PROGRESS_VERSION,
  segmentHash,
  noteHashes,
  matchSavedProgress,
} from '../../../src/document/progress-guard.js';

const segments = [
  { id: 0, original: 'First paragraph.' },
  { id: 1, original: 'Second paragraph.' },
];

function blob(overrides = {}) {
  return {
    v: PROGRESS_VERSION,
    ts: Date.now(),
    segs: [
      { id: 0, t: 'one', h: segmentHash('First paragraph.') },
      { id: 1, t: 'two', h: segmentHash('Second paragraph.') },
    ],
    notes: { 0: { text: 'note' } },
    nh: noteHashes(segments, { 0: {} }),
    ...overrides,
  };
}

describe('progress guard', () => {
  it('hashes deterministically and tells texts apart', () => {
    expect(segmentHash('abc')).toBe(segmentHash('abc'));
    expect(segmentHash('abc')).not.toBe(segmentHash('abd'));
  });

  it('restores everything when the parse is unchanged', () => {
    const matched = matchSavedProgress(blob(), segments);
    expect(matched.segs.map((s) => s.t)).toEqual(['one', 'two']);
    expect(Object.keys(matched.notes)).toEqual(['0']);
  });

  it('drops entries whose segment now holds different text', () => {
    const reparsed = [
      { id: 0, original: 'First paragraph. Second paragraph.' },
      { id: 1, original: 'Third paragraph.' },
    ];
    const matched = matchSavedProgress(blob(), reparsed);
    expect(matched.segs).toEqual([]);
    expect(matched.notes).toBeUndefined();
  });

  it('ignores blobs saved before the guard existed', () => {
    expect(matchSavedProgress({ ts: Date.now(), segs: [{ id: 0, t: 'one' }] }, segments)).toBeNull();
    expect(matchSavedProgress(null, segments)).toBeNull();
  });
});
