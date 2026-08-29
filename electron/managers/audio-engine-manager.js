// Audio engine orchestration: owns the ASR utilityProcess and status relay.
// The session is HOSTED by the floating window's listen mode (the standalone
// probe window is gone) — this manager no longer owns any window lifecycle.
//
// Iron rules honored here: the worker dies with the session (zero idle
// footprint; a closing host window force-stops via a once-listener armed at
// session start), SECURE privacy mode refuses to start (the session log
// records recognized text on disk), and a crashed engine restarts exactly
// once per session before giving up.

const path = require('path');
const fs = require('fs');
const { app, utilityProcess } = require('electron');
const { CHANNELS, PRIVACY_MODES } = require('../shared/channels');
const { locateAsrModels } = require('../utils/asr-models');
const { modelDir, modelDirs } = require('../utils/model-root');
const logger = require('../utils/logger')('AudioEngine');

const READY_TIMEOUT_MS = 30000;
const STOP_GRACE_MS = 3000;
// Rolling cap — one file per session, oldest pruned first. Filename prefix
// stays 'audio-probe-' so the accumulated tuning logs keep sorting together.
const MAX_PROBE_LOGS = 20;

let deps = null; // { store, getWindow }
let child = null;
let childState = 'idle'; // idle | starting | running | stopping
let restartedOnce = false;
let readyTimer = null;
let killTimer = null;
let privacyUnsub = null;
let sessionLanguage = ''; // SenseVoice hint from the host window ('' = auto)

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

function spawnWorker(models) {
  childState = 'starting';
  sendStatus('loading');

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
  const logPath = path.join(logsDir, `audio-probe-${stamp}.jsonl`);

  child = utilityProcess.fork(path.join(__dirname, '../services/audio-engine/audio-worker.js'), [], {
    serviceName: 't-translate-audio-engine',
    stdio: 'pipe',
  });
  child.stdout?.on('data', (d) => logger.debug(`worker: ${String(d).trim()}`));
  child.stderr?.on('data', (d) => logger.warn(`worker: ${String(d).trim()}`));

  child.on('message', onWorkerMessage);
  child.on('exit', onWorkerExit);

  // Covers the whole init → asr-start → model-load chain (loading dominates).
  readyTimer = setTimeout(() => {
    logger.error('worker ready timeout');
    killWorker();
    sendStatus('engine-dead', 'ready-timeout');
  }, READY_TIMEOUT_MS);

  child.postMessage({
    type: 'init',
    models: {
      asr: {
        modelPath: models.modelPath,
        tokensPath: models.tokensPath,
        vadPath: models.vadPath,
        // optional two-pass draft engine (null when not manually placed)
        streaming: models.streaming,
        language: sessionLanguage,
      },
    },
    logPath,
    meta: {
      appVersion: app.getVersion(),
      electron: process.versions.electron,
      model: models.modelName,
      privacyMode: deps.store.get('privacyMode', PRIVACY_MODES.STANDARD),
    },
  });
  child.postMessage({ type: 'asr-start', language: sessionLanguage });
}

function onWorkerMessage(msg) {
  if (!msg || !msg.type) return;
  switch (msg.type) {
    case 'ready':
      // init acknowledged — nothing loaded yet; asr-ready is the real gate.
      break;
    case 'asr-ready':
      clearTimeout(readyTimer);
      childState = 'running';
      logger.info(`worker ready in ${msg.loadMs}ms`);
      sendStatus('listening');
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
      // Session flushed; the probe has no reason to keep an idle engine warm
      // (zero-idle-footprint rule) — take the process down. 'exit' handler
      // finishes cleanup; the kill grace timer is already armed.
      if (child) {
        try {
          // unload first: drops the recognizer/VAD/draft refs inside the
          // worker so the model files are released before exit rather than
          // whenever the process happens to die. Matters for the pack swap
          // right behind stopSessionAndWait.
          child.postMessage({ type: 'unload', what: 'asr' });
          child.postMessage({ type: 'shutdown' });
        } catch {
          killWorker();
        }
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
  const wasStopping = childState === 'stopping';
  child = null;
  childState = 'idle';
  unsubscribePrivacy();
  logger.info(`worker exited (code ${code}, stopping=${wasStopping})`);
  drainExitWaiters();

  if (wasStopping) {
    sendStatus('stopped');
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

function feedPcm(samples) {
  if (childState !== 'running' || !child) return;
  child.postMessage({ type: 'pcm', samples });
}

// Capture-side events (device switches, reacquire outcomes) go into the same
// probe log the worker owns.
function logRendererEvent(kind, detail) {
  if (!child) return;
  try {
    child.postMessage({ type: 'event', kind, detail });
  } catch {
    // worker mid-death — event is best-effort
  }
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
    stopSession(reason);
  });
}

function stopSession(reason) {
  unsubscribePrivacy();
  if (!child) {
    childState = 'idle';
    return;
  }
  if (childState === 'stopping') return;
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

function unsubscribePrivacy() {
  if (privacyUnsub) {
    privacyUnsub();
    privacyUnsub = null;
  }
}

module.exports = {
  init,
  isAvailable,
  getInfo,
  startSession,
  stopSession,
  stopSessionAndWait,
  feedPcm,
  logRendererEvent,
};
