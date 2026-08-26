// A glossary is not one language pair. The store de-dupes favorites on
// (sourceText, targetLanguage) precisely so the same word can be saved with a
// Chinese rendering and a French one — and handing all of them to a
// translation would substitute whichever sorted first, dropping Chinese into
// French output. Nothing about that failure is visible in the result: it just
// reads as a bad translation.

import { describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../src/services/stack-client.js', () => ({
  default: { onChanged: () => () => {}, translate: vi.fn() },
}));

const useTranslationStore = (await import('../../src/stores/translation-store.js')).default;

const term = (sourceText, translatedText, targetLanguage) => ({
  id: `${sourceText}-${targetLanguage ?? 'none'}`,
  sourceText,
  translatedText,
  targetLanguage,
  folderId: 'glossary',
});

const seed = (favorites) => useTranslationStore.setState({ favorites });
const get = (lang) => useTranslationStore.getState().getGlossaryTerms(lang);

beforeEach(() => seed([]));

describe('getGlossaryTerms', () => {
  it('returns the glossary folder, not the rest of the favorites', () => {
    seed([
      term('GPU', '图形处理器', 'zh'),
      { id: 'x', sourceText: 'a saved phrase', translatedText: '一句收藏', folderId: null },
    ]);

    expect(get('zh')).toEqual([{ source: 'GPU', target: '图形处理器' }]);
  });

  it('picks the rendering for the language being translated into', () => {
    seed([term('GPU', '图形处理器', 'zh'), term('GPU', 'processeur graphique', 'fr')]);

    expect(get('fr')).toEqual([{ source: 'GPU', target: 'processeur graphique' }]);
    expect(get('zh')).toEqual([{ source: 'GPU', target: '图形处理器' }]);
  });

  it('leaves out a term saved for a language this document is not in', () => {
    seed([term('GPU', '图形处理器', 'zh')]);

    expect(get('fr')).toEqual([]);
  });

  it('keeps entries that carry no language — imported files have none', () => {
    seed([term('GPU', '图形处理器', undefined)]);

    expect(get('fr')).toEqual([{ source: 'GPU', target: '图形处理器' }]);
    expect(get('zh')).toEqual([{ source: 'GPU', target: '图形处理器' }]);
  });

  it('prefers an exact language match over a language-less entry', () => {
    seed([term('GPU', '旧的译法', undefined), term('GPU', 'processeur graphique', 'fr')]);

    expect(get('fr')).toEqual([{ source: 'GPU', target: 'processeur graphique' }]);
  });

  it('prefers the match whichever order they were saved in', () => {
    seed([term('GPU', 'processeur graphique', 'fr'), term('GPU', '旧的译法', undefined)]);

    expect(get('fr')).toEqual([{ source: 'GPU', target: 'processeur graphique' }]);
  });

  it('treats the same word in different casing as one term', () => {
    seed([term('gpu', '图形处理器', 'zh'), term('GPU', '别的译法', 'zh')]);

    expect(get('zh')).toHaveLength(1);
  });

  it('keeps different words apart', () => {
    seed([term('GPU', '图形处理器', 'zh'), term('epoch', '轮次', 'zh')]);

    expect(get('zh').map((t) => t.source).sort()).toEqual(['GPU', 'epoch']);
  });

  it('drops half-filled entries rather than substituting an empty string', () => {
    seed([term('GPU', '', 'zh'), term('', '轮次', 'zh')]);

    expect(get('zh')).toEqual([]);
  });

  it('returns everything when no language is given, as the old callers did', () => {
    seed([term('GPU', '图形处理器', 'zh'), term('epoch', 'époque', 'fr')]);

    expect(get()).toHaveLength(2);
  });
});
