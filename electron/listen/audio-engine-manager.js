// Listen session and neural voice on top of T-Engine's audio host
// (tengine/engines/audio.js), plus the status relay to the floating window.
// Process ownership, load timers, exit classification and the voice self-test
// are the adapter's; this file keeps session semantics (source, language,
// tier, one-shot restart, TTS-only idle). Rules and pitfalls:
// docs/design/listen.md §1 and §6.

const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const { CHANNELS, PRIVACY_MODES } = require('../shared/channels');
const { locateAsrModels } = require('./asr-models');
const { listVoicePacks } = require('../tts/tts-models');
const { modelDir, modelDirs } = require('../packs/model-root');
const { dataDir } = require('../platform/data-root');
const { createListenAutosave } = require('./listen-autosave');
const { createListenTranslator } = require('./listen-translator');
const tengine = require('../tengine');
const logger = require('../platform/logger')('AudioEngine');

const STOP_GRACE_MS = 3000;
const TTS_SPAWN_TIMEOUT_MS = 30000;
const TTS_IDLE_MS = 60000;
const TTS_UNLOAD_WAIT_MS = 5000;
// Session logs kept on disk, oldest pruned first.
const MAX_PROBE_LOGS = 3;

let deps = null; // { store, getWindow }
let audio = null; // T-Engine's audio host adapter
let unsubMessages = null;
let unsubEvents = null;
let childState = 'idle'; // ASR session: idle | starting | running | stopping
let restartedOnce = false;
let killTimer = null;
let privacyUnsub = null;
let sessionLanguage = ''; // SenseVoice hint from the host window ('' = auto)
// Which sound the session listens to: whole system, one program's process
// tree, or everything except it.
let sessionSource = { mode: 'system', pid: 0 };

// TTS state. ttsOnly: the process exists for TTS alone (no session ever
// started in it, or the session ended and TTS kept it alive).
let ttsOnly = false;
let ttsRequests = new Map(); // id -> { sender }
let ttsIdleTimer = null;
let ttsUnloadWaiters = [];
let spawnWaiters = []; // TTS callers waiting for a fresh process to say 'ready'
// stopSessionAndWait needs the process gone (pack swap); TTS must not keep it.
let exitRequested = false;
// Mute gate: webContents ids currently playing TTS; on while non-empty.
const ttsPlayingSenders = new Set();
// Translation + transcript of the running session (listen-translator.js);
// the stack call is wired in by the IPC layer once the stack exists.
let translator = null;
let translateStreamHook = null;
let autosaveStore = null;

function adapter() {
  return (audio ||= tengine.get().get('audio'));
}

function init(d) {
  deps = d;
  const a = adapter();
  // The smoke harness re-inits with other deps; never stack subscriptions.
  if (unsubMessages) unsubMessages();
  if (unsubEvents) unsubEvents();
  unsubMessages = a.subscribe(onWorkerMessage);
  unsubEvents = tengine.get().on(onEngineEvent);
  // The GPU switch persists in the store; the worker reads it at spawn.
  a.setProvider(d.store?.get?.('settings.gpu.enabled') === true ? 'webgpu' : 'cpu');
  autosaveStore = createListenAutosave({ dir: dataDir('listen') });
  translator = createListenTranslator({
    translateStream: (...args) => translateStreamHook(...args),
    enabled: () => !!translateStreamHook,
    uiLang: () => (deps.store.get('settings.interface.language') === 'en' ? 'en' : 'zh'),
    // Secure mode writes nothing; the user's switch is honoured here.
    autosave: async (content, sourceName) => {
      if (isSecure()) return null;
      if (deps.store.get('settings.listen.autosave', true) === false) return null;
      const filePath = autosaveStore.save(content, sourceName);
      logger.info(`subtitles saved: ${filePath}`);
      return filePath;
    },
    emit: (kind, payload) => sendToWindow(kind === 'translation' ? CHANNELS.AUDIO_ENGINE.TRANSLATION : CHANNELS.AUDIO_ENGINE.AUTOSAVED, payload),
    logger,
  });
}

