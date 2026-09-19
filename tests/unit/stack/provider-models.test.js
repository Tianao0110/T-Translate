// Default model names and what happens to the ones vendors switch off.
//
// Regression: two defaults (deepseek-chat, gemini-2.0-flash) were retired by
// their vendors and the app kept shipping them, so a new user's first request
// failed. Newer Claude and Gemini models also put a thinking block ahead of
// the answer, which the providers used to read as "no result".

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PROVIDER_METADATA } from '../../../src/stack/providers/metadata.js';
import { RETIRED_MODELS, withLiveModel } from '../../../src/stack/providers/retired-models.js';
import { createProvider, initConfigs, getProvider, updateProviderConfig } from '../../../src/stack/registry.js';
import { configureRuntime } from '../../../src/stack/runtime.js';

const replyWith = (data) => vi.fn(async () => ({ ok: true, status: 200, json: async () => data }));

function useFetch(fetch) {
  configureRuntime({ fetch, getLanguage: () => 'zh' });
  return fetch;
}

beforeEach(() => {
  useFetch(vi.fn());
});

describe('default model names', () => {
  const withDefault = Object.entries(PROVIDER_METADATA)
    .filter(([, meta]) => meta.configSchema?.model?.default);

  it('covers the four cloud LLM providers, so the checks below are not vacuous', () => {
    expect(withDefault.map(([id]) => id)).toEqual(expect.arrayContaining(['anthropic', 'deepseek', 'gemini', 'openai']));
  });

  for (const [id, meta] of withDefault) {
    it(`${id}: the settings form and the provider agree`, () => {
      const field = meta.configSchema.model;
      expect(createProvider(id, {}).config.model).toBe(field.default);
      expect(field.placeholder).toBe(field.default);
    });

    it(`${id}: the default is not a retired name`, () => {
      expect(RETIRED_MODELS[id]?.[meta.configSchema.model.default]).toBeUndefined();
    });
  }
});

describe('saved settings that still name a retired model', () => {
  it('are served by the live name', () => {
    expect(createProvider('deepseek', { apiKey: 'k', model: 'deepseek-chat' }).config.model).toBe('deepseek-flash');
    expect(createProvider('gemini', { apiKey: 'k', model: 'gemini-2.0-flash' }).config.model).toBe('gemini-flash-latest');
  });

  it('are mapped on every way a config enters the registry', () => {
    initConfigs({ deepseek: { apiKey: 'k', model: 'deepseek-chat' } });
    expect(getProvider('deepseek').config.model).toBe('deepseek-flash');

    updateProviderConfig('deepseek', { model: 'deepseek-reasoner' });
    expect(getProvider('deepseek').config.model).toBe('deepseek-flash');
    initConfigs({}, true);
  });

  it('leaves every other choice alone', () => {
    const mine = { apiKey: 'k', model: 'gpt-4o-mini' };
    expect(withLiveModel('openai', mine)).toBe(mine);
    expect(withLiveModel('deepseek', { model: 'deepseek-v4-pro' }).model).toBe('deepseek-v4-pro');
    expect(withLiveModel('gemini', {})).toEqual({});
  });

  it('never maps onto another retired name', () => {
    for (const [id, table] of Object.entries(RETIRED_MODELS)) {
      for (const live of Object.values(table)) {
        expect(table[live], `${id}: ${live}`).toBeUndefined();
      }
    }
  });
});

describe('anthropic: answers that start with a thinking block', () => {
  const reply = {
    model: 'claude-sonnet-5',
    stop_reason: 'end_turn',
    content: [
      { type: 'thinking', thinking: '', signature: 'sig' },
      { type: 'text', text: '你好，' },
      { type: 'text', text: '世界' },
    ],
  };

  it('translate returns the text blocks', async () => {
    const fetch = useFetch(replyWith(reply));
    const provider = createProvider('anthropic', { apiKey: 'k' });
    const result = await provider.translate('Hello, world', 'en', 'zh');
    expect(result).toMatchObject({ success: true, text: '你好，世界' });

    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.model).toBe('claude-sonnet-5');
    expect(body).not.toHaveProperty('temperature');
  });

  it('chat returns the text blocks', async () => {
    useFetch(replyWith(reply));
    const provider = createProvider('anthropic', { apiKey: 'k' });
    const result = await provider.chat([{ role: 'user', content: 'Hello, world' }]);
    expect(result).toMatchObject({ success: true, content: '你好，世界' });
  });

  it('a reply with no text block is still a failure', async () => {
    useFetch(replyWith({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }] }));
    const provider = createProvider('anthropic', { apiKey: 'k' });
    expect((await provider.translate('Hello', 'en', 'zh')).success).toBe(false);
  });
});

describe('deepl: which host a key is sent to', () => {
  it('a key without the :fx suffix goes to the paid host by default', () => {
    expect(createProvider('deepl', { apiKey: 'aaaa-bbbb' }).baseUrl).toBe('https://api.deepl.com/v2');
  });

  it('a :fx key is detected without ticking anything', () => {
    expect(createProvider('deepl', { apiKey: 'aaaa-bbbb:fx' }).baseUrl).toBe('https://api-free.deepl.com/v2');
  });

  it('the option still forces the free host, and a saved true is kept', () => {
    expect(createProvider('deepl', { apiKey: 'aaaa-bbbb', useFreeApi: true }).baseUrl).toBe('https://api-free.deepl.com/v2');
  });

  it('the form default matches the provider default', () => {
    expect(PROVIDER_METADATA.deepl.configSchema.useFreeApi.default).toBe(createProvider('deepl', {}).config.useFreeApi);
  });
});

describe('gemini: answers that carry a thought part', () => {
  const reply = {
    candidates: [{
      content: { parts: [{ text: 'weighing the register', thought: true }, { text: '你好，' }, { text: '世界 ' }] },
    }],
  };

  it('translate leaves the thought out and calls v1beta', async () => {
    const fetch = useFetch(replyWith(reply));
    const provider = createProvider('gemini', { apiKey: 'k' });
    const result = await provider.translate('Hello, world', 'en', 'zh');
    expect(result).toMatchObject({ success: true, text: '你好，世界' });
    expect(fetch.mock.calls[0][0]).toContain('/v1beta/models/gemini-flash-latest:generateContent');
  });

  it('chat leaves the thought out', async () => {
    useFetch(replyWith(reply));
    const provider = createProvider('gemini', { apiKey: 'k' });
    const result = await provider.chat([{ role: 'user', content: 'Hello, world' }]);
    expect(result).toMatchObject({ success: true, content: '你好，世界' });
  });
});
