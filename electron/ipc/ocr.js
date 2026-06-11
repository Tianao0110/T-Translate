// OCR IPC: engine detection, model-pack management, recognition handlers.
// Local recognition runs on electron/utils/ocr-engine (PP-OCRv5 via
// esearch-ocr); downloadable language packs live in ocr-pack-manager.

const { ipcMain } = require('electron');

const { CHANNELS } = require('../shared/channels');
const logger = require('../utils/logger')('IPC:OCR');
const { t } = require('../shared/main-i18n');
const ocrEngine = require('../utils/ocr-engine');
const packManager = require('../utils/ocr-pack-manager');
const windowsOcr = require('../utils/windows-ocr');

function register(ctx) {
  const { getMainWindow, store } = ctx;

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
      'rapid-ocr': ocrEngine.isPackInstalled('base-v5'),
      'windows-ocr': process.platform === 'win32',
    };
    logger.debug('Installed status:', status);
    return status;
  });

  // Loads the base models into a session — catches missing/corrupt model
  // files and broken onnxruntime bindings without running a recognition.
  ipcMain.handle(CHANNELS.OCR.HEALTH_CHECK, async (event, engineId) => {
    logger.info('Health check for engine:', engineId);

    if (engineId === 'rapid-ocr') {
      const result = await ocrEngine.healthCheck();
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

function registerOCRRecognizers(ctx) {
  const { store } = ctx;

  // Windows OCR — Windows.Media.Ocr via electron/utils/windows-ocr
  ipcMain.handle(CHANNELS.OCR.WINDOWS_OCR, async (event, imageData, options = {}) => {
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
  });

  // Local PP-OCR — language picks the model pack (missing pack falls back to base)
  ipcMain.handle(CHANNELS.OCR.PADDLE_OCR, async (event, imageData, options = {}) => {
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
  });

  ipcMain.handle(CHANNELS.OCR.OCRSPACE, async (event, imageData, options = {}) => {
    try {
      const apiKey = options.apiKey;
      if (!apiKey) {
        return { success: false, error: t('ocr.noApiKey', { service: 'OCR.space' }) };
      }

      let base64Data = imageData;
      let mimeType = 'image/png';
      if (imageData.startsWith('data:image')) {
        const mimeMatch = imageData.match(/^data:(image\/\w+);base64,/);
        if (mimeMatch) mimeType = mimeMatch[1];
        base64Data = imageData.split(',')[1];
      }

      const langMap = {
        'zh-Hans': 'chs', 'zh-CN': 'chs', 'zh-Hant': 'cht', 'zh-TW': 'cht',
        'en': 'eng', 'en-US': 'eng', 'ja': 'jpn', 'ko': 'kor',
      };
      const targetLang = langMap[options.language] || options.language || 'chs';

      const params = new URLSearchParams();
      params.append('base64Image', `data:${mimeType};base64,${base64Data}`);
      params.append('language', targetLang);
      params.append('OCREngine', options.engine || '2');

      const response = await fetch('https://api.ocr.space/parse/image', {
        method: 'POST',
        headers: { apikey: apiKey, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params,
      });

      const result = await response.json();

      if (result.IsErroredOnProcessing) {
        return { success: false, error: result.ErrorMessage?.[0] || t('ocr.ocrspaceFailed') };
      }

      const text = result.ParsedResults?.[0]?.ParsedText || '';
      return { success: true, text: text.trim(), confidence: 0.95, engine: 'ocrspace' };
    } catch (error) {
      logger.error('OCR.space failed:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(CHANNELS.OCR.GOOGLE_VISION, async (event, imageData, options = {}) => {
    try {
      const apiKey = options.apiKey;
      if (!apiKey) {
        return { success: false, error: t('ocr.noApiKey', { service: 'Google Cloud Vision' }) };
      }

      let base64Data = imageData;
      if (imageData.startsWith('data:image')) {
        base64Data = imageData.split(',')[1];
      }

      const response = await fetch(
        `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requests: [{
              image: { content: base64Data },
              features: [{ type: 'TEXT_DETECTION' }],
              imageContext: { languageHints: options.languages || ['zh', 'en'] },
            }],
          }),
        }
      );

      const result = await response.json();

      if (result.error) {
        return { success: false, error: result.error.message };
      }

      const text = result.responses?.[0]?.fullTextAnnotation?.text || '';
      return { success: true, text: text.trim(), confidence: 0.98, engine: 'google-vision' };
    } catch (error) {
      logger.error('Google Vision failed:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(CHANNELS.OCR.AZURE_OCR, async (event, imageData, options = {}) => {
    try {
      const apiKey = options.apiKey;
      const region = options.region || 'eastus';

      if (!apiKey) {
        return { success: false, error: t('ocr.noApiKey', { service: 'Azure OCR' }) };
      }

      let base64Data = imageData;
      if (imageData.startsWith('data:image')) {
        base64Data = imageData.split(',')[1];
      }

      const imageBuffer = Buffer.from(base64Data, 'base64');

      const response = await fetch(
        `https://${region}.api.cognitive.microsoft.com/vision/v3.2/ocr?language=${options.language || 'zh-Hans'}&detectOrientation=true`,
        {
          method: 'POST',
          headers: {
            'Ocp-Apim-Subscription-Key': apiKey,
            'Content-Type': 'application/octet-stream',
          },
          body: imageBuffer,
        }
      );

      const result = await response.json();

      if (result.error) {
        return { success: false, error: result.error.message };
      }

      const lines = [];
      for (const reg of result.regions || []) {
        for (const line of reg.lines || []) {
          lines.push(line.words?.map(w => w.text).join(' ') || '');
        }
      }

      const text = lines.join('\n');
      return { success: true, text: text.trim(), confidence: 0.95, engine: 'azure-ocr' };
    } catch (error) {
      logger.error('Azure OCR failed:', error);
      return { success: false, error: error.message };
    }
  });

  // Baidu OCR — token-exchange first, then accurate_basic
  ipcMain.handle(CHANNELS.OCR.BAIDU_OCR, async (event, imageData, options = {}) => {
    try {
      const apiKey = options.apiKey;
      const secretKey = options.secretKey;

      if (!apiKey || !secretKey) {
        return { success: false, error: t('ocr.noApiKeySecret') };
      }

      const tokenResponse = await fetch(
        `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${apiKey}&client_secret=${secretKey}`,
        { method: 'POST' }
      );
      const tokenResult = await tokenResponse.json();

      if (!tokenResult.access_token) {
        return { success: false, error: t('ocr.baiduTokenFailed') };
      }

      let base64Data = imageData;
      if (imageData.startsWith('data:image')) {
        base64Data = imageData.split(',')[1];
      }

      const params = new URLSearchParams();
      params.append('image', base64Data);
      params.append('language_type', options.language || 'CHN_ENG');
      params.append('detect_direction', 'true');

      const response = await fetch(
        `https://aip.baidubce.com/rest/2.0/ocr/v1/accurate_basic?access_token=${tokenResult.access_token}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params,
        }
      );

      const result = await response.json();

      if (result.error_code) {
        return { success: false, error: result.error_msg || t('ocr.baiduFailed') };
      }

      const text = result.words_result?.map(w => w.words).join('\n') || '';
      return { success: true, text: text.trim(), confidence: 0.96, engine: 'baidu-ocr' };
    } catch (error) {
      logger.error('Baidu OCR failed:', error);
      return { success: false, error: error.message };
    }
  });
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