// The IPC layer owns the translation stack; it hands the main-process
// stream call in once both exist.
function configureTranslation({ translateStream } = {}) {
  translateStreamHook = typeof translateStream === 'function' ? translateStream : null;
}

function setTargetLang(lang) {
  translator?.setTarget(lang);
}

function listenDir() {
  return autosaveStore ? autosaveStore.dir : dataDir('listen');
}

// The session's transcript is filed when the session ends, however it
// ends; the translator ignores a second call.
function endTranscript(reason) {
  translator?.endSession(reason).catch((e) => logger.warn(`transcript end failed: ${e.message}`));
}

// Where a download lands; reads go through findModels() over every root.
function modelsBaseDir() {
  return modelDir('asr-models');
}

// First root that holds a complete model set wins.
function findModels() {
  for (const dir of modelDirs('asr-models')) {
    const found = locateAsrModels(dir);
    if (found) return found;
  }
  return null;
}

function isAvailable() {
  return findModels() !== null;
}

function isSecure() {
  return deps.store.get('privacyMode', PRIVACY_MODES.STANDARD) === PRIVACY_MODES.SECURE;
}

function hostWindow() {
  const win = deps.getWindow?.();
  return win && !win.isDestroyed() ? win : null;
}

function sendToWindow(channel, payload) {
  const win = hostWindow();
  if (win) win.webContents.send(channel, payload);
}

function sendStatus(state, detail) {
  logger.debug(`status: ${state}${detail ? ` (${detail})` : ''}`);
  sendToWindow(CHANNELS.AUDIO_ENGINE.STATUS, { state, detail });
}

function getInfo() {
  const models = findModels();
  return {
    modelName: models ? models.modelName : null,
    streamingPresent: !!models?.streaming,
    hqPresent: !!models?.hq,
    modelsDir: modelsBaseDir(),      // where a new download lands
    activeDir: models?.baseDir || null, // where the live set actually sits
    secureBlocked: false, // kept for the renderer's shape
    running: childState === 'running' || childState === 'starting',
  };
}

function startSession(options = {}) {
  if (childState !== 'idle') {
    logger.warn(`start ignored in state ${childState}`);
    return;
  }
  // Each user-initiated session gets its own one-shot crash restart.
  restartedOnce = false;
  sessionLanguage = typeof options.language === 'string' ? options.language : '';
  sessionSource = normalizeSource(options.source);
  const models = findModels();
  if (!models) {
    sendStatus('no-model');
    return;
  }
  // A closing host window force-stops the session (stale firings are no-ops).
  hostWindow()?.once('closed', () => stopSession('window-closed'));
  // A TTS-only process has no ASR paths: a session gets a fresh one.
  if (adapter().running()) discardWorker('listen-start');
  translator?.beginSession({ targetLang: options.targetLang, sourceName: options.source?.name });
  spawnWorker(models);

  // A mid-session switch to SECURE keeps the session but closes its log.
  privacyUnsub = deps.store.onDidChange('privacyMode', (mode) => {
    if (mode === PRIVACY_MODES.SECURE && adapter().running()) {
      logger.info('privacy switched to secure — closing the session log');
      try {
        adapter().post({ type: 'log-close' });
      } catch {
        // process gone
      }
    }
  });
}

// Narrows the renderer-supplied source to the shapes the worker accepts;
// 'off' opens no audio client (the caller feeds PCM itself).
function normalizeSource(source) {
  const mode = source && ['system', 'include', 'exclude', 'off'].includes(source.mode) ? source.mode : 'system';
  const pid = Number.isInteger(source?.pid) && source.pid > 0 ? source.pid : 0;
  if (mode === 'off') return { mode: 'off', pid: 0 };
  return mode === 'system' || !pid ? { mode: 'system', pid: 0 } : { mode, pid };
}

