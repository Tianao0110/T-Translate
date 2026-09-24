import { describe, it, expect } from 'vitest';
import { resolveSameLanguageTarget } from '../../../src/core/text.js';

describe('resolveSameLanguageTarget', () => {
  it('translates normally when the text is not in the target language', () => {
    expect(resolveSameLanguageTarget(false, 'zh', 'original'))
      .toEqual({ targetLang: 'zh', passthrough: false });
    expect(resolveSameLanguageTarget(false, 'zh', 'swap'))
      .toEqual({ targetLang: 'zh', passthrough: false });
  });

  it("'original' (default) passes the source through untranslated", () => {
    expect(resolveSameLanguageTarget(true, 'en', 'original'))
      .toEqual({ targetLang: 'en', passthrough: true });
    expect(resolveSameLanguageTarget(true, 'zh', 'original'))
      .toEqual({ targetLang: 'zh', passthrough: true });
    // behavior omitted → 'original'
    expect(resolveSameLanguageTarget(true, 'en').passthrough).toBe(true);
    // unknown persisted value degrades to the safe default, not to a flip
    expect(resolveSameLanguageTarget(true, 'en', 'bogus').passthrough).toBe(true);
  });

  it("'swap' translates back into the configured source language", () => {
    // en->ja pair, selected text already ja -> swap back to en (NOT zh)
    expect(resolveSameLanguageTarget(true, 'ja', 'swap', 'en'))
      .toEqual({ targetLang: 'en', passthrough: false });
    expect(resolveSameLanguageTarget(true, 'en', 'swap', 'ja'))
      .toEqual({ targetLang: 'ja', passthrough: false });
  });

  it("'swap' with source on auto falls back to the zh<->en heuristic", () => {
    expect(resolveSameLanguageTarget(true, 'en', 'swap', 'auto'))
      .toEqual({ targetLang: 'zh', passthrough: false });
    expect(resolveSameLanguageTarget(true, 'zh', 'swap'))
      .toEqual({ targetLang: 'en', passthrough: false });
    // Non-zh/en target without a usable source falls back to zh.
    expect(resolveSameLanguageTarget(true, 'ja', 'swap', 'auto'))
      .toEqual({ targetLang: 'zh', passthrough: false });
    // source === target is not a usable other side either.
    expect(resolveSameLanguageTarget(true, 'en', 'swap', 'en'))
      .toEqual({ targetLang: 'zh', passthrough: false });
  });

  it('translates unsure text either way', () => {
    // 'original' shows the source only when sure; 'swap' swaps unless sure
    // the text is in another language.
    expect(resolveSameLanguageTarget(null, 'en', 'original'))
      .toEqual({ targetLang: 'en', passthrough: false });
    expect(resolveSameLanguageTarget(null, 'en', 'swap', 'auto'))
      .toEqual({ targetLang: 'zh', passthrough: false });
  });

  it('never flips when the target is empty', () => {
    expect(resolveSameLanguageTarget(true, '', 'swap').passthrough).toBe(false);
    expect(resolveSameLanguageTarget(true, null, 'original').targetLang).toBe(null);
  });
});
