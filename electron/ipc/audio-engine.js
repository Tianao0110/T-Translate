// IPC for the listen-translate mode (hosted by the floating window). Thin:
// session handlers delegate to audio-engine-manager, which owns the worker.

const { ipcMain, dialog } = require('electron');
const fs = require('fs');
const { CHANNELS } = require('../shared/channels');
const engineManager = require('../managers/audio-engine-manager');
const winAudio = require('../utils/win-audio-capture');
const packManager = require('../utils/audio-pack-manager');
const logger = require('../utils/logger')('IPC:AudioEngine');

const AE = CHANNELS.AUDIO_ENGINE;

// The SRT body is renderer-supplied, and the threat model for this app is a
// compromised renderer, not a mistyped call. 16MB is far past the export's own
// ceiling (20000 transcript lines, useListenSession MAX_TRANSCRIPT).
const MAX_SRT_BYTES = 16 * 1024 * 1024;

function sendPackProgress(mainWindow, packId, progress, phase) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(AE.DOWNLOAD_PROGRESS, { packId, progress, phase });
  }
}

function registerAudioEngineIPC(ctx) {
  const { getMainWindow } = ctx;

  ipcMain.handle(AE.GET_INFO, () => engineManager.getInfo());

  ipcMain.on(AE.START, (event, opts) => engineManager.startSession(opts || {}));
  ipcMain.on(AE.STOP, () => engineManager.stopSession('renderer'));

  // Audio sources for the "which program" picker, plus what this machine can
  // actually do. Sampling the peak meters takes a moment, hence invoke.
  ipcMain.handle(AE.SOURCES, async () => {
    const caps = winAudio.getCapabilities();
    return {
      ...caps,
      sessions: caps.processLoopback ? await winAudio.listAudioSessions() : [],
    };
  });

  // Subtitle export: the renderer assembles the SRT text (it owns the finals
  // and their timestamps); this side only does the save dialog + write. The
  // content is the user's own transcript — same trust level as clipboard.
  ipcMain.handle(AE.EXPORT_SRT, async (event, payload) => {
    const content = typeof payload?.content === 'string' ? payload.content : '';
    if (!content) return { success: false, error: 'empty' };
    if (Buffer.byteLength(content, 'utf8') > MAX_SRT_BYTES) {
      logger.warn('SRT export refused: content over the size cap');
      return { success: false, error: 'too-large' };
    }
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

  // The offline gate is NOT here: audio-pack-manager.downloadPack owns it, so
  // it holds for every caller instead of only this channel. The OFFLINE_BLOCKED
  // code arrives through the catch below like any other refusal.
  ipcMain.handle(AE.PACKS_DOWNLOAD, async (event, packId) => {
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
