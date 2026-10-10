// OCR host: the PP-OCR runtime (./ppocr + onnxruntime-node + skia canvas)
// in its own utilityProcess. The main process resolves packs and model
// paths; this side only loads models, decodes images and recognizes. Its
// adapter (tengine/engines/ocr.js) rejects in-flight requests on a crash
// and respawns on demand. Design notes: docs/design/ocr.md.
//
// Protocol (main -> host):
//   {type:'init', provider:'cpu'|'webgpu'}
//   {type:'recognize', id, packId, models:{det, rec, dict, gen}, image, preprocess}
//   {type:'layout', id, packId, model, image}   PDF page → layout blocks
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
// The layout model has its own slot, so it and OCR never evict each other.
const layoutSessions = new Map();

// Heavy natives load lazily on the first request, not at fork.
function ensureEnv() {
  if (env) return env;
  const { createOcr } = require('./ppocr');
  const { createLayout } = require('./layout');
  const ort = require('onnxruntime-node');
  const canvasKit = require('@napi-rs/canvas');
  env = { createOcr, createLayout, ort, canvasKit };
  return env;
}

// CPU sessions run without onnxruntime's grow-only arena (docs/design/ocr.md).
const CPU_OPTION = { enableCpuMemArena: false };

// WebGPU EP (Dawn on D3D12), shipped with onnxruntime-node.
function ortOption() {
  if (provider !== 'webgpu') return CPU_OPTION;
  return { executionProviders: ['webgpu'] };
}

// A dropped session is released once no request is still running on it.
const busy = new Map(); // session promise -> requests in flight
const doomed = new Set();

function release(promise) {
  promise.then((s) => s.release()).catch(() => {});
}

function dispose(promise) {
  if (busy.get(promise)) doomed.add(promise);
  else release(promise);
}

function dropAll(cache) {
  for (const p of cache.values()) dispose(p);
  cache.clear();
}

async function using(promise, fn) {
  busy.set(promise, (busy.get(promise) || 0) + 1);
  try {
    return await fn(await promise);
  } finally {
    const left = busy.get(promise) - 1;
    if (left) busy.set(promise, left);
    else {
      busy.delete(promise);
      if (doomed.delete(promise)) release(promise);
    }
  }
}

function sessionKey(packId) {
  return `${provider}:${packId}`;
}

async function buildSession(models, opt) {
  const { createOcr, ort, canvasKit } = ensureEnv();
  // No document-direction classifier (docs/OCR_MODELS.md, known limits).
  return createOcr({
    ort,
    ortOption: opt,
    canvasKit,
    det: models.det,
    rec: models.rec,
    dict: fs.readFileSync(models.dict, 'utf8'),
    // The space heuristic is for v3/v4 rec models only.
    spaceHeuristic: models.gen === 'v3' || models.gen === 'v4',
  });
}

// A blank frame absorbs WebGPU's first-run shader compile.
async function warmUp(session) {
  const { canvasKit } = ensureEnv();
  const canvas = canvasKit.createCanvas(480, 320);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 480, 320);
  await session.ocr(ctx.getImageData(0, 0, 480, 320));
}

// Why the GPU fell back, if it did; reported with every health reply.
let providerFallback = null;

async function createSession(models) {
  if (provider !== 'webgpu') return buildSession(models, CPU_OPTION);
  try {
    const session = await buildSession(models, ortOption());
    await warmUp(session);
    return session;
  } catch (e) {
    // Sticky: every later session on this host skips WebGPU.
    log('warn', `WebGPU failed (${e.message}) — this host falls back to CPU`);
    providerFallback = e.message;
    provider = 'cpu';
    return buildSession(models, CPU_OPTION);
  }
}

function getSession(packId, models) {
  const key = sessionKey(packId);
  if (sessions.has(key)) {
    const p = sessions.get(key);
    sessions.delete(key);
    sessions.set(key, p); // LRU bump
    return p;
  }
  while (sessions.size >= MAX_SESSIONS) {
    const oldest = sessions.keys().next().value;
    dispose(sessions.get(oldest));
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
    dropAll(sessions);
    dropAll(layoutSessions);
    return;
  }
  for (const cache of [sessions, layoutSessions]) {
    for (const key of [...cache.keys()]) {
      if (key.endsWith(`:${packId}`)) {
        dispose(cache.get(key));
        cache.delete(key);
      }
    }
  }
}

async function createLayoutSession(model) {
  const { createLayout, ort, canvasKit } = ensureEnv();
  if (provider !== 'webgpu') return createLayout({ ort, ortOption: CPU_OPTION, canvasKit, model });
  try {
    return await createLayout({ ort, ortOption: ortOption(), canvasKit, model });
  } catch (e) {
    log('warn', `WebGPU failed for layout (${e.message}) — this host falls back to CPU`);
    providerFallback = e.message;
    provider = 'cpu';
    return createLayout({ ort, ortOption: CPU_OPTION, canvasKit, model });
  }
}

function getLayout(packId, model) {
  const key = sessionKey(packId);
  if (layoutSessions.has(key)) return layoutSessions.get(key);
  dropAll(layoutSessions);
  log('info', `loading layout session ${key}`);
  const promise = createLayoutSession(model).catch((e) => {
    layoutSessions.delete(key);
    throw e;
  });
  layoutSessions.set(key, promise);
  return promise;
}

function stripDataUrl(s) {
  return s.startsWith('data:image') ? s.split(',')[1] : s;
}

// Upscaling applies to small captures only.
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
  return using(getSession(msg.packId, msg.models), async (session) => {
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
  });
}

async function layout(msg) {
  return using(getLayout(msg.packId, msg.model), async (session) => {
    const { canvasKit } = ensureEnv();
    const buf = typeof msg.image === 'string' ? Buffer.from(stripDataUrl(msg.image), 'base64') : Buffer.from(msg.image);
    const img = await canvasKit.loadImage(buf);
    return { blocks: await session.analyze(img), provider };
  });
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
        dropAll(sessions);
        dropAll(layoutSessions);
      }
      return;
    }
    case 'evict':
      evict(msg.packId);
      return;
    case 'recognize':
      return reply(msg.id, () => recognize(msg));
    case 'layout':
      return reply(msg.id, () => layout(msg));
    case 'health':
      return reply(msg.id, async () => {
        await getSession(msg.packId, msg.models);
        return { ok: true, provider, fallback: providerFallback };
      });
    case 'shutdown':
      sessions.clear();
      layoutSessions.clear();
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
