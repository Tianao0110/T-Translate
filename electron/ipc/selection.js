// electron/ipc/selection.js
// 划词翻译 IPC handlers
// 包含：窗口控制、文本获取、设置管理等

const { ipcMain, clipboard, screen } = require('electron');
const { CHANNELS } = require('../shared/channels');
const logger = require('../utils/logger')('IPC:Selection');
const { simulateCtrlC } = require('../utils/native-helper');

/**
 * 注册划词翻译相关 IPC handlers
 * @param {Object} ctx - 共享上下文
 */
function register(ctx) {
  const { getMainWindow, getSelectionWindow, runtime, store, managers } = ctx;
  
  // 获取截图模块（懒加载）
  let screenshotModule = null;
  const getScreenshotModule = () => {
    if (!screenshotModule) {
      screenshotModule = require('../screenshot-module');
    }
    return screenshotModule;
  };
  
  /**
   * 清理文本：限制连续空白行最多 2 行
   * 解决段落识别时产生过多空行的问题
   */
  const cleanTextBlankLines = (text) => {
    if (!text) return text;
    // 将连续的空白行（超过2行）替换为2行
    // \n\n\n+ -> \n\n
    return text.replace(/(\n\s*){3,}/g, '\n\n');
  };
  
  // ==================== 开关控制 ====================
  
  /**
   * 切换划词翻译
   */
  ipcMain.handle(CHANNELS.SELECTION.TOGGLE, () => {
    if (managers.toggleSelectionTranslate) {
      return managers.toggleSelectionTranslate();
    }
    logger.warn('toggleSelectionTranslate not available');
    return false;
  });
  
  /**
   * 获取划词翻译状态
   */
  ipcMain.handle(CHANNELS.SELECTION.GET_ENABLED, () => {
    return runtime.selectionEnabled;
  });
  
  // ==================== 窗口控制 ====================
  
  /**
   * 隐藏划词翻译窗口
   */
  ipcMain.handle(CHANNELS.SELECTION.HIDE, () => {
    const selectionWindow = getSelectionWindow();
    if (selectionWindow && !selectionWindow.isDestroyed()) {
      selectionWindow.hide();
      selectionWindow.webContents.send(CHANNELS.SELECTION.HIDE);
    }
    return true;
  });
  
  /**
   * 设置划词翻译窗口位置
   */
  ipcMain.handle(CHANNELS.SELECTION.SET_POSITION, (event, x, y) => {
    const selectionWindow = getSelectionWindow();
    if (selectionWindow && !selectionWindow.isDestroyed()) {
      selectionWindow.setPosition(Math.round(x), Math.round(y));
    }
    return true;
  });
  
  /**
   * 设置划词翻译窗口位置和大小
   */
  ipcMain.handle(CHANNELS.SELECTION.SET_BOUNDS, (event, bounds) => {
    const selectionWindow = getSelectionWindow();
    if (selectionWindow && !selectionWindow.isDestroyed()) {
      selectionWindow.setBounds({
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
      });
    }
    return true;
  });
  
  /**
   * 调整划词翻译窗口大小
   */
  ipcMain.handle(CHANNELS.SELECTION.RESIZE, (event, { width, height }) => {
    const selectionWindow = getSelectionWindow();
    if (selectionWindow && !selectionWindow.isDestroyed()) {
      selectionWindow.setSize(Math.round(width), Math.round(height));
    }
    return true;
  });
  
  /**
   * 开始拖动窗口
   */
  ipcMain.handle(CHANNELS.SELECTION.START_DRAG, () => {
    const selectionWindow = getSelectionWindow();
    if (selectionWindow && !selectionWindow.isDestroyed()) {
      const bounds = selectionWindow.getBounds();
      return { x: bounds.x, y: bounds.y };
    }
    return null;
  });
  
  // ==================== 设置 ====================
  
  /**
   * 获取划词翻译设置（shallow-merge 默认值，老用户升级也会拿到新字段默认值）
   */
  ipcMain.handle(CHANNELS.SELECTION.GET_SETTINGS, () => {
    const settings = store.get('settings', {});
    const defaults = {
      triggerIcon: 'dot',
      triggerSize: 24,
      triggerColor: '#3b82f6',
      customIconPath: '',
      hoverDelay: 300,
      triggerTimeout: 5000,
      resultTimeout: 3000,
      minChars: 2,
      maxChars: 500,
      stickyViaCapsLock: false,
      stickyWarningShown: false,
    };
    return { ...defaults, ...(settings.selection || {}) };
  });
  
  // ==================== 文本获取 ====================
  
  /**
   * 获取选中的文字
   * 智能防误触：检查剪贴板内容是文字还是文件
   */
  ipcMain.handle(CHANNELS.SELECTION.GET_TEXT, async (event, rect) => {
    // 1. 先尝试 Ctrl+C 复制
    const text = await fetchSelectedText();
    
    // 2. 检查剪贴板格式 (二次验身)
    const formats = clipboard.availableFormats();
    
    // 3. 判断是文件还是文本
    const isFileDrop = formats.some(f =>
      f.includes('FileNameW') ||
      f.includes('FileContents') ||
      f.includes('CF_HDROP') ||
      f === 'text/uri-list'
    );
    
    if (isFileDrop) {
      // 检查是否有纯文本
      if (text && text.trim()) {
        // 检查文本是否像是文件路径
        const looksLikePath = /^[A-Za-z]:\\|^\/|^\\\\|^file:\/\//.test(text.trim());
        
        if (looksLikePath) {
          // 是文件路径，提取文件名进行翻译
          const filename = extractFilenameForTranslation(text.trim());
          if (filename) {
            return { text: filename, method: 'filename', original: text.trim() };
          }
        } else {
          // 虽然有文件格式，但文本不是路径
          return { text: cleanTextBlankLines(text.trim()), method: 'clipboard' };
        }
      }
      
      // 没有文本，用户在拖拽文件
      return { text: null, method: null, reason: 'file_drop' };
    }
    
    // 4. 正常文本处理
    if (text && text.trim()) {
      return { text: cleanTextBlankLines(text.trim()), method: 'clipboard' };
    }
    
    // 5. 复制失败，尝试 OCR 兜底
    const ocrRect = rect || runtime.lastSelectionRect;
    
    if (ocrRect && ocrRect.width > 8 && ocrRect.height > 4) {
      try {
        const ocrText = await getTextByOCR(ocrRect, getScreenshotModule());
        if (ocrText && ocrText.trim()) {
          return { text: cleanTextBlankLines(ocrText.trim()), method: 'ocr' };
        }
      } catch (err) {
        logger.error('OCR failed:', err);
      }
    }
    
    return { text: null, method: null };
  });
  
  // ==================== 多窗口管理 ====================
  
  /**
   * 冻结当前窗口（变成独立窗口）
   */
  ipcMain.handle(CHANNELS.SELECTION.FREEZE, () => {
    const windowManager = require('../managers/window-manager');
    return windowManager.freezeSelectionWindow();
  });
  
  /**
   * 关闭冻结的窗口
   */
  ipcMain.handle(CHANNELS.SELECTION.CLOSE_FROZEN, (event, windowId) => {
    const windowManager = require('../managers/window-manager');
    return windowManager.closeFrozenSelectionWindow(windowId);
  });
  
  /**
   * 获取当前窗口 ID
   */
  ipcMain.handle(CHANNELS.SELECTION.GET_WINDOW_ID, (event) => {
    const selectionWindow = getSelectionWindow();
    if (selectionWindow && !selectionWindow.isDestroyed()) {
      return selectionWindow._windowId || null;
    }
    return null;
  });
  
  /**
   * 获取冻结窗口数量
   */
  ipcMain.handle(CHANNELS.SELECTION.FROZEN_WINDOWS_COUNT, () => {
    const windowManager = require('../managers/window-manager');
    return windowManager.getFrozenSelectionWindowsCount();
  });

  // ==================== 数据同步 ====================
  
  /**
   * 添加到历史记录
   */
  ipcMain.handle(CHANNELS.SELECTION.ADD_TO_HISTORY, (event, item) => {
    const mainWindow = getMainWindow();
    mainWindow?.webContents.send(CHANNELS.DATA.ADD_TO_HISTORY, item);
    return true;
  });
  
  logger.info('Selection IPC handlers registered');
}

