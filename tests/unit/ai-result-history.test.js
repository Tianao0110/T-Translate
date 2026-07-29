// AI results in history: they hang on the translation they came from rather
// than becoming entries of their own, they collapse per action, they can be
// deleted on their own, and secure mode keeps none of them.

import { describe, it, expect, beforeEach } from 'vitest';
import useTranslationStore, { normalizeHistoryItem } from '../../src/stores/translation-store.js';

const SOURCE = 'A long English paragraph about something.';

function seedHistory(mode = 'standard') {
  const store = useTranslationStore.getState();
  useTranslationStore.setState({ history: [], translationMode: mode });
  store.addToHistory({
    sourceText: SOURCE,
    translatedText: '一段中文译文。',
    sourceLanguage: 'en',
    targetLanguage: 'zh',
    source: 'test',
  });
  return useTranslationStore.getState().history[0];
}

const attach = (payload) => useTranslationStore.getState().attachAiResult({
  sourceText: SOURCE,
  actionId: 'summarize',
  content: 'three key points',
  provider: 'OpenAI',
  path: 'text',
  ...payload,
});

const current = () => useTranslationStore.getState().history;

beforeEach(() => {
  useTranslationStore.setState({ history: [], translationMode: 'standard' });
});

describe('attachAiResult', () => {
  it('rides on the translation instead of adding an entry', () => {
    seedHistory();

    attach();

    expect(current()).toHaveLength(1);
    expect(current()[0].ai).toHaveLength(1);
    expect(current()[0].ai[0]).toMatchObject({
      actionId: 'summarize', content: 'three key points', provider: 'OpenAI', path: 'text',
    });
  });

  it('replaces the previous result of the same action', () => {
    seedHistory();

    attach();
    attach({ content: 'a better summary' });

    expect(current()[0].ai).toHaveLength(1);
    expect(current()[0].ai[0].content).toBe('a better summary');
  });

  it('keeps results from different actions side by side', () => {
    seedHistory();

    attach();
    attach({ actionId: 'explain', content: 'what it means' });

    expect(current()[0].ai.map(a => a.actionId).sort()).toEqual(['explain', 'summarize']);
  });

  it('writes nothing in secure mode', () => {
    seedHistory('standard');
    useTranslationStore.setState({ translationMode: 'secure' });

    attach();

    expect(current()[0].ai).toBeUndefined();
  });

  it('drops the result when there is no translation to hang it on', () => {
    attach();

    expect(current()).toHaveLength(0);
  });

  it('ignores an empty result', () => {
    seedHistory();

    attach({ content: '' });

    expect(current()[0].ai).toBeUndefined();
  });

  it('records that a result came from the capture rather than the text', () => {
    seedHistory();

    attach({ path: 'vision' });

    expect(current()[0].ai[0].path).toBe('vision');
  });
});

describe('removeAiResult', () => {
  it('deletes one result and leaves the translation alone', () => {
    seedHistory();
    attach();
    const entry = current()[0];

    useTranslationStore.getState().removeAiResult(entry.id, entry.ai[0].id);

    expect(current()).toHaveLength(1);
    expect(current()[0].ai).toBeUndefined();
    expect(current()[0].translatedText).toBe('一段中文译文。');
  });

  it('leaves the other results in place', () => {
    seedHistory();
    attach();
    attach({ actionId: 'explain', content: 'what it means' });
    const entry = current()[0];
    const summaryId = entry.ai.find(a => a.actionId === 'summarize').id;

    useTranslationStore.getState().removeAiResult(entry.id, summaryId);

    expect(current()[0].ai).toHaveLength(1);
    expect(current()[0].ai[0].actionId).toBe('explain');
  });
});

describe('normalizeHistoryItem with AI results', () => {
  it('keeps well-formed attached results through an import', () => {
    const item = normalizeHistoryItem({
      sourceText: 'a',
      translatedText: 'b',
      ai: [{ id: 'x1', actionId: 'summarize', content: 'points', provider: 'OpenAI', path: 'vision', timestamp: 1700000000000 }],
    });

    expect(item.ai).toHaveLength(1);
    expect(item.ai[0]).toMatchObject({ id: 'x1', path: 'vision' });
  });

  it('drops results with no content and normalizes an unknown path', () => {
    const item = normalizeHistoryItem({
      sourceText: 'a',
      translatedText: 'b',
      ai: [{ content: '' }, { content: 'kept', path: 'telepathy' }],
    });

    expect(item.ai).toHaveLength(1);
    expect(item.ai[0].path).toBe('text');
    expect(item.ai[0].id).toBeTruthy();
  });

  it('leaves the field off when the import carries nothing usable', () => {
    expect(normalizeHistoryItem({ sourceText: 'a', translatedText: 'b', ai: 'nope' }).ai).toBeUndefined();
    expect(normalizeHistoryItem({ sourceText: 'a', translatedText: 'b', ai: [] }).ai).toBeUndefined();
  });
});
