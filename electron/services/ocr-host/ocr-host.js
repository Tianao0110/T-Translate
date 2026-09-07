// OCR host: the PP-OCR runtime (esearch-ocr + onnxruntime-node + skia
// canvas) in its own utilityProcess. The main process resolves packs and
// model paths (it owns the install roots); this side only loads models,
// decodes images and recognizes. A native crash here — an ONNX Runtime
// bug, a GPU driver fault once WebGPU is on — takes this process, not
// the app; the manager rejects in-flight requests and respawns on demand.
//
// Kept apart from the audio worker on purpose: both bundle an
// onnxruntime.dll (1.26 here, 1.27 in sherpa) and one process cannot load
// two DLLs of the same name.
//
// Protocol (main -> host):
//   {type:'init', provider:'cpu'|'webgpu'}
//   {type:'recognize', id, packId, models:{det, rec, dict, gen}, image, preprocess}
//   {type:'health', id, packId, models}      build the session, report ok
//   {type:'evict', packId?}                  drop one or every cached session
//   {type:'set-provider', provider}          drops every session, next load uses it
//   {type:'shutdown'}
// (host -> main):
//   {type:'ready'}
//   {type:'result', id, ok, value?, error?:{message, code}}
//   {type:'log', level, message}

const fs = require('fs');

const port = process.parentPort;
const log = (level, message) => port.postMessage({ type: 'log', level, message });

let env = null;
let provider = 'cpu';
// key -> Promise<ocr instance>; promise so concurrent callers share one load.
const sessions = new Map();
const MAX_SESSIONS = 2;

// Heavy natives load lazily on the first request, not at fork.
function ensureEnv() {
  if (env) return env;
  const esearch = require('esearch-ocr');
  const ort = require('onnxruntime-node');
  const canvasKit = require('@napi-rs/canvas');
  esearch.setOCREnv({
    canvas: (w, h) => canvasKit.createCanvas(w, h),
    imageData: (data, w, h) => new canvasKit.ImageData(data, w, h),
  });
  env = { esearch, ort, canvasKit };
  return env;
}

// WebGPU EP (Dawn on D3D12): onnxruntime-node ships it with dxcompiler /
// dxil next to onnxruntime.dll, so nothing is installed or downloaded.
function ortOption() {
  if (provider !== 'webgpu') return undefined;
  return { executionProviders: ['webgpu'] };
}

function sessionKey(packId) {
  return `${provider}:${packId}`;
}

async function buildSession(models, opt) {
  const { esearch, ort } = ensureEnv();
  const dict = fs.readFileSync(models.dict, 'utf8');
  // No docCls on purpose: it misclassifies short-line CJK screenshots as
  // vertical (see OCR_MODELS.md).
  // ortOption is a top-level init option in esearch-ocr (one set of session
  // options for det and rec alike); a per-model key is silently ignored.
  return esearch.init({
    det: { input: models.det },
    rec: {
      input: models.rec,
      decodeDic: dict,
      // The lib's space heuristic is for v3/v4 rec models; v5+ recognize
      // spaces natively and the heuristic over-inserts.
      optimize: { space: models.gen === 'v3' || models.gen === 'v4' },
    },
    ort,
    ...(opt ? { ortOption: opt } : {}),
  });
}

// WebGPU compiles its shader pipelines on the first run (0.5–1.1 s
// measured); a blank frame absorbs that here instead of on the user's first
// capture. Later input sizes cost only tens of milliseconds.
async function warmUp(session) {
  const { canvasKit } = ensureEnv();
  const canvas = canvasKit.createCanvas(480, 320);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 480, 320);
  await session.ocr(ctx.getImageData(0, 0, 480, 320));
}

// What went wrong with the GPU, if anything — reported with every health
// reply so the settings page can say why the switch did not take.
let providerFallback = null;

async function createSession(models) {
  if (provider !== 'webgpu') return buildSession(models, undefined);
  try {
    const session = await buildSession(models, ortOption());
    await warmUp(session);
    return session;
  } catch (e) {
    // A GPU that cannot build or run the session is a CPU machine from here
    // on: the failure is remembered, every later session skips WebGPU.
    log('warn', `WebGPU failed (${e.message}) — this host falls back to CPU`);
    providerFallback = e.message;
    provider = 'cpu';
    return buildSession(models, undefined);
  }
}

