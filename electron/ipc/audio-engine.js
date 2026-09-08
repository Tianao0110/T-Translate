// IPC for the listen-translate mode (hosted by the floating window). Thin:
// session handlers delegate to audio-engine-manager, which owns the worker.

const { ipcMain, shell } = require('electron');
const fs = require('fs');
const { CHANNELS } = require('../shared/channels');
const engineManager = require('../managers/audio-engine-manager');
const winAudio = require('../utils/win-audio-capture');
const packManager = require('../utils/audio-pack-manager');
const ttsPackManager = require('../utils/tts-pack-manager');
const logger = require('../utils/logger')('IPC:AudioEngine');

const AE = CHANNELS.AUDIO_ENGINE;

// One utterance. The translation panel's longest text is a few paragraphs;
// anything past this is not a read-aloud request.
const MAX_TTS_CHARS = 5000;
const TTS_ID = /^[A-Za-z0-9_-]{1,64}$/;
const PACK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

// Renderer-supplied request narrowed to what the worker accepts.
function normalizeTtsRequest(req) {
  if (!req || typeof req !== 'object') return null;
  if (typeof req.id !== 'string' || !TTS_ID.test(req.id)) return null;
  if (typeof req.packId !== 'string' || !PACK_ID.test(req.packId) || req.packId.includes('..')) return null;
  const text = typeof req.text === 'string' ? req.text.trim().slice(0, MAX_TTS_CHARS) : '';
  if (!text) return null;
  return {
    id: req.id,
    packId: req.packId,
    text,
    sid: Number.isInteger(req.sid) && req.sid >= 0 && req.sid < 1000 ? req.sid : 0,
    speed: Number.isFinite(req.speed) ? Math.min(3, Math.max(0.3, req.speed)) : 1,
  };
}

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

  // Translation of each final and the subtitle file at session end live in
  // the main process (managers/listen-translator.js); the window names the
  // target and opens the folder.
  engineManager.configureTranslation({ translateStream: ctx.stackHooks?.translateStream || null });
  ipcMain.on(AE.SET_TARGET, (event, lang) => engineManager.setTargetLang(typeof lang === 'string' ? lang : ''));

  ipcMain.handle(AE.OPEN_LISTEN_DIR, async () => {
    const dir = engineManager.listenDir();
    try {
      fs.mkdirSync(dir, { recursive: true });
      const err = await shell.openPath(dir);
      return err ? { success: false, error: err } : { success: true, dir };
    } catch (e) {
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

  // ===== Neural TTS =====
  // Local synthesis only: nothing here reaches the network, so neither the
  // offline nor the secure gate applies. The audio streams back to the window
  // that asked (event.sender), never broadcast.

  ipcMain.handle(AE.TTS_STATUS, () => engineManager.getTtsStatus());
  ipcMain.handle(AE.TTS_VOICES, () => engineManager.getTtsVoices());

  ipcMain.handle(AE.TTS_GENERATE, async (event, req) => {
    const request = normalizeTtsRequest(req);
    if (!request) return { success: false, error: 'bad-request' };
    try {
      return await engineManager.ttsGenerate(request, event.sender);
    } catch (error) {
      logger.error(`TTS generate failed (${request.id}):`, error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.on(AE.TTS_CANCEL, (event, req) => {
    const id = typeof req?.id === 'string' && TTS_ID.test(req.id) ? req.id : null;
    if (id) engineManager.ttsCancel(id);
  });

  // Each window reports its own playback; the manager ORs them, so one
  // window stopping never unmutes while another is still talking.
  ipcMain.on(AE.TTS_PLAYING, (event, payload) => {
    engineManager.setTtsPlaying(event.sender.id, !!payload?.on);
  });

  // Voice packs: same manifest and progress channel as the ASR packs, own
  // root and manager (tts-models; eviction unloads the voice, not the session).
  ipcMain.handle(AE.TTS_PACKS_LIST, async (event, options = {}) => {
    try {
      return { success: true, ...(await ttsPackManager.listPacks(options)) };
    } catch (error) {
      logger.error('Voice pack list failed:', error);
      return { success: false, error: error.message, errorCode: error.code };
    }
  });

  ipcMain.handle(AE.TTS_PACKS_DOWNLOAD, async (event, packId) => {
    const mainWindow = getMainWindow();
    try {
      return await ttsPackManager.downloadPack(packId, (progress, phase) => {
        sendPackProgress(mainWindow, packId, progress, phase);
      });
    } catch (error) {
      logger.error(`Voice pack download failed (${packId}):`, error);
      sendPackProgress(mainWindow, packId, -1, 'error');
      return { success: false, error: error.message, errorCode: error.code };
    }
  });

  ipcMain.handle(AE.TTS_PACKS_REMOVE, async (event, packId) => {
    try {
      return await ttsPackManager.removePack(packId);
    } catch (error) {
      logger.error(`Voice pack remove failed (${packId}):`, error);
      return { success: false, error: error.message, errorCode: error.code };
    }
  });
}

module.exports = registerAudioEngineIPC;
