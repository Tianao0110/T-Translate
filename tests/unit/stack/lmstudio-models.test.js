// A blank model name with LM Studio (src/stack/lmstudio-models.js): requests
// name the model LM Studio has loaded, so OCR and translation stop asking it
// to pick one (and swap models mid-capture); with nothing loaded they fail
// with a message to go load one. A configured name is sent as is, and an
// endpoint that is not LM Studio behaves as before.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pickLoadedModel, clearLoadedModelCache } from '../../../src/stack/lmstudio-models.js';
import { createProvider } from '../../../src/stack/registry.js';
import { OCREngineManager } from '../../../src/stack/ocr/manager.js';
import { configureRuntime } from '../../../src/stack/runtime.js';

const ENDPOINT = 'http://localhost:1234/v1';
const IMG = 'data:image/png;base64,AAAA';

const model = (id, type, state) => ({ id, type, state, object: 'model' });
const json = (data, status = 200) => ({ ok: status < 400, status, json: async () => data, text: async () => JSON.stringify(data) });

// LM Studio stand-in: /api/v0/models from `models` (null = not LM Studio),
// chat completions answer `reply` and are recorded.
function lmStudio(models, reply = '你好') {
  const chats = [];
  const fetch = vi.fn(async (url, init = {}) => {
    if (url.endsWith('/api/v0/models')) return models ? json({ data: models }) : json({ error: 'not found' }, 404);
    if (url.endsWith('/chat/completions')) {
      chats.push(JSON.parse(init.body));
      return json({ choices: [{ message: { content: reply } }], usage: { prompt_tokens: 900 } });
    }
    return json({}, 404);
  });
  configureRuntime({
    fetch,
    getLanguage: () => 'zh',
    localOcr: { paddle: vi.fn(async () => ({ success: true, text: 'local text', blocks: [], rawBlocks: [] })), windows: vi.fn(), isWindows: true },
  });
  return { fetch, chats };
}

beforeEach(() => clearLoadedModelCache());

describe('pickLoadedModel', () => {
  it('text prefers a loaded LLM, vision a loaded VLM; downloaded-only models never count', async () => {
    lmStudio([model('big-llm', 'llm', 'not-loaded'), model('vl', 'vlm', 'loaded'), model('mt', 'llm', 'loaded'), model('emb', 'embeddings', 'loaded')]);
    expect(await pickLoadedModel(ENDPOINT)).toEqual({ known: true, id: 'mt' });
    expect(await pickLoadedModel(ENDPOINT, { vision: true })).toEqual({ known: true, id: 'vl' });
  });

  it('text falls back to a loaded VLM; vision finds nothing among LLMs', async () => {
    lmStudio([model('vl', 'vlm', 'loaded')]);
    expect((await pickLoadedModel(ENDPOINT)).id).toBe('vl');
    clearLoadedModelCache();
    lmStudio([model('mt', 'llm', 'loaded')]);
    expect(await pickLoadedModel(ENDPOINT, { vision: true })).toEqual({ known: true, id: null });
  });

  it('nothing loaded is known-and-empty; no LM Studio list is unknown', async () => {
    lmStudio([model('vl', 'vlm', 'not-loaded')]);
    expect(await pickLoadedModel(ENDPOINT)).toEqual({ known: true, id: null });
    clearLoadedModelCache();
    lmStudio(null);
    expect(await pickLoadedModel(ENDPOINT)).toEqual({ known: false, id: null });
  });

  it('asks once per burst (cached a few seconds)', async () => {
    const { fetch } = lmStudio([model('mt', 'llm', 'loaded')]);
    await pickLoadedModel(ENDPOINT);
    await pickLoadedModel(ENDPOINT);
    await pickLoadedModel(`${ENDPOINT}/`);
    expect(fetch.mock.calls.filter(([url]) => url.endsWith('/api/v0/models'))).toHaveLength(1);
  });
});

describe('LM Studio translation provider', () => {
  it('blank model: names the loaded one', async () => {
    const { chats } = lmStudio([model('vl', 'vlm', 'loaded')], '你好');
    const r = await createProvider('local-llm', { endpoint: ENDPOINT }).translate('Hello', 'en', 'zh');
    expect(r.success).toBe(true);
    expect(chats[0].model).toBe('vl');
  });

  it('blank model, nothing loaded: fails without a chat request', async () => {
    const { chats } = lmStudio([model('vl', 'vlm', 'not-loaded')]);
    const r = await createProvider('local-llm', { endpoint: ENDPOINT }).translate('Hello', 'en', 'zh');
    expect(r.success).toBe(false);
    expect(r.error).toContain('LM Studio');
    expect(chats).toHaveLength(0);
  });

  it('a configured model is sent as is, without asking what is loaded', async () => {
    const { fetch, chats } = lmStudio([]);
    await createProvider('local-llm', { endpoint: ENDPOINT, model: 'qwen3-8b' }).translate('Hello', 'en', 'zh');
    expect(chats[0].model).toBe('qwen3-8b');
    expect(fetch.mock.calls.some(([url]) => url.endsWith('/api/v0/models'))).toBe(false);
  });

  it('not LM Studio: no model named, as before', async () => {
    const { chats } = lmStudio(null);
    await createProvider('local-llm', { endpoint: ENDPOINT }).translate('Hello', 'en', 'zh');
    expect(chats[0].model).toBeUndefined();
  });
});

describe('LM Studio vision OCR', () => {
  const makeManager = async () => {
    const m = new OCREngineManager({ loadConfigs: async () => ({ llmEndpoint: ENDPOINT }) });
    await m.init();
    return m;
  };

  it('blank model: names the loaded VLM', async () => {
    const { chats } = lmStudio([model('mt', 'llm', 'loaded'), model('vl', 'vlm', 'loaded')], 'Hello world');
    const r = await (await makeManager()).recognize(IMG, { engine: 'llm-vision' });
    expect(r.success).toBe(true);
    expect(chats[0].model).toBe('vl');
  });

  it('no image-capable model loaded: fails as itself — no fallback, no step toward the vision lock', async () => {
    const { chats } = lmStudio([model('mt', 'llm', 'loaded')]);
    const manager = await makeManager();
    for (let i = 0; i < 3; i++) {
      const r = await manager.recognize(IMG, { engine: 'llm-vision' });
      expect(r).toMatchObject({ success: false, errorCode: 'LMSTUDIO_NONE_LOADED' });
      expect(r.fallbackFrom).toBeUndefined();
    }
    expect(chats).toHaveLength(0);
    expect(manager._visionLocked).toBeFalsy();
  });
});