async function getSession(packId, models) {
  const key = sessionKey(packId);
  if (sessions.has(key)) {
    const p = sessions.get(key);
    sessions.delete(key);
    sessions.set(key, p); // LRU bump
    return p;
  }
  while (sessions.size >= MAX_SESSIONS) {
    const oldest = sessions.keys().next().value;
    sessions.delete(oldest);
    log('info', `evicted OCR session ${oldest}`);
  }
  log('info', `loading OCR session ${key} gen=${models.gen}`);
  const promise = createSession(models).catch((e) => {
    sessions.delete(key); // a failed load must not poison the cache
    throw e;
  });
  sessions.set(key, promise);
  return promise;
}

function evict(packId) {
  if (!packId) {
    sessions.clear();
    return;
  }
  for (const key of [...sessions.keys()]) {
    if (key.endsWith(`:${packId}`)) sessions.delete(key);
  }
}

function stripDataUrl(s) {
  return s.startsWith('data:image') ? s.split(',')[1] : s;
}

// Small captures carry small glyphs; upscaling before detection recovers
// them. Larger images skip it — cost outweighs gain.
const PREPROCESS_MAX_DIM = 1200;

async function decodeToImageData(image, preprocess = {}) {
  const { canvasKit } = ensureEnv();
  const buf = typeof image === 'string' ? Buffer.from(stripDataUrl(image), 'base64') : Buffer.from(image);
  const img = await canvasKit.loadImage(buf);

  let scale = 1;
  if (preprocess.enabled && preprocess.scale > 1 && Math.max(img.width, img.height) < PREPROCESS_MAX_DIM) {
    scale = preprocess.scale;
  }
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const canvas = canvasKit.createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (scale !== 1) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
  }
  ctx.drawImage(img, 0, 0, w, h);
  return { imageData: ctx.getImageData(0, 0, w, h), scale };
}

// esearch box: [↖,↗,↘,↙] points -> axis-aligned rect in source pixels.
function boxToBBox(box, scale) {
  if (!Array.isArray(box) || box.length < 4) return null;
  const xs = box.map((p) => (p[0] || 0) / scale);
  const ys = box.map((p) => (p[1] || 0) / scale);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

function toBlocks(lines, scale) {
  return (lines || [])
    .filter((l) => l.text && l.text.trim())
    .map((l, index) => ({
      text: l.text,
      confidence: typeof l.mean === 'number' ? l.mean : 0.9,
      bbox: boxToBBox(l.box, scale),
      index,
    }));
}

async function recognize(msg) {
  const session = await getSession(msg.packId, msg.models);
  const { imageData, scale } = await decodeToImageData(msg.image, msg.preprocess);
  const out = await session.ocr(imageData);
  const blocks = toBlocks(out.parragraphs, scale);
  const rawBlocks = toBlocks(out.src, scale);
  return {
    text: blocks.map((b) => b.text).join('\n').trim(),
    blocks,
    rawBlocks,
    confidence: blocks.length ? blocks.reduce((s, b) => s + b.confidence, 0) / blocks.length : 0,
  };
}

async function handle(msg) {
  switch (msg.type) {
    case 'init':
      provider = msg.provider === 'webgpu' ? 'webgpu' : 'cpu';
      port.postMessage({ type: 'ready' });
      return;
    case 'set-provider': {
      const next = msg.provider === 'webgpu' ? 'webgpu' : 'cpu';
      // An explicit switch is a fresh attempt: forget an earlier fallback.
      providerFallback = null;
      if (next !== provider) {
        provider = next;
        sessions.clear();
      }
      return;
    }
    case 'evict':
      evict(msg.packId);
      return;
    case 'recognize':
      return reply(msg.id, () => recognize(msg));
    case 'health':
      return reply(msg.id, async () => {
        await getSession(msg.packId, msg.models);
        return { ok: true, provider, fallback: providerFallback };
      });
    case 'shutdown':
      sessions.clear();
      process.exit(0);
      return;
    default:
      log('warn', `unknown message ${msg.type}`);
  }
}

async function reply(id, fn) {
  try {
    const value = await fn();
    port.postMessage({ type: 'result', id, ok: true, value });
  } catch (e) {
    port.postMessage({ type: 'result', id, ok: false, error: { message: e.message, code: e.code || 'OCR_FAILED' } });
  }
}

port.on('message', (e) => {
  handle(e.data).catch((err) => log('error', `handler failed: ${err.message}`));
});
