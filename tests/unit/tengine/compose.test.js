// Next-word guess rules: what part of the typed text the model gets and
// what part of its answer is shown.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { composeRequest, composeSuffix } = require('../../../electron/llm/compose.js');

describe('compose request', () => {
  it('asks only after one space; the space is what the model spells', () => {
    const r = composeRequest('Let me know if ');
    expect(r.fragment).toBe(' ');
    expect(r.prompt.endsWith('Let me know if')).toBe(true);
    expect(composeRequest('Hello there, ').fragment).toBe(' ');
  });

  it('leaves the word being typed to the Windows predictor', () => {
    expect(composeRequest('The meeting was moved to Thur')).toBeNull();
    expect(composeRequest('Let me know if')).toBeNull();
  });

  it('refuses short text, a new line, double spaces and non-English tails', () => {
    expect(composeRequest('Hi ')).toBeNull();
    expect(composeRequest('Some text\n')).toBeNull();
    expect(composeRequest('Some text  ')).toBeNull();
    expect(composeRequest('这是中文输入 ')).toBeNull();
    expect(composeRequest('Please send it to 张三 ')).toBeNull();
    expect(composeRequest(null)).toBeNull();
  });

  it('long text starts at a sentence boundary that stays put while typing', () => {
    const head = 'First sentence here. '.repeat(60);
    const a = composeRequest(`${head}Now I am `);
    const b = composeRequest(`${head}Now I am typing `);
    expect(a.prompt.length).toBeLessThan(900);
    expect(b.prompt.startsWith(a.prompt.slice(0, 80))).toBe(true);
  });
});

describe('compose suffix', () => {
  it('offers the next word when what follows shows it ended', () => {
    expect(composeSuffix({ text: ' you have', stop: 'unsure', stopPiece: ' any' }, ' ')).toBe('you');
    expect(composeSuffix({ text: ' you', stop: 'unsure', stopPiece: ' need' }, ' ')).toBe('you');
    expect(composeSuffix({ text: ' Monday', stop: 'eog', stopPiece: null }, ' ')).toBe('Monday');
  });

  it('nothing when the word itself is cut', () => {
    expect(composeSuffix({ text: ' Thurs', stop: 'unsure', stopPiece: 'day' }, ' ')).toBe('');
    expect(composeSuffix({ text: ' Thurs', stop: 'limit', stopPiece: null }, ' ')).toBe('');
  });

  it('nothing for an unspelled fragment, punctuation or non-ASCII output', () => {
    expect(composeSuffix({ text: '', stop: 'unsure', stopPiece: null }, ' ')).toBe('');
    expect(composeSuffix({ text: ' ,', stop: 'limit', stopPiece: null }, ' ')).toBe('');
    expect(composeSuffix({ text: ' 请用中文', stop: 'limit', stopPiece: null }, ' ')).toBe('');
    expect(composeSuffix(null, ' ')).toBe('');
  });
});