function sessionLogPath() {
  const logsDir = dataDir('logs');
  try {
    fs.mkdirSync(logsDir, { recursive: true });
  } catch {
    // appendable dir already exists in every normal run
  }
  // Timestamp-named files sort chronologically: prune the oldest past the cap.
  try {
    const old = fs
      .readdirSync(logsDir)
      .filter((f) => f.startsWith('audio-probe-') && f.endsWith('.jsonl'))
      .sort();
    while (old.length >= MAX_PROBE_LOGS) {
      fs.unlinkSync(path.join(logsDir, old.shift()));
    }
  } catch {
    // pruning is best-effort
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return path.join(logsDir, `audio-probe-${stamp}.jsonl`);
}

// The worker's init message; models = null describes a TTS-only process.
function initPayload(models) {
  return {
    models: {
      asr: models
        ? {
            modelPath: models.modelPath,
            tokensPath: models.tokensPath,
            vadPath: models.vadPath,
            streaming: models.streaming, // optional draft engine
            hq: models.hq, // optional high-accuracy engine, used only when the tier says so

            useHq: !!models.hq && deps.store.get('settings.listen.tier') === 'high',
            language: sessionLanguage,
          }
        : null,
    },
    // Secure mode writes no session log at all; text only by opt-in.
    logPath: models && !isSecure() ? sessionLogPath() : null,
    logText: !isSecure() && process.env.TT_LISTEN_LOG_TEXT === '1',
    meta: {
      appVersion: app.getVersion(),
      electron: process.versions.electron,
      model: models ? models.modelName : 'tts-only',
      privacyMode: deps.store.get('privacyMode', PRIVACY_MODES.STANDARD),
    },
  };
}

// models = null spawns a TTS-only process; the ASR state machine stays idle.
function spawnWorker(models) {
  ttsOnly = !models;
  exitRequested = false;
  if (models) {
    childState = 'starting';
    sendStatus('loading');
  }
  adapter()
    .spawn({ init: initPayload(models) })
    .catch((e) => logger.error(`worker spawn failed: ${e.message}`));
  // The adapter's load timer turns a silent load into an engine-dead verdict.
  if (models) adapter().startAsr(sessionLanguage);
}

// Engine-level verdicts from T-Engine; the session policy answers them here.
function onEngineEvent(evt) {
  if (evt.engine !== 'audio') return;
  if (evt.kind === 'exit') onWorkerExit(evt);
  else if (evt.kind === 'timeout' && evt.phase === 'model-load') sendStatus('engine-dead', 'ready-timeout');
}

function onWorkerMessage(msg) {
  if (!msg || !msg.type) return;
  switch (msg.type) {
    case 'ready':
      // init acknowledged; asr-ready is the real gate for sessions.
      drainSpawnWaiters(true);
      break;
    case 'asr-ready':
      childState = 'running';
      logger.info(`worker ready in ${msg.loadMs}ms`);
      // A session started mid-utterance inherits the gate.
      if (ttsPlayingSenders.size > 0) adapter().post({ type: 'tts-gate', on: true });
      // Capture starts only after the models are loaded.
      if (sessionSource.mode === 'off') sendStatus('listening');
      else {
        sendStatus('connecting');
        adapter().post({ type: 'capture-start', ...sessionSource });
      }
      break;
    case 'capture-started':
      logger.info(`capture started (${msg.mode})`);
      sendStatus('listening');
      break;
    case 'capture-error':
      logger.error(`capture failed: ${msg.message}`);
      sendStatus('capture-error', msg.message);
      stopSession('capture-error');
      break;
    case 'capture-event':
      // The native layer rebuilds the stream itself; this mirrors it into the UI.
      if (msg.kind === 'device-reacquired') sendStatus('listening');
      else if (msg.kind === 'device-lost' || msg.kind === 'reacquire-failed') sendStatus(msg.kind);
      else if (msg.kind === 'source-gone') {
        // The chosen program exited: fall back to whole-system capture in place.
        sessionSource = { mode: 'system', pid: 0 };
        sendStatus('source-gone', msg.detail);
        adapter().post({ type: 'capture-start', ...sessionSource });
      }
      break;
    case 'level':
      sendToWindow(CHANNELS.AUDIO_ENGINE.LEVEL, msg.value);
      break;
    case 'segment':
      // The translator numbers the final; the translation follows on its own channel.
      sendToWindow(CHANNELS.AUDIO_ENGINE.SEGMENT, translator ? translator.onSegment(msg.rec) : msg.rec);
      break;
    case 'partial':
      sendToWindow(CHANNELS.AUDIO_ENGINE.PARTIAL, msg.text);
      break;
    case 'hint':
      sendStatus(msg.kind ? `hint-${msg.kind}` : 'listening');
      break;
    case 'metrics':
      sendToWindow(CHANNELS.AUDIO_ENGINE.STATUS, { state: 'metrics', detail: msg.rec });
      break;
    case 'asr-stopped':
      // Session flushed: release the recognizer now, then keep the process
      // for TTS or take it down.
      clearTimeout(killTimer);
      endTranscript('stopped');
      if (adapter().running()) {
        try {
          adapter().post({ type: 'unload', what: 'asr' });
          if (keepForTts()) {
            childState = 'idle';
            ttsOnly = true;
            unsubscribePrivacy();
            sendStatus('stopped');
            armTtsIdle();
            break;
          }
          adapter().expectExit();
          adapter().post({ type: 'shutdown' });
        } catch {
          killWorker();
        }
      }
      break;
    case 'tts-ready':
      logger.info(`voice ${msg.packId} loaded in ${msg.loadMs}ms (${msg.numSpeakers} speakers, ${msg.sampleRate} Hz, ${adapter().provider()})`);
      break;
    case 'tts-unloaded':
      drainTtsUnloadWaiters();
      break;
    case 'tts-chunk':
      sendTts(msg.id, { id: msg.id, samples: msg.samples, sampleRate: msg.sampleRate, progress: msg.progress });
      break;
    case 'tts-done':
      sendTts(msg.id, { id: msg.id, done: true, cancelled: !!msg.cancelled });
      ttsRequests.delete(msg.id);
      armTtsIdle();
      break;
    case 'tts-error':
      if (msg.id) {
        logger.warn(`tts ${msg.id} failed: ${msg.message}`);
        sendTts(msg.id, { id: msg.id, error: msg.message });
        ttsRequests.delete(msg.id);
        armTtsIdle();
      } else {
        // A load failure (no request id); the adapter already told the awaiter.
        logger.error(`voice ${msg.packId || '?'} load failed: ${msg.message}`);
      }
      break;
    case 'fatal':
      logger.error(`worker fatal: ${msg.message}`);
      break;
    default:
      break;
  }
}

function onWorkerExit({ code, everReady }) {
  clearTimeout(killTimer);
  clearTimeout(ttsIdleTimer);
  const wasStopping = childState === 'stopping';
  const wasTtsOnly = ttsOnly;
  childState = 'idle';
  ttsOnly = false;
  exitRequested = false;
  failTtsRequests('engine-exited');
  drainTtsUnloadWaiters();
  drainSpawnWaiters(false);
  unsubscribePrivacy();
  logger.info(`worker exited (code ${code}, stopping=${wasStopping}, ttsOnly=${wasTtsOnly})`);
  drainExitWaiters();

  // No session was running in it: nothing to report.
  if (wasTtsOnly) return;

  endTranscript(wasStopping ? 'stopped' : 'engine-exited');
  if (wasStopping) {
    sendStatus('stopped');
    return;
  }
  // Died before ever going ready: the models did not load, no retry.
  if (!everReady) {
    logger.error('worker died during model load — not retrying');
    sendStatus('model-load-failed');
    return;
  }
  // Unexpected death mid-session: one automatic restart, then give up.
  if (!restartedOnce && hostWindow()) {
    restartedOnce = true;
    sendStatus('engine-restarting');
    const models = findModels();
    if (models) {
      spawnWorker(models);
      return;
    }
  }
  sendStatus('engine-dead');
}

// Inject PCM the host already has (smoke / bench replaying a wav).
function feedPcm(samples) {
  if (childState !== 'running' || !adapter().running()) return;
  adapter().post({ type: 'pcm', samples });
}

// Pack install / removal waits here until the worker is really gone.
let exitWaiters = [];

function drainExitWaiters() {
  const waiters = exitWaiters;
  exitWaiters = [];
  for (const done of waiters) done();
}

// Stops and resolves only once the worker process has exited (pack swaps
// need the model files closed).
function stopSessionAndWait(reason, timeoutMs = STOP_GRACE_MS + 2000) {
  if (!adapter().running()) {
    stopSession(reason);
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      logger.warn('worker did not exit in time — killing before pack swap');
      killWorker();
      resolve();
    }, timeoutMs);
    exitWaiters.push(() => {
      clearTimeout(timer);
      resolve();
    });
    exitRequested = true;
    if (childState === 'idle') {
      // TTS-only process: nothing to flush, just take it down.
      shutdownWorker();
      return;
    }
    stopSession(reason);
  });
}

