// normalizeHistoryItem: import paths must tolerate hand-edited JSON.

import { describe, it, expect } from 'vitest';
import { normalizeHistoryItem } from '../../src/stores/translation-store.js';

describe('normalizeHistoryItem', () => {
  it('passes a well-formed item through with fields intact', () => {
    const raw = {
      id: 'abc', sourceText: 'hello', translatedText: '你好',
      sourceLanguage: 'en', targetLanguage: 'zh', timestamp: 1700000000000, source: 'main',
    };
    expect(normalizeHistoryItem(raw)).toEqual(raw);
  });

  it('generates an id when missing and defaults languages', () => {
    const item = normalizeHistoryItem({ sourceText: 'a', translatedText: 'b' });
    expect(item.id).toBeTruthy();
    expect(item.sourceLanguage).toBe('auto');
    expect(item.targetLanguage).toBe('zh');
    expect(item.source).toBe('import');
  });

  it('replaces a non-numeric timestamp so date grouping never sees Invalid Date', () => {
    const item = normalizeHistoryItem({ sourceText: 'a', translatedText: 'b', timestamp: 'yesterday' });
    expect(Number.isFinite(item.timestamp)).toBe(true);
  });

  it('drops entries with no text at all', () => {
    expect(normalizeHistoryItem({ id: 'x' })).toBeNull();
    expect(normalizeHistoryItem({ sourceText: 42, translatedText: null })).toBeNull();
  });

  it('drops non-object garbage', () => {
    expect(normalizeHistoryItem(null)).toBeNull();
    expect(normalizeHistoryItem('text')).toBeNull();
    expect(normalizeHistoryItem(7)).toBeNull();
  });
});
