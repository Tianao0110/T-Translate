// OCR IPC: engine detection, model-pack management, recognition handlers.
// Local recognition runs on electron/utils/ocr-engine (PP-OCRv5 via
// esearch-ocr); downloadable language packs live in ocr-pack-manager.

const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

const { CHANNELS } = require('../shared/channels');
const logger = require('../utils/logger')('IPC:OCR');
const { t } = require('../shared/main-i18n');
const ocrEngine = require('../utils/ocr-engine');
const packManager = require('../utils/ocr-pack-manager');

function register(ctx) {
  const { getMainWindow, store } = ctx;

  // ===== Engine detection =====

  ipcMain.handle(CHANNELS.OCR.CHECK_WINDOWS_OCR, async () => {
    if (process.platform !== 'win32') {
      return { available: false, reason: t('ocr.notWindows') };
    }

    try {
      const release = os.release();
      const majorVersion = parseInt(release.split('.')[0]);

      if (majorVersion < 10) {
        return { available: false, reason: t('ocr.needsWin10') };
      }

      const psScript = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$langs = [Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages
$langs | ForEach-Object { $_.LanguageTag }
      `.trim();

      try {
        const result = await execAsync(
          `powershell -NoProfile -ExecutionPolicy Bypass -Command "${psScript.replace(/"/g, '\\"')}"`,
          { encoding: 'utf8', timeout: 10000, windowsHide: true }
        );

        const languages = result.stdout.trim().split('\n').filter(l => l.trim()).map(l => l.trim());
        logger.debug('Windows OCR available languages:', languages);

        return {
          available: languages.length > 0,
          languages,
          reason: languages.length > 0 ? null : t('ocr.noLangPack'),
        };
      } catch (e) {
        logger.error('Failed to get Windows OCR languages:', e.message);
        return { available: true, languages: [], reason: t('ocr.cantGetLangs') };
      }
    } catch (error) {
      logger.error('Check Windows OCR failed:', error);
      return { available: false, reason: error.message };
    }
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

  // Windows OCR — runs a PowerShell script that drives Windows.Media.Ocr
  ipcMain.handle(CHANNELS.OCR.WINDOWS_OCR, async (event, imageData, options = {}) => {
    if (process.platform !== 'win32') {
      return { success: false, error: t('ocr.winOnlyWindows') };
    }

    try {
      let base64Data = imageData;
      if (imageData.startsWith('data:image')) {
        base64Data = imageData.split(',')[1];
      }

      const tempFile = path.join(os.tmpdir(), `t-translate-ocr-${Date.now()}.png`);
      fs.writeFileSync(tempFile, Buffer.from(base64Data, 'base64'));

      // 'auto' maps to '' -> the PS script skips TryCreateFromLanguage and
      // uses the user's Windows profile languages directly.
      const language =
        options.language || store.get('settings.ocr.recognitionLanguage', 'auto');
      const langMap = {
        'zh-Hans': 'zh-Hans-CN',
        'zh-Hant': 'zh-Hant-TW',
        'en': 'en-US',
        'ja': 'ja-JP',
        'ko': 'ko-KR',
        'fr': 'fr-FR',
        'de': 'de-DE',
        'es': 'es-ES',
        'ru': 'ru-RU',
      };
      const winLang = langMap[language] || '';

      const psScript = getWindowsOCRScript(tempFile, winLang);

      const result = await execAsync(
        `powershell -NoProfile -ExecutionPolicy Bypass -Command "${psScript.replace(/"/g, '\\"')}"`,
        { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, windowsHide: true }
      );

      try { fs.unlinkSync(tempFile); } catch (e) {}

      // Windows OCR inserts a space between every CJK glyph; strip spaces
      // touching a CJK char (latin-latin gaps stay intact).
      const CJK = '[\\u3040-\\u30ff\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff\\uff00-\\uffef]';
      const text = result.stdout
        .trim()
        .replace(new RegExp(`(${CJK}) +(?=${CJK})`, 'g'), '$1')
        .replace(new RegExp(`(${CJK}) +`, 'g'), '$1')
        .replace(new RegExp(` +(?=${CJK})`, 'g'), '');
      logger.debug('Windows OCR result length:', text.length);

      return {
        success: true,
        text,
        confidence: text ? 0.9 : 0,
        engine: 'windows-ocr',
      };
    } catch (error) {
      // stderr carries the whole PS dump; keep the first meaningful line
      const firstLine = String(error.stderr || error.message || '')
        .split('\n').map(s => s.trim()).filter(Boolean)[0] || t('ocr.winOcrFailed');
      logger.error('Windows OCR failed:', firstLine);
      return { success: false, error: firstLine };
    }
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

// PowerShell driver for Windows.Media.Ocr. Uses AsyncOperation-AsTask shim
// because PS5 lacks native await for WinRT IAsyncOperation<T>. Image loads
// via StorageFile.GetFileFromPathAsync (the documented WinRT route — there is
// no RandomAccessStream::FromStream static). Empty winLang = user profile
// languages.
function getWindowsOCRScript(tempFile, winLang) {
  return `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
Function Await($WinRtTask, $ResultType) { $asTask = $asTaskGeneric.MakeGenericMethod($ResultType); $netTask = $asTask.Invoke($null, @($WinRtTask)); $netTask.Wait(-1) | Out-Null; $netTask.Result }
try {
  $storageFile = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync("${tempFile.replace(/\\/g, '\\\\')}")) ([Windows.Storage.StorageFile])
  $stream = Await ($storageFile.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $ocrEngine = $null
  if ('${winLang}' -ne '') {
    try { $langObj = New-Object Windows.Globalization.Language('${winLang}'); $ocrEngine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($langObj) } catch {}
  }
  if ($null -eq $ocrEngine) { $ocrEngine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }
  if ($null -eq $ocrEngine) { Write-Error 'no usable OCR language pack'; exit 1 }
  $result = Await ($ocrEngine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
  ($result.Lines | ForEach-Object { $_.Text }) -join [Environment]::NewLine
  $stream.Dispose()
} catch { Write-Error $_.Exception.Message; exit 1 }
  `.trim();
}

module.exports = register;
