// System-level IPC handlers — window control, dialogs, platform info, external links.

const { ipcMain, dialog, shell } = require("electron");
const fs = require("fs").promises;
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

  // Offline mode promises "no network requests" — that includes the updater.
  // Gated in main so all windows are covered by one check.
  const updateBlockedOffline = () =>
    store.get('privacyMode', 'standard') === 'offline'
      ? { success: false, offline: true, error: t('system.offlineUpdateBlocked', '离线模式下已禁用检查更新') }
      : null;

  ipcMain.handle(CHANNELS.APP.CHECK_UPDATE, async () => {
    const blocked = updateBlockedOffline();
    if (blocked) return blocked;
    try {
      return await autoUpdater.checkForUpdate();
    } catch (error) {
      logger.error('Check update failed:', error.message);
      return { success: false, error: error.message || t('system.checkUpdateFailed', '检查更新失败') };
    }
  });

  // Push download progress to renderer via 'update:download-progress'.
  // Renderer still sends {downloadUrl, downloadName} - ignored, electron-updater
  // downloads whatever the preceding check resolved from the feed.
  ipcMain.handle(CHANNELS.APP.DOWNLOAD_UPDATE, async () => {
    const blocked = updateBlockedOffline();
    if (blocked) return blocked;
    if (_isDownloading) {
      return { success: false, error: t('system.alreadyDownloading', '已在下载中') };
    }

    _isDownloading = true;
    _downloadProgress = { downloaded: 0, total: 0, percent: 0 };

    try {
      const filePath = await autoUpdater.downloadUpdate((progress) => {
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

  ipcMain.handle(CHANNELS.APP.INSTALL_UPDATE, async () => {
    try {
      await autoUpdater.installUpdate();
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

  // Save dialog + write in one invoke — the renderer has no fs for
  // arbitrary files, and a path returned from SAVE alone is useless to it.
  ipcMain.handle(CHANNELS.DIALOG.SAVE_FILE, async (event, { defaultPath, filters, data, encoding } = {}) => {
    const mainWindow = getMainWindow();
    try {
      const result = await dialog.showSaveDialog(mainWindow, { defaultPath, filters });
      if (result.canceled || !result.filePath) {
        return { success: false, canceled: true };
      }
      await fs.writeFile(result.filePath, data ?? "", encoding === "binary" ? "binary" : "utf8");
      logger.debug("File saved:", result.filePath);
      return { success: true, filePath: result.filePath };
    } catch (error) {
      logger.error("Save file error:", error);
      return { success: false, error: error.message };
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

  // On-disk footprint for the privacy page's data-management panel.
  ipcMain.handle(CHANNELS.APP.GET_DATA_STATS, () => {
    const fs = require('fs');
    const path = require('path');
    const stats = { settingsFileSize: 0, logsDirSize: 0, logsFileCount: 0 };

    try {
      if (store.path && fs.existsSync(store.path)) {
        stats.settingsFileSize = fs.statSync(store.path).size;
      }
    } catch (e) {
      logger.debug('Settings file stat failed:', e.message);
    }

    try {
      const { getLogDirectory } = require('../utils/logger');
      const logDir = getLogDirectory();
      if (logDir && fs.existsSync(logDir)) {
        for (const file of fs.readdirSync(logDir)) {
          const st = fs.statSync(path.join(logDir, file));
          if (st.isFile()) {
            stats.logsDirSize += st.size;
            stats.logsFileCount++;
          }
        }
      }
    } catch (e) {
      logger.debug('Log dir stat failed:', e.message);
    }

    return stats;
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