// ==================== 辅助函数 ====================

/**
 * 串行化锁 —— fetchSelectedText 通过 promise chain 保证任意时刻只有一个 in-flight
 * 调用，避免跨 mouseup 周期的 clipboard 污染（上一次 fetch 的 500ms 延迟 restore
 * 还没 fire，下一次 fetch 就读了脏 clipboard 当 backup，最后两次 restore 互相覆盖）。
 */
let lastRestoreComplete = Promise.resolve();

/**
 * 稳定获取选中文字（清空+轮询方案）
 *
 * 调用方：
 *   1. IPC handler CHANNELS.SELECTION.GET_TEXT（用户点图标时）
 *   2. main.js handleHotkeyDirectPath（CapsLock 直出路径）
 *
 * 两者可能在相邻 mouseup 周期内先后触发，lastRestoreComplete promise chain
 * 保证下一次 fetch 必须等上一次的 restore 真正完成（包括 500ms 延迟）才开始。
 */
async function fetchSelectedText() {
  // 挂在 chain 末尾：等上一次 fetch 的 restore 完成
  const prevRestore = lastRestoreComplete;
  let resolveMyRestore;
  const myRestorePromise = new Promise(r => { resolveMyRestore = r; });
  lastRestoreComplete = myRestorePromise;

  await prevRestore.catch(() => {});  // 上一次就算 reject 也不阻塞本次

  let backup = null;
  let foundText = null;
  try {
    // 1. 备份现有剪贴板
    backup = clipboard.readText();

    // 2. 清空剪贴板（关键！作为信号量）
    clipboard.clear();

    // 3. 触发系统复制
    simulateCtrlC();

    // 4. 轮询等待（最多 800ms，每 50ms 检查一次）
    for (let i = 0; i < 16; i++) {
      await new Promise(resolve => setTimeout(resolve, 50));
      const text = clipboard.readText();
      if (text && text.trim()) {
        foundText = text.trim();
        break;
      }
    }

    return foundText;
  } catch (err) {
    logger.error('fetchSelectedText error:', err);
    return null;
  } finally {
    // 抓到文字：延迟 500ms 再 restore，让 caller 有时间同步读 clipboard formats
    // 抓不到：立即 restore。无论哪种都要 resolveMyRestore，否则下一次 fetch 永远卡住。
    if (foundText) {
      setTimeout(() => {
        try { if (backup !== null) clipboard.writeText(backup); } catch (e) { logger.warn('restore failed:', e.message); }
        resolveMyRestore();
      }, 500);
    } else {
      try { if (backup !== null) clipboard.writeText(backup); } catch (e) { logger.warn('restore failed:', e.message); }
      resolveMyRestore();
    }
  }
}

