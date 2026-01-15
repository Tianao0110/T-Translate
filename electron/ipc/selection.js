// electron/ipc/selection.js
// 划词翻译 IPC handlers
// 包含：窗口控制、文本获取、设置管理等

const { ipcMain, clipboard, screen } = require('electron');
const { CHANNELS } = require('../shared/channels');
const logger = require('../utils/logger')('IPC:Selection');
const { simulateCtrlC, getWindowInfoAtPoint } = require('../utils/native-helper');

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
   * 获取划词翻译设置
   */
  ipcMain.handle(CHANNELS.SELECTION.GET_SETTINGS, () => {
    const settings = store.get('settings', {});
    return settings.selection || {
      triggerIcon: 'dot',
      triggerSize: 24,
      triggerColor: '#3b82f6',
      customIconPath: '',
      hoverDelay: 300,
      triggerTimeout: 5000,
      resultTimeout: 3000,
      minChars: 2,
      maxChars: 500,
    };
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
          return { text: text.trim(), method: 'clipboard' };
        }
      }
      
      // 没有文本，用户在拖拽文件
      return { text: null, method: null, reason: 'file_drop' };
    }
    
    // 4. 正常文本处理
    if (text && text.trim()) {
      return { text: text.trim(), method: 'clipboard' };
    }
    
    // 5. 复制失败，尝试 OCR 兜底
    const ocrRect = rect || runtime.lastSelectionRect;
    
    if (ocrRect && ocrRect.width > 10 && ocrRect.height > 5) {
      try {
        const ocrText = await getTextByOCR(ocrRect, getScreenshotModule());
        if (ocrText && ocrText.trim()) {
          return { text: ocrText.trim(), method: 'ocr' };
        }
      } catch (err) {
        logger.error('OCR failed:', err);
      }
    }
    
    return { text: null, method: null };
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
 * 稳定获取选中文字（清空+轮询方案）
 */
async function fetchSelectedText() {
  try {
    // 1. 备份现有剪贴板
    const backup = clipboard.readText();
    
    // 2. 清空剪贴板（关键！作为信号量）
    clipboard.clear();
    
    // 3. 触发系统复制
    simulateCtrlC();
    
    // 4. 轮询等待（最多 500ms，每 50ms 检查一次）
    for (let i = 0; i < 10; i++) {
      await new Promise(resolve => setTimeout(resolve, 50));
      const text = clipboard.readText();
      if (text && text.trim()) {
        // 延迟恢复剪贴板
        setTimeout(() => {
          if (backup) clipboard.writeText(backup);
        }, 500);
        return text.trim();
      }
    }
    
    // 5. 超时，恢复剪贴板
    if (backup) clipboard.writeText(backup);
    return null;
  } catch (err) {
    logger.error('fetchSelectedText error:', err);
    return null;
  }
}

/**
 * OCR 兜底方案
 */
async function getTextByOCR(rect, screenshotModule) {
  try {
    // 区域太小则跳过
    if (rect.width < 20 || rect.height < 10) {
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
    
    // 使用 Tesseract OCR
    const Tesseract = require('tesseract.js');
    const result = await Tesseract.recognize(
      Buffer.from(screenshot.replace(/^data:image\/\w+;base64,/, ''), 'base64'),
      'chi_sim+eng',
      { logger: () => {} }
    );
    
    return result.data.text;
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

/**
 * 判断是否应该显示划词翻译触发器
 * 智能防误触方案
 */
async function shouldShowSelectionTrigger(startPos, endPos, distance) {
  try {
    const deltaX = Math.abs(endPos.x - startPos.x);
    const deltaY = Math.abs(endPos.y - startPos.y);
    
    // ========== 通用方向检测 ==========
    // 规则1：纯垂直移动很可能是拖拽
    if (deltaX < 5 && deltaY > 30) {
      return false;
    }
    
    // 规则2：斜向拖拽
    if (deltaY > deltaX && deltaY > 50) {
      return false;
    }
    
    // 仅 Windows 需要窗口检测
    if (process.platform !== 'win32') {
      return true;
    }
    
    // ========== Windows 平台：使用 Win32 API 检测 ==========
    const windowInfo = getWindowInfoAtPoint(endPos.x, endPos.y);
    
    if (!windowInfo) {
      return true;
    }
    
    // 输入框直接放行
    if (windowInfo.isInputBox) {
      return true;
    }
    
    // 桌面：直接拒绝
    if (windowInfo.isDesktop) {
      return false;
    }
    
    // 文件管理器：应用严格规则
    if (windowInfo.isFileManager || windowInfo.isFileView) {
      if (distance > 150) return false;
      if (deltaY > 15) return false;
      if (deltaX > 5 && deltaY > deltaX * 0.2) return false;
      if (deltaX < 30) return false;
    }
    
    return true;
  } catch (err) {
    logger.error('shouldShowSelectionTrigger error:', err);
    return true;
  }
}

module.exports = register;
module.exports.fetchSelectedText = fetchSelectedText;
module.exports.shouldShowSelectionTrigger = shouldShowSelectionTrigger;
