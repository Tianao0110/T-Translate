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

  it("'swap' keeps the legacy zh<->en flip", () => {
    expect(resolveSameLanguageTarget('en', 'en', 'swap'))
      .toEqual({ targetLang: 'zh', passthrough: false });
    expect(resolveSameLanguageTarget('zh', 'zh', 'swap'))
      .toEqual({ targetLang: 'en', passthrough: false });
    // Non-zh/en targets fall back to zh — documented legacy quirk.
    expect(resolveSameLanguageTarget('ja', 'ja', 'swap'))
      .toEqual({ targetLang: 'zh', passthrough: false });
  });

  it('never flips when the target is empty', () => {
    expect(resolveSameLanguageTarget('en', '', 'swap').passthrough).toBe(false);
    expect(resolveSameLanguageTarget('en', null, 'original').targetLang).toBe(null);
  });
});
