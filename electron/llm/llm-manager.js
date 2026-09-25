// The main-process side of the built-in model: where T-Engine's numbers
// turn into decisions (docs/T-ENGINE.md §7). Resolves which file the engine
// loads (the whitelist, or the developer door for a trial model), keeps one
// model resident and drops it after five idle minutes (P8), runs the GPU
// switch's self-test, and writes the trial log for a model outside the
// whitelist. Prompts and outputs pass through untouched and unrecorded
// unless the developer's text switch is on.
//
// The vision model (the built-in OCR engine) and the speech model (the
// listen chain's high-accuracy tier) are media slots, each with its own
// host, residency, idle timer and policy streaks, so they stay resident
// next to the text model and none waits for another.

const path = require('path');
const { PRIVACY_MODES } = require('../shared/channels');
const { LLM_MODELS_DIR, LLM_ROLE_VISION, LLM_ROLE_ASR, LLM_TEXT_ROLES, packById, defaultPack, roleForFileName } = require('../shared/llm-packs');
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

// Only a translation model can be the settings choice; anything else stored
// there falls back to the default pack.
function selectedPack() {
  const chosen = packById(deps.store.get(KEY_PACK, '') || '');
  return chosen && LLM_TEXT_ROLES.includes(chosen.role) ? chosen : defaultPack();
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

// --- media slots ---
//
// One role on its own host: which pack to load (resolve, given the
// adapter's provider), how (loadOptions), then residency, the idle timer,
// in-flight bookkeeping, the GPU self-test and the policy streaks.
function createMediaSlot({ engine, adapterKey, label, unavailable, missing, resolve, loadOptions }) {
  let slotResident = null; // { path, provider }
  let slotIdle = null;
  let slotInflight = 0;
  let slotPolicy = createLlmPolicy({ engine });
  const adapter = () => (deps ? deps[adapterKey] : null);

  function clearSlotIdle() {
    if (slotIdle) {
      deps.timers.clear(slotIdle);
      slotIdle = null;
    }
  }

  function armSlotIdle() {
    clearSlotIdle();
    if (slotInflight > 0 || !adapter()?.loaded()) return;
    slotIdle = deps.timers.set(() => {
      slotIdle = null;
      unloadSlot('idle').catch((e) => deps.logger?.warn?.(`${label} idle unload failed: ${e.message}`));
    }, deps.idleUnloadMs);
    if (typeof slotIdle?.unref === 'function') slotIdle.unref();
  }

  async function target() {
    if (!deps) throw fail('LLM_NOT_READY', 'model manager not initialised');
    if (!adapter()) throw fail(unavailable[0], unavailable[1]);
    if (!deps.packs.status()) await deps.packs.scan();
    const r = resolve(adapter().provider());
    if (!r) throw fail(missing[0], missing[1]);
    return r;
  }

  async function ensureSlotLoaded() {
    const t = await target();
    const a = adapter();
    const provider = a.provider();
    const loaded = a.loaded();
    if (loaded && slotResident && slotResident.path === t.path && slotResident.provider === provider) {
      return { info: loaded.info, target: t, reloaded: false };
    }
    const info = await a.load(t.path, loadOptions(t));
    slotResident = { path: t.path, provider };
    armSlotIdle();
    return { info, target: t, reloaded: true };
  }

  // One request on the slot's model, loading it first.
  async function run(request) {
    await ensureSlotLoaded();
    slotInflight++;
    clearSlotIdle();
    const g = adapter().generate(request);
    const promise = g.promise.finally(() => {
      slotInflight--;
      armSlotIdle();
    });
    return { promise, cancel: g.cancel, reqId: g.reqId };
  }

  async function unloadSlot(reason = 'manual') {
    clearSlotIdle();
    const a = adapter();
    if (!a || !a.loaded()) {
      slotResident = null;
      return false;
    }
    await a.unload();
    slotResident = null;
    deps.logger?.info?.(`${label} unloaded (${reason})`);
    return true;
  }

  // Behind the GPU switch: the pack the current provider would load, run
  // through the host's self-test; with nothing installed the wish is
  // recorded as pending.
  async function selfTest() {
    const a = adapter();
    if (!a) return { ok: true, provider: 'cpu', fallback: null, pending: true };
    if (!deps.packs.status()) await deps.packs.scan();
    const t = resolve(a.provider());
    if (!t) return { ok: true, provider: 'cpu', fallback: null, pending: true };
    const r = await a.health({ file: t.path, options: loadOptions(t) });
    slotResident = { path: t.path, provider: a.provider() };
    armSlotIdle();
    return { ok: !!r.ok && r.provider === 'gpu' && !r.fallback, provider: r.provider === 'gpu' ? 'webgpu' : 'cpu', fallback: r.fallback || null, tokPerSec: r.tokPerSec ?? null, promptMs: r.promptMs ?? null };
  }

  function observe(evt) {
    const actions = slotPolicy.observe(evt);
    if (evt.kind === 'exit') {
      slotResident = null;
      clearSlotIdle();
    }
    return actions;
  }

  // The live half of a slot's status; the caller adds its pack rows.
  function liveStatus() {
    const a = adapter();
    const loaded = a.loaded();
    return {
      provider: a.provider(),
      resident: loaded ? { file: path.basename(loaded.file), provider: loaded.provider, device: loaded.device ? loaded.device.name : null, fallback: loaded.fallback } : null,
      inflight: slotInflight,
      lastHealth: a.status().lastHealth,
      lastRequest: a.status().lastRequest,
      policy: slotPolicy.state(),
    };
  }

  function reset() {
    clearSlotIdle();
    slotResident = null;
    slotInflight = 0;
    slotPolicy = createLlmPolicy({ engine });
  }

  return { engine, adapter, ensureLoaded: ensureSlotLoaded, run, unload: unloadSlot, selfTest, observe, liveStatus, unhealthy: () => slotPolicy.state().unhealthy, reset };
}

// The vision slot: the image mmproj next to its model, GPU only.
const vision = createMediaSlot({
  engine: 'llm-vision',
  adapterKey: 'visionAdapter',
  label: 'vision model',
  unavailable: ['LLM_VISION_UNAVAILABLE', 'vision engine not wired'],
  missing: ['LLM_VISION_MISSING', 'no vision model installed'],
  resolve: () => deps.packs.resolveVision(),
  loadOptions: (target) => ({
    nCtx: target.pack ? target.pack.ctx : 4096,
    nBatch: 2048,
    template: 'auto',
    mmproj: target.mmproj,
    visionFamily: target.pack ? target.pack.visionFamily || null : null,
  }),
});

// The speech slot: the audio mmproj next to its model, on the GPU or the
// CPU, the larger pack on the GPU.
const asr = createMediaSlot({
  engine: 'llm-asr',
  adapterKey: 'asrAdapter',
  label: 'speech model',
  unavailable: ['LLM_ASR_UNAVAILABLE', 'speech engine not wired'],
  missing: ['LLM_ASR_MISSING', 'no speech model installed'],
  resolve: (provider) => deps.packs.resolveAsr({ preferLarger: provider === 'gpu' }),
  loadOptions: (target) => ({
    nCtx: target.pack ? target.pack.ctx : 2048,
    nBatch: 512,
    template: 'auto',
    mmproj: target.mmproj,
    media: 'audio',
    audioFamily: target.pack ? target.pack.audioFamily || null : null,
  }),
});

function onEngineEvent(evt) {
  if (evt.engine === 'llm-vision') {
    for (const a of vision.observe(evt)) {
      if (a.rule === 'P6') deps.logger?.warn?.(`built-in vision model marked unhealthy after ${a.consecutive} stalls; the OCR chain moves on this session`);
    }
    return;
  }
  if (evt.engine === 'llm-asr') {
    for (const a of asr.observe(evt)) {
      if (a.rule === 'P6') deps.logger?.warn?.(`built-in speech model marked unhealthy after ${a.consecutive} stalls; the listen chain moves on this session`);
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
    asrAdapter: null,
    ...d,
  };
  if (!deps.packs) {
    const { modelDir } = require('../packs/model-root');
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

// Reads an image (PNG / JPEG bytes) with the vision model: resolves with
// the text, per-line boxes and numbers. The bytes go to the host and
// nowhere else; nothing about them is logged.
async function recognize({ image, task = 'Spotting', maxTokens = null } = {}) {
  if (vision.unhealthy()) throw fail('LLM_UNHEALTHY', 'built-in vision model stalled repeatedly this session');
  // GPU only (docs/T-ENGINE.md §10): with the GPU off the engine steps
  // aside before the pack is loaded.
  if (!deps.visionAdapter) throw fail('LLM_VISION_UNAVAILABLE', 'vision engine not wired');
  if (deps.visionAdapter.provider() !== 'gpu') throw fail('LLM_VISION_NEEDS_GPU', 'the built-in vision model runs only with GPU acceleration on');
  return vision.run({ kind: 'ocr', image, task, ...(maxTokens ? { maxTokens } : {}) });
}

function visionStatus() {
  if (!deps.visionAdapter) return { available: false };
  const row = deps.packs.status()?.packs.find((p) => p.role === LLM_ROLE_VISION) || null;
  const live = vision.liveStatus();
  return {
    available: true,
    pack: row ? { id: row.id, name: row.name, status: row.status, files: row.files || [] } : null,
    // What the OCR chain and the settings card go by: pack ready and GPU on.
    usable: !!(row && row.status === 'ready' && live.provider === 'gpu'),
    ...live,
  };
}

// --- the speech slot ---

// Transcribes one segment (Float32Array, mono, 16 kHz): resolves with the
// transcript, its language and numbers. The audio goes to the host and
// nowhere else; nothing about it is logged.
async function transcribe({ pcm, maxTokens = null } = {}) {
  if (asr.unhealthy()) throw fail('LLM_UNHEALTHY', 'built-in speech model stalled repeatedly this session');
  return asr.run({ kind: 'asr', audio: pcm, ...(maxTokens ? { maxTokens } : {}) });
}

function asrStatus() {
  if (!deps.asrAdapter) return { available: false };
  const live = asr.liveStatus();
  const rows = (deps.packs.status()?.packs || []).filter((p) => p.role === LLM_ROLE_ASR);
  const next = deps.packs.resolveAsr({ preferLarger: live.provider === 'gpu' });
  return {
    available: true,
    packs: rows.map((r) => ({ id: r.id, name: r.name, status: r.status, files: r.files || [] })),
    // The pack the next load takes on the current provider.
    selected: next && next.pack ? next.pack.id : null,
    usable: !!next,
    ...live,
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
    asr: asrStatus(),
  };
}

function reset() {
  clearIdle();
  vision.reset();
  asr.reset();
  if (unsubscribe) unsubscribe();
  unsubscribe = null;
  deps = null;
  resident = null;
  trial = null;
  inflight = 0;
  policy = createLlmPolicy();
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
  unloadVision: (reason) => vision.unload(reason),
  visionSelfTest: () => vision.selfTest(),
  visionStatus,
  transcribe,
  ensureAsrLoaded: () => asr.ensureLoaded(),
  unloadAsr: (reason) => asr.unload(reason),
  asrSelfTest: () => asr.selfTest(),
  asrStatus,
  rescan: () => deps.packs.scan(),
  dir: () => deps.packs.dir(),
  reset,
  IDLE_UNLOAD_MS,
};
