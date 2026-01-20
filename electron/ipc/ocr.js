// electron/ipc/ocr.js
// OCR 相关 IPC handlers
// 包含：引擎检测、引擎管理、各种 OCR 识别

const { ipcMain, app } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

const { CHANNELS, OCR_ENGINES } = require('../shared/channels');
const logger = require('../utils/logger')('IPC:OCR');

/**
 * 注册 OCR 相关 IPC handlers
 * @param {Object} ctx - 共享上下文
 */
function register(ctx) {
  const { getMainWindow, store } = ctx;
  
  // ==================== 引擎检测 ====================
  
  /**
   * 检查 Windows OCR 是否可用
   */
  ipcMain.handle(CHANNELS.OCR.CHECK_WINDOWS_OCR, async () => {
    if (process.platform !== 'win32') {
      return { available: false, reason: '非 Windows 系统' };
    }
    
    try {
      const release = os.release();
      const majorVersion = parseInt(release.split('.')[0]);
      
      if (majorVersion < 10) {
        return { available: false, reason: '需要 Windows 10 或更高版本' };
      }
      
      // 检查可用的 OCR 语言
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
          reason: languages.length > 0 ? null : '未安装任何 OCR 语言包',
        };
      } catch (e) {
        logger.error('Failed to get Windows OCR languages:', e.message);
        return { available: true, languages: [], reason: '无法获取语言列表' };
      }
    } catch (error) {
      logger.error('Check Windows OCR failed:', error);
      return { available: false, reason: error.message };
    }
  });
  
  /**
   * 检查 PaddleOCR 是否可用
   */
  ipcMain.handle(CHANNELS.OCR.CHECK_PADDLE_OCR, async () => {
    // 尝试 @gutenye/ocr-node
    try {
      await import('@gutenye/ocr-node');
      logger.debug('@gutenye/ocr-node is available');
      return { available: true, version: 'gutenye' };
    } catch (e) {
      logger.debug('@gutenye/ocr-node not available:', e.message);
    }
    
    // 尝试 multilingual-purejs-ocr
    try {
      await import('multilingual-purejs-ocr');
      logger.debug('multilingual-purejs-ocr is available');
      return { available: true, version: 'purejs' };
    } catch (e) {
      logger.debug('multilingual-purejs-ocr not available:', e.message);
    }
    
    return { available: false };
  });
  
  /**
   * 检查 OCR 引擎安装状态
   */
  ipcMain.handle(CHANNELS.OCR.CHECK_INSTALLED, async () => {
    const status = {
      'llm-vision': true, // 内置
      'rapid-ocr': false,
    };
    
    const checkModule = (moduleName) => {
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
  
  /**
   * 获取可用的 OCR 引擎列表
   */
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
    
    // 检查 RapidOCR
    let rapidAvailable = false;
    try {
      require.resolve('@gutenye/ocr-node');
      rapidAvailable = true;
    } catch (e) {
      try {
        require.resolve('multilingual-purejs-ocr');
        rapidAvailable = true;
      } catch (e2) {}
    }
    
    engines.push({
      id: OCR_ENGINES.RAPID_OCR,
      name: 'RapidOCR',
      description: '本地 OCR，基于 PP-OCRv4，速度快',
      available: rapidAvailable,
      isOnline: false,
      tier: 1,
    });
    
    // 在线 OCR API
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
  
  // ==================== 引擎管理 ====================
  
  /**
   * 下载 OCR 引擎
   */
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
          return { success: false, error: '未知的引擎 ID' };
      }
      
      // 获取安装路径
      const installPath = getInstallPath();
      if (!installPath) {
        return {
          success: false,
          error: '无法确定安装路径，请手动在项目目录运行: npm install ' + packageName,
        };
      }
      
      logger.info(`Installing ${packageName} to ${installPath}`);
      
      // 发送进度
      sendProgress(mainWindow, engineId, 10, `正在下载 ${packageDesc}...`);
      
      // 检查 npm
      try {
        await execAsync('npm --version', { timeout: 10000 });
      } catch (e) {
        return {
          success: false,
          error: 'npm 不可用，请确保已安装 Node.js 并添加到环境变量',
        };
      }
      
      sendProgress(mainWindow, engineId, 30, '正在安装依赖...');
      
      // 执行 npm install
      const { stdout, stderr } = await execAsync(
        `npm install ${packageName} --save --legacy-peer-deps`,
        {
          cwd: installPath,
          timeout: 600000, // 10 分钟超时
          env: { ...process.env, npm_config_loglevel: 'error' },
        }
      );
      
      logger.debug('npm install stdout:', stdout);
      
      // 清理全局实例缓存
      if (engineId === 'paddle-ocr') {
        global.pureJsOcrInstance = null;
      } else if (engineId === 'rapid-ocr') {
        global.gutenyeOcrInstance = null;
      }
      
      sendProgress(mainWindow, engineId, 100, '安装完成！');
      
      return {
        success: true,
        message: `${packageDesc} 安装成功`,
        needRestart: true,
        restartMessage: '为确保 OCR 引擎正常工作，建议重启应用',
      };
    } catch (error) {
      logger.error('Download failed:', error);
      return { success: false, error: formatError(error) };
    }
  });
  
  /**
   * 删除 OCR 引擎
   */
  ipcMain.handle(CHANNELS.OCR.REMOVE_ENGINE, async (event, engineId) => {
    logger.info('Removing engine:', engineId);
    
    try {
      const checkModule = (moduleName) => {
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
          return { success: false, error: 'LLM Vision 是内置引擎，无法卸载' };
        case 'windows-ocr':
          return { success: false, error: 'Windows OCR 是系统引擎，无法卸载' };
        default:
          return { success: false, error: '无法删除该引擎' };
      }
      
      if (!isTargetInstalled) {
        return { success: false, error: '该引擎未安装' };
      }
      
      if (localEngineCount <= 1) {
        return {
          success: false,
          error: '无法卸载：必须保留至少一个本地 OCR 引擎',
        };
      }
      
      const installPath = getInstallPath();
      if (!installPath) {
        return { success: false, error: '无法确定卸载路径' };
      }
      
      logger.info(`Uninstalling ${packageName} from ${installPath}`);
      
      await execAsync(`npm uninstall ${packageName}`, {
        cwd: installPath,
        timeout: 60000,
      });
      
      // 清理全局实例
      if (engineId === 'paddle-ocr') {
        global.paddleOcrInstance = null;
      } else if (engineId === 'rapid-ocr') {
        global.rapidOcrInstance = null;
      }
      
      return { success: true, message: `${packageName} 已卸载` };
    } catch (error) {
      logger.error('Remove failed:', error);
      return { success: false, error: error.message || '卸载失败' };
    }
  });
  
  // ==================== OCR 识别 ====================
  
  registerOCRRecognizers(ctx);
  
  logger.info('OCR IPC handlers registered');
}

