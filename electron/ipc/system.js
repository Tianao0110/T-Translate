// electron/ipc/system.js
// 系统级 IPC handlers
// 包含：窗口控制、对话框、平台信息、外部链接等

const { ipcMain, dialog, shell } = require("electron");
const { CHANNELS } = require("../shared/channels");
const logger = require("../utils/logger")("IPC:System");

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
   * 打开外部链接
   */
  ipcMain.on(CHANNELS.SYSTEM.OPEN_EXTERNAL, (event, url) => {
    if (url && typeof url === "string") {
      shell.openExternal(url);
      logger.debug("Opening external URL:", url.substring(0, 50));
    }
  });

  // ==================== 应用信息 ====================

  /**
   * 获取应用版本
   */
  ipcMain.handle(CHANNELS.APP.GET_VERSION, () => {
    return app.getVersion();
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
          message: "连接正常",
        };
      } else {
        return {
          success: false,
          models: [],
          message: `服务器返回 ${response.status}`,
        };
      }
    } catch (error) {
      logger.warn("Health check failed:", error.message);
      return {
        success: false,
        models: [],
        message: error.name === "AbortError" ? "连接超时" : "无法连接服务",
      };
    }
  });

  logger.info("System IPC handlers registered");
}

module.exports = register;
