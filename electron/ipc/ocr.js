// OCR IPC: engine detection, install/repair, recognition handlers per engine.

const { ipcMain, app } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

const { CHANNELS, OCR_ENGINES } = require('../shared/channels');
const logger = require('../utils/logger')('IPC:OCR');
const { smartMerge, mergedBlocksToText } = require('../utils/text-merger');
const { t } = require('../shared/main-i18n');

// Packaged native modules may be incompatible with the user's CPU/Windows build.
// After repair, replacements live in userData/node_modules, so try that first.
const userDataModules = path.join(app.getPath('userData'), 'node_modules');

function resolveOcrModule() {
  try {
    return require.resolve('@gutenye/ocr-node', { paths: [userDataModules] });
  } catch (e) {}
  try {
    return require.resolve('@gutenye/ocr-node');
  } catch (e) {}
  return null;
}

async function loadOcrModule() {
  const resolved = resolveOcrModule();
  if (!resolved) return null;
  try {
    // Use file:// URL so dynamic import resolves the userData copy, not the default
    const moduleUrl = require('url').pathToFileURL(resolved).href;
    return await import(moduleUrl);
  } catch (e) {
    logger.warn('loadOcrModule failed for', resolved, ':', e.message);
    try {
      return await import('@gutenye/ocr-node');
    } catch (e2) {
      return null;
    }
  }
}

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

        const languages = result.stdout.trim().split('\n').filter(l => l.trim());
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

  ipcMain.handle(CHANNELS.OCR.CHECK_PADDLE_OCR, async () => {
    try {
      const mod = await loadOcrModule();
      if (mod) {
        logger.debug('@gutenye/ocr-node is available');
        return { available: true, version: 'gutenye' };
      }
      throw new Error('module not found');
    } catch (e) {
      logger.debug('@gutenye/ocr-node not available:', e.message);
    }

    try {
      await import('multilingual-purejs-ocr');
      logger.debug('multilingual-purejs-ocr is available');
      return { available: true, version: 'purejs' };
    } catch (e) {
      logger.debug('multilingual-purejs-ocr not available:', e.message);
    }

    return { available: false };
  });

  ipcMain.handle(CHANNELS.OCR.CHECK_INSTALLED, async () => {
    const status = {
      'llm-vision': true, // builtin
      'rapid-ocr': false,
    };

    const checkModule = (moduleName) => {
      if (moduleName === '@gutenye/ocr-node') return !!resolveOcrModule();
      try {
        require.resolve(moduleName);
        return true;
      } catch (e) {
        return false;
      }
    };

    if (checkModule('@gutenye/ocr-node')) {
      status['rapid-ocr'] = true;
    }

    logger.debug('Installed status:', status);
    return status;
  });

  ipcMain.handle(CHANNELS.OCR.GET_AVAILABLE_ENGINES, async () => {
    const engines = [
      {
        id: OCR_ENGINES.LLM_VISION,
        name: 'LLM Vision',
        description: '使用本地 LLM 视觉模型识别',
        available: true,
        isOnline: false,
        tier: 2,
      },
    ];

    let rapidAvailable = false;
    try {
      if (resolveOcrModule()) {
        rapidAvailable = true;
      } else {
        require.resolve('multilingual-purejs-ocr');
        rapidAvailable = true;
      }
    } catch (e) {}

    engines.push({
      id: OCR_ENGINES.RAPID_OCR,
      name: 'RapidOCR',
      description: '本地 OCR，基于 PP-OCRv4，速度快',
      available: rapidAvailable,
      isOnline: false,
      tier: 1,
    });

    engines.push(
      {
        id: OCR_ENGINES.OCRSPACE,
        name: 'OCR.space',
        description: '在线 OCR，免费 25000次/月',
        available: true,
        isOnline: true,
        tier: 3,
      },
      {
        id: OCR_ENGINES.GOOGLE_VISION,
        name: 'Google Vision',
        description: '识别效果最好，200+ 语言',
        available: true,
        isOnline: true,
        tier: 3,
      },
      {
        id: OCR_ENGINES.AZURE_OCR,
        name: 'Azure OCR',
        description: '免费额度高，5000次/月',
        available: true,
        isOnline: true,
        tier: 3,
      },
      {
        id: OCR_ENGINES.BAIDU_OCR,
        name: '百度 OCR',
        description: '中文识别最强，国内快',
        available: true,
        isOnline: true,
        tier: 3,
      }
    );

    return engines;
  });

  // ===== Engine install / uninstall =====

  ipcMain.handle(CHANNELS.OCR.DOWNLOAD_ENGINE, async (event, engineId) => {
    const mainWindow = getMainWindow();
    logger.info('Downloading engine:', engineId);

    try {
      let packageName, packageDesc;

      switch (engineId) {
        case 'paddle-ocr':
          packageName = 'multilingual-purejs-ocr';
          packageDesc = 'PaddleOCR (multilingual-purejs-ocr)';
          break;
        case 'rapid-ocr':
          packageName = '@gutenye/ocr-node';
          packageDesc = 'RapidOCR (@gutenye/ocr-node)';
          break;
        default:
          return { success: false, error: t('ocr.unknownEngine') };
      }

      const installPath = getInstallPath();
      if (!installPath) {
        return {
          success: false,
          error: t('ocr.cantFindPath') + packageName,
        };
      }

      logger.info(`Installing ${packageName} to ${installPath}`);

      sendProgress(mainWindow, engineId, 10, t('ocr.downloading', { name: packageDesc }));

      try {
        await execAsync('npm --version', { timeout: 10000 });
      } catch (e) {
        return {
          success: false,
          error: t('ocr.npmUnavailable'),
        };
      }

      sendProgress(mainWindow, engineId, 30, t('ocr.installing'));

      const { stdout, stderr } = await execAsync(
        `npm install ${packageName} --save --legacy-peer-deps`,
        {
          cwd: installPath,
          timeout: 600000,
          env: { ...process.env, npm_config_loglevel: 'error' },
        }
      );

      logger.debug('npm install stdout:', stdout);

      // Drop cached instance so next call picks up the fresh module
      if (engineId === 'paddle-ocr') {
        global.pureJsOcrInstance = null;
      } else if (engineId === 'rapid-ocr') {
        global.gutenyeOcrInstance = null;
      }

      sendProgress(mainWindow, engineId, 100, t('ocr.installDone'));

      return {
        success: true,
        message: t('ocr.installSuccess', { name: packageDesc }),
        needRestart: true,
        restartMessage: t('ocr.restartHint'),
      };
    } catch (error) {
      logger.error('Download failed:', error);
      return { success: false, error: formatError(error) };
    }
  });

  ipcMain.handle(CHANNELS.OCR.REMOVE_ENGINE, async (event, engineId) => {
    logger.info('Removing engine:', engineId);

    try {
      const checkModule = (moduleName) => {
        if (moduleName === '@gutenye/ocr-node') return !!resolveOcrModule();
        try {
          require.resolve(moduleName);
          return true;
        } catch (e) {
          return false;
        }
      };

      const paddleInstalled = checkModule('multilingual-purejs-ocr');
      const rapidInstalled = checkModule('@gutenye/ocr-node');

      let localEngineCount = 0;
      if (paddleInstalled) localEngineCount++;
      if (rapidInstalled) localEngineCount++;

      let packageName, isTargetInstalled;

      switch (engineId) {
        case 'paddle-ocr':
          packageName = 'multilingual-purejs-ocr';
          isTargetInstalled = paddleInstalled;
          break;
        case 'rapid-ocr':
          packageName = '@gutenye/ocr-node';
          isTargetInstalled = rapidInstalled;
          break;
        case 'llm-vision':
          return { success: false, error: t('ocr.builtinEngine') };
        case 'windows-ocr':
          return { success: false, error: t('ocr.systemEngine') };
        default:
          return { success: false, error: t('ocr.cantRemove') };
      }

      if (!isTargetInstalled) {
        return { success: false, error: t('ocr.notInstalled') };
      }

      // Refuse removal if it would leave zero local engines installed
      if (localEngineCount <= 1) {
        return {
          success: false,
          error: t('ocr.keepOneLocal'),
        };
      }

      const installPath = getInstallPath();
      if (!installPath) {
        return { success: false, error: t('ocr.cantFindUninstallPath') };
      }

      logger.info(`Uninstalling ${packageName} from ${installPath}`);

      await execAsync(`npm uninstall ${packageName}`, {
        cwd: installPath,
        timeout: 60000,
      });

      if (engineId === 'paddle-ocr') {
        global.paddleOcrInstance = null;
      } else if (engineId === 'rapid-ocr') {
        global.rapidOcrInstance = null;
      }

      return { success: true, message: t('ocr.uninstalled', { name: packageName }) };
    } catch (error) {
      logger.error('Remove failed:', error);
      return { success: false, error: error.message || t('ocr.uninstallFailed') };
    }
  });

  // ===== Health check + repair =====

  // Loads the engine and creates an instance (which loads model files) to
  // detect "module installed but native binding broken" cases.
  ipcMain.handle(CHANNELS.OCR.HEALTH_CHECK, async (event, engineId) => {
    logger.info('Health check for engine:', engineId);

    if (engineId === 'rapid-ocr') {
      let moduleAvailable = false;
      try {
        if (resolveOcrModule()) {
          moduleAvailable = true;
        } else {
          throw new Error('not found');
        }
      } catch (e) {
        return {
          healthy: false,
          error: 'module_missing',
          message: t('ocr.moduleMissing'),
          details: { resolveError: e.message },
        };
      }

      try {
        const ocrModule = await loadOcrModule();
        let Ocr = ocrModule.default;
        if (!Ocr?.create) Ocr = ocrModule.Ocr;
        if (!Ocr?.create && typeof ocrModule.create === 'function') Ocr = ocrModule;

        if (!Ocr?.create) {
          return {
            healthy: false,
            error: 'module_corrupt',
            message: t('ocr.moduleCorrupt'),
          };
        }

        const instance = await Ocr.create();

        if (!instance) {
          return {
            healthy: false,
            error: 'instance_failed',
            message: t('ocr.instanceFailed'),
          };
        }

        global.gutenyeOcrInstance = instance;

        return { healthy: true, message: t('ocr.engineHealthy') };
      } catch (e) {
        logger.error('Health check failed:', e);
        return {
          healthy: false,
          error: 'load_failed',
          message: t('ocr.loadFailed', { detail: e.message }),
          details: { loadError: e.message },
        };
      }
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

  // Force-reinstall: nuke instance + module + require cache, then install fresh.
  // Only supports rapid-ocr because its native binary is the main failure mode.
  ipcMain.handle(CHANNELS.OCR.REPAIR_ENGINE, async (event, engineId) => {
    const mainWindow = getMainWindow();
    logger.info('Repairing engine:', engineId);

    if (engineId !== 'rapid-ocr') {
      return { success: false, error: t('ocr.repairOnlyRapid') };
    }

    try {
      const installPath = getInstallPath();
      if (!installPath) {
        return {
          success: false,
          error: t('ocr.repairCantFindPath'),
        };
      }

      sendProgress(mainWindow, engineId, 5, t('ocr.repairChecking'));

      try {
        await execAsync('npm --version', { timeout: 10000 });
      } catch (e) {
        return {
          success: false,
          error: t('ocr.npmUnavailable'),
        };
      }

      global.gutenyeOcrInstance = null;

      sendProgress(mainWindow, engineId, 15, t('ocr.repairUninstalling'));

      try {
        await execAsync('npm uninstall @gutenye/ocr-node @gutenye/ocr-models @gutenye/ocr-common', {
          cwd: installPath,
          timeout: 60000,
          env: { ...process.env, npm_config_loglevel: 'error' },
        });
      } catch (e) {
        logger.warn('Uninstall step had issues (may be OK):', e.message);
      }

      // Evict any cached references so the next require picks up the new copy
      for (const key of Object.keys(require.cache)) {
        if (key.includes('@gutenye') || key.includes('ocr-node') || key.includes('ocr-models') || key.includes('ocr-common')) {
          delete require.cache[key];
        }
      }

      sendProgress(mainWindow, engineId, 40, t('ocr.repairDownloading'));

      const { stdout, stderr } = await execAsync(
        'npm install @gutenye/ocr-node --save --legacy-peer-deps',
        {
          cwd: installPath,
          timeout: 600000,
          env: { ...process.env, npm_config_loglevel: 'error' },
        }
      );

      logger.debug('Repair install stdout:', stdout);

      sendProgress(mainWindow, engineId, 80, t('ocr.repairVerifying'));

      try {
        // NODE_PATH points node at the freshly-installed module
        const verifyResult = await execAsync(
          'node -e "require(\'@gutenye/ocr-node\'); console.log(\'OK\')"',
          {
            cwd: installPath,
            timeout: 15000,
            env: { ...process.env, NODE_PATH: path.join(installPath, 'node_modules') },
          }
        );

        if (!verifyResult.stdout.includes('OK')) {
          throw new Error('Verification failed');
        }
      } catch (verifyError) {
        logger.warn('In-process verify failed, but module may work after restart:', verifyError.message);
      }

      sendProgress(mainWindow, engineId, 100, t('ocr.repairDone'));

      return {
        success: true,
        message: t('ocr.repairSuccess'),
        needRestart: true,
        restartMessage: t('ocr.repairRestartHint'),
      };
    } catch (error) {
      logger.error('Repair failed:', error);
      return { success: false, error: formatError(error) };
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

      const language = options.language || 'zh-Hans';
      const langMap = {
        'zh-Hans': 'zh-Hans-CN',
        'zh-Hant': 'zh-Hant-TW',
        'en': 'en-US',
        'ja': 'ja-JP',
        'ko': 'ko-KR',
      };
      const winLang = langMap[language] || language;

      const psScript = getWindowsOCRScript(tempFile, winLang);

      const result = await execAsync(
        `powershell -NoProfile -ExecutionPolicy Bypass -Command "${psScript.replace(/"/g, '\\"')}"`,
        { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, windowsHide: true }
      );

      try { fs.unlinkSync(tempFile); } catch (e) {}

      const text = result.stdout.trim();
      logger.debug('Windows OCR result length:', text.length);

      return {
        success: true,
        text,
        confidence: text ? 0.9 : 0,
        engine: 'windows-ocr',
      };
    } catch (error) {
      logger.error('Windows OCR failed:', error);
      return { success: false, error: error.message || t('ocr.winOcrFailed') };
    }
  });

  // PaddleOCR — tries purejs (pure JS), then gutenye (native, faster)
  ipcMain.handle(CHANNELS.OCR.PADDLE_OCR, async (event, imageData, options = {}) => {
    try {
      let base64Data = imageData;
      if (imageData.startsWith('data:image')) {
        base64Data = imageData.split(',')[1];
      }

      const imageBuffer = Buffer.from(base64Data, 'base64');
      const tempFile = path.join(os.tmpdir(), `t-translate-paddle-${Date.now()}.png`);
      fs.writeFileSync(tempFile, imageBuffer);

      let result = null;
      let lastError = null;

      try {
        const pureJsModule = await import('multilingual-purejs-ocr');
        const OcrClass = pureJsModule.Ocr || pureJsModule.default?.Ocr || pureJsModule.default;

        if (typeof OcrClass === 'function') {
          if (!global.pureJsOcrInstance) {
            global.pureJsOcrInstance = new OcrClass();
          }

          const imgBuffer = fs.readFileSync(tempFile);
          result = await global.pureJsOcrInstance.recognize(imgBuffer);

          if (result) {
            let text = typeof result === 'string' ? result : result.text || '';
            if (Array.isArray(result)) {
              text = result.map(item => item.text || item[1]?.[0] || String(item)).join('\n');
            }

            if (text) {
              try { fs.unlinkSync(tempFile); } catch (e) {}
              return {
                success: true,
                text,
                confidence: 0.9,
                engine: 'purejs-ocr',
              };
            }
          }
        }
      } catch (e) {
        lastError = e;
      }

      try {
        const ocrModule = await loadOcrModule();
        if (!ocrModule) throw new Error('OCR module not available');
        let Ocr = ocrModule.default;
        if (!Ocr?.create) Ocr = ocrModule.Ocr;
        if (!Ocr?.create && typeof ocrModule.create === 'function') Ocr = ocrModule;

        if (Ocr?.create) {
          if (!global.gutenyeOcrInstance) {
            global.gutenyeOcrInstance = await Ocr.create();
          }

          result = await global.gutenyeOcrInstance.detect(tempFile);

          if (result?.length > 0) {
            const blocks = result.map((item, index) => {
              // Bbox field naming varies between versions. Each box is
              // [[x1,y1], [x2,y2], [x3,y3], [x4,y4]]; reduce to axis-aligned rect.
              let bbox = null;

              if (item.box || item.bbox || item.position) {
                const box = item.box || item.bbox || item.position;
                if (Array.isArray(box) && box.length >= 4) {
                  const xs = box.map(p => p[0] || p.x || 0);
                  const ys = box.map(p => p[1] || p.y || 0);
                  bbox = {
                    x: Math.min(...xs),
                    y: Math.min(...ys),
                    width: Math.max(...xs) - Math.min(...xs),
                    height: Math.max(...ys) - Math.min(...ys),
                  };
                }
              }

              return {
                text: item.text,
                confidence: item.score || 0.9,
                bbox: bbox,
                index,
              };
            });

            // Stitch fragmented per-line detections back into paragraphs
            const mergedBlocks = smartMerge(blocks, {
              lineGapThreshold: 1.5,
              xOverlapRatio: 0.3,
            });

            const fullText = mergedBlocksToText(mergedBlocks);

            logger.debug(`OCR merge: ${blocks.length} blocks -> ${mergedBlocks.length} paragraphs`);

            try { fs.unlinkSync(tempFile); } catch (e) {}

            return {
              success: true,
              text: fullText,
              blocks: mergedBlocks,
              rawBlocks: blocks,
              confidence: mergedBlocks.reduce((sum, b) => sum + b.confidence, 0) / mergedBlocks.length,
              engine: 'gutenye-ocr',
            };
          }
        }
      } catch (e) {
        lastError = lastError || e;
      }

      try { fs.unlinkSync(tempFile); } catch (e) {}

      if (lastError) {
        return { success: false, error: t('ocr.paddleLoadFailed', { detail: lastError.message }) };
      }

      return { success: true, text: '', blocks: [], confidence: 0, engine: 'purejs-ocr' };
    } catch (error) {
      logger.error('PaddleOCR failed:', error);
      return { success: false, error: error.message };
    }
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

// Returns the directory where npm install should run. In packaged builds we
// install into userData (writable + persists across upgrades). In dev we walk
// up from __dirname looking for the project package.json.
function getInstallPath() {
  const appPath = app.getAppPath();
  const isPackaged = app.isPackaged;

  if (isPackaged) {
    return app.getPath('userData');
  }

  const possiblePaths = [
    appPath,
    path.dirname(appPath),
    process.cwd(),
    path.join(process.cwd(), '..'),
    path.resolve(__dirname, '..'),
    path.resolve(__dirname, '../..'),
  ];

  for (const checkPath of possiblePaths) {
    try {
      const packageJsonPath = path.join(checkPath, 'package.json');
      if (fs.existsSync(packageJsonPath)) {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        if (pkg.name === 't-translate' || pkg.dependencies?.electron) {
          return checkPath;
        }
      }
    } catch (e) {}
  }

  const cwd = process.cwd();
  if (cwd !== '/' && !cwd.match(/^[A-Z]:\\$/)) {
    return cwd;
  }

  return null;
}

function sendProgress(mainWindow, engineId, progress, status) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(CHANNELS.OCR.DOWNLOAD_PROGRESS, {
      engineId, progress, status,
    });
  }
}

function formatError(error) {
  if (error.message?.includes('ENOENT')) {
    return t('ocr.npmNotFound');
  } else if (error.message?.includes('ETIMEDOUT') || error.message?.includes('timeout')) {
    return t('ocr.downloadTimeout');
  } else if (error.message?.includes('EACCES')) {
    return t('ocr.permissionDenied');
  }
  return error.message?.substring(0, 200) || t('ocr.downloadFailed');
}

// PowerShell driver for Windows.Media.Ocr. Uses AsyncOperation-AsTask shim
// because PS5 lacks native await for WinRT IAsyncOperation<T>.
function getWindowsOCRScript(tempFile, winLang) {
  return `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
Function Await($WinRtTask, $ResultType) { $asTask = $asTaskGeneric.MakeGenericMethod($ResultType); $netTask = $asTask.Invoke($null, @($WinRtTask)); $netTask.Wait(-1) | Out-Null; $netTask.Result }
try {
  $file = [System.IO.File]::OpenRead("${tempFile.replace(/\\/g, '\\\\')}")
  $stream = [Windows.Storage.Streams.RandomAccessStream]::FromStream($file)
  $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $ocrEngine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage("${winLang}")
  if ($null -eq $ocrEngine) { $ocrEngine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }
  $result = Await ($ocrEngine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
  if ($result.Text) { $result.Text } else { ($result.Lines | ForEach-Object { $_.Text }) -join [Environment]::NewLine }
  $stream.Dispose(); $file.Dispose()
} catch { Write-Error $_.Exception.Message; exit 1 }
  `.trim();
}

module.exports = register;
