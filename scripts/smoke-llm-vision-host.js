// The vision slot end to end in a real Electron: the model folder scanner
// accepting the two-file pack, llm-manager loading it into its own host
// next to the text model, a recognize() with boxes, the CPU size cap, the
// GPU self-test, and both hosts unloading. userData and the model folder
// are sandboxes; the files are hard-linked in under their pinned names.
//
//   npm run smoke:llm-vision-host -- --model <PaddleOCR-VL gguf> --mmproj <mmproj gguf> [--text <Qwen3 gguf>] [--gpu]
/* eslint-disable no-console */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { app } = require('electron');

const SANDBOX = path.join(os.tmpdir(), 't-translate-smoke-llm-vision-host');
const arg = (name, def = null) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : def;
};
const MODEL = arg('--model', process.env.TT_VISION_MODEL);
const MMPROJ = arg('--mmproj', process.env.TT_VISION_MMPROJ);
const TEXT = arg('--text', process.env.TT_LLM_MODEL);
const GPU = process.argv.includes('--gpu');
const HEALTH_IMAGE = path.join(__dirname, '..', 'electron', 'tengine', 'runtime', 'assets', 'vision-health.png');

let failures = 0;
function step(label, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures++;
}

function place(dir, src) {
  const dst = path.join(dir, path.basename(src));
  try {
    fs.linkSync(src, dst);
  } catch {
    // Hard links cannot cross volumes (the sandbox is on the system drive):
    // this is a real copy of a large file, removed again at exit.
    console.log(`copying ${path.basename(src)} into the sandbox (${Math.round(fs.statSync(src).size / 1048576)} MB, no hard link across drives)`);
    fs.copyFileSync(src, dst);
  }
  return dst;
}

function cleanupSandbox() {
  try {
    fs.rmSync(SANDBOX, { recursive: true, force: true });
  } catch (e) {
    console.log(`sandbox kept (${e.message}): ${SANDBOX}`);
  }
}

function fakeStore(seed = {}) {
  const data = { ...seed };
  return { get: (k, d) => (k in data ? data[k] : d), set: (k, v) => { data[k] = v; }, onDidChange: () => () => {} };
}

// A PNG larger than the CPU cap, made of the health image's bytes is not
// possible without a decoder; a raw RGB bitmap is enough for mtmd's stb
// loader through a BMP header instead.
function bigBmp(width, height) {
  const rowBytes = (width * 3 + 3) & ~3;
  const size = 54 + rowBytes * height;
  const b = Buffer.alloc(size, 0xff);
  b.write('BM', 0);
  b.writeUInt32LE(size, 2);
  b.writeUInt32LE(54, 10);
  b.writeUInt32LE(40, 14);
  b.writeInt32LE(width, 18);
  b.writeInt32LE(height, 22);
  b.writeUInt16LE(1, 26);
  b.writeUInt16LE(24, 28);
  return b;
}

