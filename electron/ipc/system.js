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

  /**
   * 检查更新 - 从 GitHub Releases 获取最新版本
   */
  ipcMain.handle(CHANNELS.APP.CHECK_UPDATE, async () => {
    const currentVersion = app.getVersion();
    const repoUrl = 'https://api.github.com/repos/Tianao0110/T-Translate/releases/latest';
    
    try {
      logger.info('Checking for updates...');
      
      // 使用 net 模块请求 GitHub API
      const { net } = require('electron');
      
      const response = await new Promise((resolve, reject) => {
        const request = net.request({
          method: 'GET',
          url: repoUrl,
        });
        
        request.setHeader('User-Agent', 'T-Translate-Updater');
        request.setHeader('Accept', 'application/vnd.github.v3+json');
        
        let data = '';
        let statusCode = 0;
        
        request.on('response', (resp) => {
          statusCode = resp.statusCode;
          
          resp.on('data', (chunk) => {
            data += chunk.toString();
          });
          
          resp.on('end', () => {
            // 404 表示没有发布任何 Release
            if (statusCode === 404) {
              resolve({ noRelease: true });
              return;
            }
            
            if (statusCode !== 200) {
              reject(new Error(`HTTP ${statusCode}`));
              return;
            }
            
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(new Error('Invalid JSON response'));
            }
          });
        });
        
        request.on('error', (error) => {
          reject(error);
        });
        
        // 设置超时
        setTimeout(() => {
          request.abort();
          reject(new Error('Request timeout'));
        }, 15000);
        
        request.end();
      });
      
      // 没有发布任何 Release
      if (response.noRelease) {
        logger.info('No releases found on GitHub');
        return {
          success: true,
          hasUpdate: false,
          currentVersion: currentVersion.replace(/^v/, ''),
          latestVersion: null,
          message: '暂无发布版本',
        };
      }
      
      // 解析版本号 (去掉 v 前缀)
      const latestVersion = (response.tag_name || '').replace(/^v/, '');
      const current = currentVersion.replace(/^v/, '');
      
      // 比较版本号
      const hasUpdate = compareVersions(latestVersion, current) > 0;
      
      logger.info(`Current: ${current}, Latest: ${latestVersion}, HasUpdate: ${hasUpdate}`);
      
      return {
        success: true,
        hasUpdate,
        currentVersion: current,
        latestVersion,
        releaseUrl: response.html_url,
        releaseName: response.name,
        releaseNotes: response.body || '',
        publishedAt: response.published_at,
      };
      
    } catch (error) {
      logger.error('Check update failed:', error.message);
      return {
        success: false,
        error: error.message || '检查更新失败',
      };
    }
  });

  /**
   * 版本号比较函数
   * @returns 1 if a > b, -1 if a < b, 0 if equal
   */
  function compareVersions(a, b) {
    const partsA = a.split('.').map(Number);
    const partsB = b.split('.').map(Number);
    
    for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
      const numA = partsA[i] || 0;
      const numB = partsB[i] || 0;
      
      if (numA > numB) return 1;
      if (numA < numB) return -1;
    }
    
    return 0;
  }

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
    
    return { success: false, message: '无法获取日志目录' };
  });
  
  /**
   * 获取日志目录路径
   */
  ipcMain.handle(CHANNELS.LOGS.GET_DIRECTORY, () => {
    const { getLogDirectory } = require('../utils/logger');
    return getLogDirectory();
  });

  logger.info("System IPC handlers registered");
}

module.exports = register;
