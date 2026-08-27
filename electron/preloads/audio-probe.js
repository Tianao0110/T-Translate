// Preload for the standalone audio-probe window.

const { contextBridge, ipcRenderer } = require('electron');
const { CHANNELS } = require('../shared/channels');

const AP = CHANNELS.AUDIO_PROBE;

contextBridge.exposeInMainWorld('audioProbe', {
  getInfo: () => ipcRenderer.invoke(AP.GET_INFO),
  start: (opts) => ipcRenderer.send(AP.START, opts),
  stop: () => ipcRenderer.send(AP.STOP),
  close: () => ipcRenderer.send(AP.CLOSE),
  sendPcm: (samples) => ipcRenderer.send(AP.PCM, samples),
  sendEvent: (kind, detail) => ipcRenderer.send(AP.EVENT, { kind, detail }),

  onStatus: (cb) => ipcRenderer.on(AP.STATUS, (event, payload) => cb(payload)),
  onSegment: (cb) => ipcRenderer.on(AP.SEGMENT, (event, rec) => cb(rec)),
  onPartial: (cb) => ipcRenderer.on(AP.PARTIAL, (event, text) => cb(text)),

  // Same crash-visibility bridge as the child pane: renderer errors reach the
  // on-disk main log instead of dying with the window.
  logs: {
    write: (payload) => ipcRenderer.send(CHANNELS.LOGS.WRITE, payload),
  },
});
