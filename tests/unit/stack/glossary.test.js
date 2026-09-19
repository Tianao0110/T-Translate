// The glossary pass: which terms one translation may use, how a term is
// matched, and that every window gets it — not just the main one.
//
// Regressions this guards:
// - a term without a target language rewrote translations INTO its own source
//   language (zh -> en output had "fine-tuning" replaced with "微调");
// - matching was a plain substring, so "prompt" turned "prompts" into "提示词s";
// - a cache hit skipped the glossary pass entirely;
// - the selection window, the floating window and listen captions never sent
//   glossary terms, so the glossary silently did nothing there.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  applyGlossary, termAppliesTo, termRegex, pickTermsForTarget, glossaryPass, sanitizeGlossaryItems,
} from '../../../src/stack/glossary.js';
import { TranslationService } from '../../../src/stack/service.js';
import { configureRuntime } from '../../../src/stack/runtime.js';

describe('term matching', () => {
  it('matches a Latin term at word boundaries only', () => {
    const terms = [{ source: 'prompt', target: '提示词' }];
    expect(applyGlossary('两个 prompts 和一个 prompt。', terms).text).toBe('两个 prompts 和一个 提示词。');
    expect(applyGlossary('the tokenizer is fine', [{ source: 'token', target: '词元' }]).text).toBe('the tokenizer is fine');
  });

  it('still matches a Latin term pressed against CJK text', () => {
    const terms = [{ source: 'fine-tuning', target: '微调' }];
    expect(applyGlossary('我们做了fine-tuning之后', terms).text).toBe('我们做了微调之后');
    expect(applyGlossary('Fine-Tuning 很贵', terms).text).toBe('微调 很贵');
  });

  it('keeps substring matching for scripts without spaces', () => {
    expect(applyGlossary('これは機械学習です', [{ source: '機械学習', target: '机器学习' }]).text).toBe('これは机器学习です');
  });

  it('handles terms that start or end with punctuation, and accented neighbours', () => {
    expect(applyGlossary('用 C++ 写的', [{ source: 'C++', target: 'C加加' }]).text).toBe('用 C加加 写的');
    expect(applyGlossary('un résumé court', [{ source: 'sum', target: 'X' }]).text).toBe('un résumé court');
  });

  it('prefers the longer term and inserts the target literally', () => {
    const terms = [{ source: 'rate limit', target: '速率限制' }, { source: 'rate limiting', target: '限流' }];
    expect(applyGlossary('开启 rate limiting', terms).text).toBe('开启 限流');
    expect(applyGlossary('cost', [{ source: 'cost', target: '$& 成本 $1' }]).text).toBe('$& 成本 $1');
  });

  it('termAppliesTo uses the same matcher', () => {
    expect(termAppliesTo({ source: 'prompt', target: 'x' }, 'Many prompts here')).toBe(false);
    expect(termAppliesTo({ source: 'prompt', target: 'x' }, 'One Prompt here')).toBe(true);
    expect(termRegex('a.b').test('axb')).toBe(false);
  });
});

describe('pickTermsForTarget', () => {
  const items = [
    { source: 'bank', target: '银行', targetLanguage: 'zh' },
    { source: 'bank', target: 'banque', targetLanguage: 'fr' },
    { source: 'Bank', target: '岸', },
    { source: 'loose', target: '松散' },
  ];

  it('leaves out terms saved for another language, and lets an exact match win', () => {
    expect(pickTermsForTarget(items, 'zh')).toEqual([
      { source: 'bank', target: '银行', bound: true },
      { source: 'loose', target: '松散', bound: false },
    ]);
    expect(pickTermsForTarget(items, 'fr').find((t) => t.source === 'bank')).toEqual({ source: 'bank', target: 'banque', bound: true });
  });

  it('falls back to the language-less entry, marked unbound', () => {
    expect(pickTermsForTarget(items, 'de').map((t) => [t.source, t.target, t.bound])).toEqual([
      ['Bank', '岸', false], ['loose', '松散', false],
    ]);
  });

  it('tolerates junk', () => {
    expect(pickTermsForTarget(null, 'zh')).toEqual([]);
    expect(pickTermsForTarget([null, { source: 'a' }, { target: 'b' }], 'zh')).toEqual([]);
  });
});

describe('sanitizeGlossaryItems (what a window may push)', () => {
  it('keeps well-formed items and drops the rest', () => {
    expect(sanitizeGlossaryItems([
      { source: 'GPU', target: '图形处理器', targetLanguage: 'zh', note: 'dropped field' },
      { source: 'loose', target: '松散' },
      { source: '', target: 'x' }, { source: 'x' }, null, 'string', { source: 1, target: 2 },
      { source: 'a'.repeat(501), target: 'too long' },
    ])).toEqual([
      { source: 'GPU', target: '图形处理器', targetLanguage: 'zh' },
      { source: 'loose', target: '松散' },
    ]);
  });

  it('is bounded and tolerates a non-array', () => {
    const many = Array.from({ length: 6000 }, (_, i) => ({ source: `term${i}`, target: 'x' }));
    expect(sanitizeGlossaryItems(many)).toHaveLength(5000);
    expect(sanitizeGlossaryItems('nope')).toEqual([]);
    expect(sanitizeGlossaryItems(undefined)).toEqual([]);
  });
});

