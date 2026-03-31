// electron/ipc/system.js
// 系统级 IPC handlers
// 包含：窗口控制、对话框、平台信息、外部链接等

const { ipcMain, dialog, shell } = require("electron");
const { CHANNELS } = require("../shared/channels");
const logger = require("../utils/logger")("IPC:System");
const { t } = require("../shared/main-i18n");

/**
 * 注册系统级 IPC handlers
 * @param {Object} ctx - 共享上下文
 */
function register(ctx) {
  const { getMainWindow, store, app } = ctx;

  // ==================== 窗口控制 ====================

  /**
   * 最小化窗口
   */
  ipcMain.on(CHANNELS.SYSTEM.MINIMIZE, () => {
    const mainWindow = getMainWindow();
    if (mainWindow) {
      mainWindow.minimize();
      logger.debug("Window minimized");
    }
  });

  /**
   * 最大化/还原窗口
   */
  ipcMain.on(CHANNELS.SYSTEM.MAXIMIZE, () => {
    const mainWindow = getMainWindow();
    if (mainWindow) {
      if (mainWindow.isMaximized()) {
        mainWindow.restore();
        logger.debug("Window restored");
      } else {
        mainWindow.maximize();
        logger.debug("Window maximized");
      }
    }
  });

  /**
   * 获取窗口是否最大化
   */
  ipcMain.handle("is-maximized", () => {
    const mainWindow = getMainWindow();
    return mainWindow ? mainWindow.isMaximized() : false;
  });

  /**
   * 关闭窗口
   */
  ipcMain.on(CHANNELS.SYSTEM.CLOSE, () => {
    const mainWindow = getMainWindow();
    if (mainWindow) {
      mainWindow.close();
      logger.debug("Window close requested");
    }
  });

  /**
   * 设置窗口置顶
   */
  ipcMain.on(CHANNELS.SYSTEM.SET_ALWAYS_ON_TOP, (event, alwaysOnTop) => {
    const mainWindow = getMainWindow();
    if (mainWindow) {
      mainWindow.setAlwaysOnTop(alwaysOnTop);
      store.set("alwaysOnTop", alwaysOnTop);
      logger.debug("Always on top:", alwaysOnTop);
    }
  });

  /**
   * 打开外部链接（带安全验证）
   */
  ipcMain.on(CHANNELS.SYSTEM.OPEN_EXTERNAL, (event, url) => {
    if (url && typeof url === "string") {
      // 安全检查：只允许 http/https 协议
      try {
        const parsedUrl = new URL(url);
        if (parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:') {
          shell.openExternal(url);
          logger.debug("Opening external URL:", url.substring(0, 50));
        } else {
          logger.warn("Blocked non-http URL:", parsedUrl.protocol);
        }
      } catch (e) {
        logger.warn("Invalid URL:", url.substring(0, 50));
      }
    }
  });

  // ==================== 应用信息 ====================

  /**
   * 获取应用版本
   */
  ipcMain.handle(CHANNELS.APP.GET_VERSION, () => {
    return app.getVersion();
  });

  // ==================== 自动更新 ====================

  const autoUpdater = require('../utils/auto-updater');

  // 下载进度的临时存储（IPC 无法直接 stream，用轮询方式）
  let _downloadProgress = null;
  let _isDownloading = false;

  /**
   * 检查更新 - 从 GitHub Releases 获取最新版本
   */
  ipcMain.handle(CHANNELS.APP.CHECK_UPDATE, async () => {
    try {
      return await autoUpdater.checkForUpdate();
    } catch (error) {
      logger.error('Check update failed:', error.message);
      return { success: false, error: error.message || t('system.checkUpdateFailed', '检查更新失败') };
    }
  });

  /**
   * 下载更新安装包
   * 参数: { downloadUrl, downloadName }
   * 返回: { success, filePath, error }
   * 下载过程中通过 DOWNLOAD_PROGRESS 事件推送进度
   */
  ipcMain.handle(CHANNELS.APP.DOWNLOAD_UPDATE, async (event, { downloadUrl, downloadName }) => {
    if (_isDownloading) {
      return { success: false, error: t('system.alreadyDownloading', '已在下载中') };
    }

    _isDownloading = true;
    _downloadProgress = { downloaded: 0, total: 0, percent: 0 };

    try {
      const filePath = await autoUpdater.downloadUpdate(downloadUrl, downloadName, (progress) => {
        _downloadProgress = progress;
        // 向渲染进程推送进度
        const mainWindow = getMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('update:download-progress', progress);
        }
      });

      _isDownloading = false;
      return { success: true, filePath };
    } catch (error) {
      _isDownloading = false;
      _downloadProgress = null;
      logger.error('Download update failed:', error.message);
      return { success: false, error: error.message || t('system.downloadFailed', '下载失败') };
    }
  });

  /**
   * 安装更新（运行安装包并退出）
   */
  ipcMain.handle(CHANNELS.APP.INSTALL_UPDATE, async (event, { filePath }) => {
    try {
      await autoUpdater.installUpdate(filePath);
      return { success: true };
    } catch (error) {
      logger.error('Install update failed:', error.message);
      return { success: false, error: error.message || t('system.installFailed', '安装失败') };
    }
  });

  /**
   * 获取平台信息
   */
  ipcMain.handle(CHANNELS.SYSTEM.GET_PLATFORM, () => {
    return process.platform;
  });

  /**
   * 获取应用路径
   */
  ipcMain.handle(CHANNELS.SYSTEM.GET_APP_PATH, async (event, name) => {
    return app.getPath(name || "userData");
  });

  // ==================== 对话框 ====================

  /**
   * 显示保存对话框
   */
  ipcMain.handle(CHANNELS.DIALOG.SAVE, async (event, options) => {
    const mainWindow = getMainWindow();
    try {
      const result = await dialog.showSaveDialog(mainWindow, options);
      logger.debug(
        "Save dialog result:",
        result.canceled ? "canceled" : result.filePath
      );
      return result;
    } catch (error) {
      logger.error("Save dialog error:", error);
      return { canceled: true, error: error.message };
    }
  });

  /**
   * 显示打开对话框
   */
  ipcMain.handle(CHANNELS.DIALOG.OPEN, async (event, options) => {
    const mainWindow = getMainWindow();
    try {
      const result = await dialog.showOpenDialog(mainWindow, options);
      logger.debug(
        "Open dialog result:",
        result.canceled ? "canceled" : `${result.filePaths.length} files`
      );
      return result;
    } catch (error) {
      logger.error("Open dialog error:", error);
      return { canceled: true, filePaths: [], error: error.message };
    }
  });

  /**
   * 显示消息对话框
   */
  ipcMain.handle(CHANNELS.DIALOG.MESSAGE, async (event, options) => {
    const mainWindow = getMainWindow();
    try {
      const result = await dialog.showMessageBox(mainWindow, options);
      return result;
    } catch (error) {
      logger.error("Message dialog error:", error);
      return { response: -1, error: error.message };
    }
  });

  // ==================== API 健康检查 ====================

  /**
   * 检查 LLM API 连接状态
   */
  ipcMain.handle(CHANNELS.APP.HEALTH_CHECK, async () => {
    try {
      const settings = store.get("settings", {});
      const endpoint =
        settings.connection?.apiEndpoint || "http://localhost:1234/v1";

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${endpoint}/models`, {
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        logger.debug("Health check passed, models:", data?.data?.length || 0);
        return {
          success: true,
          models: data?.data || [],
          message: t('system.connectionOk', '连接正常'),
        };
      } else {
        return {
          success: false,
          models: [],
          message: t('system.serverStatus', '服务器返回') + ` ${response.status}`,
        };
      }
    } catch (error) {
      logger.warn("Health check failed:", error.message);
      return {
        success: false,
        models: [],
        message: error.name === "AbortError" ? t('system.timeout', '连接超时') : t('system.cannotConnect', '无法连接服务'),
      };
    }
  });

  // ==================== 日志管理 ====================
  
  /**
   * 打开日志目录
   */
  ipcMain.handle(CHANNELS.LOGS.OPEN_DIRECTORY, async () => {
    const { getLogDirectory } = require('../utils/logger');
    const logDir = getLogDirectory();
    
    if (logDir) {
      // 确保目录存在
      const fs = require('fs');
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }
      
      shell.openPath(logDir);
      logger.info('Opened log directory:', logDir);
      return { success: true, path: logDir };
    }
    
    return { success: false, message: t('system.logDirFailed', '无法获取日志目录') };
  });
  
  /**
   * 获取日志目录路径
   */
  ipcMain.handle(CHANNELS.LOGS.GET_DIRECTORY, () => {
    const { getLogDirectory } = require('../utils/logger');
    return getLogDirectory();
  });

  // ==================== 开机自启 ====================

  /**
   * 设置开机自启
   */
  ipcMain.handle(CHANNELS.APP.SET_AUTO_LAUNCH, (event, enabled) => {
    try {
      app.setLoginItemSettings({
        openAtLogin: enabled,
        args: enabled ? ['--startup'] : [],
      });
      // 同时保存到 store（getLoginItemSettings 在开发模式下不可靠）
      store.set('settings.startup.autoLaunch', enabled);
      logger.info('Auto launch set to:', enabled);
      return { success: true, enabled };
    } catch (e) {
      logger.error('Failed to set auto launch:', e);
      return { success: false, error: e.message };
    }
  });

  /**
   * 获取开机自启状态
   */
  ipcMain.handle(CHANNELS.APP.GET_AUTO_LAUNCH, () => {
    try {
      // 优先读 store（可靠），fallback 到系统 API
      const stored = store.get('settings.startup.autoLaunch');
      if (stored !== undefined) {
        return { success: true, enabled: !!stored };
      }
      const settings = app.getLoginItemSettings();
      return { success: true, enabled: settings.openAtLogin };
    } catch (e) {
      return { success: false, enabled: false };
    }
  });

  logger.info("System IPC handlers registered");
}

module.exports = register;