/**
 * OCR 兜底方案 - 使用 RapidOCR (PaddleOCR)
 */
async function getTextByOCR(rect, screenshotModule) {
  try {
    // 区域太小则跳过
    if (rect.width < 12 || rect.height < 6) {
      return null;
    }
    
    // 添加边距
    const padding = 5;
    const captureRect = {
      x: rect.x - padding,
      y: rect.y - padding,
      width: rect.width + padding * 2,
      height: rect.height + padding * 2,
    };
    
    // 截取区域
    const screenshot = await screenshotModule.captureRegion(captureRect);
    
    if (!screenshot) {
      return null;
    }
    
    // 使用 RapidOCR (PaddleOCR)
    const { recognizeWithRapidOCR } = require('../utils/ocr-helper');
    const result = await recognizeWithRapidOCR(screenshot, { merge: true });
    
    if (result.success && result.text) {
      return result.text;
    }
    
    return null;
  } catch (err) {
    logger.error('OCR error:', err);
    return null;
  }
}

/**
 * 从文件路径提取可翻译的文件名
 */
function extractFilenameForTranslation(filePath) {
  try {
    let filename = filePath;
    
    // file:// URL
    if (filename.startsWith('file://')) {
      filename = decodeURIComponent(filename.replace('file://', ''));
    }
    
    // 提取文件名
    const pathParts = filename.split(/[/\\]/);
    filename = pathParts[pathParts.length - 1];
    
    // 移除扩展名
    const dotIndex = filename.lastIndexOf('.');
    if (dotIndex > 0) {
      filename = filename.substring(0, dotIndex);
    }
    
    // 清理特殊字符
    filename = filename.replace(/[_-]+/g, ' ').trim();
    
    // 太短或只有数字/符号的文件名没有翻译价值
    if (filename.length < 2 || /^[\d\s\W]+$/.test(filename)) {
      return null;
    }
    
    return filename;
  } catch (err) {
    logger.error('extractFilenameForTranslation error:', err);
    return null;
  }
}

module.exports = register;
module.exports.fetchSelectedText = fetchSelectedText;