describe('glossaryPass', () => {
  it('applies a language-less term only when the source text contained it', () => {
    const loose = [{ source: 'fine-tuning', target: '微调', bound: false }];
    // zh -> en: the English output naturally holds the word; the source did not.
    expect(glossaryPass('We did fine-tuning on it.', loose, '我们对它做了微调。').text).toBe('We did fine-tuning on it.');
    // en -> zh: the model left the word untranslated.
    expect(glossaryPass('我们对它做了 fine-tuning。', loose, 'We did fine-tuning on it.').text).toBe('我们对它做了 微调。');
  });

  it('applies a term bound to the target language wherever it was left untranslated', () => {
    const bound = [{ source: 'fine-tuning', target: '微调', bound: true }];
    expect(glossaryPass('これは fine-tuning 的说明', bound, 'これはファインチューニングの説明').text).toBe('これは 微调 的说明');
  });

  it('treats a term without the flag as language-less', () => {
    expect(glossaryPass('We did fine-tuning.', [{ source: 'fine-tuning', target: '微调' }], '我们做了微调。').replacements).toEqual([]);
  });
});

describe('the service applies the glossary for every caller', () => {
  const SETTINGS = {
    providers: {
      list: [{ id: 'openai', enabled: true, priority: 1 }],
      configs: { openai: { apiKey: 'sk-test' } },
    },
  };
  const reply = (text) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: text } }] }), text: async () => '' });
  const fakeL2 = () => ({ get: vi.fn(() => null), set: vi.fn(), clear: vi.fn(), getStats: vi.fn(() => ({})) });

  async function makeService(answer) {
    const fetch = vi.fn(async () => reply(answer));
    configureRuntime({ fetch, getLanguage: () => 'zh' });
    const svc = new TranslationService({ getCustomFilters: () => [], cache: fakeL2() });
    await svc.init(SETTINGS);
    return { svc, fetch };
  }

  beforeEach(() => configureRuntime({ getLanguage: () => 'zh' }));

  it('uses the pushed glossary when the caller sends none (selection, floating, captions)', async () => {
    const { svc } = await makeService('我们做了 fine-tuning。');
    svc.setGlossary([{ source: 'fine-tuning', target: '微调', targetLanguage: 'zh' }]);
    const r = await svc.translate('We did fine-tuning.', { targetLang: 'zh' });
    expect(r.text).toBe('我们做了 微调。');
    expect(r.glossaryReplacements).toEqual([{ from: 'fine-tuning', to: '微调' }]);
  });

  it('keeps the terms a caller sends, including an explicit empty list', async () => {
    const { svc } = await makeService('我们做了 fine-tuning。');
    svc.setGlossary([{ source: 'fine-tuning', target: '微调', targetLanguage: 'zh' }]);
    const own = await svc.translate('We did fine-tuning.', { targetLang: 'zh', useCache: false, glossaryTerms: [{ source: 'fine-tuning', target: '精调', bound: true }] });
    expect(own.text).toBe('我们做了 精调。');
    const none = await svc.translate('We did fine-tuning.', { targetLang: 'zh', useCache: false, glossaryTerms: [] });
    expect(none.text).toBe('我们做了 fine-tuning。');
  });

  it('does not let a term saved for Chinese touch a translation into English', async () => {
    const { svc } = await makeService('We did fine-tuning.');
    svc.setGlossary([{ source: 'fine-tuning', target: '微调', targetLanguage: 'zh' }, { source: 'loss', target: '损失' }]);
    const r = await svc.translate('我们做了微调，loss 降了。', { targetLang: 'en' });
    expect(r.text).toBe('We did fine-tuning.');
  });

  it('runs the pass on a cache hit too, with the glossary as it is now', async () => {
    const { svc, fetch } = await makeService('开启 rate limiting。');
    const first = await svc.translate('Enable rate limiting.', { targetLang: 'zh' });
    expect(first.text).toBe('开启 rate limiting。');

    svc.setGlossary([{ source: 'rate limiting', target: '限流', targetLanguage: 'zh' }]);
    const second = await svc.translate('Enable rate limiting.', { targetLang: 'zh' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(second.fromCache).toBe(true);
    expect(second.text).toBe('开启 限流。');
  });

  it('a streamed translation served from cache replays the glossaried text', async () => {
    const { svc } = await makeService('开启 rate limiting。');
    await svc.translate('Enable rate limiting.', { targetLang: 'zh' });
    svc.setGlossary([{ source: 'rate limiting', target: '限流', targetLanguage: 'zh' }]);
    const chunks = [];
    const r = await svc.translateStream('Enable rate limiting.', { targetLang: 'zh' }, (c) => chunks.push(c));
    expect(r.text).toBe('开启 限流。');
    expect(chunks).toEqual(['开启 限流。']);
  });
});
