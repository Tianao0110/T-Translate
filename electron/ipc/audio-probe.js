// IPC for the audio-transcription probe window. Thin: every handler delegates
// to audio-probe-manager, which owns the worker and window lifecycle.

const { ipcMain } = require('electron');
const { CHANNELS } = require('../shared/channels');
const probeManager = require('../managers/audio-probe-manager');

const AP = CHANNELS.AUDIO_PROBE;

// Structured clone should deliver a Float32Array; coerce the byte-ish shapes
// some transports fall back to so the worker only ever sees Float32Array.
function toFloat32(samples) {
  if (samples instanceof Float32Array) return samples;
  if (ArrayBuffer.isView(samples)) {
    return new Float32Array(samples.buffer, samples.byteOffset, samples.byteLength / 4);
  }
  if (samples instanceof ArrayBuffer) return new Float32Array(samples);
  return null;
}

function registerAudioProbeIPC(ctx) {
  ipcMain.handle(AP.GET_INFO, () => probeManager.getInfo());

  ipcMain.on(AP.START, (event, opts) => probeManager.startSession(opts || {}));
  ipcMain.on(AP.STOP, () => probeManager.stopSession('renderer'));

  ipcMain.on(AP.PCM, (event, samples) => {
    const f32 = toFloat32(samples);
    if (f32) probeManager.feedPcm(f32);
  });

  ipcMain.on(AP.EVENT, (event, payload) => {
    if (payload && typeof payload.kind === 'string') {
      probeManager.logRendererEvent(payload.kind, payload.detail);
    }
  });

  ipcMain.on(AP.CLOSE, () => {
    const win = ctx.getAudioProbeWindow?.();
    if (win && !win.isDestroyed()) win.close();
  });
}

module.exports = registerAudioProbeIPC;