function stopSession(reason) {
  unsubscribePrivacy();
  if (!adapter().running()) {
    childState = 'idle';
    return;
  }
  // 'idle' with a live child is a TTS-only process: no session to stop.
  if (childState === 'stopping' || childState === 'idle') return;
  logger.info(`stopping session (${reason})`);
  childState = 'stopping';
  try {
    adapter().stopAsr();
    adapter().post({ type: 'asr-stop' });
  } catch {
    killWorker();
    return;
  }
  killTimer = setTimeout(() => {
    logger.warn('worker stop grace expired — killing');
    killWorker();
  }, STOP_GRACE_MS);
}

function shutdownWorker() {
  if (!adapter().running()) return;
  try {
    adapter().post({ type: 'unload', what: 'tts' });
    adapter().expectExit();
    adapter().post({ type: 'shutdown' });
  } catch {
    killWorker();
    return;
  }
  killTimer = setTimeout(() => {
    logger.warn('worker shutdown grace expired — killing');
    killWorker();
  }, STOP_GRACE_MS);
}

function killWorker() {
  clearTimeout(killTimer);
  adapter().kill();
}

// Drops a TTS-only process without onWorkerExit's session bookkeeping.
function discardWorker(reason) {
  if (!adapter().running()) return;
  logger.info(`discarding tts-only worker (${reason})`);
  clearTimeout(ttsIdleTimer);
  ttsOnly = false;
  failTtsRequests('engine-replaced');
  drainTtsUnloadWaiters();
  drainSpawnWaiters(false);
  adapter().discard(reason);
}

