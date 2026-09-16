// End to end through the translation stack: the 'tengine' provider ->
// llm-manager -> LLM host -> llama.cpp, with the real filters, templates and
// privacy gate in between. userData and the model folder are sandboxes; the
// model files are hard-linked in under their whitelisted names.
//
//   npx electron scripts/smoke/smoke-llm-stack.js --model <Qwen3 gguf> [--mt <Hy-MT2 gguf>] [--gpu]
/* eslint-disable no-console */

const path = require('path');
const fs = require('fs');
const { net } = require('electron');
const { arg, has, sleep, checklist, sandbox, place, fakeStore, run } = require('../lib/electron-smoke');

const MODEL = arg('--model', process.env.TT_LLM_MODEL);
const MT = arg('--mt', null);
const GPU = has('--gpu');
const { step, summary } = checklist();
const zh = (s) => /[一-鿿]/.test(String(s || ''));

// A whitelisted file goes in under its pinned name so the scanner's hash
// check applies; anything else keeps its own name.
function placeModel(dir, src) {
  const { LLM_PACKS } = require('../../electron/shared/llm-packs');
  const size = fs.statSync(src).size;
  const pack = LLM_PACKS.find((p) => p.size === size) || null;
  return { pack, dst: place(dir, src, pack ? pack.file : path.basename(src)) };
}

