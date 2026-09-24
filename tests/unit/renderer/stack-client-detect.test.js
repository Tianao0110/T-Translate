// stack-client.detectLanguages: the main process judges (stack:detect-language)
// in batches under the facade's cap; without an answer it judges locally.

import { describe, it, expect, vi, afterEach } from 'vitest';
import stackClient from '../../../src/translation/stack-client.js';

afterEach(() => {
  delete window.electron;
});

describe('stack-client detectLanguages', () => {
  it('judges locally without a bridge', async () => {
    expect(await stackClient.detectLanguage('Hello world', 'zh')).toEqual({ language: 'en', inTarget: false });
  });

  it('asks the main process in batches of 1000', async () => {
    const detectLanguage = vi.fn(async ({ texts }) => texts.map(() => ({ language: 'fr', inTarget: false })));
    window.electron = { stack: { detectLanguage } };
    const results = await stackClient.detectLanguages(Array(2500).fill('Bonjour'), 'en');
    expect(results).toHaveLength(2500);
    expect(results[0]).toEqual({ language: 'fr', inTarget: false });
    expect(detectLanguage.mock.calls.map(([payload]) => payload.texts.length)).toEqual([1000, 1000, 500]);
    expect(detectLanguage.mock.calls[0][0].targetLang).toBe('en');
  });

  it('falls back to the local judgment when the answer is missing', async () => {
    window.electron = { stack: { detectLanguage: vi.fn(async () => null) } };
    expect(await stackClient.detectLanguage('你好世界', 'zh')).toEqual({ language: 'zh', inTarget: true });
  });
});
