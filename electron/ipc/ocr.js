// OCR IPC: engine detection, model-pack management, recognition handlers.
// Local recognition runs on electron/utils/ocr-engine (PP-OCRv6 via
// esearch-ocr); downloadable language packs live in ocr-pack-manager.

const { ipcMain } = require('electron');

const { CHANNELS } = require('../shared/channels');
const { BASE_PACK_ID } = require('../shared/ocr-packs');
const logger = require('../utils/logger')('IPC:OCR');
const { t } = require('../shared/main-i18n');
const ocrEngine = require('../utils/ocr-engine');
const packManager = require('../utils/ocr-pack-manager');
const windowsOcr = require('../utils/windows-ocr');

function register(ctx) {
  const { getMainWindow, store } = ctx;

  // Seed the engine's model tier from persisted settings; the renderer keeps
  // it updated through SET_MODEL_TIER when the user switches.
  ocrEngine.setModelTier(store.get('settings.ocr.modelTier', 'standard'));

  // Warm the heavy natives at idle so neither the settings page nor the
  // first recognition pays the sync-require cost mid-interaction. Only when
  // the local engine is actually selected — no point paying its RAM otherwise.
  if (store.get('settings.ocr.engine') === 'rapid-ocr') {
    setTimeout(() => ocrEngine.prewarm(), 5000);
  }

  ipcMain.handle(CHANNELS.OCR.SET_MODEL_TIER, (event, tier) => {
    ocrEngine.setModelTier(tier);
    return { success: true };
  });

  // ===== Engine detection =====

  ipcMain.handle(CHANNELS.OCR.CHECK_WINDOWS_OCR, async () => {
    const result = await windowsOcr.checkAvailability();
    logger.debug('Windows OCR availability:', result);

    const reasonMap = {
      'not-windows': t('ocr.notWindows'),
      'needs-win10': t('ocr.needsWin10'),
      'no-lang-pack': t('ocr.noLangPack'),
    };
    return {
      available: result.available,
      languages: result.languages,
      reason: result.reason ? (reasonMap[result.reason] || result.reason) : null,
    };
  });

  ipcMain.handle(CHANNELS.OCR.CHECK_INSTALLED, async () => {
    const status = {
      'llm-vision': true, // builtin
      'rapid-ocr': ocrEngine.isPackInstalled(BASE_PACK_ID),
      'windows-ocr': process.platform === 'win32',
    };
    logger.debug('Installed status:', status);
    return status;
  });

  // Light by default (file presence only — cheap enough for page entry);
  // options.deep also builds the session, reserved for explicit user action.
  ipcMain.handle(CHANNELS.OCR.HEALTH_CHECK, async (event, engineId, options = {}) => {
    logger.info('Health check for engine:', engineId, options?.deep ? '(deep)' : '');

    if (engineId === 'rapid-ocr') {
      const result = await ocrEngine.healthCheck({ deep: !!options?.deep });
      if (result.healthy) {
        return { healthy: true, message: t('ocr.engineHealthy') };
      }
      const message =
        result.error === 'BASE_MODELS_MISSING'
          ? t('ocr.baseModelsMissing')
          : t('ocr.loadFailed', { detail: result.detail || result.error });
      return { healthy: false, error: result.error, message };
    }

    if (engineId === 'llm-vision') {
      return { healthy: true, message: t('ocr.llmBuiltin') };
    }

    if (engineId === 'windows-ocr') {
      if (process.platform !== 'win32') {
        return { healthy: false, error: 'platform', message: t('ocr.notWindows') };
      }
      return { healthy: true, message: t('ocr.winOcrAvailable') };
    }

    return { healthy: true, message: t('ocr.onlineNoCheck') };
  });

  // ===== Model packs =====

  ipcMain.handle(CHANNELS.OCR.PACKS_LIST, async (event, options = {}) => {
    try {
      return { success: true, ...(await packManager.listPacks(options)) };
    } catch (error) {
      logger.error('Pack list failed:', error);
      return { success: false, error: error.message, errorCode: error.code };
    }
  });

  ipcMain.handle(CHANNELS.OCR.PACKS_DOWNLOAD, async (event, packId) => {
    const mainWindow = getMainWindow();
    try {
      const result = await packManager.downloadPack(packId, (progress, phase) => {
        sendPackProgress(mainWindow, packId, progress, phase);
      });
      return result;
    } catch (error) {
      logger.error(`Pack download failed (${packId}):`, error);
      sendPackProgress(mainWindow, packId, -1, 'error');
      return { success: false, error: error.message, errorCode: error.code };
    }
  });

  ipcMain.handle(CHANNELS.OCR.PACKS_REMOVE, async (event, packId) => {
    try {
      return await packManager.removePack(packId);
    } catch (error) {
      logger.error(`Pack remove failed (${packId}):`, error);
      return { success: false, error: error.message, errorCode: error.code };
    }
  });

  registerOCRRecognizers(ctx);

  logger.info('OCR IPC handlers registered');
}

// ===== Per-engine recognizers =====
// Bodies are shared with the translation-stack facade (ctx.localOcr): the
// stack's local-bridge engines call these directly, the legacy IPC channels
// keep serving any renderer path until the cleanup batch retires them.

// Windows OCR — Windows.Media.Ocr via electron/utils/windows-ocr
async function recognizeWindows(store, imageData, options = {}) {
  const language =
    options.language || store.get('settings.ocr.recognitionLanguage', 'auto');
  const result = await windowsOcr.recognize(imageData, { language });

  if (!result.success) {
    logger.error('Windows OCR failed:', result.error);
    if (process.platform !== 'win32') result.error = t('ocr.winOnlyWindows');
  } else {
    logger.debug('Windows OCR result length:', result.text.length);
  }
  return result;
}

// Local PP-OCR — language picks the model pack (missing pack falls back to base)
async function recognizePaddle(store, imageData, options = {}) {
  const language =
    options.language || store.get('settings.ocr.recognitionLanguage', 'auto');
  const preprocess = {
    enabled: store.get('settings.ocr.enablePreprocess', true),
    scale: store.get('settings.ocr.scaleFactor', 2),
  };
  const result = await ocrEngine.recognize(imageData, { ...options, language, preprocess });

  if (!result.success && result.errorCode === 'BASE_MODELS_MISSING') {
    result.error = t('ocr.baseModelsMissing');
  }
  return result;
}

function registerOCRRecognizers(ctx) {
  const { store } = ctx;

  ipcMain.handle(CHANNELS.OCR.WINDOWS_OCR, (event, imageData, options = {}) =>
    recognizeWindows(store, imageData, options));

  ipcMain.handle(CHANNELS.OCR.PADDLE_OCR, (event, imageData, options = {}) =>
    recognizePaddle(store, imageData, options));
}

// ===== Helpers =====

function sendPackProgress(mainWindow, packId, progress, phase) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(CHANNELS.OCR.DOWNLOAD_PROGRESS, {
      packId, progress, phase,
    });
  }
}

module.exports = register;
module.exports.recognizeWindows = recognizeWindows;
module.exports.recognizePaddle = recognizePaddle;