async function main() {
  if (!MODEL || !fs.existsSync(MODEL)) {
    console.error('usage: npx electron scripts/smoke/smoke-llm-stack.js --model <path.gguf> [--mt <path.gguf>] [--gpu]');
    return 2;
  }
  const box = sandbox('t-translate-smoke-llm-stack');
  const modelsDir = path.join(box.dir, 'llm-models');
  fs.mkdirSync(modelsDir, { recursive: true });
  const placed = placeModel(modelsDir, MODEL);
  const placedMt = MT && fs.existsSync(MT) ? placeModel(modelsDir, MT) : null;
  console.log(`model folder ${modelsDir}: ${placed.pack ? placed.pack.id : 'unlisted'}${placedMt ? ` + ${placedMt.pack ? placedMt.pack.id : 'unlisted'}` : ''}`);

  const store = fakeStore({ privacyMode: 'standard' });
  const tengine = require('../../electron/tengine').get();
  const llmManager = require('../../electron/llm/llm-manager');
  const makeLogger = require('../../electron/platform/logger');
  llmManager.init({ store, tengine, adapter: tengine.get('llm'), logsDir: path.join(box.dir, 'logs'), modelsDir, logger: makeLogger('LLM') });
  tengine.get('llm').setProvider(GPU ? 'gpu' : 'cpu');
  const t0 = Date.now();
  const scan = await llmManager.rescan();
  step('whitelisted file verified by hash', scan.packs.some((p) => p.status === 'ready'), `${Date.now() - t0} ms: ${scan.packs.map((p) => `${p.id}:${p.status}`).join(' ')}`);

  const { createTranslationStack } = require('../../electron/generated/translation-stack.cjs');
  const stack = createTranslationStack({
    fetch: net.fetch.bind(net),
    getLanguage: () => 'zh',
    loggerFactory: (scope) => makeLogger(`Stack:${scope}`),
    loadProviderConfigs: async () => ({ list: [{ id: 'tengine', enabled: true, priority: 0 }], configs: { tengine: {} } }),
    loadOcrConfigs: async () => ({}),
    localOcr: { paddle: async () => ({}), windows: async () => ({}), isWindows: true },
    getCustomFilters: () => [],
    localLlm: {
      generate: (request, onToken) => llmManager.generate(request, onToken),
      status: () => llmManager.status(),
      selected: () => llmManager.selected(),
    },
  });
  await stack.init();
  const service = stack.service;

  const probe = await service.testProvider('tengine');
  step('testProvider sees the selected pack', probe.success === true, probe.message);

  const t1 = Date.now();
  const r1 = await service.translate('Open https://example.com/docs and paste the key from the box.', { targetLang: 'zh', sourceLang: 'en', template: 'natural', useCache: false });
  step('translate through the stack', r1.success && r1.provider === 'tengine' && zh(r1.text), `${Date.now() - t1} ms: ${r1.text || r1.error}`);
  step('url filter round-trips', !!r1.text && r1.text.includes('https://example.com/docs'));

  const chunks = [];
  const r2 = await service.translateStream('Subtitles auto-save as SRT when you stop or switch sources.', { targetLang: 'zh', sourceLang: 'en', template: 'natural', useCache: false }, (c) => chunks.push(c));
  step('translateStream streams chunks', r2.success && chunks.length >= 2 && zh(r2.text), `${chunks.length} chunks: ${r2.text || r2.error}`);

  const r3 = await service.translate('The rnodel loads in 0.3 seconds and the first token arrlves after 1O ms.', { targetLang: 'zh', sourceLang: 'en', template: 'ocr', useCache: false });
  step('ocr template answers in the target language', r3.success && zh(r3.text), r3.text || r3.error);

  const r4 = await service.chatCompletion([
    { role: 'system', content: '你是一个阅读助手。用户会给你一段内容，请基于原文理解它，然后用中文写总结。只输出总结正文，不要复述原文，不要说明你在做什么。' },
    { role: 'user', content: '请阅读下面的内容，并用中文总结要点。\n\n内容：\nThe floating window captures a region of the screen and recognizes the text in it. Recognition runs on this machine; nothing is uploaded.\n\n要求：\n- 3-5 条要点，每条一行\n- 输出格式：每行以「- 」开头，一行一个要点，不要段落' },
  ], { requireChat: true, useCache: false });
  step('chatCompletion for AI actions', r4.success && zh(r4.content), (r4.content || r4.error || '').split('\n')[0]);

  const ac = new AbortController();
  const pending = service.translate('Write a very long essay about the history of the ocean, at least five hundred words, covering every era.', { targetLang: 'zh', sourceLang: 'en', template: 'natural', useCache: false, signal: ac.signal });
  setTimeout(() => ac.abort(), 400);
  const r5 = await pending;
  step('abort signal cancels the local generation', r5.success === false, r5.error);

  const r6 = await service.translate('It works offline too.', { targetLang: 'zh', sourceLang: 'en', template: 'natural', useCache: false, privacyMode: 'offline' });
  step('offline mode keeps the built-in model', r6.success && r6.provider === 'tengine', r6.text || r6.error);

  if (placedMt && placedMt.pack) {
    store.set('settings.llm.pack', placedMt.pack.id);
    const sel = llmManager.selected();
    step('settings choose the translation-only pack', sel.id === placedMt.pack.id && sel.role === 'mt' && sel.status === 'ready');
    const t2 = Date.now();
    const r7 = await service.translate('Please have your materials ready before the meeting.', { targetLang: 'zh', sourceLang: 'en', template: 'natural', useCache: false });
    step('MT pack translates through the short prompt', r7.success && zh(r7.text) && !/Requirements|要求/.test(r7.text), `${Date.now() - t2} ms: ${r7.text || r7.error}`);
    const r8 = await service.chatCompletion([{ role: 'user', content: 'Summarize: the window captures text.' }], { requireChat: true, useCache: false });
    step('MT pack is skipped for AI actions', r8.success === false, r8.error);
    store.set('settings.llm.pack', placed.pack ? placed.pack.id : '');
  }

  const s = llmManager.status();
  console.log(`resident ${s.resident ? `${s.resident.file} on ${s.resident.provider}` : 'none'}, last request ${s.lastRequest ? `${s.lastRequest.tokPerSec} tok/s, stop ${s.lastRequest.stop}` : 'none'}`);
  await llmManager.unload('smoke');
  tengine.shutdownAll();
  await sleep(300);
  box.cleanup();
  return summary();
}

run(main);
