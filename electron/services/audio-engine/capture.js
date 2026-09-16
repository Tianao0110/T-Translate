// Native WASAPI capture inside the worker (listen/win-audio-capture): the
// audio client handle, the level meter, and the "meter must not freeze"
// idle rule. Captured audio goes to the ASR session's handlePcm and nowhere
// else; nothing here is ever written to disk.

const { post, logLine } = require('./io');
const { eventRecord } = require('./probe-metrics');

// Native capture handle (listen/win-audio-capture). Null whenever no audio is
// being pulled — the zero-idle rule applies to the audio client too.
let capture = null;
let lastLevelPostAt = 0;
const LEVEL_INTERVAL_MS = 80;
// A loopback client gets no packets at all while nothing renders on the
// endpoint (measured 2026-09-02), so a paused video would leave the meter
// frozen on its last frame unless someone zeroes it.
let lastPcmAt = 0;
let levelZeroed = true;
const LEVEL_IDLE_MS = 1000;

async function start(msg, onPcm) {
  stop();
  logLine(eventRecord('capture-activating', msg.mode || 'system'));
  try {
    // Required lazily: a machine without the native layer must still be able
    // to load models and report a clean capture error, not fail at import.
    const winAudio = require('../../listen/win-audio-capture');
    capture = await winAudio.startCapture({
      mode: msg.mode || 'system',
      pid: msg.pid || 0,
      onPcm: (pcm) => {
        emitLevel(pcm);
        onPcm(pcm);
      },
      onEvent: (kind, detail) => {
        logLine(eventRecord(kind, detail));
        post({ type: 'capture-event', kind, detail });
      },
    });
    logLine(eventRecord('capture-start', capture.mode + (msg.pid ? ` pid=${msg.pid}` : '')));
    post({ type: 'capture-started', mode: capture.mode });
  } catch (err) {
    capture = null;
    logLine(eventRecord('capture-failed', String(err.message)));
    post({ type: 'capture-error', message: String(err.message) });
  }
}

function stop() {
  if (!capture) return;
  try {
    capture.stop();
  } catch {
    // already torn down
  }
  capture = null;
  post({ type: 'level', value: 0 }); // the meter must not freeze on the last loud frame
}

// Same curve the renderer used to compute from its own audio callback, kept
// identical so the meter behaves exactly as before the capture moved here.
function emitLevel(samples) {
  const now = Date.now();
  lastPcmAt = now;
  levelZeroed = false;
  if (now - lastLevelPostAt < LEVEL_INTERVAL_MS) return;
  lastLevelPostAt = now;
  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) sumSq += samples[i] * samples[i];
  const rms = Math.sqrt(sumSq / (samples.length || 1));
  post({ type: 'level', value: Math.min(1, Math.sqrt(rms) * 2.2) });
}

// A loopback client gets no packets at all while nothing renders on the
// endpoint, so a paused video would leave the meter frozen on its last frame
// unless someone zeroes it.
function zeroLevelIfIdle(now) {
  if (capture && !levelZeroed && now - lastPcmAt > LEVEL_IDLE_MS) {
    levelZeroed = true;
    post({ type: 'level', value: 0 });
  }
}

const stats = () => capture?.stats?.();

module.exports = { start, stop, zeroLevelIfIdle, stats };
