// Ghost-text compose rules: what part of the typed text the model gets and
// what part of its answer is shown.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { composeRequest, composeSuffix } = require('../../../electron/llm/compose.js');

describe('compose request', () => {
  it('takes the word being typed off the end, with its leading space', () => {
    const r = composeRequest('The meeting was moved to Thur');
    expect(r.fragment).toBe(' Thur');
    expect(r.prompt.endsWith('The meeting was moved to')).toBe(true);
  });

  it('a single trailing space is the fragment; punctuation leaves none', () => {
    expect(composeRequest('Let me know if ').fragment).toBe(' ');
    expect(composeRequest('Let me know if ').prompt.endsWith('Let me know if')).toBe(true);
    expect(composeRequest('Hello there,').fragment).toBe('');
  });

  it('a lone first word is spelled from an empty text', () => {
    const r = composeRequest('Thank');
    expect(r.fragment).toBe('Thank');
    expect(r.prompt.endsWith('\n\n')).toBe(true);
  });

  it('refuses short text, a new line, double spaces and non-English tails', () => {
    expect(composeRequest('Hi')).toBeNull();
    expect(composeRequest('Some text\n')).toBeNull();
    expect(composeRequest('Some text  ')).toBeNull();
    expect(composeRequest('这是中文输入')).toBeNull();
    expect(composeRequest('Please send it to 张三 tom')).toBeNull();
    expect(composeRequest(null)).toBeNull();
  });

  it('long text starts at a sentence boundary that stays put while typing', () => {
    const head = 'First sentence here. '.repeat(60);
    const a = composeRequest(`${head}Now I am typ`);
    const b = composeRequest(`${head}Now I am typing`);
    expect(a.prompt.length).toBeLessThan(900);
    const startA = a.prompt.slice(0, 80);
    expect(b.prompt.startsWith(startA)).toBe(true);
  });
});

describe('compose suffix', () => {
  it('finishes the word and adds one more when the next pick starts a new word', () => {
    expect(composeSuffix({ text: ' Thursday at', stop: 'unsure', stopPiece: ' three' }, ' Thur')).toBe('sday at');
  });

  it('keeps the finished word when the following word is cut', () => {
    expect(composeSuffix({ text: ' Thursday aft', stop: 'unsure', stopPiece: 'ernoon' }, ' Thur')).toBe('sday');
  });

  it('shows nothing when the word being finished is itself cut', () => {
    expect(composeSuffix({ text: ' Thurs', stop: 'unsure', stopPiece: 'day' }, ' Thur')).toBe('');
    expect(composeSuffix({ text: ' Thurs', stop: 'limit', stopPiece: null }, ' Thur')).toBe('');
  });

  it('after a whole word or a space it offers the next word only', () => {
    expect(composeSuffix({ text: ' if you have', stop: 'unsure', stopPiece: ' any' }, ' if')).toBe(' you');
    expect(composeSuffix({ text: ' you have', stop: 'unsure', stopPiece: ' any' }, ' ')).toBe('you');
    expect(composeSuffix({ text: ' how are', stop: 'limit', stopPiece: null }, '')).toBe(' how');
  });

  it('end of text counts as a word end', () => {
    expect(composeSuffix({ text: ' Monday', stop: 'eog', stopPiece: null }, ' Mon')).toBe('day');
  });

  it('nothing for a fragment the model never finished spelling or non-ASCII output', () => {
    expect(composeSuffix({ text: ' Th', stop: 'unsure', stopPiece: null }, ' Thur')).toBe('');
    expect(composeSuffix({ text: ' 请用中文', stop: 'limit', stopPiece: null }, ' ')).toBe('');
    expect(composeSuffix(null, ' a')).toBe('');
  });
});
