// Bilibili subtitle JSON: seconds to three decimals, sorted by start, empty
// content and untimed entries skipped, text normalised; object or text
// input; detectFormat tells it from json3; bad input gives nothing.

import { describe, it, expect } from 'vitest';
import { parseBcc } from '../src/content/parsers/bcc.js';
import { detectFormat, parseSubtitles } from '../src/content/parsers/index.js';

const SAMPLE = {
  font_size: 0.4,
  type: 'AIsubtitle',
  lang: 'zh',
  body: [
    { from: 3.2, to: 5.0004, sid: 2, location: 2, content: '第二句', music: 0 },
    { from: 0.5, to: 2.81, sid: 1, location: 2, content: '  Hello\nworld ', music: 0 },
    { from: 6, to: 7, sid: 3, content: '' },
    { from: '8', to: 9, sid: 4, content: 'string time' },
    { from: 10, to: 11, sid: 5 },
    { from: 12, to: 13.5, sid: 6, content: '中文\n换行' },
  ],
};

describe('parseBcc', () => {
  it('cues in seconds, sorted, empty and untimed entries skipped', () => {
    expect(parseBcc(SAMPLE)).toEqual([
      { id: '1', start: 0.5, end: 2.81, text: 'Hello world' },
      { id: '0', start: 3.2, end: 5, text: '第二句' },
      { id: '5', start: 12, end: 13.5, text: '中文换行' },
    ]);
  });

  it('takes text too, with a BOM', () => {
    expect(parseBcc(`\u{feff}${JSON.stringify(SAMPLE)}`)).toEqual(parseBcc(SAMPLE));
    expect(parseSubtitles(JSON.stringify(SAMPLE), 'bcc')).toHaveLength(3);
  });

  it('bad input gives no cues', () => {
    for (const bad of ['', 'not json', '{"body": 3}', '[]', null, 42, { body: [null, 'x'] }]) expect(parseBcc(bad)).toEqual([]);
  });

  it('detectFormat: bcc by its body entries, json3 by its events', () => {
    const text = JSON.stringify(SAMPLE);
    expect(detectFormat(text)).toBe('bcc');
    expect(detectFormat(SAMPLE)).toBe('bcc');
    expect(detectFormat(JSON.stringify({ events: [{ tStartMs: 0, dDurationMs: 1, segs: [] }] }))).toBe('json3');
    expect(detectFormat(JSON.stringify({ body: [{ content: 'x', from: 1, to: 2 }] }))).toBe('bcc');
    expect(detectFormat(JSON.stringify({ body: [] }))).toBeNull();
    expect(detectFormat({ body: [{ from: '1' }] })).toBeNull();
    expect(detectFormat(JSON.stringify({ body: [{ content: 'say "events": now', from: 1, to: 2 }] }))).toBe('bcc');
  });
});
