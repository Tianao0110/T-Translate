// System-level IPC handlers — window control, dialogs, platform info, external links.

const { ipcMain, dialog, shell } = require("electron");
const { CHANNELS } = require("../shared/channels");
const logger = require("../utils/logger")("IPC:System");
const { t } = require("../shared/main-i18n");

function register(ctx) {
  const { getMainWindow, store, app } = ctx;

  // ===== Window control =====

  ipcMain.on(CHANNELS.SYSTEM.MINIMIZE, () => {
    const mainWindow = getMainWindow();
    if (mainWindow) {
      mainWindow.minimize();
      logger.debug("Window minimized");
    }
  });

  // Maximize toggles restore when already maximized.
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

  ipcMain.handle("is-maximized", () => {
    const mainWindow = getMainWindow();
    return mainWindow ? mainWindow.isMaximized() : false;
  });

  ipcMain.on(CHANNELS.SYSTEM.CLOSE, () => {
    const mainWindow = getMainWindow();
    if (mainWindow) {
      mainWindow.close();
      logger.debug("Window close requested");
    }
  });

  ipcMain.on(CHANNELS.SYSTEM.SET_ALWAYS_ON_TOP, (event, alwaysOnTop) => {
    const mainWindow = getMainWindow();
    if (mainWindow) {
      mainWindow.setAlwaysOnTop(alwaysOnTop);
      store.set("alwaysOnTop", alwaysOnTop);
      logger.debug("Always on top:", alwaysOnTop);
    }
  });

  // Open external URL — gated to http/https only (block file://, javascript:, etc.).
  ipcMain.on(CHANNELS.SYSTEM.OPEN_EXTERNAL, (event, url) => {
    if (url && typeof url === "string") {
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

  // ===== App info =====

  ipcMain.handle(CHANNELS.APP.GET_VERSION, () => {
    return app.getVersion();
  });

  // ===== Auto update =====

  const autoUpdater = require('../utils/auto-updater');

  // IPC doesn't stream — track download state here and poll/push via separate channel.
  let _downloadProgress = null;
  let _isDownloading = false;

  ipcMain.handle(CHANNELS.APP.CHECK_UPDATE, async () => {
    try {
      return await autoUpdater.checkForUpdate();
    } catch (error) {
      logger.error('Check update failed:', error.message);
      return { success: false, error: error.message || t('system.checkUpdateFailed', '检查更新失败') };
    }
  });

  // Push download progress to renderer via 'update:download-progress'.
  ipcMain.handle(CHANNELS.APP.DOWNLOAD_UPDATE, async (event, { downloadUrl, downloadName }) => {
    if (_isDownloading) {
      return { success: false, error: t('system.alreadyDownloading', '已在下载中') };
    }

    _isDownloading = true;
    _downloadProgress = { downloaded: 0, total: 0, percent: 0 };

    try {
      const filePath = await autoUpdater.downloadUpdate(downloadUrl, downloadName, (progress) => {
        _downloadProgress = progress;
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

  ipcMain.handle(CHANNELS.APP.INSTALL_UPDATE, async (event, { filePath }) => {
    try {
      await autoUpdater.installUpdate(filePath);
      return { success: true };
    } catch (error) {
      logger.error('Install update failed:', error.message);
      return { success: false, error: error.message || t('system.installFailed', '安装失败') };
    }
  });

  ipcMain.handle(CHANNELS.SYSTEM.GET_PLATFORM, () => {
    return process.platform;
  });

  ipcMain.handle(CHANNELS.SYSTEM.GET_APP_PATH, async (event, name) => {
    return app.getPath(name || "userData");
  });

  // ===== Dialogs =====

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

  // ===== LLM endpoint health check =====

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

  // ===== Logs =====

  ipcMain.handle(CHANNELS.LOGS.OPEN_DIRECTORY, async () => {
    const { getLogDirectory } = require('../utils/logger');
    const logDir = getLogDirectory();

    if (logDir) {
      // Ensure the directory exists before asking the shell to open it.
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

  ipcMain.handle(CHANNELS.LOGS.GET_DIRECTORY, () => {
    const { getLogDirectory } = require('../utils/logger');
    return getLogDirectory();
  });

  // ===== Auto-launch (login item) =====

  ipcMain.handle(CHANNELS.APP.SET_AUTO_LAUNCH, (event, enabled) => {
    try {
      app.setLoginItemSettings({
        openAtLogin: enabled,
        args: enabled ? ['--startup'] : [],
      });
      // Mirror to store: getLoginItemSettings is unreliable in dev mode.
      store.set('settings.startup.autoLaunch', enabled);
      logger.info('Auto launch set to:', enabled);
      return { success: true, enabled };
    } catch (e) {
      logger.error('Failed to set auto launch:', e);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle(CHANNELS.APP.GET_AUTO_LAUNCH, () => {
    try {
      // Prefer store (reliable in dev), fall back to system API.
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
