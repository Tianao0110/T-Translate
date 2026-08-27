// Audio-transcription probe orchestration: owns the probe window lifecycle,
// the ASR utilityProcess, and status relay between them.
//
// Iron rules honored here: the probe window is destroy-on-close (never a
// hidden resident like the selection window), the worker dies with the window
// (zero idle footprint), SECURE privacy mode refuses to start (the probe log
// records recognized text on disk), and a crashed engine restarts exactly once
// per window before giving up.

const path = require('path');
const fs = require('fs');
const { app, utilityProcess } = require('electron');
const { CHANNELS, PRIVACY_MODES } = require('../shared/channels');
const { locateAsrModels } = require('../utils/asr-models');
const logger = require('../utils/logger')('AudioProbe');

const READY_TIMEOUT_MS = 30000;
const STOP_GRACE_MS = 3000;
const MAX_PROBE_LOGS = 20; // rolling cap — one file per session, oldest pruned first

let deps = null; // { store, windows, createWindow }
let child = null;
let childState = 'idle'; // idle | starting | running | stopping
let restartedOnce = false;
let readyTimer = null;
let killTimer = null;
let privacyUnsub = null;

function init(d) {
  deps = d;
}

function modelsBaseDir() {
  return path.join(app.getPath('userData'), 'asr-models');
}

function isAvailable() {
  return locateAsrModels(modelsBaseDir()) !== null;
}

function isSecure() {
  return deps.store.get('privacyMode', PRIVACY_MODES.STANDARD) === PRIVACY_MODES.SECURE;
}

function probeWindow() {
  const win = deps.windows.audioProbe;
  return win && !win.isDestroyed() ? win : null;
}

function sendToWindow(channel, payload) {
  const win = probeWindow();
  if (win) win.webContents.send(channel, payload);
}

function sendStatus(state, detail) {
  logger.debug(`status: ${state}${detail ? ` (${detail})` : ''}`);
  sendToWindow(CHANNELS.AUDIO_PROBE.STATUS, { state, detail });
}

function getInfo() {
  const models = locateAsrModels(modelsBaseDir());
  return {
    modelName: models ? models.modelName : null,
    modelsDir: modelsBaseDir(),
    secureBlocked: isSecure(),
    running: childState === 'running' || childState === 'starting',
  };
}

function toggleWindow() {
  const win = probeWindow();
  if (win) {
    win.close(); // 'closed' handler tears the session down
    return;
  }
  if (!isAvailable()) {
    logger.warn('toggle ignored: no ASR models present');
    return;
  }
  deps.windows.audioProbe = deps.createWindow();
  deps.windows.audioProbe.on('closed', () => {
    deps.windows.audioProbe = null;
    stopSession('window-closed');
  });
  restartedOnce = false;
}

function startSession() {
  if (childState !== 'idle') {
    logger.warn(`start ignored in state ${childState}`);
    return;
  }
  // Each user-initiated session gets its own one-shot crash restart.
  restartedOnce = false;
  const models = locateAsrModels(modelsBaseDir());
  if (!models) {
    sendStatus('no-model');
    return;
  }
  if (isSecure()) {
    sendStatus('secure-blocked');
    return;
  }
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

  child = utilityProcess.fork(path.join(__dirname, '../services/asr-probe/asr-worker.js'), [], {
    serviceName: 't-translate-asr-probe',
    stdio: 'pipe',
  });
  child.stdout?.on('data', (d) => logger.debug(`worker: ${String(d).trim()}`));
  child.stderr?.on('data', (d) => logger.warn(`worker: ${String(d).trim()}`));

  child.on('message', onWorkerMessage);
  child.on('exit', onWorkerExit);

  readyTimer = setTimeout(() => {
    logger.error('worker ready timeout');
    killWorker();
    sendStatus('engine-dead', 'ready-timeout');
  }, READY_TIMEOUT_MS);

  child.postMessage({
    type: 'init',
    modelPath: models.modelPath,
    tokensPath: models.tokensPath,
    vadPath: models.vadPath,
    logPath,
    meta: {
      appVersion: app.getVersion(),
      electron: process.versions.electron,
      model: models.modelName,
      privacyMode: deps.store.get('privacyMode', PRIVACY_MODES.STANDARD),
    },
  });
}

function onWorkerMessage(msg) {
  if (!msg || !msg.type) return;
  switch (msg.type) {
    case 'ready':
      clearTimeout(readyTimer);
      childState = 'running';
      logger.info(`worker ready in ${msg.loadMs}ms`);
      sendStatus('listening');
      break;
    case 'segment':
      sendToWindow(CHANNELS.AUDIO_PROBE.SEGMENT, msg.rec);
      break;
    case 'hint':
      sendStatus(msg.kind ? `hint-${msg.kind}` : 'listening');
      break;
    case 'metrics':
      sendToWindow(CHANNELS.AUDIO_PROBE.STATUS, { state: 'metrics', detail: msg.rec });
      break;
    case 'stopped':
      // Worker exits itself right after; 'exit' handler finishes cleanup.
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

  if (wasStopping) {
    sendStatus('stopped');
    return;
  }
  // Unexpected death mid-session: one automatic restart, then give up.
  if (!restartedOnce && probeWindow()) {
    restartedOnce = true;
    sendStatus('engine-restarting');
    const models = locateAsrModels(modelsBaseDir());
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
    child.postMessage({ type: 'stop' });
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
  toggleWindow,
  startSession,
  stopSession,
  feedPcm,
  logRendererEvent,
};
