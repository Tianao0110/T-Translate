// electron/main.js
const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  globalShortcut,
  ipcMain,
  dialog,
  shell,
  nativeImage,
  clipboard,
  screen,
  desktopCapturer,
} = require("electron");
const path = require("path");
const Store = require("electron-store");

// 引入截图模块
const screenshotModule = require('./screenshot-module');

// 初始化配置存储
const store = new Store({
  defaults: {
    windowBounds: { width: 1200, height: 800 },
    windowPosition: null,
    alwaysOnTop: false,
    startMinimized: false,
    theme: "light",
  },
});

ipcMain.handle("store-get", async (event, key) => {
  return store.get(key);
});

ipcMain.handle("store-set", async (event, key, val) => {
  store.set(key, val);
});

// 全局变量
let mainWindow = null;
let screenshotWindow = null;
let tray = null;
let isQuitting = false;

// 开发环境检测
const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;

/**
 * 创建主窗口
 */
function createWindow() {
  // 获取保存的窗口配置
  const windowBounds = store.get("windowBounds");
  const windowPosition = store.get("windowPosition");

  // 创建浏览器窗口
  mainWindow = new BrowserWindow({
    width: windowBounds.width,
    height: windowBounds.height,
    x: windowPosition?.x,
    y: windowPosition?.y,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, "preload.js"),
      webSecurity: false,
    },
    autoHideMenuBar: true,
    menuBarVisible: false,
    icon: path.join(__dirname, "../public/icon.png"),
    frame: false,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    show: false,
    backgroundColor: "#ffffff",
    alwaysOnTop: store.get("alwaysOnTop", false),
  });
  mainWindow.removeMenu();

  // 加载应用
  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  // 窗口准备好后显示
  mainWindow.once("ready-to-show", () => {
    if (!store.get("startMinimized")) {
      mainWindow.show();
    }
  });

  // 保存窗口状态
  mainWindow.on("resize", () => {
    if (!mainWindow.isMaximized()) {
      store.set("windowBounds", mainWindow.getBounds());
    }
  });

  mainWindow.on("move", () => {
    if (!mainWindow.isMaximized()) {
      store.set("windowPosition", mainWindow.getPosition());
    }
  });

  // 关闭窗口处理
  mainWindow.on("close", (event) => {
    if (!isQuitting && process.platform !== "darwin") {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // 处理外部链接
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

/**
 * 截图功能 - 创建选区窗口
 * 优先使用 node-screenshots，回退到 desktopCapturer
 */
let screenshotData = null;
let wasMainWindowVisible = false; // 记录截图前主窗口是否可见
let screenshotFromHotkey = false; // 记录是否从快捷键触发

async function startScreenshot(fromHotkey = false) {
  // 如果已有截图窗口，先关闭
  if (screenshotWindow) {
    screenshotWindow.close();
    screenshotWindow = null;
  }

  // 记录触发来源
  screenshotFromHotkey = fromHotkey;
  
  // 记录主窗口当前状态
  wasMainWindowVisible = mainWindow && mainWindow.isVisible();
  
  console.log('[Main] startScreenshot, fromHotkey:', fromHotkey, 'wasMainWindowVisible:', wasMainWindowVisible);
  
  // 隐藏主窗口
  if (wasMainWindowVisible) {
    mainWindow.hide();
  }

  // 等待主窗口完全隐藏
  await new Promise(resolve => setTimeout(resolve, 300));

  // 获取所有显示器信息
  const displays = screen.getAllDisplays();
  const primaryDisplay = screen.getPrimaryDisplay();
  
  console.log('[Main] All displays:', displays.map(d => ({
    id: d.id,
    bounds: d.bounds,
    scaleFactor: d.scaleFactor
  })));

  // 计算所有显示器的总边界
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let maxScaleFactor = 1;
  displays.forEach(display => {
    minX = Math.min(minX, display.bounds.x);
    minY = Math.min(minY, display.bounds.y);
    maxX = Math.max(maxX, display.bounds.x + display.bounds.width);
    maxY = Math.max(maxY, display.bounds.y + display.bounds.height);
    maxScaleFactor = Math.max(maxScaleFactor, display.scaleFactor);
  });
  
  const totalWidth = maxX - minX;
  const totalHeight = maxY - minY;
  const totalBounds = { minX, minY, maxX, maxY, totalWidth, totalHeight };
  
  console.log('[Main] Total screen area:', totalBounds);

  // 优先使用 node-screenshots
  if (screenshotModule.isNodeScreenshotsAvailable()) {
    console.log('[Main] Using node-screenshots for capture');
    screenshotData = await screenshotModule.captureWithNodeScreenshots(displays, totalBounds);
  }
  
  // 回退到 desktopCapturer
  if (!screenshotData) {
    console.log('[Main] Using desktopCapturer fallback');
    screenshotData = await screenshotModule.captureWithDesktopCapturer(
      displays, primaryDisplay, totalBounds, maxScaleFactor
    );
  }
  
  if (screenshotData) {
    screenshotModule.setScreenshotData(screenshotData);
    console.log('[Main] Screenshot data saved, type:', screenshotData.type);
  } else {
    console.error('[Main] Failed to capture screenshot');
  }

  console.log('[Main] Total screen bounds:', { minX, minY, maxX, maxY });

  // 注册临时的 ESC 全局快捷键用于取消截图
  globalShortcut.register('Escape', () => {
    console.log('[Main] ESC pressed (global shortcut), fromHotkey:', screenshotFromHotkey, 'wasMainWindowVisible:', wasMainWindowVisible);
    if (screenshotWindow) {
      screenshotWindow.close();
      screenshotWindow = null;
    }
    // 清理截图数据
    screenshotModule.clearScreenshotData();
    screenshotData = null;
    
    // 如果是从快捷键触发的，取消时不显示主窗口
    // 如果是从软件内按钮触发的，取消时恢复显示
    if (!screenshotFromHotkey && wasMainWindowVisible && mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
    
    // 重置状态并取消注册
    wasMainWindowVisible = false;
    screenshotFromHotkey = false;
    globalShortcut.unregister('Escape');
  });

  // 创建全屏透明窗口用于选区
  // 尝试为每个显示器单独创建窗口，但先尝试单窗口方案
  screenshotWindow = new BrowserWindow({
    x: minX,
    y: minY,
    width: totalWidth,
    height: totalHeight,
    transparent: true,
    frame: false,
    fullscreen: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    focusable: true,
    hasShadow: false,
    enableLargerThanScreen: true, // 允许窗口大于单个屏幕
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  // 设置窗口边界（确保覆盖所有屏幕）
  screenshotWindow.setBounds({
    x: minX,
    y: minY,
    width: totalWidth,
    height: totalHeight
  });

  console.log('[Main] Screenshot window bounds set to:', screenshotWindow.getBounds());

  // 传递屏幕边界信息和配置给选区窗口
  screenshotWindow.webContents.on('did-finish-load', async () => {
    screenshotWindow.webContents.send('screen-bounds', { minX, minY, maxX, maxY });
    
    // 读取设置中的确认按钮选项
    let showConfirmButtons = true; // 默认显示
    try {
      const settings = store.get('settings');
      if (settings?.screenshot?.showConfirmButtons !== undefined) {
        showConfirmButtons = settings.screenshot.showConfirmButtons;
      }
    } catch (e) {
      console.log('[Main] Could not read screenshot settings:', e.message);
    }
    
    // 发送配置
    screenshotWindow.webContents.send('screenshot-config', {
      showConfirmButtons: showConfirmButtons
    });
    
    // 确保窗口获得焦点
    screenshotWindow.focus();
    screenshotWindow.webContents.focus();
    
    // 打印实际窗口大小
    console.log('[Main] Screenshot window actual bounds:', screenshotWindow.getBounds());
  });

  screenshotWindow.loadFile(path.join(__dirname, "screenshot.html"));
  
  // 在 Windows 上确保窗口置顶
  screenshotWindow.setAlwaysOnTop(true, 'screen-saver');
  
  // 确保窗口获得焦点以接收键盘事件
  screenshotWindow.focus();
  
  screenshotWindow.on("closed", () => {
    screenshotWindow = null;
    // 清理全局快捷键
    globalShortcut.unregister('Escape');
  });
}

/**
 * 处理截图选区
 */
async function handleScreenshotSelection(bounds) {
  console.log('[Main] handleScreenshotSelection called, bounds:', bounds);
  
  // 取消注册 ESC 快捷键
  globalShortcut.unregister('Escape');
  
  try {
    // 先关闭选区窗口
    if (screenshotWindow) {
      screenshotWindow.close();
      screenshotWindow = null;
    }

    // 使用 screenshotModule 处理截图
    const data = screenshotModule.getScreenshotData() || screenshotData;
    
    if (!data) {
      throw new Error('没有预先截取的屏幕图像');
    }

    let dataURL;
    
    // 根据截图类型处理
    if (data.type === 'node-screenshots') {
      console.log('[Main] Processing with node-screenshots');
      dataURL = screenshotModule.processSelection(bounds);
    } else {
      // desktopCapturer 回退处理
      console.log('[Main] Processing with desktopCapturer fallback');
      dataURL = processDesktopCapturerSelection(data, bounds);
    }
    
    console.log('[Main] DataURL generated, length:', dataURL?.length || 0);

    // 清理
    screenshotData = null;
    screenshotModule.clearScreenshotData();
    wasMainWindowVisible = false;
    screenshotFromHotkey = false;

    // 截图成功后始终显示主窗口（需要显示结果）
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }

    await new Promise(resolve => setTimeout(resolve, 100));

    // 发送截图到渲染进程
    if (mainWindow && dataURL) {
      console.log('[Main] Sending screenshot-captured to renderer...');
      mainWindow.webContents.send('screenshot-captured', dataURL);
    }

    return dataURL;
  } catch (error) {
    console.error('[Main] Screenshot error:', error);
    
    screenshotData = null;
    screenshotModule.clearScreenshotData();
    wasMainWindowVisible = false;
    screenshotFromHotkey = false;
    
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
    
    return null;
  }
}

/**
 * 处理 desktopCapturer 的选区（回退方案）
 */
function processDesktopCapturerSelection(data, bounds) {
  const { sources, displays, totalBounds } = data;
  
  if (!sources || sources.length === 0) {
    throw new Error('没有可用的截图源');
  }
  
  const fullScreenshot = sources[0].thumbnail;
  const screenshotSize = fullScreenshot.getSize();
  
  // 计算缩放
  const scaleX = screenshotSize.width / totalBounds.totalWidth;
  const scaleY = screenshotSize.height / totalBounds.totalHeight;
  
  const relativeX = bounds.x - totalBounds.minX;
  const relativeY = bounds.y - totalBounds.minY;
  
  let cropBounds = {
    x: Math.round(relativeX * scaleX),
    y: Math.round(relativeY * scaleY),
    width: Math.round(bounds.width * scaleX),
    height: Math.round(bounds.height * scaleY),
  };
  
  // 边界检查
  cropBounds.x = Math.max(0, Math.min(cropBounds.x, screenshotSize.width - 1));
  cropBounds.y = Math.max(0, Math.min(cropBounds.y, screenshotSize.height - 1));
  cropBounds.width = Math.max(1, Math.min(cropBounds.width, screenshotSize.width - cropBounds.x));
  cropBounds.height = Math.max(1, Math.min(cropBounds.height, screenshotSize.height - cropBounds.y));
  
  console.log('[Main] Crop bounds:', cropBounds);
  
  const croppedImage = fullScreenshot.crop(cropBounds);
  return croppedImage.toDataURL();
}

/**
 * 创建菜单
 */
function createMenu() {
  const template = [
    {
      label: "文件",
      submenu: [
        {
          label: "新建翻译",
          accelerator: "CmdOrCtrl+N",
          click: () => {
            mainWindow.webContents.send("menu-action", "new-translation");
          },
        },
        {
          label: "导入文本",
          accelerator: "CmdOrCtrl+O",
          click: async () => {
            const result = await dialog.showOpenDialog(mainWindow, {
              properties: ["openFile"],
              filters: [
                {
                  name: "文本文件",
                  extensions: ["txt", "md", "doc", "docx", "pdf"],
                },
                { name: "所有文件", extensions: ["*"] },
              ],
            });

            if (!result.canceled) {
              mainWindow.webContents.send("import-file", result.filePaths[0]);
            }
          },
        },
        {
          label: "导出翻译",
          accelerator: "CmdOrCtrl+S",
          click: () => {
            mainWindow.webContents.send("menu-action", "export-translation");
          },
        },
        { type: "separator" },
        {
          label: "退出",
          accelerator: process.platform === "darwin" ? "Cmd+Q" : "Ctrl+Q",
          click: () => {
            isQuitting = true;
            app.quit();
          },
        },
      ],
    },
    {
      label: "编辑",
      submenu: [
        { label: "撤销", accelerator: "CmdOrCtrl+Z", role: "undo" },
        { label: "重做", accelerator: "Shift+CmdOrCtrl+Z", role: "redo" },
        { type: "separator" },
        { label: "剪切", accelerator: "CmdOrCtrl+X", role: "cut" },
        { label: "复制", accelerator: "CmdOrCtrl+C", role: "copy" },
        { label: "粘贴", accelerator: "CmdOrCtrl+V", role: "paste" },
        { label: "全选", accelerator: "CmdOrCtrl+A", role: "selectAll" },
      ],
    },
    {
      label: "视图",
      submenu: [
        {
          label: "重新加载",
          accelerator: "CmdOrCtrl+R",
          click: () => {
            mainWindow.reload();
          },
        },
        {
          label: "开发者工具",
          accelerator: "F12",
          click: () => {
            mainWindow.webContents.toggleDevTools();
          },
        },
        { type: "separator" },
        {
          label: "实际大小",
          accelerator: "CmdOrCtrl+0",
          click: () => {
            mainWindow.webContents.setZoomLevel(0);
          },
        },
        {
          label: "放大",
          accelerator: "CmdOrCtrl+Plus",
          click: () => {
            const currentZoom = mainWindow.webContents.getZoomLevel();
            mainWindow.webContents.setZoomLevel(currentZoom + 1);
          },
        },
        {
          label: "缩小",
          accelerator: "CmdOrCtrl+-",
          click: () => {
            const currentZoom = mainWindow.webContents.getZoomLevel();
            mainWindow.webContents.setZoomLevel(currentZoom - 1);
          },
        },
        { type: "separator" },
        {
          label: "全屏",
          accelerator: "F11",
          click: () => {
            mainWindow.setFullScreen(!mainWindow.isFullScreen());
          },
        },
        {
          label: "置顶",
          type: "checkbox",
          checked: store.get("alwaysOnTop", false),
          click: (menuItem) => {
            const alwaysOnTop = menuItem.checked;
            mainWindow.setAlwaysOnTop(alwaysOnTop);
            store.set("alwaysOnTop", alwaysOnTop);
          },
        },
      ],
    },
    {
      label: "翻译",
      submenu: [
        {
          label: "截图翻译",
          accelerator: "Alt+Q",
          click: () => {
            startScreenshot();
          },
        },
        {
          label: "快速翻译",
          accelerator: "CmdOrCtrl+Shift+T",
          click: () => {
            mainWindow.webContents.send("menu-action", "quick-translate");
          },
        },
        { type: "separator" },
        {
          label: "切换语言",
          accelerator: "CmdOrCtrl+L",
          click: () => {
            mainWindow.webContents.send("menu-action", "switch-language");
          },
        },
        {
          label: "清空内容",
          accelerator: "CmdOrCtrl+Shift+C",
          click: () => {
            mainWindow.webContents.send("menu-action", "clear-content");
          },
        },
      ],
    },
    {
      label: "设置",
      submenu: [
        {
          label: "偏好设置",
          accelerator: "CmdOrCtrl+,",
          click: () => {
            mainWindow.webContents.send("menu-action", "open-settings");
          },
        },
        {
          label: "LM Studio 设置",
          click: () => {
            mainWindow.webContents.send("menu-action", "llm-settings");
          },
        },
        {
          label: "OCR 设置",
          click: () => {
            mainWindow.webContents.send("menu-action", "ocr-settings");
          },
        },
      ],
    },
    {
      label: "帮助",
      submenu: [
        {
          label: "使用指南",
          click: () => {
            shell.openExternal(
              "https://github.com/yourusername/t-translate/wiki"
            );
          },
        },
        {
          label: "快捷键列表",
          click: () => {
            mainWindow.webContents.send("menu-action", "show-shortcuts");
          },
        },
        { type: "separator" },
        {
          label: "检查更新",
          click: () => {
            checkForUpdates();
          },
        },
        {
          label: "关于",
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: "info",
              title: "关于 T-Translate",
              message: "T-Translate",
              detail: `版本: 1.0.0\n离线翻译工具\n\n基于 LM Studio 和本地 OCR\n© 2024 Your Name`,
              buttons: ["确定"],
            });
          },
        },
      ],
    },
  ];

  // macOS 特殊处理
  if (process.platform === "darwin") {
    template.unshift({
      label: app.getName(),
      submenu: [
        { label: "关于 " + app.getName(), role: "about" },
        { type: "separator" },
        {
          label: "偏好设置",
          accelerator: "Cmd+,",
          click: () =>
            mainWindow.webContents.send("menu-action", "open-settings"),
        },
        { type: "separator" },
        { label: "隐藏 " + app.getName(), accelerator: "Cmd+H", role: "hide" },
        { label: "隐藏其他", accelerator: "Cmd+Shift+H", role: "hideothers" },
        { label: "显示全部", role: "unhide" },
        { type: "separator" },
        {
          label: "退出",
          accelerator: "Cmd+Q",
          click: () => {
            isQuitting = true;
            app.quit();
          },
        },
      ],
    });
  }

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

/**
 * 创建系统托盘
 */
function createTray() {
  const iconPath = path.join(__dirname, "../public/icon.png");
  const trayIcon = nativeImage
    .createFromPath(iconPath)
    .resize({ width: 16, height: 16 });

  tray = new Tray(trayIcon);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "显示窗口",
      click: () => {
        mainWindow.show();
        mainWindow.focus();
      },
    },
    {
      label: "截图翻译",
      click: () => {
        startScreenshot();
      },
    },
    { type: "separator" },
    {
      label: "置顶",
      type: "checkbox",
      checked: store.get("alwaysOnTop", false),
      click: (menuItem) => {
        const alwaysOnTop = menuItem.checked;
        mainWindow.setAlwaysOnTop(alwaysOnTop);
        store.set("alwaysOnTop", alwaysOnTop);
      },
    },
    { type: "separator" },
    {
      label: "退出",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setToolTip("T-Translate");
  tray.setContextMenu(contextMenu);

  // 双击托盘图标显示窗口
  tray.on("double-click", () => {
    mainWindow.show();
    mainWindow.focus();
  });
}

/**
 * 注册全局快捷键
 */
function registerShortcuts() {
  // 截图翻译 Alt+Q
  globalShortcut.register("Alt+Q", () => {
    startScreenshot(true); // true 表示从快捷键触发
  });

  // 显示/隐藏窗口
  globalShortcut.register("CommandOrControl+Shift+W", () => {
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

/**
 * IPC 通信处理
 */
function setupIPC() {
  // 获取应用版本
  ipcMain.handle("get-app-version", () => {
    return app.getVersion();
  });

  // 获取平台信息
  ipcMain.handle("get-platform", () => {
    return process.platform;
  });

  // 最小化窗口
  ipcMain.on("minimize-window", () => {
    mainWindow.minimize();
  });

  // 最大化窗口
  ipcMain.on("maximize-window", () => {
    if (mainWindow.isMaximized()) {
      mainWindow.restore();
    } else {
      mainWindow.maximize();
    }
  });

  // 关闭窗口
  ipcMain.on("close-window", () => {
    mainWindow.close();
  });

  // 设置置顶
  ipcMain.on("set-always-on-top", (event, alwaysOnTop) => {
    mainWindow.setAlwaysOnTop(alwaysOnTop);
    store.set("alwaysOnTop", alwaysOnTop);
  });

  // 打开外部链接
  ipcMain.on("open-external", (event, url) => {
    shell.openExternal(url);
  });

  // 显示保存对话框
  ipcMain.handle("show-save-dialog", async (event, options) => {
    const result = await dialog.showSaveDialog(mainWindow, options);
    return result;
  });

  // 显示打开对话框
  ipcMain.handle("show-open-dialog", async (event, options) => {
    const result = await dialog.showOpenDialog(mainWindow, options);
    return result;
  });

  // 读取剪贴板文本
  ipcMain.handle("read-clipboard-text", () => {
    return clipboard.readText();
  });

  // 写入剪贴板文本
  ipcMain.on("write-clipboard-text", (event, text) => {
    clipboard.writeText(text);
  });

  // 读取剪贴板图片
  ipcMain.handle("read-clipboard-image", () => {
    const image = clipboard.readImage();
    if (!image.isEmpty()) {
      return image.toDataURL();
    }
    return null;
  });

  // Store 相关方法
  ipcMain.handle("store-delete", async (event, key) => {
    store.delete(key);
  });

  ipcMain.handle("store-clear", async (event) => {
    store.clear();
  });

  ipcMain.handle("store-has", async (event, key) => {
    return store.has(key);
  });

  // App 路径获取
  ipcMain.handle("get-app-path", async (event, name) => {
    return app.getPath(name || "userData");
  });

  // 截图功能
  ipcMain.handle("capture-screen", async () => {
    return await startScreenshot();
  });

  // 截图选区完成
  ipcMain.on("screenshot-selection", async (event, bounds) => {
    await handleScreenshotSelection(bounds);
  });

  // 截图取消
  ipcMain.on("screenshot-cancel", () => {
    console.log('[Main] Screenshot cancelled, fromHotkey:', screenshotFromHotkey, 'wasMainWindowVisible:', wasMainWindowVisible);
    // 清理预截图数据
    screenshotData = null;
    screenshotModule.clearScreenshotData();
    
    // 取消注册 ESC 快捷键
    globalShortcut.unregister('Escape');
    
    if (screenshotWindow) {
      screenshotWindow.close();
      screenshotWindow = null;
    }
    
    // 如果是从快捷键触发的，取消时不显示主窗口
    // 如果是从软件内按钮触发的（主窗口之前是可见的），取消时恢复显示
    if (!screenshotFromHotkey && wasMainWindowVisible && mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
    
    // 重置状态
    wasMainWindowVisible = false;
    screenshotFromHotkey = false;
  });
}

/**
 * 检查更新（简化版）
 */
function checkForUpdates() {
  dialog.showMessageBox(mainWindow, {
    type: "info",
    title: "检查更新",
    message: "当前已是最新版本",
    buttons: ["确定"],
  });
}

/**
 * 应用启动
 */
app.whenReady().then(() => {
  createWindow();
  createMenu();
  createTray();
  registerShortcuts();
  setupIPC();
});

/**
 * 窗口全部关闭时退出（除了 macOS）
 */
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

/**
 * 激活应用时重新创建窗口（macOS）
 */
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  } else {
    mainWindow.show();
  }
});

/**
 * 应用退出前清理
 */
app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  if (tray) {
    tray.destroy();
  }
});

/**
 * 阻止多个实例
 */
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// 导出主窗口引用（用于测试）
module.exports = { mainWindow };
