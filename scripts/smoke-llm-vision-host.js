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
  const llmManager = require('../electron/managers/llm-manager');
  const makeLogger = require('../electron/utils/logger');
  llmManager.init({ store, tengine, adapter: tengine.get('llm'), visionAdapter: tengine.get('llm-vision'), logsDir: path.join(SANDBOX, 'logs'), modelsDir, logger: makeLogger('LLM') });
  tengine.get('llm').setProvider(GPU ? 'gpu' : 'cpu');
  tengine.get('llm-vision').setProvider('cpu');

  const scan = await llmManager.rescan();
  const row = scan.packs.find((p) => p.role === 'vision');
  step('two-file pack verified by both hashes', row && row.status === 'ready', row ? `${row.id}: ${row.files.map((f) => `${f.part}=${f.status}`).join(' ')}` : 'no vision row');

  const image = fs.readFileSync(HEALTH_IMAGE);
  const t0 = Date.now();
  const r1 = await (await llmManager.recognize({ image })).promise;
  step('recognize on the CPU host reads the fixed image with a box', r1.lines.some((l) => l.text.includes('OK') && l.box), `${Date.now() - t0} ms incl. load: ${JSON.stringify(r1.lines)}`);
  const v1 = llmManager.status().vision;
  step('status shows the vision slot resident on its own host', v1.available && v1.resident && v1.resident.file === path.basename(MODEL) && v1.provider === 'cpu', `${v1.resident?.file} on ${v1.resident?.provider}, cap ${v1.maxPixels}`);

  let tooLarge = null;
  try {
    await (await llmManager.recognize({ image: bigBmp(800, 600) })).promise;
  } catch (e) {
    tooLarge = e;
  }
  step('an image over the CPU cap is refused before encoding', tooLarge && tooLarge.code === 'LLM_IMAGE_TOO_LARGE', tooLarge ? tooLarge.message : 'accepted');

  const status = tengine.status();
  const hosts = status.engines.filter((e) => e.id === 'llm' || e.id === 'llm-vision').map((e) => `${e.id}:${e.host?.running ? 'running' : 'idle'}`);
  step('the vision host runs separately from the text host', status.engines.find((e) => e.id === 'llm-vision')?.host?.running === true, hosts.join(' '));

  if (TEXT && fs.existsSync(TEXT)) {
    const g = await llmManager.generate({ system: 'Translate the following text into Chinese (Simplified). Output ONLY the translation.', user: 'The window reads text from the screen.', maxTokens: 40 });
    const [text, vision] = await Promise.all([g.promise, (await llmManager.recognize({ image })).promise]);
    step('text and vision requests run side by side on two hosts', /[一-鿿]/.test(text.text) && vision.lines.length > 0, `${text.text.trim()} | ${vision.lines[0]?.text}`);
    step('both models resident at once', !!llmManager.status().resident && !!llmManager.status().vision.resident);
  }

  if (GPU) {
    tengine.get('llm-vision').setProvider('gpu');
    const t1 = Date.now();
    const st = await llmManager.visionSelfTest();
    step('GPU self-test reloads the vision pack on Vulkan without a cap', st.ok && st.provider === 'webgpu', `${Date.now() - t1} ms, prefill ${st.promptMs} ms, ${st.tokPerSec} tok/s`);
    const r2 = await (await llmManager.recognize({ image: bigBmp(800, 600), maxTokens: 8 })).promise;
    step('the GPU takes the large image', r2.stop === 'eog' || r2.stop === 'limit', `${r2.imageTokens} image tok, ${r2.totalMs} ms`);
  }

  // Through the stack: the OCR manager's built-in vision engine, a capture
  // as the data URL the windows send, line boxes back; and the degrade to
  // the classic local engine when the vision host refuses.
  tengine.get('llm-vision').setProvider('cpu');
  const { createTranslationStack } = require('../electron/generated/translation-stack.cjs');
  const paddleStub = async () => ({ success: true, text: 'stub', blocks: [], rawBlocks: [] });
  const stack = createTranslationStack({
    fetch: async () => { throw new Error('no network in this smoke'); },
    getLanguage: () => 'zh',
    loggerFactory: (scope) => makeLogger(`Stack:${scope}`),
    loadProviderConfigs: async () => ({ list: [], configs: {} }),
    loadOcrConfigs: async () => ({}),
    localOcr: { paddle: paddleStub, windows: paddleStub, isWindows: true },
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
  step('stack OCR engine returns text with line boxes', o1.success && o1.engine === 'tengine-vision' && o1.blocks.length > 0 && o1.blocks[0].bbox.width > 0, `${o1.text} ${JSON.stringify(o1.blocks[0]?.bbox)}`);
  const big = bigBmp(800, 600);
  const o2 = await stack.ocr.recognize(`data:image/bmp;base64,${big.toString('base64')}`, { engine: 'tengine-vision' });
  step('a refused capture degrades to the classic local engine with a notice', o2.success && o2.engine === 'rapid-ocr' && o2.fallbackFrom === 'tengine-vision', o2.fallbackReason || o2.error);

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
