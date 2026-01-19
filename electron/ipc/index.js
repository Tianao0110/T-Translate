// electron/ipc/index.js
// IPC 统一注册入口 - 依赖注入中心
// 所有 IPC handler 在此统一注册，子模块不 require 父模块

const logger = require('../utils/logger')('IPC');

// ==================== 子模块导入 ====================
const registerSystemIPC = require('./system');
const registerStoreIPC = require('./store');
const registerShortcutsIPC = require('./shortcuts');
const registerScreenshotIPC = require('./screenshot');
const registerClipboardIPC = require('./clipboard');
const registerGlassIPC = require('./glass');
const registerSubtitleIPC = require('./subtitle');
const registerSelectionIPC = require('./selection');
const registerSecureStorageIPC = require('./secure-storage');
const registerOcrIPC = require('./ocr');
const registerPrivacyIPC = require('./privacy');
const { registerThemeIPC } = require('./theme');

/**
 * 初始化所有 IPC handler
 * 
 * @param {Object} deps - 依赖注入对象
 * @param {Object} deps.windows - 窗口引用管理器
 * @param {Object} deps.runtime - 运行时状态
 * @param {Object} deps.store - 持久化存储
 * @param {Object} deps.app - Electron app 实例
 * @param {Object} deps.managers - 管理器集合
 * @param {Function} deps.managers.startScreenshot - 启动截图
 * @param {Function} deps.managers.toggleGlassWindow - 切换玻璃窗口
 * @param {Function} deps.managers.toggleSelectionTranslate - 切换划词翻译
 * 
 * @example
 * // 在 main.js 中使用
 * const { initIPC } = require('./ipc');
 * const { store, runtime, windows } = require('./state');
 * 
 * app.whenReady().then(() => {
 *   initIPC({
 *     windows,
 *     runtime,
 *     store,
 *     app,
 *     managers: {
 *       startScreenshot,
 *       toggleGlassWindow,
 *       toggleSelectionTranslate,
 *     },
 *   });
 * });
 */
function initIPC(deps) {
  logger.info('Initializing IPC handlers...');
  
  // 验证必要依赖
  const requiredDeps = ['windows', 'runtime', 'store', 'app'];
  for (const dep of requiredDeps) {
    if (!deps[dep]) {
      logger.error(`Missing required dependency: ${dep}`);
      throw new Error(`IPC initialization failed: missing ${dep}`);
    }
  }
  
  // 创建共享上下文（传递给所有子模块）
  const context = {
    // 窗口引用
    getMainWindow: () => deps.windows.main,
    getGlassWindow: () => deps.windows.glass,
    getScreenshotWindow: () => deps.windows.screenshot,
    getSelectionWindow: () => deps.windows.selection,
    getSubtitleCaptureWindow: () => deps.windows.subtitleCapture,
    
    // 运行时状态
    runtime: deps.runtime,
    
    // 持久化存储
    store: deps.store,
    
    // Electron app
    app: deps.app,
    
    // 管理器函数（通过依赖注入传入，避免循环依赖）
    managers: deps.managers || {},
  };
  
  // ==================== 注册各模块 IPC ====================
  
  // 批次 3.1: 系统/窗口控制
  registerSystemIPC(context);
  
  // 批次 3.2: 存储 & 快捷键
  registerStoreIPC(context);
  registerShortcutsIPC(context);
  
  // 批次 3.3: 截图 & 剪贴板
  registerScreenshotIPC(context);
  registerClipboardIPC(context);
  
  // 批次 3.4: 玻璃窗口 & 字幕
  registerGlassIPC(context);
  registerSubtitleIPC(context);
  
  // 批次 3.5: 划词翻译 & 安全存储
  registerSelectionIPC(context);
  registerSecureStorageIPC(context);
  
  // 批次 3.6: OCR & 隐私
  registerOcrIPC(context);
  registerPrivacyIPC(context);
  
  // 批次 3.7: 主题管理
  registerThemeIPC({ store: deps.store, logger });
  
  logger.success('All IPC handlers initialized');
  
  return context;
}

/**
 * 清理 IPC handlers（用于热重载或测试）
 */
function cleanupIPC() {
  const { ipcMain } = require('electron');
  
  // 注意：Electron 没有提供移除所有 handler 的方法
  // 这个函数主要用于记录清理意图，实际清理需要手动处理
  logger.info('IPC cleanup requested (manual cleanup may be needed)');
}

// ==================== 导出 ====================

module.exports = {
  initIPC,
  cleanupIPC,
};
