// The main-process side of the built-in model: where T-Engine's numbers
// turn into decisions (docs/T-ENGINE.md §7). Resolves which file the engine
// loads (the whitelist, or the developer door for a trial model), keeps one
// model resident and drops it after five idle minutes (P8), runs the GPU
// switch's self-test, and writes the trial log for a model outside the
// whitelist. Prompts and outputs pass through untouched and unrecorded
// unless the developer's text switch is on.
//
// The vision model (the built-in OCR engine) is a second slot with its own
// host, residency, idle timer and policy streaks, so it stays resident
// next to the text model and neither waits for the other.

const path = require('path');
const { PRIVACY_MODES } = require('../shared/channels');
const { LLM_MODELS_DIR, LLM_ROLE_VISION, packById, defaultPack, roleForFileName } = require('../shared/llm-packs');
const { createLlmPackManager } = require('./llm-pack-manager');
const { createTrialLog, pruneTrialLogs, summarizeTrialLogs } = require('../tengine/trial-log');
const { createLlmPolicy } = require('../policy/engine-policy');

const IDLE_UNLOAD_MS = 5 * 60 * 1000;
const KEY_ALLOW_UNLISTED = 'settings.llm.allowUnlistedModels';
const KEY_TRIAL_TEXT = 'settings.llm.trialLogText';
// Which pack the built-in provider uses (settings page choice): a whitelist
// id, or `unlisted:<file>` for a folder file behind the developer door.
const KEY_PACK = 'settings.llm.pack';
const UNLISTED_PREFIX = 'unlisted:';
const TRIAL_EVENT_KINDS = new Set(['model-loaded', 'model-load-failed', 'request-failed', 'stall', 'health', 'exit']);
let deps = null;
let resident = null; // { path, provider } as requested at load time
let trial = null; // trial log of the resident unlisted model
let idleTimer = null;
let inflight = 0;
let unsubscribe = null;
// The policy table: streaks and advice from the engine's numbers.
let policy = createLlmPolicy();
// The vision slot.
let visionResident = null; // { path, provider }
let visionIdleTimer = null;
let visionInflight = 0;
let visionPolicy = createLlmPolicy({ engine: 'llm-vision' });

const fail = (code, message) => Object.assign(new Error(message), { code });

function isSecure() {
  return deps.store.get('privacyMode', PRIVACY_MODES.STANDARD) === PRIVACY_MODES.SECURE;
}

function allowUnlisted() {
  return process.env.TT_TENGINE_DEV === '1' || deps.store.get(KEY_ALLOW_UNLISTED, false) === true;
}

function trialText() {
  return deps.store.get(KEY_TRIAL_TEXT, false) === true;
}

function selectedPack() {
  const chosen = packById(deps.store.get(KEY_PACK, '') || '');
  return chosen || defaultPack();
}

// A folder file chosen through the developer door, if the door is open and
// the file is still there; null otherwise (the whitelist choice applies).
function selectedUnlisted() {
  const raw = String(deps.store.get(KEY_PACK, '') || '');
  if (!raw.startsWith(UNLISTED_PREFIX) || !allowUnlisted()) return null;
  const file = path.basename(raw.slice(UNLISTED_PREFIX.length));
  const row = deps.packs.status()?.unlisted.find((u) => u.file === file);
  if (!row) return null;
  return { id: raw, file, role: row.role || roleForFileName(file), name: file.replace(/\.gguf$/i, ''), status: 'ready', trial: true };
}

// The pack the built-in provider will use, with its install state — what
// the stack's prompt shaping and testConnection read.
function selected() {
  if (!deps) return null;
  const unlisted = selectedUnlisted();
  if (unlisted) return unlisted;
  const pack = selectedPack();
  if (!pack) return null;
  const row = deps.packs.status()?.packs.find((p) => p.id === pack.id);
  return { id: pack.id, role: pack.role, name: pack.name, status: row ? row.status : 'unknown', trial: false };
}

function clearIdle() {
  if (idleTimer) {
    deps.timers.clear(idleTimer);
    idleTimer = null;
  }
}

function armIdle() {
  clearIdle();
  if (inflight > 0 || !deps.adapter.loaded()) return;
  idleTimer = deps.timers.set(() => {
    idleTimer = null;
    unload('idle').catch((e) => deps.logger?.warn?.(`idle unload failed: ${e.message}`));
  }, deps.idleUnloadMs);
  if (typeof idleTimer?.unref === 'function') idleTimer.unref();
}

function clearVisionIdle() {
  if (visionIdleTimer) {
    deps.timers.clear(visionIdleTimer);
    visionIdleTimer = null;
  }
}

