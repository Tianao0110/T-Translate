// SRT and WebVTT export: clock formats past an hour, the three displays
// (a missing translation falls back in "translation", never the other way),
// sorting and numbering, empty cues skipped, blank lines and VTT markup
// characters kept out of cue text; file names cleaned for every OS.

import { describe, it, expect } from 'vitest';
import { toSrt, toVtt, cueText, exportFileName } from '../src/shared/subtitle-export.js';
import { parseSrt } from '../src/content/parsers/srt.js';
import { parseVtt } from '../src/content/parsers/vtt.js';

const CUES = [
  { id: 'b', start: 3725.5, end: 3727.0004, text: 'Second', translation: '第二句' },
  { id: 'a', start: 1.25, end: 3, text: 'First', translation: null },
  { id: 'c', start: 2, end: 2.5, text: '', translation: '' },
  { id: 'd', start: 2.1, end: 2.4, text: 'Fish & <chips>', translation: '炸鱼\n\n薯条' },
];

describe('export', () => {
  it('SRT, bilingual: sorted, numbered from 1, comma clock, empty cue left out', () => {
    expect(toSrt(CUES, { display: 'bilingual' })).toBe(
      '1\n00:00:01,250 --> 00:00:03,000\nFirst\n\n' +
        '2\n00:00:02,100 --> 00:00:02,400\nFish & <chips>\n炸鱼\n薯条\n\n' +
        '3\n01:02:05,500 --> 01:02:07,000\nSecond\n第二句\n'
    );
  });

  it('translation only falls back to the original; original only ignores translations', () => {
    const blocks = (srt) => srt.trimEnd().split('\n\n').map((b) => b.split('\n').slice(2).join('|'));
    expect(blocks(toSrt(CUES, { display: 'translation' }))).toEqual(['First', '炸鱼|薯条', '第二句']);
    expect(blocks(toSrt(CUES, { display: 'original' }))).toEqual(['First', 'Fish & <chips>', 'Second']);
    expect(toSrt(CUES, { display: 'original' })).not.toMatch(/第二句|炸鱼/);
    expect(cueText({ text: '', translation: 'only' }, 'original')).toBe('');
    expect(cueText({ text: '', translation: 'only' }, 'bilingual')).toBe('only');
    expect(cueText({ text: 'a', translation: 'b' })).toBe('a\nb');
  });

  it('WebVTT: header, dot clock, markup characters escaped', () => {
    const vtt = toVtt(CUES, { display: 'bilingual' });
    expect(vtt.startsWith('WEBVTT\n\n1\n00:00:01.250 --> 00:00:03.000\nFirst\n')).toBe(true);
    expect(vtt).toContain('Fish &amp; &lt;chips&gt;');
    expect(vtt).toContain('01:02:05.500 --> 01:02:07.000');
  });

  it('our parsers read the files back', () => {
    expect(parseSrt(toSrt(CUES, { display: 'bilingual' })).map((c) => [c.start, c.end])).toEqual([
      [1.25, 3],
      [2.1, 2.4],
      [3725.5, 3727],
    ]);
    expect(parseVtt(toVtt(CUES, { display: 'original' })).map((c) => c.text)).toEqual(['First', 'Fish & <chips>', 'Second']);
    expect(parseVtt(toVtt(CUES, { display: 'translation' })).map((c) => c.text)).toEqual(['First', '炸鱼薯条', '第二句']);
  });

  it('nothing to export gives an empty file body', () => {
    expect(toSrt([])).toBe('');
    expect(toSrt(null)).toBe('');
    expect(toVtt([{ id: 'x', start: 1, end: 2, text: '  ' }])).toBe('WEBVTT\n\n');
    expect(toSrt([{ id: 'x', start: 'a', end: 2, text: 'bad' }, { id: 'y', start: 5, end: 4, text: 'end before start' }])).toBe('1\n00:00:05,000 --> 00:00:05,000\nend before start\n');
  });

  it('file names: site and media id, unsafe characters replaced', () => {
    expect(exportFileName({ site: 'youtube', mediaId: 'UF8uR6Z6KLc' })).toBe('t-caption-youtube-UF8uR6Z6KLc.srt');
    expect(exportFileName({ site: 'bilibili', mediaId: 'BV1GJ411x7h7:p2' })).toBe('t-caption-bilibili-BV1GJ411x7h7_p2.srt');
    expect(exportFileName({ site: 'generic', mediaId: 'a/b\\c*d?"e<f>|g' }, 'vtt')).toBe('t-caption-generic-a_b_c_d_e_f_g.vtt');
    expect(exportFileName({ site: 'youtube', mediaId: null })).toBe('t-caption-youtube-video.srt');
    expect(exportFileName({})).toBe('t-caption-site-video.srt');
    expect(exportFileName({ site: 'x', mediaId: '...' })).toBe('t-caption-x-video.srt');
  });
});