async function main() {
  if (!MODEL || !MMPROJ || !fs.existsSync(MODEL) || !fs.existsSync(MMPROJ)) {
    console.error('usage: npm run smoke:llm-vision-host -- --model <gguf> --mmproj <gguf> [--text <gguf>] [--gpu]');
    app.exit(2);
    return;
  }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  const modelsDir = path.join(SANDBOX, 'llm-models');
  fs.mkdirSync(modelsDir, { recursive: true });
  app.setPath('userData', SANDBOX);
  process.env.TT_MODELS_ROOT = path.join(SANDBOX, 'models');
  place(modelsDir, MODEL);
  place(modelsDir, MMPROJ);
  if (TEXT && fs.existsSync(TEXT)) place(modelsDir, TEXT);

  const store = fakeStore({ privacyMode: 'standard' });
  const tengine = require('../electron/tengine').get();
  const llmManager = require('../electron/llm/llm-manager');
  const makeLogger = require('../electron/platform/logger');
  llmManager.init({ store, tengine, adapter: tengine.get('llm'), visionAdapter: tengine.get('llm-vision'), logsDir: path.join(SANDBOX, 'logs'), modelsDir, logger: makeLogger('LLM') });
  tengine.get('llm').setProvider(GPU ? 'gpu' : 'cpu');
  tengine.get('llm-vision').setProvider('cpu');

  const scan = await llmManager.rescan();
  const row = scan.packs.find((p) => p.role === 'vision');
  step('two-file pack verified by both hashes', row && row.status === 'ready', row ? `${row.id}: ${row.files.map((f) => `${f.part}=${f.status}`).join(' ')}` : 'no vision row');

  // GPU only: on the CPU the manager refuses before a byte of the pack is
  // read, and the settings card reads unusable.
  let onCpu = null;
  try {
    await (await llmManager.recognize({ image: fs.readFileSync(HEALTH_IMAGE) })).promise;
  } catch (e) {
    onCpu = e;
  }
  step('on the CPU the vision slot refuses before loading', onCpu && onCpu.code === 'LLM_VISION_NEEDS_GPU' && !llmManager.status().vision.resident && llmManager.status().vision.usable === false, onCpu ? onCpu.message : 'accepted');

  tengine.get('llm-vision').setProvider('gpu');
  const image = fs.readFileSync(HEALTH_IMAGE);
  const t0 = Date.now();
  const r1 = await (await llmManager.recognize({ image })).promise;
  step('recognize on the GPU host reads the fixed image with a box', r1.lines.some((l) => l.text.includes('OK') && l.box), `${Date.now() - t0} ms incl. load and warm-up: ${JSON.stringify(r1.lines)}`);
  const v1 = llmManager.status().vision;
  step('status shows the vision slot resident on its own host', v1.available && v1.usable && v1.resident && v1.resident.file === path.basename(MODEL) && v1.provider === 'gpu', `${v1.resident?.file} on ${v1.resident?.provider}`);
  const t2 = Date.now();
  const r2 = await (await llmManager.recognize({ image: bigBmp(1200, 900), maxTokens: 8 })).promise;
  step('a large image goes through on the GPU', r2.stop === 'eog' || r2.stop === 'limit', `${r2.imageTokens} image tok, ${Date.now() - t2} ms (first time at this size)`);

  const status = tengine.status();
  const hosts = status.engines.filter((e) => e.id === 'llm' || e.id === 'llm-vision').map((e) => `${e.id}:${e.host?.running ? 'running' : 'idle'}`);
  step('the vision host runs separately from the text host', status.engines.find((e) => e.id === 'llm-vision')?.host?.running === true, hosts.join(' '));

  if (TEXT && fs.existsSync(TEXT)) {
    const g = await llmManager.generate({ system: 'Translate the following text into Chinese (Simplified). Output ONLY the translation.', user: 'The window reads text from the screen.', maxTokens: 40 });
    const [text, vision] = await Promise.all([g.promise, (await llmManager.recognize({ image })).promise]);
    step('text and vision requests run side by side on two hosts', /[一-鿿]/.test(text.text) && vision.lines.length > 0, `${text.text.trim()} | ${vision.lines[0]?.text}`);
    step('both models resident at once', !!llmManager.status().resident && !!llmManager.status().vision.resident);
  }

  const t1 = Date.now();
  const st = await llmManager.visionSelfTest();
  step('GPU self-test on the resident pack', st.ok && st.provider === 'webgpu', `${Date.now() - t1} ms, prefill ${st.promptMs} ms, ${st.tokPerSec} tok/s`);

  // Through the stack with the engine selected: PP-OCR (stubbed) reads
  // first and keeps a simple capture; a capture it cannot read escalates
  // to the vision model; with the GPU off the classic engines serve it
  // and the result carries the notice.
  const { createTranslationStack } = require('../electron/generated/translation-stack.cjs');
  const line = { text: 'stub line', confidence: 0.98, bbox: { x: 10, y: 10, width: 200, height: 20 } };
  let paddleMode = 'simple';
  const paddleStub = async () => (paddleMode === 'simple'
    ? { success: true, text: 'stub line', confidence: 0.98, blocks: [line], rawBlocks: [line] }
    : { success: false, error: 'stub cannot read this', errorCode: 'BASE_MODELS_MISSING' });
  const stack = createTranslationStack({
    fetch: async () => { throw new Error('no network in this smoke'); },
    getLanguage: () => 'zh',
    loggerFactory: (scope) => makeLogger(`Stack:${scope}`),
    loadProviderConfigs: async () => ({ list: [], configs: {} }),
    loadOcrConfigs: async () => ({}),
    localOcr: { paddle: paddleStub, windows: async () => ({ success: false, error: 'no windows ocr in this smoke' }), isWindows: true },
    getCustomFilters: () => [],
    localLlm: {
      generate: (request, onToken) => llmManager.generate(request, onToken),
      status: () => llmManager.status(),
      selected: () => llmManager.selected(),
      recognize: (request) => llmManager.recognize(request),
      visionStatus: () => llmManager.visionStatus(),
    },
  });
  await stack.init();
  const dataUrl = `data:image/png;base64,${image.toString('base64')}`;
  const o1 = await stack.ocr.recognize(dataUrl, { engine: 'tengine-vision', allowedEngines: ['tengine-vision', 'rapid-ocr', 'windows-ocr'] });
  step('smart routing keeps a simple capture on PP-OCR', o1.success && o1.engine === 'rapid-ocr' && o1.routed?.reason === 'simple', JSON.stringify(o1.routed));
  paddleMode = 'fail';
  const o2 = await stack.ocr.recognize(dataUrl, { engine: 'tengine-vision' });
  step('smart routing escalates what PP-OCR cannot read to the vision model, with line boxes', o2.success && o2.engine === 'tengine-vision' && o2.routed?.reason === 'unreadable' && o2.blocks.length > 0 && o2.blocks[0].bbox.width > 0, `${o2.text} ${JSON.stringify(o2.blocks[0]?.bbox)}`);
  paddleMode = 'simple';
  tengine.get('llm-vision').setProvider('cpu');
  const o3 = await stack.ocr.recognize(dataUrl, { engine: 'tengine-vision' });
  step('with the GPU off the classic engine serves it and the result says so', o3.success && o3.engine === 'rapid-ocr' && o3.fallbackFrom === 'tengine-vision' && o3.fallbackReason === 'unavailable', JSON.stringify({ engine: o3.engine, fallbackFrom: o3.fallbackFrom }));
  tengine.get('llm-vision').setProvider('gpu');

  step('manual unload clears both slots', (await llmManager.unloadVision('smoke')) === true && llmManager.status().vision.resident === null);
  await llmManager.unload('smoke');
  tengine.shutdownAll();
  await new Promise((r) => setTimeout(r, 300));
  cleanupSandbox();
  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  app.exit(failures ? 1 : 0);
}

app.whenReady().then(() => main().catch((e) => {
  console.error('smoke failed:', e);
  app.exit(1);
}));
