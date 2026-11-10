// TTML through jsdom's DOMParser: clock, frame (ttp:frameRate 25) and tick
// (ttp:tickRate) times, begin + dur, a div's begin offsetting its paragraphs,
// a paragraph timed only by its spans, nested spans, <br/>, CJK joins;
// defaults (30 fps, prefixed namespace), the time grammar, broken XML.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseTtml, parseTtmlTime } from '../src/content/parsers/ttml.js';
import { detectFormat } from '../src/content/parsers/index.js';

const SAMPLE = fs.readFileSync(path.join(__dirname, 'fixtures', 'subtitles', 'sample.ttml'), 'utf8');

describe('parseTtml', () => {
  const cues = parseTtml(SAMPLE);

  it('one cue per timed paragraph with text', () => {
    expect(cues.map((c) => [c.id, c.start, c.end])).toEqual([
      ['sub1', 1, 2.5],
      ['1', 2.48, 4],
      ['2', 4.5, 6],
      ['3', 6.5, 7.5],
      ['4', 101, 103],
      ['5', 102, 104.5],
    ]);
  });

  it('inlines spans and line breaks', () => {
    expect(cues.map((c) => c.text)).toEqual([
      'Plain clock with nested spans',
      'Frames at 25 fps',
      'Ticks & a dur',
      '你好世界',
      'Offset by the div',
      'Timed by spans',
    ]);
  });

  it('defaults to 30 fps and reads any namespace prefix', () => {
    const doc = `<tt:tt xmlns:tt="http://www.w3.org/ns/ttml"><tt:body><tt:div>
      <tt:p begin="00:00:01:15" end="00:00:02:00">Half a second in</tt:p>
    </tt:div></tt:body></tt:tt>`;
    expect(parseTtml(doc)).toEqual([{ id: '0', start: 1.5, end: 2, text: 'Half a second in' }]);
  });

  it('a div end clips its paragraphs', () => {
    const doc = '<tt xmlns="http://www.w3.org/ns/ttml"><body><div begin="10s" end="12s"><p begin="1s" end="5s">x</p><p begin="1s">y</p></div></body></tt>';
    expect(parseTtml(doc).map((c) => [c.start, c.end])).toEqual([[11, 12], [11, 12]]);
  });

  it('detectFormat says ttml', () => {
    expect(detectFormat(SAMPLE)).toBe('ttml');
  });

  it('never throws on empty, broken or foreign XML', () => {
    expect(parseTtml('')).toEqual([]);
    expect(parseTtml('<tt><body><p begin="1s" end="2s">unclosed')).toEqual([]);
    expect(parseTtml('<html><body><p begin="1s" end="2s">not ttml</p></body></html>')).toEqual([]);
    expect(parseTtml('<tt xmlns="http://www.w3.org/ns/ttml"><body><p begin="soon" end="2s">bad time</p></body></tt>')).toEqual([]);
    expect(parseTtml(null)).toEqual([]);
  });
});

describe('parseTtmlTime', () => {
  const rates = { fps: 25, subFrameRate: 2, tickRate: 10000000 };
  it.each([
    ['01:02:03.5', 3723.5],
    ['00:00:01:05', 1.2],
    ['00:00:01:05.1', 1.22],
    ['12.5s', 12.5],
    ['500ms', 0.5],
    ['2m', 120],
    ['1.5h', 5400],
    ['50f', 2],
    ['25000000t', 2.5],
  ])('%s → %f s', (value, seconds) => {
    expect(parseTtmlTime(value, rates)).toBeCloseTo(seconds, 6);
  });

  it('NaN for anything else', () => {
    expect(parseTtmlTime('1:2', rates)).toBeNaN();
    expect(parseTtmlTime('abc', rates)).toBeNaN();
    expect(parseTtmlTime('', rates)).toBeNaN();
  });
});
