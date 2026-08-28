// IPC for the listen-translate mode (hosted by the floating window). Thin:
// session handlers delegate to audio-engine-manager, which owns the worker.

const { ipcMain, dialog } = require('electron');
const fs = require('fs');
const { CHANNELS, PRIVACY_MODES } = require('../shared/channels');
const engineManager = require('../managers/audio-engine-manager');
const packManager = require('../utils/audio-pack-manager');
const logger = require('../utils/logger')('IPC:AudioEngine');

const AE = CHANNELS.AUDIO_ENGINE;

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

function sendPackProgress(mainWindow, packId, progress, phase) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(AE.DOWNLOAD_PROGRESS, { packId, progress, phase });
  }
}

function registerAudioEngineIPC(ctx) {
  const { getMainWindow, store } = ctx;

  ipcMain.handle(AE.GET_INFO, () => engineManager.getInfo());

  ipcMain.on(AE.START, (event, opts) => engineManager.startSession(opts || {}));
  ipcMain.on(AE.STOP, () => engineManager.stopSession('renderer'));

  ipcMain.on(AE.PCM, (event, samples) => {
    const f32 = toFloat32(samples);
    if (f32) engineManager.feedPcm(f32);
  });

  ipcMain.on(AE.EVENT, (event, payload) => {
    if (payload && typeof payload.kind === 'string') {
      engineManager.logRendererEvent(payload.kind, payload.detail);
    }
  });

  // Subtitle export: the renderer assembles the SRT text (it owns the finals
  // and their timestamps); this side only does the save dialog + write. The
  // content is the user's own transcript — same trust level as clipboard.
  ipcMain.handle(AE.EXPORT_SRT, async (event, payload) => {
    const content = typeof payload?.content === 'string' ? payload.content : '';
    if (!content) return { success: false, error: 'empty' };
    try {
      const win = ctx.windows?.floatingWindow;
      const stamp = new Date().toISOString().slice(0, 10);
      const result = await dialog.showSaveDialog(win && !win.isDestroyed() ? win : null, {
        defaultPath: `listen-${stamp}.srt`,
        filters: [{ name: 'SubRip Subtitles', extensions: ['srt'] }],
      });
      if (result.canceled || !result.filePath) return { success: false, canceled: true };
      fs.writeFileSync(result.filePath, content, 'utf8');
      return { success: true, filePath: result.filePath };
    } catch (e) {
      logger.error('SRT export failed:', e.message);
      return { success: false, error: e.message };
    }
  });

  // ===== Model packs =====
  // The settings page is the only download entry point (the floating window's
  // listen button stays disabled until a base pack lands).

  ipcMain.handle(AE.PACKS_LIST, async (event, options = {}) => {
    try {
      return { success: true, ...(await packManager.listPacks(options)) };
    } catch (error) {
      logger.error('Pack list failed:', error);
      return { success: false, error: error.message, errorCode: error.code };
    }
  });

  ipcMain.handle(AE.PACKS_DOWNLOAD, async (event, packId) => {
    // Offline mode promises the app never reaches the network — a model
    // download is not an exception the user can click their way out of.
    if (store.get('privacyMode', PRIVACY_MODES.STANDARD) === PRIVACY_MODES.OFFLINE) {
      return { success: false, error: 'offline-mode', errorCode: 'OFFLINE_BLOCKED' };
    }
    const mainWindow = getMainWindow();
    try {
      return await packManager.downloadPack(packId, (progress, phase) => {
        sendPackProgress(mainWindow, packId, progress, phase);
      });
    } catch (error) {
      logger.error(`Pack download failed (${packId}):`, error);
      sendPackProgress(mainWindow, packId, -1, 'error');
      return { success: false, error: error.message, errorCode: error.code };
    }
  });

  ipcMain.handle(AE.PACKS_REMOVE, async (event, packId) => {
    try {
      return await packManager.removePack(packId);
    } catch (error) {
      logger.error(`Pack remove failed (${packId}):`, error);
      return { success: false, error: error.message, errorCode: error.code };
    }
  });
}

module.exports = registerAudioEngineIPC;
