// electron/ipc/glass.js
// 玻璃翻译窗口 IPC handlers
// 包含：窗口控制、设置、翻译、截图等

const { ipcMain, safeStorage } = require('electron');
const { CHANNELS } = require('../shared/channels');
const logger = require('../utils/logger')('IPC:Glass');

/**
 * 注册玻璃窗口相关 IPC handlers
 * @param {Object} ctx - 共享上下文
 */
function register(ctx) {
  const { getMainWindow, getGlassWindow, store, managers } = ctx;
  
  // 获取截图模块（懒加载）
  let screenshotModule = null;
  const getScreenshotModule = () => {
    if (!screenshotModule) {
      screenshotModule = require('../screenshot-module');
    }
    return screenshotModule;
  };
  
  // ==================== 窗口控制 ====================
  
  /**
   * 打开玻璃窗口
   */
  ipcMain.handle(CHANNELS.GLASS.OPEN, () => {
    if (managers.createGlassWindow) {
      managers.createGlassWindow();
      return true;
    }
    logger.warn('createGlassWindow not available');
    return false;
  });
  
  /**
   * 关闭玻璃窗口
   */
  ipcMain.handle(CHANNELS.GLASS.CLOSE, () => {
    const glassWindow = getGlassWindow();
    if (glassWindow) {
      glassWindow.close();
      return true;
    }
    return false;
  });
  
  /**
   * 获取玻璃窗口边界
   */
  ipcMain.handle(CHANNELS.GLASS.GET_BOUNDS, () => {
    const glassWindow = getGlassWindow();
    if (glassWindow) {
      return glassWindow.getBounds();
    }
    return null;
  });
  
  /**
   * 设置窗口置顶
   */
  ipcMain.handle(CHANNELS.GLASS.SET_ALWAYS_ON_TOP, (event, enabled) => {
    const glassWindow = getGlassWindow();
    if (glassWindow) {
      glassWindow.setAlwaysOnTop(enabled);
      return true;
    }
    return false;
  });
  
  /**
   * 设置窗口透明度
   */
  ipcMain.handle(CHANNELS.GLASS.SET_OPACITY, (event, opacity) => {
    const glassWindow = getGlassWindow();
    if (glassWindow && !glassWindow.isDestroyed()) {
      glassWindow.setOpacity(opacity);
      // 同时保存
      const current = store.get('glassLocalSettings', {});
      store.set('glassLocalSettings', { ...current, opacity });
      return true;
    }
    return false;
  });
  
  // ==================== 鼠标穿透 ====================
  
  /**
   * 设置穿透模式 - 使用智能穿透
   */
  ipcMain.handle(CHANNELS.GLASS.SET_PASS_THROUGH, (event, enabled) => {
    const glassWindow = getGlassWindow();
    if (glassWindow && !glassWindow.isDestroyed()) {
      logger.debug('Setting pass-through mode:', enabled);
      if (enabled) {
        glassWindow.setIgnoreMouseEvents(true, { forward: true });
      } else {
        glassWindow.setIgnoreMouseEvents(false);
      }
      return true;
    }
    return false;
  });
  
  /**
   * 动态设置穿透（根据鼠标位置）
   */
  ipcMain.handle(CHANNELS.GLASS.SET_IGNORE_MOUSE, (event, ignore) => {
    const glassWindow = getGlassWindow();
    if (glassWindow && !glassWindow.isDestroyed()) {
      if (ignore) {
        glassWindow.setIgnoreMouseEvents(true, { forward: true });
      } else {
        glassWindow.setIgnoreMouseEvents(false);
      }
      return true;
    }
    return false;
  });
  
  // ==================== 设置管理 ====================
  
  /**
   * 获取玻璃窗口设置（合并主程序设置和本地设置）
   */
  ipcMain.handle(CHANNELS.GLASS.GET_SETTINGS, async () => {
    const mainWindow = getMainWindow();
    const mainSettings = store.get('settings', {});
    const glassConfig = mainSettings.glassWindow || {};
    const ocrConfig = mainSettings.ocr || {};
    const localSettings = store.get('glassLocalSettings', {});
    
    // 默认语言设置
    let currentTargetLang = mainSettings.translation?.defaultTargetLang ?? 'zh';
    let currentSourceLang = mainSettings.translation?.defaultSourceLang ?? 'auto';
    
    // 尝试从主窗口获取实时的目标语言
    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        const langSettings = await mainWindow.webContents.executeJavaScript(`
          (function() {
            try {
              const store = window.__TRANSLATION_STORE__;
              if (store) {
                const state = store.getState();
                return {
                  targetLanguage: state.currentTranslation?.targetLanguage || 'zh',
                  sourceLanguage: state.currentTranslation?.sourceLanguage || 'auto'
                };
              }
              return { targetLanguage: 'zh', sourceLanguage: 'auto' };
            } catch(e) {
              return { targetLanguage: 'zh', sourceLanguage: 'auto' };
            }
          })()
        `);
        currentTargetLang = langSettings.targetLanguage;
        currentSourceLang = langSettings.sourceLanguage;
      } catch (e) {
        logger.debug('Could not get language settings from main window:', e.message);
      }
    }
    
    const merged = {
      // 从主程序设置
      refreshInterval: glassConfig.refreshInterval ?? 3000,
      smartDetect: glassConfig.smartDetect ?? true,
      streamOutput: glassConfig.streamOutput ?? true,
      ocrEngine: ocrConfig.engine ?? glassConfig.ocrEngine ?? 'llm-vision',
      globalOcrEngine: ocrConfig.engine ?? 'llm-vision',
      defaultOpacity: glassConfig.defaultOpacity ?? 0.85,
      autoPin: glassConfig.autoPin ?? true,
      lockTargetLang: glassConfig.lockTargetLang ?? true,
      // 翻译设置
      targetLanguage: currentTargetLang,
      sourceLanguage: currentSourceLang,
      // 主题
      theme: mainSettings.interface?.theme ?? 'light',
      // 本地设置
      opacity: localSettings.opacity ?? glassConfig.defaultOpacity ?? 0.85,
      isPinned: localSettings.isPinned ?? glassConfig.autoPin ?? true,
    };
    
    logger.debug('Get settings:', merged);
    return merged;
  });
  
  /**
   * 保存玻璃窗口本地设置
   */
  ipcMain.handle(CHANNELS.GLASS.SAVE_SETTINGS, (event, settings) => {
    const glassWindow = getGlassWindow();
    const current = store.get('glassLocalSettings', {});
    store.set('glassLocalSettings', { ...current, ...settings });
    
    // 如果设置了透明度，实时应用
    if (settings.opacity !== undefined && glassWindow && !glassWindow.isDestroyed()) {
      glassWindow.setOpacity(settings.opacity);
    }
    
    return true;
  });
  
  /**
   * 获取翻译源配置
   */
  ipcMain.handle(CHANNELS.GLASS.GET_PROVIDER_CONFIGS, async () => {
    const mainSettings = store.get('settings', {});
    const providerSettings = mainSettings.providers || {};
    
    // 解密 API Keys
    const configs = JSON.parse(JSON.stringify(providerSettings.configs || {}));
    
    for (const providerId of Object.keys(configs)) {
      const config = configs[providerId];
      if (config?.apiKey === '***encrypted***') {
        const encryptKey = `provider_${providerId}_apiKey`;
        const stored = store.get(`__encrypted_${encryptKey}`);
        
        if (stored) {
          try {
            if (safeStorage.isEncryptionAvailable()) {
              const buffer = Buffer.from(stored, 'base64');
              configs[providerId].apiKey = safeStorage.decryptString(buffer);
            } else {
              configs[providerId].apiKey = Buffer.from(stored, 'base64').toString('utf-8');
            }
          } catch (e) {
            logger.error(`Failed to decrypt ${providerId} API key:`, e);
            configs[providerId].apiKey = '';
          }
        } else {
          configs[providerId].apiKey = '';
        }
      }
    }
    
    return {
      list: providerSettings.list || [],
      configs,
    };
  });
  
  /**
   * 通知玻璃窗重新加载设置
   */
  ipcMain.handle(CHANNELS.GLASS.NOTIFY_SETTINGS_CHANGED, () => {
    const glassWindow = getGlassWindow();
    if (glassWindow && !glassWindow.isDestroyed()) {
      const settings = store.get('settings', {});
      glassWindow.webContents.send(CHANNELS.GLASS.SETTINGS_CHANGED, settings);
      return true;
    }
    return false;
  });
  
  // ==================== 翻译 ====================
  
  /**
   * 翻译文本（转发到主窗口）
   */
  ipcMain.handle(CHANNELS.GLASS.TRANSLATE, async (event, text) => {
    try {
      const mainWindow = getMainWindow();
      mainWindow?.webContents.send(CHANNELS.GLASS.TRANSLATE_REQUEST, text);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  
  // ==================== 区域截图 ====================
  
  /**
   * 截取玻璃窗口覆盖区域
   */
  ipcMain.handle(CHANNELS.GLASS.CAPTURE_REGION, async (event, bounds) => {
    const glassWindow = getGlassWindow();
    
    try {
      if (!glassWindow || glassWindow.isDestroyed()) {
        throw new Error('玻璃窗口不存在');
      }
      
      // 保存原始透明度
      let originalOpacity = 1;
      try {
        originalOpacity = glassWindow.getOpacity();
      } catch (e) {
        originalOpacity = 0.85;
      }
      
      // 强制隐藏窗口
      try {
        glassWindow.setOpacity(0);
        await new Promise(resolve => setTimeout(resolve, 80));
      } catch (e) {
        logger.warn('Failed to set opacity:', e.message);
      }
      
      // 使用 node-screenshots 截取指定区域
      const screenshotMod = getScreenshotModule();
      const screenshot = await screenshotMod.captureRegion(bounds);
      
      // 恢复窗口透明度
      try {
        glassWindow.setOpacity(originalOpacity > 0 ? originalOpacity : 0.85);
      } catch (e) {
        logger.warn('Failed to restore opacity:', e.message);
      }
      
      if (screenshot) {
        return { success: true, imageData: screenshot };
      } else {
        throw new Error('截图失败');
      }
    } catch (error) {
      logger.error('Capture region error:', error);
      // 确保窗口恢复可见
      if (glassWindow && !glassWindow.isDestroyed()) {
        try {
          glassWindow.setOpacity(0.85);
        } catch (e) {
          // 忽略
        }
      }
      return { success: false, error: error.message };
    }
  });
  
  // ==================== 数据同步 ====================
  
  /**
   * 添加到收藏（从玻璃窗口）
   */
  ipcMain.handle(CHANNELS.GLASS.ADD_TO_FAVORITES, (event, item) => {
    const mainWindow = getMainWindow();
    mainWindow?.webContents.send(CHANNELS.DATA.ADD_TO_FAVORITES, item);
    return true;
  });
  
  /**
   * 添加到历史记录（从玻璃窗口）
   */
  ipcMain.handle(CHANNELS.GLASS.ADD_TO_HISTORY, (event, item) => {
    const mainWindow = getMainWindow();
    mainWindow?.webContents.send(CHANNELS.DATA.ADD_TO_HISTORY, item);
    return true;
  });
  
  /**
   * 获取历史记录（从主窗口）
   */
  ipcMain.handle(CHANNELS.GLASS.GET_HISTORY, async (event, limit = 20) => {
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) {
      return [];
    }
    
    try {
      // 从主窗口获取历史记录
      // localStorage key 是 'translation-store'（Zustand persist 配置）
      const history = await mainWindow.webContents.executeJavaScript(`
        (function() {
          try {
            const stored = localStorage.getItem('translation-store');
            if (stored) {
              const parsed = JSON.parse(stored);
              // Zustand persist 存储格式: { state: { history: [...] } }
              const state = parsed.state || parsed;
              const items = state.history || [];
              return items.slice(0, ${limit}).map(item => ({
                id: item.id,
                source: item.sourceText,
                translated: item.translatedText,
                timestamp: item.timestamp,
                sourceLang: item.sourceLanguage,
                targetLang: item.targetLanguage,
              }));
            }
            return [];
          } catch(e) {
            console.error('Failed to get history:', e);
            return [];
          }
        })()
      `);
      return history || [];
    } catch (e) {
      logger.debug('Could not get history from main window:', e.message);
      return [];
    }
  });
  
  /**
   * 同步目标语言到主程序
   */
  ipcMain.handle(CHANNELS.GLASS.SYNC_TARGET_LANGUAGE, (event, langCode) => {
    const mainWindow = getMainWindow();
    mainWindow?.webContents.send(CHANNELS.DATA.SYNC_TARGET_LANGUAGE, langCode);
    return true;
  });
  
  logger.info('Glass IPC handlers registered');
}

module.exports = register;
