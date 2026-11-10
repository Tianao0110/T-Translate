// YouTube json3: the window-setup event skipped, word-by-word auto-caption
// segs merged into one cue, aAppend continuing the last cue and stretching its
// end, a '\n'-only event dropped, an event without dDurationMs skipped,
// manual multi-line text, CJK joins; object or text input; bad input.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseJson3 } from '../src/content/parsers/json3.js';
import { detectFormat, parseSubtitles } from '../src/content/parsers/index.js';

const SAMPLE = fs.readFileSync(path.join(__dirname, 'fixtures', 'subtitles', 'sample.json3'), 'utf8');

describe('parseJson3', () => {
  const cues = parseJson3(SAMPLE);

  it('one cue per caption event, appends folded in', () => {
    expect(cues).toEqual([
      { id: '0', start: 0.16, end: 4.959, text: "so today we're going" },
      { id: '1', start: 2.639, end: 7.959, text: 'to talk about subtitles' },
      { id: '3', start: 12, end: 14.5, text: 'Manual line one line two' },
      { id: '4', start: 15, end: 17, text: '日本語の字幕' },
    ]);
  });

  it('takes the parsed object too', () => {
    expect(parseJson3(JSON.parse(SAMPLE))).toEqual(cues);
    expect(parseSubtitles(JSON.parse(SAMPLE))).toEqual(cues);
  });

  it('appends go to their own window', () => {
    const data = {
      events: [
        { tStartMs: 0, dDurationMs: 1000, wWinId: 1, segs: [{ utf8: 'one' }] },
        { tStartMs: 0, dDurationMs: 1000, wWinId: 2, segs: [{ utf8: 'two' }] },
        { tStartMs: 500, dDurationMs: 2000, wWinId: 1, aAppend: 1, segs: [{ utf8: ' more' }] },
      ],
    };
    expect(parseJson3(data).map((c) => [c.text, c.end])).toEqual([['one more', 2.5], ['two', 1]]);
  });

  it('detectFormat says json3', () => {
    expect(detectFormat(SAMPLE)).toBe('json3');
  });

  it('never throws on empty or broken input', () => {
    expect(parseJson3('')).toEqual([]);
    expect(parseJson3('{"events": [')).toEqual([]);
    expect(parseJson3('{"events": "nope"}')).toEqual([]);
    expect(parseJson3({ events: [null, 1, { segs: 'x', dDurationMs: 1 }, { segs: [null, { utf8: 5 }], dDurationMs: 1 }] })).toEqual([]);
    expect(parseJson3(null)).toEqual([]);
  });
});
