// SubRip: the fixture has a BOM and CRLF; multi-line text, {\an8}, <i> / <b> /
// <font>, a '.' before the millis, an entry without the blank line before it,
// an empty entry, "<3" kept as text, and an hour-long clock.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseSrt } from '../src/content/parsers/srt.js';
import { detectFormat } from '../src/content/parsers/index.js';

const RAW = fs.readFileSync(path.join(__dirname, 'fixtures', 'subtitles', 'sample.srt'));
const SAMPLE = RAW.toString('utf8');

describe('parseSrt', () => {
  it('the fixture really is BOM + CRLF', () => {
    expect([...RAW.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(SAMPLE.includes('\r\n')).toBe(true);
  });

  const cues = parseSrt(SAMPLE);

  it('keeps the timed entries with text, numbered by their sequence, sorted', () => {
    expect(cues.map((c) => [c.id, c.start, c.end])).toEqual([
      ['1', 1, 2.5],
      ['2', 2.5, 4],
      ['12', 3, 3.2],
      ['3', 4, 6],
      ['10', 3723.456, 3725],
    ]);
  });

  it('cleans the text', () => {
    const text = Object.fromEntries(cues.map((c) => [c.id, c.text]));
    expect(text['1']).toBe('Top line and a second line');
    expect(text['2']).toBe('Colored & plain');
    expect(text['3']).toBe('Missing blank line above, dot millis');
    expect(text['10']).toBe('第一行第二行');
    expect(text['12']).toBe('I <3 subtitles');
  });

  it('reads LF the same way, numbers missing sequence lines by position', () => {
    expect(parseSrt(SAMPLE.replace(/\r\n/g, '\n'))).toEqual(cues);
    const bare = '00:00:01,000 --> 00:00:02,000\none\n\n00:00:03,000 --> 00:00:04,000\ntwo';
    expect(parseSrt(bare).map((c) => `${c.id}:${c.text}`)).toEqual(['0:one', '1:two']);
  });

  it('keeps duplicate sequence numbers apart', () => {
    const dup = '1\n00:00:01,000 --> 00:00:02,000\na\n\n1\n00:00:03,000 --> 00:00:04,000\nb';
    expect(parseSrt(dup).map((c) => c.id)).toEqual(['1', '1#2']);
  });

  it('detectFormat says srt', () => {
    expect(detectFormat(SAMPLE)).toBe('srt');
  });

  it('never throws on empty or broken input', () => {
    expect(parseSrt('')).toEqual([]);
    expect(parseSrt('1\nnot a time\ntext')).toEqual([]);
    expect(parseSrt(undefined)).toEqual([]);
  });
});