/**
 * 注册各种 OCR 识别器
 */
function registerOCRRecognizers(ctx) {
  const { store } = ctx;
  
  // Windows OCR
  ipcMain.handle(CHANNELS.OCR.WINDOWS_OCR, async (event, imageData, options = {}) => {
    if (process.platform !== 'win32') {
      return { success: false, error: 'Windows OCR 仅在 Windows 系统上可用' };
    }
    
    try {
      // 从 data URL 提取 base64
      let base64Data = imageData;
      if (imageData.startsWith('data:image')) {
        base64Data = imageData.split(',')[1];
      }
      
      // 保存临时图片
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
      
      // PowerShell 脚本（简化版）
      const psScript = getWindowsOCRScript(tempFile, winLang);
      
      const result = await execAsync(
        `powershell -NoProfile -ExecutionPolicy Bypass -Command "${psScript.replace(/"/g, '\\"')}"`,
        { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, windowsHide: true }
      );
      
      // 删除临时文件
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
      return { success: false, error: error.message || 'Windows OCR 识别失败' };
    }
  });
  
  // PaddleOCR
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
      
      // 尝试 multilingual-purejs-ocr
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
      
      // 尝试 @gutenye/ocr-node
      try {
        const ocrModule = await import('@gutenye/ocr-node');
        let Ocr = ocrModule.default;
        if (!Ocr?.create) Ocr = ocrModule.Ocr;
        if (!Ocr?.create && typeof ocrModule.create === 'function') Ocr = ocrModule;
        
        if (Ocr?.create) {
          if (!global.gutenyeOcrInstance) {
            global.gutenyeOcrInstance = await Ocr.create();
          }
          
          result = await global.gutenyeOcrInstance.detect(tempFile);
          
          if (result?.length > 0) {
            // 提取文本块，包含坐标信息
            const blocks = result.map((item, index) => {
              // 尝试获取坐标（不同版本可能有不同的字段名）
              let bbox = null;
              
              if (item.box || item.bbox || item.position) {
                const box = item.box || item.bbox || item.position;
                // box 通常是 [[x1,y1], [x2,y2], [x3,y3], [x4,y4]] 格式
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
            
            const fullText = blocks.map(b => b.text).join('\n');
            try { fs.unlinkSync(tempFile); } catch (e) {}
            
            return {
              success: true,
              text: fullText,
              blocks: blocks,  // 新增：包含坐标的文本块数组
              confidence: blocks.reduce((sum, b) => sum + b.confidence, 0) / blocks.length,
              engine: 'gutenye-ocr',
            };
          }
        }
      } catch (e) {
        lastError = lastError || e;
      }
      
      try { fs.unlinkSync(tempFile); } catch (e) {}
      
      if (lastError) {
        return { success: false, error: `PaddleOCR 引擎加载失败: ${lastError.message}` };
      }
      
      return { success: true, text: '', blocks: [], confidence: 0, engine: 'purejs-ocr' };
    } catch (error) {
      logger.error('PaddleOCR failed:', error);
      return { success: false, error: error.message };
    }
  });
  
  // OCR.space
  ipcMain.handle(CHANNELS.OCR.OCRSPACE, async (event, imageData, options = {}) => {
    try {
      const apiKey = options.apiKey;
      if (!apiKey) {
        return { success: false, error: '未配置 OCR.space API Key' };
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
        return { success: false, error: result.ErrorMessage?.[0] || 'OCR.space 处理失败' };
      }
      
      const text = result.ParsedResults?.[0]?.ParsedText || '';
      return { success: true, text: text.trim(), confidence: 0.95, engine: 'ocrspace' };
    } catch (error) {
      logger.error('OCR.space failed:', error);
      return { success: false, error: error.message };
    }
  });
  
  // Google Vision
  ipcMain.handle(CHANNELS.OCR.GOOGLE_VISION, async (event, imageData, options = {}) => {
    try {
      const apiKey = options.apiKey;
      if (!apiKey) {
        return { success: false, error: '未配置 Google Cloud Vision API Key' };
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
  
  // Azure OCR
  ipcMain.handle(CHANNELS.OCR.AZURE_OCR, async (event, imageData, options = {}) => {
    try {
      const apiKey = options.apiKey;
      const region = options.region || 'eastus';
      
      if (!apiKey) {
        return { success: false, error: '未配置 Azure OCR API Key' };
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
  
  // 百度 OCR
  ipcMain.handle(CHANNELS.OCR.BAIDU_OCR, async (event, imageData, options = {}) => {
    try {
      const apiKey = options.apiKey;
      const secretKey = options.secretKey;
      
      if (!apiKey || !secretKey) {
        return { success: false, error: '未配置百度 OCR API Key' };
      }
      
      // 获取 access_token
      const tokenResponse = await fetch(
        `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${apiKey}&client_secret=${secretKey}`,
        { method: 'POST' }
      );
      const tokenResult = await tokenResponse.json();
      
      if (!tokenResult.access_token) {
        return { success: false, error: '获取百度 access_token 失败' };
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
        return { success: false, error: result.error_msg || '百度 OCR 失败' };
      }
      
      const text = result.words_result?.map(w => w.words).join('\n') || '';
      return { success: true, text: text.trim(), confidence: 0.96, engine: 'baidu-ocr' };
    } catch (error) {
      logger.error('Baidu OCR failed:', error);
      return { success: false, error: error.message };
    }
  });
}

// ==================== 辅助函数 ====================

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
    return 'npm 命令未找到，请确保已安装 Node.js';
  } else if (error.message?.includes('ETIMEDOUT') || error.message?.includes('timeout')) {
    return '下载超时，请检查网络连接后重试';
  } else if (error.message?.includes('EACCES')) {
    return '权限不足，请以管理员身份运行';
  }
  return error.message?.substring(0, 200) || '下载失败';
}

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