function armVisionIdle() {
  clearVisionIdle();
  if (visionInflight > 0 || !deps.visionAdapter?.loaded()) return;
  visionIdleTimer = deps.timers.set(() => {
    visionIdleTimer = null;
    unloadVision('idle').catch((e) => deps.logger?.warn?.(`vision idle unload failed: ${e.message}`));
  }, deps.idleUnloadMs);
  if (typeof visionIdleTimer?.unref === 'function') visionIdleTimer.unref();
}

function onEngineEvent(evt) {
  if (evt.engine === 'llm-vision') {
    for (const a of visionPolicy.observe(evt)) {
      if (a.rule === 'P6') deps.logger?.warn?.(`built-in vision model marked unhealthy after ${a.consecutive} stalls; the OCR chain moves on this session`);
    }
    if (evt.kind === 'exit') {
      visionResident = null;
      clearVisionIdle();
    }
    return;
  }
  if (evt.engine !== 'llm') return;
  for (const a of policy.observe(evt)) {
    if (a.rule === 'P6') deps.logger?.warn?.(`built-in model marked unhealthy after ${a.consecutive} stalls; other sources take over this session`);
    else if (a.rule === 'P4' || a.rule === 'P9') deps.logger?.info?.(`built-in model ${a.advice}: ${a.tokPerSec} tok/s`);
  }
  if (evt.kind === 'ready') pruneTrialLogs({ dir: deps.logsDir, now: deps.now });
  if (evt.kind === 'exit') {
    resident = null;
    clearIdle();
  }
  if (trial && TRIAL_EVENT_KINDS.has(evt.kind)) {
    const { engine, host, at, ...rest } = evt;
    trial.write(rest);
  }
  if (evt.kind === 'exit') trial = null;
}

function init(d) {
  deps = {
    now: Date.now,
    timers: { set: setTimeout, clear: clearTimeout },
    idleUnloadMs: IDLE_UNLOAD_MS,
    visionAdapter: null,
    ...d,
  };
  if (!deps.packs) {
    const { modelDir } = require('../utils/model-root');
    deps.packs = createLlmPackManager({ dir: deps.modelsDir || modelDir(LLM_MODELS_DIR), allowUnlisted, logger: deps.logger, now: deps.now });
  }
  if (unsubscribe) unsubscribe();
  unsubscribe = deps.tengine ? deps.tengine.on(onEngineEvent) : null;
  pruneTrialLogs({ dir: deps.logsDir, now: deps.now });
  deps.packs.scan().catch((e) => deps.logger?.warn?.(`model folder scan failed: ${e.message}`));
}

async function resolveTarget({ packId = null, file = null } = {}) {
  if (!deps) throw fail('LLM_NOT_READY', 'model manager not initialised');
  if (!deps.packs.status()) await deps.packs.scan();
  if (file) {
    if (!allowUnlisted()) throw fail('LLM_MODEL_NOT_ALLOWED', 'unlisted models are off');
    const u = deps.packs.resolveUnlisted(file);
    if (!u) throw fail('LLM_MODEL_NOT_ALLOWED', `${path.basename(String(file))} is not in the model folder`);
    return u;
  }
  // No explicit choice: a folder file picked through the developer door wins.
  if (!packId) {
    const u = selectedUnlisted();
    const r = u ? deps.packs.resolveUnlisted(u.file) : null;
    if (r) return r;
  }
  // An explicit pack, else the settings choice, else the default pack —
  // whichever of those is actually installed.
  const wanted = packId || selectedPack()?.id || null;
  const r = (wanted && deps.packs.resolvePack(wanted)) || (!packId && deps.packs.resolveDefault()) || null;
  if (!r) throw fail('LLM_MODEL_MISSING', wanted ? `${wanted} is not installed` : 'no model installed');
  return r;
}

function loadOptions(target) {
  const pack = target.pack;
  return { nCtx: pack ? pack.ctx : 4096, nBatch: 512, template: pack ? pack.template : 'auto' };
}

function openTrial(target) {
  trial = target.trial
    ? createTrialLog({ dir: deps.logsDir, modelFile: path.basename(target.path), now: deps.now, isSecure, logText: trialText, logger: deps.logger })
    : null;
}

// Loads the selected model unless it is the one already resident on the
// requested provider. sel: { packId } for the whitelist, { file } for the
// developer door.
async function ensureLoaded(sel = {}, { onProgress = null } = {}) {
  const target = await resolveTarget(sel);
  const provider = deps.adapter.provider();
  const loaded = deps.adapter.loaded();
  if (loaded && resident && resident.path === target.path && resident.provider === provider) {
    return { info: loaded.info, target, reloaded: false };
  }
  openTrial(target);
  const info = await deps.adapter.load(target.path, loadOptions(target), { onProgress });
  resident = { path: target.path, provider };
  armIdle();
  return { info, target, reloaded: true };
}

// --- the vision slot ---

