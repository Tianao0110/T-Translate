// The built-in model as a stack provider, against a fake localLlm hook:
// message shaping (system + user, the MT user-only mode, multi-turn folding),
// streaming, cancellation through the signal, chat for AI actions, the
// not-ready / no-model answers, and the prompt branch the service applies
// to it (output-language line for the general model, short prompt for MT).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { configureRuntime } from '../../src/stack/runtime.js';
import TengineProvider, { splitMessages, translateBudget } from '../../src/stack/providers/tengine.js';
import { createProvider } from '../../src/stack/registry.js';

function fakeLlm({ text = '你好', stop = 'eog', tokens = ['你', '好'], selected = { id: 'qwen3-1.7b', role: 'general', name: 'Qwen3-1.7B', status: 'ready' }, generateError = null } = {}) {
  const llm = {
    calls: [],
    cancel: vi.fn(),
    selected: () => selected,
    status: () => ({ ready: true, packs: { packs: [{ id: 'qwen3-1.7b', status: 'ready' }, { id: 'hy-mt2-1.8b', status: 'missing' }] } }),
    generate: vi.fn(async (request, onToken) => {
      llm.calls.push(request);
      if (generateError) throw generateError;
      let resolve;
      const promise = new Promise((r) => {
        resolve = r;
      });
      setTimeout(() => {
        if (onToken) for (const t of tokens) onToken(t);
        resolve({ text, stop, genTokens: tokens.length, tokPerSec: 50 });
      }, 5);
      return { promise, cancel: llm.cancel, reqId: 'g1' };
    }),
  };
  return llm;
}

beforeEach(() => {
  configureRuntime({ fetch: vi.fn(), getLanguage: () => 'zh', localLlm: null });
});

