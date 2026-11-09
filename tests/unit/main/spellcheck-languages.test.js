// The spellchecker languages are the OS languages Chromium knows; these pin
// the exact-tag / base-language fallback and the never-empty rule.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { pickSpellcheckLanguages, DEAD_DICTIONARY_URL } = require('../../../electron/windows/spellcheck.js');

const AVAILABLE = ['af', 'de', 'de-DE', 'en', 'en-AU', 'en-CA', 'en-GB', 'en-US', 'fr', 'fr-FR'];

describe('pickSpellcheckLanguages', () => {
  it('keeps an exact tag the spellchecker knows', () => {
    expect(pickSpellcheckLanguages(['en-CA', 'zh-Hans-CN'], AVAILABLE)).toEqual(['en-CA']);
  });

  it('falls back to the base language for an unknown regional tag', () => {
    expect(pickSpellcheckLanguages(['fr-CA'], AVAILABLE)).toEqual(['fr']);
  });

  it('skips languages the spellchecker does not know and never returns empty', () => {
    expect(pickSpellcheckLanguages(['zh-Hans-CN', 'ja-JP'], AVAILABLE)).toEqual(['en-US']);
    expect(pickSpellcheckLanguages([], AVAILABLE)).toEqual(['en-US']);
    expect(pickSpellcheckLanguages(undefined, undefined)).toEqual(['en-US']);
  });

  it('keeps order and drops duplicates', () => {
    expect(pickSpellcheckLanguages(['de-AT', 'de-DE', 'en-US'], AVAILABLE)).toEqual(['de', 'de-DE', 'en-US']);
  });
});

describe('dictionary download URL', () => {
  it('points at this machine only', () => {
    expect(DEAD_DICTIONARY_URL.startsWith('http://127.0.0.1:')).toBe(true);
  });
});