function unsubscribePrivacy() {
  if (privacyUnsub) {
    privacyUnsub();
    privacyUnsub = null;
  }
}

// ===== TTS =====

function keepForTts() {
  return !exitRequested && (!!adapter().ttsLoadedPack() || ttsRequests.size > 0);
}

function voicePacks() {
  return listVoicePacks(modelDirs('tts-models'));
}

function packSummary(pack) {
  return {
    id: pack.id,
    version: pack.version,
    model: pack.model,
    engine: pack.engine,
    sampleRate: pack.sampleRate,
    languages: pack.languages,
    voiceGroups: pack.voiceGroups,
    featured: pack.featured,
    preferMixed: pack.preferMixed,
  };
}

function getTtsStatus() {
  const packs = voicePacks();
  return {
    available: packs.length > 0,
    packs: packs.map(packSummary),
    loaded: adapter().ttsLoadedPack(),
    packsDir: modelDir('tts-models'),
    provider: adapter().provider(),
    providerNote: adapter().providerNote(),
  };
}

// Flat voice list for the picker: one entry per speaker id, numbered within
// its language+gender group. Names are the renderer's job (i18n).
function getTtsVoices() {
  const voices = [];
  for (const pack of voicePacks()) {
    const counters = new Map();
    for (const group of pack.voiceGroups) {
      const from = Number.isInteger(group.from) ? group.from : 0;
      const to = Number.isInteger(group.to) ? group.to : from;
      for (let sid = from; sid <= to; sid++) {
        const key = `${group.lang}:${group.gender}`;
        const n = (counters.get(key) || 0) + 1;
        counters.set(key, n);
        voices.push({
          id: `${pack.id}:${sid}`,
          packId: pack.id,
          engine: pack.engine,
          sid,
          lang: group.lang || pack.languages[0] || '',
          gender: group.gender || '',
          n,
          featured: pack.featured.includes(sid),
          preferMixed: pack.preferMixed,
          languages: pack.languages,
        });
      }
    }
  }
  return voices;
}

