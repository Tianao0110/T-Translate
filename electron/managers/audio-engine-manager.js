// Audio engine orchestration: owns the audio utilityProcess (ASR + neural
// TTS) and the status relay. The listen session is HOSTED by the floating
// window's listen mode — this manager owns no window lifecycle.
//
// Iron rules honored here: the worker dies with the listen session (zero idle
// footprint; a closing host window force-stops via a once-listener armed at
// session start), SECURE privacy mode refuses to start a session (its log
// records recognized text on disk), and a crashed engine restarts exactly
// once per session before giving up.
//
// TTS (v0.4.2) is the one relaxation of zero-idle: a spoken line needs the
// worker even with no session running, and a voice pack takes 1.3-2.2s to
// load, so a TTS-only process stays warm for TTS_IDLE_MS after the last
// utterance (longer while the floating window is on screen) and is then torn
// down. A listen session reuses whatever process is up; TTS loaded inside a
// session process lives as long as the session.

const path = require('path');
const fs = require('fs');
const { app, utilityProcess } = require('electron');
const { CHANNELS, PRIVACY_MODES } = require('../shared/channels');
const { locateAsrModels } = require('../utils/asr-models');
const { listVoicePacks } = require('../utils/tts-models');
const { modelDir, modelDirs } = require('../utils/model-root');
const logger = require('../utils/logger')('AudioEngine');

const READY_TIMEOUT_MS = 30000;
const STOP_GRACE_MS = 3000;
const TTS_IDLE_MS = 60000;
const TTS_UNLOAD_WAIT_MS = 5000;
// Rolling cap — one file per session, oldest pruned first. Filename prefix
// stays 'audio-probe-' so the accumulated tuning logs keep sorting together.
const MAX_PROBE_LOGS = 20;

let deps = null; // { store, getWindow }
let child = null;
let childState = 'idle'; // ASR session: idle | starting | running | stopping
let restartedOnce = false;
// Did THIS spawn ever reach asr-ready? A worker that dies before it does died
// loading the models, and loading them again will die the same way.
let engineEverReady = false;
let readyTimer = null;
let killTimer = null;
let privacyUnsub = null;
let sessionLanguage = ''; // SenseVoice hint from the host window ('' = auto)
// Which sound the session listens to: whole system (default), one program's
// process tree, or everything except it. Native capture lives in the worker
// (v0.4.1); the renderer no longer touches audio at all.
let sessionSource = { mode: 'system', pid: 0 };

// TTS state. ttsOnly: the process exists for TTS alone (no session ever
// started in it, or the session ended and TTS kept it alive).
let ttsOnly = false;
let ttsLoadedPack = '';
let ttsRequests = new Map(); // id -> { sender }
let ttsIdleTimer = null;
let ttsUnloadWaiters = [];
let spawnWaiters = []; // TTS callers waiting for a fresh process to say 'ready'
// stopSessionAndWait needs the process gone (pack swap); TTS must not keep it.
let exitRequested = false;
// Mute gate: webContents ids currently playing TTS (any engine, any window).
// The gate is on while the set is non-empty; the worker drops captured audio
// for that span (+ a short tail) so the app never transcribes its own voice.
const ttsPlayingSenders = new Set();

function init(d) {
  deps = d;
}

// Where a download lands. Reads go through findModels(), which also looks at
// the pre-v0.4.0 userData location (see model-root.js).
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
    modelsDir: modelsBaseDir(),      // where a new download lands
    activeDir: models?.baseDir || null, // where the live set actually sits
    secureBlocked: isSecure(),
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
  if (isSecure()) {
    sendStatus('secure-blocked');
    return;
  }
  // Zero-idle-footprint backstop: a closing host window must never leave the
  // engine humming. once() self-detaches; a stale listener firing after a
  // normal stop hits the idle guard in stopSession and is a no-op.
  hostWindow()?.once('closed', () => stopSession('window-closed'));
  // A TTS-only process was declared without ASR paths or a session log; a
  // session gets a fresh one and the voice reloads on the next utterance.
  if (child) discardWorker('listen-start');
  spawnWorker(models);

  // A mid-session switch to SECURE stops the probe (its log carries text).
  privacyUnsub = deps.store.onDidChange('privacyMode', (mode) => {
    if (mode === PRIVACY_MODES.SECURE) {
      logger.info('privacy switched to secure — stopping probe');
      stopSession('privacy');
      sendStatus('secure-blocked');
    }
  });
}

// Renderer-supplied, so it is narrowed to the three shapes the worker accepts
// rather than forwarded as-is.
// 'off' opens no audio client at all: the caller feeds PCM itself, which is
// how the smoke harness replays a wav through the real chain.
function normalizeSource(source) {
  const mode = source && ['system', 'include', 'exclude', 'off'].includes(source.mode) ? source.mode : 'system';
  const pid = Number.isInteger(source?.pid) && source.pid > 0 ? source.pid : 0;
  if (mode === 'off') return { mode: 'off', pid: 0 };
  return mode === 'system' || !pid ? { mode: 'system', pid: 0 } : { mode, pid };
}

