// Pure-function coverage for the 0.2.9 document-translation overhaul:
// timecode conversion, CSV splitting, SRT id stability, segmentation.

import { describe, it, expect } from 'vitest';
import {
  toSRTTimecode,
  toVTTTimecode,
  splitCSVLine,
  parseSRT,
  parseVTT,
  splitIntoSegments,
  shouldSkipSegment,
  detectLanguage,
  exportSRT,
  exportVTT,
  detectHeadings,
  buildOutlineTree,
} from '../../src/utils/document-parser.js';

describe('timecode conversion', () => {
  it('VTT dot becomes SRT comma', () => {
    expect(toSRTTimecode('00:00:01.000 --> 00:00:04.400'))
      .toBe('00:00:01,000 --> 00:00:04,400');
  });

  it('short-form VTT gets the 2-digit hour SRT requires', () => {
    expect(toSRTTimecode('01:02.500 --> 01:05.000'))
      .toBe('00:01:02,500 --> 00:01:05,000');
  });

  it('1-digit VTT hour is zero-padded', () => {
    expect(toSRTTimecode('1:02:03.500 --> 1:02:04.000'))
      .toBe('01:02:03,500 --> 01:02:04,000');
  });

  it('already-SRT timecode is unchanged', () => {
    expect(toSRTTimecode('00:00:01,000 --> 00:00:04,400'))
      .toBe('00:00:01,000 --> 00:00:04,400');
  });

  it('SRT comma becomes VTT dot', () => {
    expect(toVTTTimecode('00:00:01,000 --> 00:00:04,400'))
      .toBe('00:00:01.000 --> 00:00:04.400');
  });
});

describe('splitCSVLine', () => {
  it('splits plain fields', () => {
    expect(splitCSVLine('a,b,c')).toEqual(['a', 'b', 'c']);
  });

  it('keeps commas inside quoted cells', () => {
    expect(splitCSVLine('a,"b, with comma",c')).toEqual(['a', 'b, with comma', 'c']);
  });

  it('unescapes doubled quotes', () => {
    expect(splitCSVLine('x,"He said ""hi""",y')).toEqual(['x', 'He said "hi"', 'y']);
  });

  it('handles trailing empty field', () => {
    expect(splitCSVLine('a,b,')).toEqual(['a', 'b', '']);
  });
});

describe('parseSRT', () => {
  const srt = [
    '5', '00:00:01,000 --> 00:00:02,000', 'first', '',
    '5', '00:00:03,000 --> 00:00:04,000', 'second', '',
    '1', '00:00:05,000 --> 00:00:06,000', 'third',
  ].join('\n');

  it('assigns sequential ids even when cue numbers restart or duplicate', () => {
    const segments = parseSRT(srt);
    expect(segments.map(s => s.id)).toEqual([0, 1, 2]);
    expect(segments.map(s => s.index)).toEqual([5, 5, 1]);
  });

  it('exportSRT renumbers sequentially', () => {
    const out = exportSRT(parseSRT(srt));
    expect(out.split('\n\n').map(block => block.split('\n')[0])).toEqual(['1', '2', '3']);
  });
});

describe('parseVTT / exportVTT', () => {
  const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nhello\n\n00:00:03.000 --> 00:00:04.000\nworld';

  it('parses cues with sequential ids', () => {
    const segments = parseVTT(vtt);
    expect(segments).toHaveLength(2);
    expect(segments[0].original).toBe('hello');
  });

  it('VTT-loaded subtitles export valid SRT timecodes', () => {
    const out = exportSRT(parseVTT(vtt));
    expect(out).toContain('00:00:01,000 --> 00:00:02,000');
    expect(out).not.toContain('.000 -->');
  });

  it('SRT-loaded subtitles export valid VTT timecodes', () => {
    const srt = '1\n00:00:01,000 --> 00:00:02,000\nhi';
    const out = exportVTT(parseSRT(srt));
    expect(out.startsWith('WEBVTT')).toBe(true);
    expect(out).toContain('00:00:01.000 --> 00:00:02.000');
  });
});

describe('splitIntoSegments', () => {
  it('splits on blank lines and skips per filters', () => {
    const segments = splitIntoSegments('First paragraph here.\n\nSecond paragraph here.', {
      filters: { skipShort: false },
    });
    expect(segments).toHaveLength(2);
    expect(segments.every(s => s.status === 'pending')).toBe(true);
  });

  it('long paragraphs are split under maxCharsPerSegment', () => {
    const para = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} is here.`).join(' ');
    const segments = splitIntoSegments(para, { maxCharsPerSegment: 200, filters: { skipShort: false } });
    expect(segments.length).toBeGreaterThan(1);
    expect(segments.every(s => s.original.length <= 200)).toBe(true);
  });
});

describe('shouldSkipSegment', () => {
  it('skips short / numeric / code / already-target-language text', () => {
    expect(shouldSkipSegment('hi', { skipShort: true, minLength: 10 }).skip).toBe(true);
    expect(shouldSkipSegment('12345', { skipNumbers: true }).skip).toBe(true);
    expect(shouldSkipSegment('```\ncode\n```', { skipCode: true }).skip).toBe(true);
    expect(shouldSkipSegment('这是一段中文文本内容', { skipTargetLang: true, targetLang: 'zh' }).skip).toBe(true);
  });

  it('keeps normal translatable text', () => {
    expect(shouldSkipSegment('This is a normal English sentence.', {
      skipShort: true, minLength: 10, skipNumbers: true, skipCode: true,
      skipTargetLang: true, targetLang: 'zh',
    }).skip).toBe(false);
  });
});

describe('detectLanguage', () => {
  it('classifies zh / ja / ko / en', () => {
    expect(detectLanguage('这是中文内容测试')).toBe('zh');
    expect(detectLanguage('これはにほんごのテストです')).toBe('ja');
    expect(detectLanguage('한국어 텍스트입니다')).toBe('ko');
    expect(detectLanguage('plain english text')).toBe('en');
  });
});

describe('outline detection', () => {
  it('builds a nested tree from markdown headings', () => {
    const segments = [
      { id: 0, original: '# Chapter One' },
      { id: 1, original: '## Section A' },
      { id: 2, original: 'Body text long enough to not be a heading match here.' },
      { id: 3, original: '# Chapter Two' },
    ];
    const tree = buildOutlineTree(detectHeadings(segments));
    expect(tree).toHaveLength(2);
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].segmentId).toBe(1);
  });
});
