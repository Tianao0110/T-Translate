import { describe, it, expect } from 'vitest';
import { resolveSameLanguageTarget } from '../../src/utils/text.js';

describe('resolveSameLanguageTarget', () => {
  it('translates normally when detected differs from target', () => {
    expect(resolveSameLanguageTarget('en', 'zh', 'original'))
      .toEqual({ targetLang: 'zh', passthrough: false });
    expect(resolveSameLanguageTarget('ja', 'zh', 'swap'))
      .toEqual({ targetLang: 'zh', passthrough: false });
  });

  it("'original' (default) passes the source through untranslated", () => {
    expect(resolveSameLanguageTarget('en', 'en', 'original'))
      .toEqual({ targetLang: 'en', passthrough: true });
    expect(resolveSameLanguageTarget('zh', 'zh', 'original'))
      .toEqual({ targetLang: 'zh', passthrough: true });
    // behavior omitted → 'original'
    expect(resolveSameLanguageTarget('en', 'en').passthrough).toBe(true);
    // unknown persisted value degrades to the safe default, not to a flip
    expect(resolveSameLanguageTarget('en', 'en', 'bogus').passthrough).toBe(true);
  });

  it("'swap' translates back into the configured source language", () => {
    // en->ja pair, selected text already ja -> swap back to en (NOT zh)
    expect(resolveSameLanguageTarget('ja', 'ja', 'swap', 'en'))
      .toEqual({ targetLang: 'en', passthrough: false });
    expect(resolveSameLanguageTarget('en', 'en', 'swap', 'ja'))
      .toEqual({ targetLang: 'ja', passthrough: false });
  });

  it("'swap' with source on auto falls back to the zh<->en heuristic", () => {
    expect(resolveSameLanguageTarget('en', 'en', 'swap', 'auto'))
      .toEqual({ targetLang: 'zh', passthrough: false });
    expect(resolveSameLanguageTarget('zh', 'zh', 'swap'))
      .toEqual({ targetLang: 'en', passthrough: false });
    // Non-zh/en target without a usable source falls back to zh.
    expect(resolveSameLanguageTarget('ja', 'ja', 'swap', 'auto'))
      .toEqual({ targetLang: 'zh', passthrough: false });
    // source === target is not a usable other side either.
    expect(resolveSameLanguageTarget('en', 'en', 'swap', 'en'))
      .toEqual({ targetLang: 'zh', passthrough: false });
  });

  it('never flips when the target is empty', () => {
    expect(resolveSameLanguageTarget('en', '', 'swap').passthrough).toBe(false);
    expect(resolveSameLanguageTarget('en', null, 'original').targetLang).toBe(null);
  });
});