describe('tengine provider', () => {
  it('is registered, chat-capable, offline and streaming', () => {
    const p = createProvider('tengine', {});
    expect(p).toBeInstanceOf(TengineProvider);
    expect(p.requiresNetwork).toBe(false);
    expect(p.supportsStreaming).toBe(true);
    expect(typeof p.chat).toBe('function');
    expect(TengineProvider.metadata.id).toBe('tengine');
    expect(TengineProvider.metadata.supportsChat).toBe(true);
  });

  it('reports not ready without the hook', async () => {
    const p = new TengineProvider();
    const r = await p.translate('hi', 'auto', 'zh');
    expect(r.success).toBe(false);
    expect(r.error).toContain('未就绪');
    expect((await p.testConnection()).success).toBe(false);
    expect(await p.getModels()).toEqual([]);
  });

  it('sends system + user for the default mode and folds the MT user-only mode', async () => {
    const llm = fakeLlm();
    configureRuntime({ localLlm: llm });
    const p = new TengineProvider();
    const r = await p.translate('Hello', 'en', 'zh', { systemPrompt: { content: 'SYS', mode: 'system' } });
    expect(r).toMatchObject({ success: true, text: '你好', stop: 'eog', tokPerSec: 50 });
    expect(llm.calls[0]).toEqual({ kind: 'translate', system: 'SYS', user: 'Hello', maxTokens: translateBudget('Hello') });
    await p.translate('Hello', 'en', 'zh', { systemPrompt: { content: 'Translate:', mode: 'user' } });
    expect(llm.calls[1]).toMatchObject({ system: '', user: 'Translate:\n\nHello' });
    await p.translate('Hello', 'en', 'ja');
    expect(llm.calls[2].system).toMatch(/Japanese/);
  });

  it('streams chunks and returns the joined text', async () => {
    configureRuntime({ localLlm: fakeLlm() });
    const p = new TengineProvider();
    const chunks = [];
    const r = await p.translateStream('Hello', 'en', 'zh', (c) => chunks.push(c), { systemPrompt: 'S' });
    expect(chunks).toEqual(['你', '好']);
    expect(r).toMatchObject({ success: true, text: '你好' });
  });

  it('cancels through the signal and reports a cancel', async () => {
    const llm = fakeLlm({ stop: 'cancel', text: '' });
    configureRuntime({ localLlm: llm });
    const p = new TengineProvider();
    const ac = new AbortController();
    const pending = p.translate('Hello', 'en', 'zh', { signal: ac.signal });
    await new Promise((r) => setTimeout(r, 1));
    ac.abort();
    const r = await pending;
    expect(llm.cancel).toHaveBeenCalled();
    expect(r.success).toBe(false);
    expect(r.error).toBe('已取消');
  });

  it('maps stalls, errors and empty output to provider errors', async () => {
    configureRuntime({ localLlm: fakeLlm({ stop: 'stall' }) });
    expect((await new TengineProvider().translate('x', 'en', 'zh')).error).toContain('生成中断');
    configureRuntime({ localLlm: fakeLlm({ stop: 'error' }) });
    expect((await new TengineProvider().translate('x', 'en', 'zh')).error).toContain('失败');
    configureRuntime({ localLlm: fakeLlm({ text: '  ', tokens: [] }) });
    expect((await new TengineProvider().translate('x', 'en', 'zh')).error).toContain('无翻译结果');
    configureRuntime({ localLlm: fakeLlm({ generateError: Object.assign(new Error('nope'), { code: 'LLM_MODEL_MISSING' }) }) });
    expect((await new TengineProvider().translate('x', 'en', 'zh')).error).toContain('未安装');
  });

  it('chat folds a conversation into one user turn and answers with content', async () => {
    const llm = fakeLlm({ text: '要点一\n要点二', tokens: ['要点一\n', '要点二'] });
    configureRuntime({ localLlm: llm });
    const p = new TengineProvider();
    const r = await p.chat([
      { role: 'system', content: '你是阅读助手' },
      { role: 'user', content: '第一问' },
      { role: 'assistant', content: '第一答' },
      { role: 'user', content: '总结一下' },
    ], { max_tokens: 200, kind: 'summarize' });
    expect(r).toEqual({ success: true, content: '要点一\n要点二', model: null });
    expect(llm.calls[0]).toEqual({ kind: 'summarize', system: '你是阅读助手', user: 'User: 第一问\n\nAssistant: 第一答\n\nUser: 总结一下', maxTokens: 200 });
  });

  it('refuses chat while a translation-only pack is selected', async () => {
    const llm = fakeLlm({ selected: { id: 'hy-mt2-1.8b', role: 'mt', name: 'Hy-MT2-1.8B', status: 'ready' } });
    configureRuntime({ localLlm: llm });
    const p = new TengineProvider();
    expect(p.canChat()).toBe(false);
    const r = await p.chat([{ role: 'user', content: 'x' }]);
    expect(r.success).toBe(false);
    expect(r.error).toContain('只做翻译');
    expect(llm.generate).not.toHaveBeenCalled();
    expect((await p.translate('Hello', 'en', 'zh')).success).toBe(true);
    configureRuntime({ localLlm: fakeLlm() });
    expect(new TengineProvider().canChat()).toBe(true);
  });

  it('testConnection and getModels read the selected pack and the folder', async () => {
    configureRuntime({ localLlm: fakeLlm() });
    const p = new TengineProvider();
    expect(await p.testConnection()).toEqual({ success: true, message: 'Qwen3-1.7B' });
    expect(await p.getModels()).toEqual(['qwen3-1.7b']);
    configureRuntime({ localLlm: fakeLlm({ selected: { id: 'qwen3-1.7b', role: 'general', name: 'Qwen3-1.7B', status: 'missing' } }) });
    const r = await new TengineProvider().testConnection();
    expect(r.success).toBe(false);
    expect(r.message).toContain('未安装');
  });

  it('helpers: message split and translation budget', () => {
    expect(splitMessages([{ role: 'user', content: 'u' }])).toEqual({ system: '', user: 'u' });
    expect(splitMessages([{ role: 'system', content: 'a' }, { role: 'system', content: 'b' }, { role: 'user', content: 'u' }])).toEqual({ system: 'a\n\nb', user: 'u' });
    expect(translateBudget('')).toBe(256);
    expect(translateBudget('x'.repeat(2000))).toBe(2048);
  });
});
