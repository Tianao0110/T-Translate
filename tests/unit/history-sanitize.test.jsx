// The 0.3.x empty-translation bug wrote whole result objects into persisted
// history. v0.3.4 stopped the source and made the cache self-heal, but the
// rows already on disk stayed broken and killed the history panel on render
// (React #31). Real user data: 55 rows, all translatedText, all this shape.

import { describe, it, expect } from 'vitest';
import { sanitizeTextEntries, toStoredText } from '../../src/stores/history-sanitize.js';

const POISON = { text: '', from: 'zh', to: 'en' };
const clean = (over = {}) => ({ id: '1', sourceText: 'hello', translatedText: '你好', ...over });

describe('sanitizeTextEntries', () => {
  it('drops the exact shape found in the user\'s history', () => {
    const rows = [clean({ id: 'a' }), clean({ id: 'b', translatedText: POISON })];
    const { entries, dropped } = sanitizeTextEntries(rows, 'drop');

    expect(dropped).toBe(1);
    expect(entries.map(e => e.id)).toEqual(['a']);
  });

  it('recovers a translation when the object actually carries one', () => {
    const rows = [clean({ translatedText: { text: '你好世界', from: 'en', to: 'zh' } })];
    const { entries, repaired, dropped } = sanitizeTextEntries(rows, 'drop');

    expect({ repaired, dropped }).toEqual({ repaired: 1, dropped: 0 });
    expect(entries[0].translatedText).toBe('你好世界');
  });

  it('keeps clean rows untouched, same object identity', () => {
    const row = clean();
    const { entries, repaired, dropped } = sanitizeTextEntries([row], 'drop');

    expect(entries[0]).toBe(row);
    expect({ repaired, dropped }).toEqual({ repaired: 0, dropped: 0 });
  });

  it('blanks instead of deleting for favorites — that data is user-curated', () => {
    const rows = [clean({ id: 'fav', translatedText: POISON })];
    const { entries, repaired, dropped } = sanitizeTextEntries(rows, 'blank');

    expect({ repaired, dropped }).toEqual({ repaired: 1, dropped: 0 });
    expect(entries[0]).toMatchObject({ id: 'fav', sourceText: 'hello', translatedText: '' });
  });

  it('handles a poisoned sourceText the same way', () => {
    const { entries, dropped } = sanitizeTextEntries([clean({ sourceText: POISON })], 'drop');
    expect(dropped).toBe(1);
    expect(entries).toEqual([]);
  });

  it('throws nothing at junk input', () => {
    expect(sanitizeTextEntries(null)).toEqual({ entries: [], repaired: 0, dropped: 0 });
    expect(sanitizeTextEntries(undefined)).toEqual({ entries: [], repaired: 0, dropped: 0 });
    expect(sanitizeTextEntries([null, 'x', 42]).dropped).toBe(3);
  });

  it('preserves every other field on a repaired row', () => {
    const row = clean({ translatedText: POISON, ai: [{ id: 'x' }], timestamp: 123, source: 'selection' });
    const { entries } = sanitizeTextEntries([row], 'blank');
    expect(entries[0]).toMatchObject({ ai: [{ id: 'x' }], timestamp: 123, source: 'selection' });
  });
});

describe('toStoredText', () => {
  it('stops the object at the write side, where `|| \'\'` let it through', () => {
    expect(toStoredText(POISON)).toBe('');
    expect(toStoredText({ text: '有内容' })).toBe('有内容');
    expect(toStoredText('plain')).toBe('plain');
    expect(toStoredText(undefined)).toBe('');
    expect(toStoredText(null)).toBe('');
  });
});

// Render-path guard. The store repairs persisted rows, but a bad value can
// still arrive live (a provider result handed straight to the panel), and one
// row must never take down the panel around it.
describe('HighlightText survives a non-string', () => {
  it('renders the poison object without throwing', async () => {
    const { render } = await import('@testing-library/react');
    const { default: HighlightText } = await import('../../src/components/shared/HighlightText.jsx');

    expect(() => render(<HighlightText text={POISON} search="" />)).not.toThrow();
    expect(() => render(<HighlightText text={POISON} search="zh" />)).not.toThrow();
  });

  it('still highlights normal text', async () => {
    const { render } = await import('@testing-library/react');
    const { default: HighlightText } = await import('../../src/components/shared/HighlightText.jsx');

    const { container } = render(<HighlightText text="hello world" search="world" />);
    expect(container.querySelector('mark')?.textContent).toBe('world');
  });
});
