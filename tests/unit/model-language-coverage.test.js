// The failover chain only advances on failure, and an LLM asked for a language
// it does not know answers fluently and wrongly — a "success" that ends the
// chain before Google, which does know that language, ever gets a turn.
//
// These rules exist to reorder the chain, never to make a claim in the UI.
// The tests below encode that: an unknown model must change nothing.

import { describe, it, expect } from 'vitest';
import {
  modelCoversLanguage,
  reorderForLanguage,
} from '../../src/config/model-language-coverage.js';

describe('modelCoversLanguage', () => {
  it('knows Llama 3 is documented for eight languages', () => {
    expect(modelCoversLanguage('llama-3.1-8b-instruct', 'de')).toBe(true);
    expect(modelCoversLanguage('llama-3.1-8b-instruct', 'th')).toBe(true);
    expect(modelCoversLanguage('Llama-3.3-70B', 'bo')).toBe(false);
    expect(modelCoversLanguage('llama_3_2_3b', 'ja')).toBe(false);
  });

  it('matches families through quantization and vendor prefixes', () => {
    for (const name of [
      'qwen2.5-7b-instruct-q4_k_m',
      'TheBloke/Qwen2.5-14B-GGUF',
      'Qwen3-32B',
      'qwen_2_5_coder',
    ]) {
      expect(modelCoversLanguage(name, 'ja'), name).toBe(true);
    }
  });

  it('never demotes a broad multilingual model', () => {
    expect(modelCoversLanguage('nllb-200-distilled-600M', 'bo')).toBe(true);
    expect(modelCoversLanguage('madlad400-3b-mt', 'lus')).toBe(true);
  });

  it('reads the language pair out of an Opus-MT name', () => {
    // opus-mt-en-zh does en->zh and returns confident garbage for anything
    // else, which is what makes this rule worth having.
    expect(modelCoversLanguage('opus-mt-en-zh', 'zh')).toBe(true);
    expect(modelCoversLanguage('opus-mt-en-zh', 'ja')).toBe(false);
    expect(modelCoversLanguage('Helsinki-NLP/opus-mt-de-en', 'en')).toBe(true);
    expect(modelCoversLanguage('Helsinki-NLP/opus-mt-de-en', 'fr')).toBe(false);
  });

  it('says "unknown", not "no", when it has never heard of the model', () => {
    // The whole safety argument rests on this: unknown must not read as false.
    for (const name of ['my-model-final', 'mistral-7b', 'gemma-2-9b', '', null, undefined]) {
      expect(modelCoversLanguage(name, 'ja'), String(name)).toBeNull();
    }
    expect(modelCoversLanguage('opus-mt-something', 'ja')).toBeNull(); // no pair in name
  });
});

describe('reorderForLanguage', () => {
  const models = {
    'local-llm': 'llama-3.1-8b',        // eight languages
    'ollama': 'qwen2.5-7b',             // 29 languages
    'google-translate': '',             // not an LLM — unknown, never demoted
    'openai': 'gpt-4o-mini',            // unknown
  };
  const getModel = (id) => models[id] || '';
  const chain = ['local-llm', 'ollama', 'google-translate', 'openai'];

  it('leaves the chain untouched when every model covers the target', () => {
    // German is in both local models' documented sets.
    expect(reorderForLanguage(chain, 'de', getModel)).toBe(chain);
  });

  it('demotes only the models that do not cover the target', () => {
    // Japanese: Qwen yes, Llama no.
    expect(reorderForLanguage(chain, 'ja', getModel))
      .toEqual(['ollama', 'google-translate', 'openai', 'local-llm']);
  });

  it('puts the long tail in front of both local models', () => {
    // Tibetan: neither documents it, Google does it fine.
    expect(reorderForLanguage(chain, 'bo', getModel))
      .toEqual(['google-translate', 'openai', 'local-llm', 'ollama']);
  });

  it('demotes, never drops — a demoted provider still runs if all else fails', () => {
    const result = reorderForLanguage(chain, 'bo', getModel);
    expect([...result].sort()).toEqual([...chain].sort());
  });

  it('keeps relative order inside each group', () => {
    const long = ['local-llm', 'ollama', 'openai', 'anthropic', 'google-translate'];
    expect(reorderForLanguage(long, 'bo', getModel))
      .toEqual(['openai', 'anthropic', 'google-translate', 'local-llm', 'ollama']);
  });

  it('changes nothing when no model is identifiable', () => {
    const unknown = () => 'some-local-file';
    expect(reorderForLanguage(chain, 'bo', unknown)).toBe(chain);
  });
});

// Wiring check: the pure function above is only useful if the service actually
// consults it. Runs the real TranslationService against the real registry with
// an injected fetch, and watches which endpoint gets called first.
describe('the service reorders the real chain', () => {
  it('tries the cloud source first when the local model does not know the target', async () => {
    const { vi } = await import('vitest');
    const { TranslationService } = await import('../../src/stack/service.js');
    const { configureRuntime } = await import('../../src/stack/runtime.js');

    const calls = [];
    configureRuntime({
      fetch: vi.fn(async (url) => {
        calls.push(String(url));
        return {
          ok: true,
          status: 200,
          json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
          text: async () => '',
        };
      }),
      getLanguage: () => 'en',
    });

    // Local Llama first, OpenAI second. Llama documents eight languages.
    const settings = {
      providers: {
        list: [
          { id: 'local-llm', enabled: true, priority: 1 },
          { id: 'openai', enabled: true, priority: 2 },
        ],
        configs: {
          'local-llm': { endpoint: 'http://localhost:1234/v1', model: 'llama-3.1-8b' },
          openai: { apiKey: 'sk-test', model: 'gpt-4o-mini' },
        },
      },
    };

    const service = new TranslationService({ getCustomFilters: () => [] });
    await service.init(settings);

    // German IS in Llama's documented set — local goes first, as configured.
    await service.translate('hello', { targetLang: 'de', useCache: false });
    expect(calls[0]).toContain('localhost:1234');

    // Tibetan is not. The local model would have answered anyway, so the
    // chain has to skip it before asking, not after.
    calls.length = 0;
    await service.translate('hello', { targetLang: 'bo', useCache: false });
    expect(calls[0]).toContain('api.openai.com');
  });
});
