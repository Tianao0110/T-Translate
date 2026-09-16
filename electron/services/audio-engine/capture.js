// Native WASAPI capture inside the worker (listen/win-audio-capture): the
// audio client handle, the level meter, and the "meter must not freeze"
// idle rule. Captured audio goes to the ASR session's handlePcm and nowhere
// else; nothing here is ever written to disk.

const { post, logLine } = require('./io');
const { eventRecord } = require('./probe-metrics');

// Native capture handle; null whenever no audio is being pulled.
let capture = null;
let lastLevelPostAt = 0;
const LEVEL_INTERVAL_MS = 80;
// Idle rule: zero the meter when the endpoint stops delivering packets.
let lastPcmAt = 0;
let levelZeroed = true;
const LEVEL_IDLE_MS = 1000;

async function start(msg, onPcm) {
  stop();
  logLine(eventRecord('capture-activating', msg.mode || 'system'));
  try {
    // Required lazily so a machine without the native layer still loads models.
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

// Level meter (0..1-ish), posted at most every LEVEL_INTERVAL_MS.
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

// Zeroes the meter after a quiet second (a paused source delivers no packets).
function zeroLevelIfIdle(now) {
  if (capture && !levelZeroed && now - lastPcmAt > LEVEL_IDLE_MS) {
    levelZeroed = true;
    post({ type: 'level', value: 0 });
  }
}

const stats = () => capture?.stats?.();

module.exports = { start, stop, zeroLevelIfIdle, stats };