async function resolveVisionTarget() {
  if (!deps) throw fail('LLM_NOT_READY', 'model manager not initialised');
  if (!deps.visionAdapter) throw fail('LLM_VISION_UNAVAILABLE', 'vision engine not wired');
  if (!deps.packs.status()) await deps.packs.scan();
  const r = deps.packs.resolveVision();
  if (!r) throw fail('LLM_VISION_MISSING', 'no vision model installed');
  return r;
}

function visionLoadOptions(target) {
  const pack = target.pack;
  return {
    nCtx: pack ? pack.ctx : 4096,
    nBatch: 2048,
    template: 'auto',
    mmproj: target.mmproj,
    visionFamily: pack ? pack.visionFamily || null : null,
  };
}

async function ensureVisionLoaded() {
  const target = await resolveVisionTarget();
  const provider = deps.visionAdapter.provider();
  const loaded = deps.visionAdapter.loaded();
  if (loaded && visionResident && visionResident.path === target.path && visionResident.provider === provider) {
    return { info: loaded.info, target, reloaded: false };
  }
  const info = await deps.visionAdapter.load(target.path, visionLoadOptions(target));
  visionResident = { path: target.path, provider };
  armVisionIdle();
  return { info, target, reloaded: true };
}

// Reads an image (PNG / JPEG bytes) with the vision model: resolves with
// the text, per-line boxes and numbers. The bytes go to the host and
// nowhere else; nothing about them is logged.
async function recognize({ image, task = 'Spotting', maxTokens = null } = {}) {
  if (visionPolicy.state().unhealthy) throw fail('LLM_UNHEALTHY', 'built-in vision model stalled repeatedly this session');
  // GPU only (2026-09-14 decision): on the CPU the encoder takes seconds
  // and a screen-scaled capture blows the size cap anyway, so the engine
  // steps aside before a 1.7 GB pack is even loaded.
  if (!deps.visionAdapter) throw fail('LLM_VISION_UNAVAILABLE', 'vision engine not wired');
  if (deps.visionAdapter.provider() !== 'gpu') throw fail('LLM_VISION_NEEDS_GPU', 'the built-in vision model runs only with GPU acceleration on');
  await ensureVisionLoaded();
  visionInflight++;
  clearVisionIdle();
  const g = deps.visionAdapter.generate({ kind: 'ocr', image, task, ...(maxTokens ? { maxTokens } : {}) });
  const promise = g.promise.finally(() => {
    visionInflight--;
    armVisionIdle();
  });
  return { promise, cancel: g.cancel, reqId: g.reqId };
}

async function unloadVision(reason = 'manual') {
  clearVisionIdle();
  if (!deps.visionAdapter || !deps.visionAdapter.loaded()) {
    visionResident = null;
    return false;
  }
  await deps.visionAdapter.unload();
  visionResident = null;
  deps.logger?.info?.(`vision model unloaded (${reason})`);
  return true;
}

// Behind the GPU switch, like selfTest: the vision pack on the GPU reading
// the fixed image; with nothing installed the wish is recorded as pending.
async function visionSelfTest() {
  if (!deps.visionAdapter) return { ok: true, provider: 'cpu', fallback: null, pending: true };
  if (!deps.packs.status()) await deps.packs.scan();
  const target = deps.packs.resolveVision();
  if (!target) return { ok: true, provider: 'cpu', fallback: null, pending: true };
  const r = await deps.visionAdapter.health({ file: target.path, options: visionLoadOptions(target) });
  visionResident = { path: target.path, provider: deps.visionAdapter.provider() };
  armVisionIdle();
  return { ok: !!r.ok && r.provider === 'gpu' && !r.fallback, provider: r.provider === 'gpu' ? 'webgpu' : 'cpu', fallback: r.fallback || null, tokPerSec: r.tokPerSec ?? null, promptMs: r.promptMs ?? null };
}

function visionStatus() {
  const a = deps.visionAdapter;
  if (!a) return { available: false };
  const loaded = a.loaded();
  const row = deps.packs.status()?.packs.find((p) => p.role === LLM_ROLE_VISION) || null;
  return {
    available: true,
    pack: row ? { id: row.id, name: row.name, status: row.status, files: row.files || [] } : null,
    provider: a.provider(),
    // What the OCR chain and the settings card go by: pack ready and GPU on.
    usable: !!(row && row.status === 'ready' && a.provider() === 'gpu'),
    resident: loaded ? { file: path.basename(loaded.file), provider: loaded.provider, device: loaded.device ? loaded.device.name : null, fallback: loaded.fallback } : null,
    inflight: visionInflight,
    lastHealth: a.status().lastHealth,
    lastRequest: a.status().lastRequest,
    policy: visionPolicy.state(),
  };
}

