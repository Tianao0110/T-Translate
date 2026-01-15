// electron/ipc/subtitle.js
// 字幕采集相关 IPC handlers
// 包含：采集区窗口控制、坐标管理、区域截图

const { ipcMain } = require('electron');
const { CHANNELS } = require('../shared/channels');
const logger = require('../utils/logger')('IPC:Subtitle');

/**
 * 注册字幕采集相关 IPC handlers
 * @param {Object} ctx - 共享上下文
 */
function register(ctx) {
  const { getGlassWindow, runtime, store, managers } = ctx;
  
  // 获取截图模块（懒加载）
  let screenshotModule = null;
  const getScreenshotModule = () => {
    if (!screenshotModule) {
      screenshotModule = require('../screenshot-module');
    }
    return screenshotModule;
  };
  
  // ==================== 采集区窗口控制 ====================
  
  /**
   * 打开/关闭字幕采集区选择窗口
   */
  ipcMain.handle(CHANNELS.SUBTITLE.TOGGLE_CAPTURE_WINDOW, () => {
    try {
      if (managers.toggleSubtitleCaptureWindow) {
        managers.toggleSubtitleCaptureWindow();
        return { success: true };
      }
      logger.warn('toggleSubtitleCaptureWindow not available');
      return { success: false, error: 'Function not available' };
    } catch (error) {
      logger.error('Toggle capture window error:', error);
      return { success: false, error: error.message };
    }
  });
  
  /**
   * 检查采集区窗口是否可见
   */
  ipcMain.handle(CHANNELS.SUBTITLE.IS_CAPTURE_WINDOW_VISIBLE, () => {
    const subtitleCaptureWindow = runtime._windows?.subtitleCapture;
    if (subtitleCaptureWindow && !subtitleCaptureWindow.isDestroyed()) {
      return subtitleCaptureWindow.isVisible();
    }
    return false;
  });
  
  // ==================== 采集区坐标管理 ====================
  
  /**
   * 获取字幕采集区坐标
   */
  ipcMain.handle(CHANNELS.SUBTITLE.GET_CAPTURE_RECT, () => {
    // 优先从运行时状态获取
    if (runtime.subtitleCaptureRect) {
      return runtime.subtitleCaptureRect;
    }
    // 尝试从存储读取
    const saved = store.get('subtitleCaptureRect');
    if (saved) {
      runtime.subtitleCaptureRect = saved;
      return saved;
    }
    return null;
  });
  
  /**
   * 设置字幕采集区坐标（从设置面板手动输入）
   */
  ipcMain.handle(CHANNELS.SUBTITLE.SET_CAPTURE_RECT, (event, rect) => {
    if (rect && rect.x !== undefined && rect.y !== undefined) {
      runtime.subtitleCaptureRect = rect;
      store.set('subtitleCaptureRect', rect);
      
      // 如果采集区窗口存在，同步位置
      const subtitleCaptureWindow = runtime._windows?.subtitleCapture;
      if (subtitleCaptureWindow && !subtitleCaptureWindow.isDestroyed()) {
        subtitleCaptureWindow.setBounds(rect);
      }
      
      logger.debug('Capture rect set:', rect);
      return { success: true };
    }
    return { success: false, error: 'Invalid rect' };
  });
  
  /**
   * 清除字幕采集区
   */
  ipcMain.handle(CHANNELS.SUBTITLE.CLEAR_CAPTURE_RECT, () => {
    runtime.subtitleCaptureRect = null;
    store.delete('subtitleCaptureRect');
    
    // 关闭采集区窗口
    const subtitleCaptureWindow = runtime._windows?.subtitleCapture;
    if (subtitleCaptureWindow && !subtitleCaptureWindow.isDestroyed()) {
      subtitleCaptureWindow.close();
    }
    
    logger.debug('Capture rect cleared');
    return { success: true };
  });
  
  // ==================== 区域截图 ====================
  
  /**
   * 截取字幕采集区（用于字幕模式）
   */
  ipcMain.handle(CHANNELS.SUBTITLE.CAPTURE_REGION, async () => {
    try {
      const rect = runtime.subtitleCaptureRect;
      if (!rect) {
        throw new Error('未设置字幕采集区');
      }
      
      // 使用 node-screenshots 截取指定区域
      const screenshotMod = getScreenshotModule();
      const screenshot = await screenshotMod.captureRegion(rect);
      
      if (screenshot) {
        logger.debug('Subtitle region captured');
        return { success: true, imageData: screenshot };
      } else {
        throw new Error('截图失败');
      }
    } catch (error) {
      logger.error('Capture subtitle region error:', error);
      return { success: false, error: error.message };
    }
  });
  
  logger.info('Subtitle IPC handlers registered');
}

module.exports = register;
