// WebVTT: header / NOTE / STYLE / REGION skipped, identifiers, both clock
// forms, cue settings, voice / class / karaoke tags, entities, ruby, CJK
// line joins, empty and zero-length cues, out-of-order starts; detectFormat.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseVtt } from '../src/content/parsers/vtt.js';
import { detectFormat, parseSubtitles } from '../src/content/parsers/index.js';

const SAMPLE = fs.readFileSync(path.join(__dirname, 'fixtures', 'subtitles', 'sample.vtt'), 'utf8');

describe('parseVtt', () => {
  const cues = parseVtt(SAMPLE);

  it('keeps every timed cue with text, sorted by start', () => {
    expect(cues.map((c) => [c.id, c.start, c.end])).toEqual([
      ['intro', 1, 3.5],
      ['1', 3.5, 5.25],
      ['2', 5.25, 8],
      ['5', 7, 9.5],
      ['3', 8, 8],
      ['6', 62, 3600],
    ]);
  });

  it('cleans the text', () => {
    const text = Object.fromEntries(cues.map((c) => [c.id, c.text]));
    expect(text.intro).toBe('Hello there, & welcome <back>!');
    expect(text['2']).toBe('We are karaoke');
    expect(text['3']).toBe('empty-length cue');
    expect(text['5']).toBe('你好世界');
    expect(text['6']).toBe("Ruby 漢字 and Mr & Mrs Smith 'quoted'");
  });

  it('reads CRLF and a BOM the same way', () => {
    expect(parseVtt(`\u{feff}${SAMPLE.replace(/\r?\n/g, '\r\n')}`)).toEqual(cues);
  });

  it('takes a file without the header, and YouTube rolling repeats as they are', () => {
    const rolling = '00:00:00.000 --> 00:00:02.000\nfirst line\n\n00:00:02.000 --> 00:00:04.000\nfirst line\nsecond line\n';
    expect(parseVtt(rolling).map((c) => c.text)).toEqual(['first line', 'first line second line']);
  });

  it('never throws on empty or broken input', () => {
    expect(parseVtt('')).toEqual([]);
    expect(parseVtt('WEBVTT')).toEqual([]);
    expect(parseVtt('WEBVTT\n\nxx:yy --> nope\ntext')).toEqual([]);
    expect(parseVtt(null)).toEqual([]);
    expect(parseVtt(42)).toEqual([]);
  });
});

describe('detectFormat', () => {
  it('knows each format by its content', () => {
    expect(detectFormat(SAMPLE)).toBe('vtt');
    expect(detectFormat('\u{feff}  WEBVTT\n')).toBe('vtt');
    expect(detectFormat('1\n00:00:01,000 --> 00:00:02,000\nhi')).toBe('srt');
    expect(detectFormat('00:01.000 --> 00:02.000\nhi')).toBe('vtt');
    expect(detectFormat('<?xml version="1.0"?>\n<tt xmlns="http://www.w3.org/ns/ttml"></tt>')).toBe('ttml');
    expect(detectFormat('<tt:tt xmlns:tt="http://www.w3.org/ns/ttml"/>')).toBe('ttml');
    expect(detectFormat('{"wireMagic":"pb3","events":[]}')).toBe('json3');
    expect(detectFormat({ events: [] })).toBe('json3');
  });

  it('falls back to the Content-Type and URL, content first', () => {
    expect(detectFormat('', 'text/vtt; charset=utf-8')).toBe('vtt');
    expect(detectFormat('', 'application/x-subrip')).toBe('srt');
    expect(detectFormat('', 'application/ttml+xml')).toBe('ttml');
    expect(detectFormat('', '', 'https://www.youtube.com/api/timedtext?v=x&lang=en&fmt=json3')).toBe('json3');
    expect(detectFormat('', '', 'https://cdn.example/subs/en.dfxp?sig=1')).toBe('ttml');
    expect(detectFormat('WEBVTT\n', 'application/json', 'x.srt')).toBe('vtt');
  });

  it('says null when it cannot tell', () => {
    expect(detectFormat('')).toBeNull();
    expect(detectFormat('<html><body>404</body></html>', 'text/html')).toBeNull();
    expect(detectFormat('{"error":1}')).toBeNull();
    expect(detectFormat(undefined)).toBeNull();
    expect(detectFormat({})).toBeNull();
  });

  it('parseSubtitles detects, dispatches, and gives [] for the unknown', () => {
    expect(parseSubtitles(SAMPLE)).toEqual(parseVtt(SAMPLE));
    expect(parseSubtitles(SAMPLE, 'nope')).toEqual([]);
    expect(parseSubtitles('<html/>')).toEqual([]);
    expect(parseSubtitles(null)).toEqual([]);
  });
});