function ensureTtsWorker() {
  if (adapter().running()) return Promise.resolve(true);
  spawnWorker(null);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('tts-worker-timeout')), TTS_SPAWN_TIMEOUT_MS);
    spawnWaiters.push((ok) => {
      clearTimeout(timer);
      if (ok) resolve(true);
      else reject(new Error('tts-worker-died'));
    });
  });
}

function drainSpawnWaiters(ok) {
  const waiters = spawnWaiters;
  spawnWaiters = [];
  for (const done of waiters) done(ok);
}

function sendTts(id, payload) {
  const req = ttsRequests.get(id);
  if (!req) return;
  try {
    if (!req.sender.isDestroyed()) req.sender.send(CHANNELS.AUDIO_ENGINE.TTS_CHUNK, payload);
  } catch {
    // window went away mid-utterance
  }
}

function failTtsRequests(message) {
  for (const id of [...ttsRequests.keys()]) {
    sendTts(id, { id, error: message });
  }
  ttsRequests.clear();
}

// Synthesizes one utterance; audio streams to `sender` on TTS_CHUNK as
// {id, samples, sampleRate} then {id, done}. Resolves once queued in the worker.
async function ttsGenerate({ id, text, packId, sid, speed }, sender) {
  const pack = voicePacks().find((p) => p.id === packId);
  if (!pack) return { success: false, error: 'pack-not-installed' };
  if (!sender || sender.isDestroyed()) return { success: false, error: 'no-sender' };

  clearTimeout(ttsIdleTimer);
  ttsRequests.set(id, { sender });
  try {
    await ensureTtsWorker();
  } catch (e) {
    ttsRequests.delete(id);
    return { success: false, error: e.message };
  }
  try {
    adapter().post({
      type: 'tts-generate',
      id,
      text,
      sid,
      speed,
      pack: ttsPackPayload(pack),
    });
  } catch (e) {
    ttsRequests.delete(id);
    return { success: false, error: e.message };
  }
  return { success: true };
}

// What the worker needs to load a voice, plus one warm-up line per language.
function ttsPackPayload(pack) {
  const warmup = [];
  for (const lang of pack.languages || []) {
    const group = (pack.voiceGroups || []).find((g) => g.lang === lang);
    const text = lang === 'zh' ? '好。' : 'Hi.';
    warmup.push({ sid: group && Number.isInteger(group.from) ? group.from : 0, text });
  }
  return { id: pack.id, engine: pack.engine, paths: pack.paths, speedScale: pack.speedScale, warmup };
}

function ttsCancel(id) {
  if (!adapter().running() || !ttsRequests.has(id)) return;
  try {
    adapter().post({ type: 'tts-cancel', id });
  } catch {
    // process gone — exit handler fails the request
  }
}