// Streams visible text to onToken; resolves with the engine's result. The
// trial log gets the request's numbers (and text only with the switch).
async function generate({ packId = null, file = null, kind = 'generate', system = '', user = '', prompt, maxTokens = 256, sampler = {} } = {}, onToken = null) {
  // P6: after repeated stalls this session steps aside until the host is
  // restarted or a model is loaded afresh (both reset the policy).
  if (policy.state().unhealthy) throw fail('LLM_UNHEALTHY', 'built-in model stalled repeatedly this session');
  const { target } = await ensureLoaded({ packId, file });
  inflight++;
  clearIdle();
  const request = { kind, maxTokens, sampler, ...(prompt !== undefined ? { prompt } : { system, user }) };
  const g = deps.adapter.generate(request, onToken);
  const promise = g.promise
    .then((r) => {
      if (trial) {
        const { text, ...numbers } = r;
        trial.write({ kind: 'request', requestKind: kind, ...numbers, text: { system, user, prompt, output: text } });
      }
      return r;
    })
    .finally(() => {
      inflight--;
      armIdle();
    });
  return { promise, cancel: g.cancel, reqId: g.reqId, trial: target.trial };
}

async function unload(reason = 'manual') {
  clearIdle();
  if (!deps.adapter.loaded()) {
    resident = null;
    return false;
  }
  await deps.adapter.unload();
  resident = null;
  trial = null;
  deps.logger?.info?.(`model unloaded (${reason})`);
  return true;
}

// The five-step probe on a file in the folder but outside the whitelist.
// Its raw report goes to that file's trial log; the caller gets it too.
async function probe(fileName) {
  const target = await resolveTarget({ file: fileName });
  await unload('probe');
  const log = createTrialLog({ dir: deps.logsDir, modelFile: path.basename(target.path), now: deps.now, isSecure, logText: trialText, logger: deps.logger });
  const report = await deps.adapter.probe(target.path, { nCtx: 4096 });
  log.write({ kind: 'probe', verdict: report.verdict, steps: report.steps, meta: report.meta, budget: report.budget, generate: report.generate });
  return report;
}

// Behind the GPU switch. With no model installed there is nothing to test:
// the wish is recorded and the first load runs the real check.
async function selfTest() {
  if (!deps.packs.status()) await deps.packs.scan();
  const target = deps.packs.resolveDefault();
  if (!target) return { ok: true, provider: 'cpu', fallback: null, pending: true };
  openTrial(target);
  const r = await deps.adapter.health({ file: target.path, options: loadOptions(target) });
  resident = { path: target.path, provider: deps.adapter.provider() };
  armIdle();
  return { ok: !!r.ok && r.provider === 'gpu' && !r.fallback, provider: r.provider === 'gpu' ? 'webgpu' : 'cpu', fallback: r.fallback || null, tokPerSec: r.tokPerSec ?? null };
}

function trialReport(fileName) {
  const modelFile = path.basename(String(fileName || ''));
  const report = summarizeTrialLogs({ dir: deps.logsDir, modelFile });
  return report;
}

function status() {
  if (!deps) return { ready: false };
  const loaded = deps.adapter.loaded();
  return {
    ready: true,
    dir: deps.packs.dir(),
    packs: deps.packs.status(),
    selected: selected(),
    scanning: deps.packs.scanning(),
    allowUnlisted: allowUnlisted(),
    trialLogText: trialText(),
    provider: deps.adapter.provider(),
    resident: loaded ? { file: path.basename(loaded.file), provider: loaded.provider, device: loaded.device ? loaded.device.name : null, fallback: loaded.fallback, trial: !!trial } : null,
    inflight,
    runtime: deps.adapter.runtime(),
    lastHealth: deps.adapter.status().lastHealth,
    lastRequest: deps.adapter.status().lastRequest,
    policy: policy.state(),
    vision: visionStatus(),
  };
}

function reset() {
  clearIdle();
  clearVisionIdle();
  if (unsubscribe) unsubscribe();
  unsubscribe = null;
  deps = null;
  resident = null;
  trial = null;
  inflight = 0;
  policy = createLlmPolicy();
  visionResident = null;
  visionInflight = 0;
  visionPolicy = createLlmPolicy({ engine: 'llm-vision' });
}

module.exports = {
  init,
  ensureLoaded,
  generate,
  unload,
  probe,
  selfTest,
  trialReport,
  status,
  selected,
  recognize,
  unloadVision,
  visionSelfTest,
  visionStatus,
  rescan: () => deps.packs.scan(),
  dir: () => deps.packs.dir(),
  reset,
  IDLE_UNLOAD_MS,
  KEY_ALLOW_UNLISTED,
  KEY_TRIAL_TEXT,
  KEY_PACK,
  UNLISTED_PREFIX,
};
