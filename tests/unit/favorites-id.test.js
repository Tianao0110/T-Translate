// Every favorites row must carry an id — removeFromFavorites filters by id,
// so an id-less row (the old glossary-import path) was undeletable. Locks the
// three layers: store fallback on add, caller-provided id wins, and the
// rehydrate backfill that heals rows already persisted without one.

import { describe, it, expect, beforeEach } from 'vitest';
import useTranslationStore from '../../src/stores/translation-store.js';

beforeEach(() => {
  useTranslationStore.setState({ favorites: [] });
});

describe('favorites id guarantee', () => {
  it('backfills an id when the caller forgets one, and the row stays deletable', () => {
    const store = useTranslationStore.getState();
    store.addToFavorites({
      sourceText: 'term',
      translatedText: '术语',
      folderId: 'glossary',
    });

    const row = useTranslationStore.getState().favorites[0];
    expect(row.id).toBeTruthy();

    store.removeFromFavorites(row.id);
    expect(useTranslationStore.getState().favorites).toHaveLength(0);
  });

  it('a caller-provided id wins over the fallback', () => {
    useTranslationStore.getState().addToFavorites({
      id: 'given-id',
      sourceText: 'a',
      translatedText: 'b',
    });
    expect(useTranslationStore.getState().favorites[0].id).toBe('given-id');
  });

  it('does not mutate the caller object when backfilling', () => {
    const item = { sourceText: 'x', translatedText: 'y' };
    useTranslationStore.getState().addToFavorites(item);
    expect(item.id).toBeUndefined();
  });

  it('rehydrate backfills ids on rows persisted without one', async () => {
    localStorage.setItem('translation-store', JSON.stringify({
      state: {
        favorites: [
          { sourceText: 'legacy', translatedText: '旧条目', folderId: 'glossary' },
          { id: 'kept', sourceText: 'ok', translatedText: '有 id' },
        ],
      },
      version: 0,
    }));

    await useTranslationStore.persist.rehydrate();

    const favs = useTranslationStore.getState().favorites;
    expect(favs).toHaveLength(2);
    expect(favs.find((f) => f.sourceText === 'legacy').id).toBeTruthy();
    expect(favs.find((f) => f.sourceText === 'ok').id).toBe('kept');

    localStorage.removeItem('translation-store');
  });
});