function sessionLogPath() {
  const logsDir = path.join(app.getPath('userData'), 'logs');
  try {
    fs.mkdirSync(logsDir, { recursive: true });
  } catch {
    // appendable dir already exists in every normal run
  }
  // Timestamp-named files sort chronologically — prune oldest beyond the cap.
  try {
    const old = fs
      .readdirSync(logsDir)
      .filter((f) => f.startsWith('audio-probe-') && f.endsWith('.jsonl'))
      .sort();
    while (old.length >= MAX_PROBE_LOGS) {
      fs.unlinkSync(path.join(logsDir, old.shift()));
    }
  } catch {
    // pruning is best-effort — a full disk of logs still beats a dead session
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return path.join(logsDir, `audio-probe-${stamp}.jsonl`);
}

// models = null spawns a TTS-only process: no ASR paths, no session log, no
// ready timeout, and the ASR state machine stays idle.
function spawnWorker(models) {
  ttsOnly = !models;
  exitRequested = false;
  if (models) {
    childState = 'starting';
    engineEverReady = false;
    sendStatus('loading');
  }

  child = utilityProcess.fork(path.join(__dirname, '../services/audio-engine/audio-worker.js'), [], {
    serviceName: 't-translate-audio-engine',
    stdio: 'pipe',
  });
  child.stdout?.on('data', (d) => logger.debug(`worker: ${String(d).trim()}`));
  child.stderr?.on('data', (d) => logger.warn(`worker: ${String(d).trim()}`));

  child.on('message', onWorkerMessage);
  child.on('exit', onWorkerExit);

  if (models) {
    // Covers the whole init → asr-start → model-load chain (loading dominates).
    readyTimer = setTimeout(() => {
      logger.error('worker ready timeout');
      killWorker();
      sendStatus('engine-dead', 'ready-timeout');
    }, READY_TIMEOUT_MS);
  }

  child.postMessage({
    type: 'init',
    models: {
      asr: models
        ? {
            modelPath: models.modelPath,
            tokensPath: models.tokensPath,
            vadPath: models.vadPath,
            // optional two-pass draft engine (null when not manually placed)
            streaming: models.streaming,
            language: sessionLanguage,
          }
        : null,
    },
    logPath: models ? sessionLogPath() : null,
    // Recognized text stays out of the on-disk log by default — the session
    // log exists for tuning (segment lengths, gaps, RTF), and those are
    // metrics, not words. Developers chasing a bad transcription opt in.
    logText: process.env.TT_LISTEN_LOG_TEXT === '1',
    meta: {
      appVersion: app.getVersion(),
      electron: process.versions.electron,
      model: models ? models.modelName : 'tts-only',
      privacyMode: deps.store.get('privacyMode', PRIVACY_MODES.STANDARD),
    },
  });
  if (models) child.postMessage({ type: 'asr-start', language: sessionLanguage });
}

function onWorkerMessage(msg) {
  if (!msg || !msg.type) return;
  switch (msg.type) {
    case 'ready':
      // init acknowledged — nothing loaded yet; asr-ready is the real gate.
      // TTS callers only need the process to be talking.
      drainSpawnWaiters(child);
      break;
    case 'asr-ready':
      clearTimeout(readyTimer);
      childState = 'running';
      engineEverReady = true;
      logger.info(`worker ready in ${msg.loadMs}ms`);
      // A session started mid-utterance inherits the gate.
      if (ttsPlayingSenders.size > 0) child?.postMessage({ type: 'tts-gate', on: true });
      // Capture starts only now: an audio client opened while the models were
      // still loading would just fill a buffer nobody reads.
      if (sessionSource.mode === 'off') sendStatus('listening');
      else {
        sendStatus('connecting');
        child?.postMessage({ type: 'capture-start', ...sessionSource });
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
      // device-lost / device-reacquired / reacquire-failed — the native layer
      // rebuilds the stream itself; this only mirrors it into the UI.
      if (msg.kind === 'device-reacquired') sendStatus('listening');
      else if (msg.kind === 'device-lost' || msg.kind === 'reacquire-failed') sendStatus(msg.kind);
      else if (msg.kind === 'source-gone') {
        // The chosen program exited. Fall back to whole-system capture in
        // place so the session keeps running; the renderer resets its picker.
        sessionSource = { mode: 'system', pid: 0 };
        sendStatus('source-gone', msg.detail);
        child?.postMessage({ type: 'capture-start', ...sessionSource });
      }
      break;
    case 'level':
      sendToWindow(CHANNELS.AUDIO_ENGINE.LEVEL, msg.value);
      break;
    case 'segment':
      sendToWindow(CHANNELS.AUDIO_ENGINE.SEGMENT, msg.rec);
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
      // Session flushed. A warm voice (or an utterance in flight) keeps the
      // process as TTS-only; otherwise the zero-idle rule takes it down. Either
      // way the recognizer is unloaded first so the model files are released
      // now rather than whenever the process happens to die — the pack swap
      // behind stopSessionAndWait depends on that.
      clearTimeout(killTimer);
      if (child) {
        try {
          child.postMessage({ type: 'unload', what: 'asr' });
          if (keepForTts()) {
            childState = 'idle';
            ttsOnly = true;
            unsubscribePrivacy();
            sendStatus('stopped');
            armTtsIdle();
            break;
          }
          child.postMessage({ type: 'shutdown' });
        } catch {
          killWorker();
        }
      }
      break;
    case 'tts-ready':
      ttsLoadedPack = msg.packId;
      logger.info(`voice ${msg.packId} loaded in ${msg.loadMs}ms (${msg.numSpeakers} speakers, ${msg.sampleRate} Hz)`);
      break;
    case 'tts-unloaded':
      ttsLoadedPack = '';
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

function onWorkerExit(code) {
  clearTimeout(readyTimer);
  clearTimeout(killTimer);
  clearTimeout(ttsIdleTimer);
  const wasStopping = childState === 'stopping';
  const wasTtsOnly = ttsOnly;
  child = null;
  childState = 'idle';
  ttsOnly = false;
  exitRequested = false;
  ttsLoadedPack = '';
  failTtsRequests('engine-exited');
  drainTtsUnloadWaiters();
  drainSpawnWaiters(null);
  unsubscribePrivacy();
  logger.info(`worker exited (code ${code}, stopping=${wasStopping}, ttsOnly=${wasTtsOnly})`);
  drainExitWaiters();

  // No session was running in it: nothing to report on the status channel.
  if (wasTtsOnly) return;

  if (wasStopping) {
    sendStatus('stopped');
    return;
  }
  // Died before ever going ready = the models did not load. A hand-placed file
  // that is not really an ONNX model takes the worker down through a native
  // exception (exit 0xE06D7363) rather than the JS try/catch around the load,
  // so there is no 'fatal' message to go on — the state is the signal. Loading
  // the same file again would crash identically, so the one-shot restart is
  // reserved for engines that were actually running.
  if (!engineEverReady) {
    logger.error('worker died during model load — not retrying');
    sendStatus('model-load-failed');
    return;
  }
  // Unexpected death mid-session: one automatic restart, then give up.
  if (!restartedOnce && hostWindow()) {
    restartedOnce = true;
    sendStatus('engine-restarting');
    const models = findModels();
    if (models && !isSecure()) {
      spawnWorker(models);
      return;
    }
  }
  sendStatus('engine-dead');
}

// Inject PCM the host already has (the smoke harness replaying a wav through
// the real chain). Normal sessions never call this — the worker's own native
// capture feeds the VAD directly, and no renderer channel reaches either one.
function feedPcm(samples) {
  if (childState !== 'running' || !child) return;
  child.postMessage({ type: 'pcm', samples });
}

// Callers that must not touch the model files until the worker is really gone
// (pack install/removal) wait on these.
let exitWaiters = [];

function drainExitWaiters() {
  const waiters = exitWaiters;
  exitWaiters = [];
  for (const done of waiters) done();
}

/**
 * Stop and resolve only once the worker process has exited. A pack swap that
 * starts while the worker still has the .onnx files open fails on Windows —
 * and it would fail at the very end of a 150 MB download.
 */
function stopSessionAndWait(reason, timeoutMs = STOP_GRACE_MS + 2000) {
  if (!child) {
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
  if (!child) {
    childState = 'idle';
    return;
  }
  // 'idle' with a live child is a TTS-only process — no session to stop.
  if (childState === 'stopping' || childState === 'idle') return;
  logger.info(`stopping session (${reason})`);
  childState = 'stopping';
  try {
    child.postMessage({ type: 'asr-stop' });
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
  if (!child) return;
  try {
    child.postMessage({ type: 'unload', what: 'tts' });
    child.postMessage({ type: 'shutdown' });
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
  clearTimeout(readyTimer);
  clearTimeout(killTimer);
  if (child) {
    try {
      child.kill();
    } catch {
      // already gone
    }
  }
}

// Drop a process without going through onWorkerExit's session bookkeeping:
// used when a listen session replaces a TTS-only process.
function discardWorker(reason) {
  const old = child;
  if (!old) return;
  logger.info(`discarding tts-only worker (${reason})`);
  old.removeListener('message', onWorkerMessage);
  old.removeListener('exit', onWorkerExit);
  clearTimeout(ttsIdleTimer);
  child = null;
  ttsOnly = false;
  ttsLoadedPack = '';
  failTtsRequests('engine-replaced');
  drainTtsUnloadWaiters();
  drainSpawnWaiters(null);
  try {
    old.kill();
  } catch {
    // already gone
  }
}

function unsubscribePrivacy() {
  if (privacyUnsub) {
    privacyUnsub();
    privacyUnsub = null;
  }
}

// ===== TTS =====

function keepForTts() {
  return !exitRequested && (!!ttsLoadedPack || ttsRequests.size > 0);
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
    loaded: ttsLoadedPack,
    packsDir: modelDir('tts-models'),
  };
}

// Flat voice list for the picker: one entry per speaker id, numbered within
// its language+gender group so the renderer can label "中文女声 3" without
// knowing the pack layout. Names are the renderer's job (i18n).
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
  if (child) return Promise.resolve(child);
  spawnWorker(null);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('tts-worker-timeout')), READY_TIMEOUT_MS);
    spawnWaiters.push((proc) => {
      clearTimeout(timer);
      if (proc) resolve(proc);
      else reject(new Error('tts-worker-died'));
    });
  });
}

function drainSpawnWaiters(proc) {
  const waiters = spawnWaiters;
  spawnWaiters = [];
  for (const done of waiters) done(proc);
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

/**
 * Synthesize one utterance; the audio streams to `sender` on TTS_CHUNK as
 * {id, samples, sampleRate} messages followed by {id, done}. Resolves as soon
 * as the request is queued in the worker.
 */
async function ttsGenerate({ id, text, packId, sid, speed }, sender) {
  const pack = voicePacks().find((p) => p.id === packId);
  if (!pack) return { success: false, error: 'pack-not-installed' };
  if (!sender || sender.isDestroyed()) return { success: false, error: 'no-sender' };

  clearTimeout(ttsIdleTimer);
  ttsRequests.set(id, { sender });
  let worker;
  try {
    worker = await ensureTtsWorker();
  } catch (e) {
    ttsRequests.delete(id);
    return { success: false, error: e.message };
  }
  try {
    worker.postMessage({
      type: 'tts-generate',
      id,
      text,
      sid,
      speed,
      pack: { id: pack.id, engine: pack.engine, paths: pack.paths, speedScale: pack.speedScale },
    });
  } catch (e) {
    ttsRequests.delete(id);
    return { success: false, error: e.message };
  }
  return { success: true };
}

function ttsCancel(id) {
  if (!child || !ttsRequests.has(id)) return;
  try {
    child.postMessage({ type: 'tts-cancel', id });
  } catch {
    // process gone — exit handler fails the request
  }
}

// Mute gate, keyed by the reporting webContents so windows do not unmute
// each other. A destroyed window drops out via the on/off pairing its
// engine emits; a crashed one is cleaned up when it reports again or never.
function setTtsPlaying(senderId, on) {
  const before = ttsPlayingSenders.size > 0;
  if (on) ttsPlayingSenders.add(senderId);
  else ttsPlayingSenders.delete(senderId);
  const after = ttsPlayingSenders.size > 0;
  if (before === after) return;
  logger.debug(`tts gate ${after ? 'on' : 'off'}`);
  if (child && childState === 'running') {
    try {
      child.postMessage({ type: 'tts-gate', on: after });
    } catch {
      // process gone
    }
  }
  sendToWindow(CHANNELS.AUDIO_ENGINE.TTS_GATE, { on: after });
}

function armTtsIdle() {
  clearTimeout(ttsIdleTimer);
  if (!child || !ttsLoadedPack || ttsRequests.size > 0) return;
  ttsIdleTimer = setTimeout(onTtsIdle, TTS_IDLE_MS);
}

function onTtsIdle() {
  ttsIdleTimer = null;
  if (!child || ttsRequests.size > 0) return;
  // Inside a listen session the voice rides along until the session ends.
  if (childState !== 'idle') return;
  // Floating window on screen = the user is likely to ask for another line.
  const win = hostWindow();
  if (win && win.isVisible()) {
    armTtsIdle();
    return;
  }
  logger.info('tts idle — unloading voice and exiting');
  shutdownWorker();
}

/**
 * Release the voice pack files before a pack swap/removal. A TTS-only process
 * exits outright (the surest release); inside a listen session only the voice
 * is unloaded and the worker's ack is awaited.
 */
function unloadTtsAndWait(packId) {
  if (!child || (!ttsLoadedPack && ttsRequests.size === 0)) return Promise.resolve();
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
      child.postMessage({ type: 'unload', what: 'tts' });
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

module.exports = {
  init,
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
  unloadTtsAndWait,
};
