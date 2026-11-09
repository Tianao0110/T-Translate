// Ghost completion appends the remainder of the first history or favorites
// text that extends what was typed; these pin the matching rules.

import { describe, it, expect } from 'vitest';
import { findCompletion } from '../../../src/components/TranslationPanel/hooks/useInputCompletion.js';

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
