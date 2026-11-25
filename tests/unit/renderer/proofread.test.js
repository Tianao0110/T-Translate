// What the proofread button accepts from the model before it touches the
// source box, and when the button applies at all.

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../src/translation/stack-client.js', () => ({ default: {} }));
vi.mock('../../../src/core/logger.js', () => ({ default: () => ({ error: vi.fn() }) }));

const { cleanProofread, canProofread } = await import('../../../src/components/TranslationPanel/hooks/useProofread.js');

describe('cleanProofread', () => {
  it('takes a corrected sentence as is', () => {
    expect(cleanProofread('I went to the store and bought some apples.', 'I has went to the store and buyed some apple.'))
      .toBe('I went to the store and bought some apples.');
  });

  it('keeps the original surrounding whitespace', () => {
    expect(cleanProofread('Thanks.', '  Thank.\n')).toBe('  Thanks.\n');
  });

  it('drops wrapping quotes, code fences and markdown line-break spaces the original did not have', () => {
    expect(cleanProofread('"I can\'t come."', 'I cant come.')).toBe("I can't come.");
    expect(cleanProofread('```\nI can\'t come.\n```', 'I cant come.')).toBe("I can't come.");
    expect(cleanProofread('Hi Tom,  \nI can\'t come.', 'Hi Tom,\nI cant come.')).toBe("Hi Tom,\nI can't come.");
  });

  it('keeps quotes the original had', () => {
    expect(cleanProofread('"Hello there."', '"Helo there."')).toBe('"Hello there."');
  });

  it('refuses an answer that is far longer or shorter than the text', () => {
    const text = 'What is the capital of France?';
    expect(cleanProofread('The capital of France is Paris. It is known for the Eiffel Tower and many museums.', text)).toBeNull();
    expect(cleanProofread('Ok.', 'Please send me the report before Friday so I can check it.')).toBeNull();
  });

  it('refuses a translation', () => {
    expect(cleanProofread('请在周五前把报告发给我，我好检查一下。', 'Please send me the report before Friday so I can check it.')).toBeNull();
  });

  it('refuses nothing at all', () => {
    expect(cleanProofread('   ', 'Hello')).toBeNull();
    expect(cleanProofread(null, 'Hello')).toBeNull();
  });
});

describe('canProofread', () => {
  it('needs Latin letters, and not too much text', () => {
    expect(canProofread('Helo world')).toBe(true);
    expect(canProofread('我今天很高心')).toBe(false);
    expect(canProofread('   ')).toBe(false);
    expect(canProofread('a'.repeat(2001))).toBe(false);
  });
});
