// Ghost completion appends the next few words of the first history or
// favorites text that extends what was typed; these pin the matching rules.

import { describe, it, expect } from 'vitest';
import { findCompletion, capCompletion } from '../../../src/components/TranslationPanel/hooks/useInputCompletion.js';

const list = (...texts) => texts.map((sourceText) => ({ sourceText }));

describe('findCompletion', () => {
  it('needs at least two non-blank characters', () => {
    expect(findCompletion('h', [list('hello world')])).toBeNull();
    expect(findCompletion(' h ', [list('hello world')])).toBeNull();
    expect(findCompletion('', [list('hello world')])).toBeNull();
  });

  it('returns the remainder of the first match, sources in order', () => {
    expect(findCompletion('hel', [list('hello world'), list('help me')])).toBe('lo world');
    expect(findCompletion('hel', [list(), list('help me')])).toBe('p me');
    expect(findCompletion('hel', [list('nothing here', 'help me', 'hello')])).toBe('p me');
  });

  it('ignores case for plain ASCII input and keeps the stored spelling', () => {
    expect(findCompletion('HEL', [list('hello world')])).toBe('lo world');
    expect(findCompletion('hello W', [list('hello world')])).toBe('orld');
  });

  it('stops where the phrase ends, not after a fixed number of words', () => {
    const hit = (typed, sentence) => findCompletion(typed, [list(sentence)]);
    expect(hit('Thank you for your he', 'Thank you for your help with the project last week.')).toBe('lp with the project');
    expect(hit('Could you please send me the upda', 'Could you please send me the updated version of the report by Friday?')).toBe('ted version of the report');
    expect(hit('I would appreciate it if you could get ba', 'I would appreciate it if you could get back to me as soon as possible.')).toBe('ck to me');
    expect(hit('The meeting has been moved to Thur', 'The meeting has been moved to Thursday at three in the afternoon.')).toBe('sday');
    expect(hit('If you have any other questions, fe', 'If you have any other questions, feel free to contact me at any time.')).toBe('el free to contact me');
    expect(hit('The application crashes every', 'The application crashes every time I try to open a large file.')).toBe(' time');
  });

  it('the first piece always shows, even a word that opens a phrase', () => {
    expect(capCompletion(' last week.')).toBe(' last week.');
    expect(capCompletion(' at three in the afternoon')).toBe(' at three');
  });

  it('a comma ends the phrase and is dropped; a full stop is kept', () => {
    expect(capCompletion('lp, and thanks again')).toBe('lp');
    expect(capCompletion('lp with everything.')).toBe('lp with everything.');
  });

  it('a long phrase with no stop is capped at eight words', () => {
    expect(capCompletion(' one two three four five six seven eight nine ten')).toBe(' one two three four five six seven eight');
  });

  it('never runs past a line break', () => {
    expect(findCompletion('Hi Tom', [list('Hi Tom,\nSee you on Monday.')])).toBeNull();
    expect(capCompletion('\nnext line')).toBe('');
  });

  it('CJK stops at its first punctuation or after ten characters', () => {
    expect(findCompletion('今天天', [list('今天天气很好，我们去公园散步吧')])).toBe('气很好');
    expect(capCompletion('一二三四五六七八九十十一十二')).toBe('一二三四五六七八九十');
  });

  it('matches CJK exactly', () => {
    expect(findCompletion('今天天', [list('今天天气很好'), list('今日天气')])).toBe('气很好');
    expect(findCompletion('今日', [list('今天天气很好')])).toBeNull();
  });

  it('skips entries that add nothing', () => {
    expect(findCompletion('hello', [list('hello', 'hello  ', 'hell')])).toBeNull();
  });

  it('tolerates missing or malformed entries', () => {
    expect(findCompletion('hel', [null, list(undefined), [{ sourceText: 42 }], list('hello')])).toBe('lo');
  });

  it('caps a very long remainder', () => {
    const long = 'ab' + 'x'.repeat(1000);
    expect(findCompletion('ab', [list(long)])).toHaveLength(300);
  });
});