// Mute gate, keyed by the reporting webContents so windows do not unmute each other.
function setTtsPlaying(senderId, on) {
  const before = ttsPlayingSenders.size > 0;
  if (on) ttsPlayingSenders.add(senderId);
  else ttsPlayingSenders.delete(senderId);
  const after = ttsPlayingSenders.size > 0;
  if (before === after) return;
  logger.debug(`tts gate ${after ? 'on' : 'off'}`);
  if (adapter().running() && childState === 'running') {
    try {
      adapter().post({ type: 'tts-gate', on: after });
    } catch {
      // process gone
    }
  }
  sendToWindow(CHANNELS.AUDIO_ENGINE.TTS_GATE, { on: after });
}

function armTtsIdle() {
  clearTimeout(ttsIdleTimer);
  if (!adapter().running() || !adapter().ttsLoadedPack() || ttsRequests.size > 0) return;
  ttsIdleTimer = setTimeout(onTtsIdle, TTS_IDLE_MS);
}

function onTtsIdle() {
  ttsIdleTimer = null;
  if (!adapter().running() || ttsRequests.size > 0) return;
  // Inside a listen session the voice rides along; on screen, keep it warm.
  if (childState !== 'idle') return;
  const win = hostWindow();
  if (win && win.isVisible()) {
    armTtsIdle();
    return;
  }
  logger.info('tts idle — unloading voice and exiting');
  shutdownWorker();
}

// Releases the voice pack files before a pack swap / removal: a TTS-only
// process exits, inside a session only the voice is unloaded and acked.
function unloadTtsAndWait(packId) {
  if (!adapter().running() || (!adapter().ttsLoadedPack() && ttsRequests.size === 0)) return Promise.resolve();
  logger.info(`releasing voice before pack swap (${packId})`);
  clearTimeout(ttsIdleTimer);
  if (childState === 'idle') {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        killWorker();
        resolve();
      }, TTS_UNLOAD_WAIT_MS);
      exitWaiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
      exitRequested = true;
      shutdownWorker();
    });
  }
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, TTS_UNLOAD_WAIT_MS);
    ttsUnloadWaiters.push(() => {
      clearTimeout(timer);
      resolve();
    });
    try {
      adapter().post({ type: 'unload', what: 'tts' });
    } catch {
      drainTtsUnloadWaiters();
    }
  });
}

function drainTtsUnloadWaiters() {
  const waiters = ttsUnloadWaiters;
  ttsUnloadWaiters = [];
  for (const done of waiters) done();
}

// 'cpu' | 'webgpu'; the worker rebuilds the voice on the next request.
function setTtsProvider(provider) {
  adapter().setProvider(provider);
}

// Loads a voice on the current provider and reports the adapter's verdict;
// the GPU switch turns on only without a fallback note.
async function ttsSelfTest() {
  const packs = voicePacks();
  if (!packs.length) return { ok: false, provider: adapter().provider(), fallback: null, error: 'no-pack' };
  const pack = packs.find((p) => p.engine === 'kokoro') || packs[0];
  clearTimeout(ttsIdleTimer);
  try {
    await ensureTtsWorker();
    return await adapter().health({ pack: ttsPackPayload(pack) });
  } catch (e) {
    return { ok: false, provider: adapter().provider(), fallback: adapter().providerNote(), error: e.message, packId: pack.id };
  } finally {
    armTtsIdle();
  }
}

module.exports = {
  init,
  configureTranslation,
  setTargetLang,
  listenDir,
  isAvailable,
  getInfo,
  startSession,
  stopSession,
  stopSessionAndWait,
  feedPcm,
  getTtsStatus,
  getTtsVoices,
  ttsGenerate,
  ttsCancel,
  setTtsPlaying,
  setTtsProvider,
  ttsSelfTest,
  unloadTtsAndWait,
};
