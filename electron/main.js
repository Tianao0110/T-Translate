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
const screenshotModule = require("./screenshot-module");

// Windows 截图穿透功能（让窗口在截图中不可见）
let setWindowDisplayAffinity = null;
const WDA_EXCLUDEFROMCAPTURE = 0x00000011;

if (process.platform === "win32") {
  try {
    const koffi = require("koffi");
    const user32 = koffi.load("user32.dll");
    setWindowDisplayAffinity = user32.func("SetWindowDisplayAffinity", "bool", [
      "void*",
      "uint",
    ]);
    console.log("[Main] Windows SetWindowDisplayAffinity API loaded");
  } catch (e) {
    console.warn("[Main] Failed to load koffi for Windows API:", e.message);
    console.warn(
      "[Main] Glass window will flash during capture. Install koffi: npm install koffi"
    );
  }
}

/**
 * 设置窗口为截图不可见（仅 Windows）
 * 调用后，该窗口在所有截图中都不会出现
 */
function makeWindowInvisibleToCapture(electronWindow) {
  if (process.platform !== "win32" || !setWindowDisplayAffinity) {
    return false;
  }

  try {
    const hwnd = electronWindow.getNativeWindowHandle();
    const result = setWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE);
    if (result) {
      console.log("[Main] Window set to capture-invisible mode");
      return true;
    } else {
      console.warn("[Main] SetWindowDisplayAffinity returned false");
      return false;
    }
  } catch (e) {
    console.error("[Main] Failed to set window display affinity:", e);
    return false;
  }
}

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
let glassWindow = null; // 玻璃翻译窗口
let selectionWindow = null; // 划词翻译窗口
let tray = null;
let isQuitting = false;
let selectionEnabled = false; // 划词翻译开关 - 默认关闭

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
 * 创建玻璃翻译窗口
 */
function createGlassWindow() {
  if (glassWindow) {
    glassWindow.focus();
    return;
  }

  // 获取保存的玻璃窗口位置和大小
  const glassBounds = store.get("glassBounds", {
    width: 400,
    height: 200,
    x: undefined,
    y: undefined,
  });

  glassWindow = new BrowserWindow({
    width: glassBounds.width,
    height: glassBounds.height,
    x: glassBounds.x,
    y: glassBounds.y,
    minWidth: 200,
    minHeight: 100,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    resizable: true,
    hasShadow: false,
    backgroundColor: "#00000000",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload-glass.js"),
    },
  });

  // Windows: 设置窗口为截图不可见（零闪烁方案）
  if (process.platform === "win32") {
    // 需要在窗口显示后设置
    glassWindow.once("ready-to-show", () => {
      const success = makeWindowInvisibleToCapture(glassWindow);
      if (success) {
        console.log("[Glass] Window is now invisible to screen capture");
      }
    });
  }

  // 加载玻璃窗口页面
  if (isDev) {
    glassWindow.loadURL("http://localhost:5173/src/windows/glass.html");
  } else {
    glassWindow.loadFile(
      path.join(__dirname, "../dist/src/windows/glass.html")
    );
  }

  // 窗口移动/缩放时保存位置
  glassWindow.on("moved", () => {
    if (glassWindow) {
      const bounds = glassWindow.getBounds();
      store.set("glassBounds", bounds);
    }
  });

  glassWindow.on("resized", () => {
    if (glassWindow) {
      const bounds = glassWindow.getBounds();
      store.set("glassBounds", bounds);
    }
  });

  glassWindow.on("closed", () => {
    glassWindow = null;
  });

  // 注册窗口内快捷键
  glassWindow.webContents.on("before-input-event", (event, input) => {
    if (input.key === "Escape") {
      glassWindow.close();
    } else if (
      input.key === " " &&
      !input.control &&
      !input.alt &&
      !input.meta
    ) {
      // 空格键手动刷新
      glassWindow.webContents.send("glass:refresh");
    }
  });
}

/**
 * 切换玻璃窗口显示/隐藏
 */
function toggleGlassWindow() {
  if (glassWindow) {
    if (glassWindow.isVisible()) {
      glassWindow.close();
    } else {
      glassWindow.show();
      glassWindow.focus();
    }
  } else {
    createGlassWindow();
  }
}

// ==================== 划词翻译 ====================

/**
 * 创建划词翻译窗口
 * 关键：focusable: false - 点击时不抢夺原窗口焦点，保持选区状态
 */
function createSelectionWindow() {
  if (selectionWindow && !selectionWindow.isDestroyed()) {
    return selectionWindow;
  }

  selectionWindow = new BrowserWindow({
    width: 450,
    height: 200,
    show: false,
    frame: false,
    transparent: true,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false, // 🔴 关键：点击不抢焦点，原窗口保持选区
    webPreferences: {
      preload: path.join(__dirname, "preload-selection.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // 设置窗口层级最高
  selectionWindow.setAlwaysOnTop(true, "screen-saver");

  // 不穿透鼠标事件
  selectionWindow.setIgnoreMouseEvents(false);

  if (isDev) {
    selectionWindow.loadURL("http://localhost:5173/selection.html");
  } else {
    selectionWindow.loadFile(path.join(__dirname, "../dist/selection.html"));
  }

  selectionWindow.webContents.on("did-finish-load", () => {
    console.log("[Selection] Window content loaded");
  });

  selectionWindow.on("closed", () => {
    selectionWindow = null;
  });

  return selectionWindow;
}

/**
 * 显示划词翻译触发点
 * 只显示圆点，不复制。点击时才复制
 * @param {number} mouseX - 鼠标 X 坐标
 * @param {number} mouseY - 鼠标 Y 坐标
 * @param {Object} rect - 选区矩形（用于 OCR 兜底）
 */
function showSelectionTrigger(mouseX, mouseY, rect) {
  console.log("[Selection] showSelectionTrigger at:", mouseX, mouseY);

  if (!selectionEnabled) return;

  // 保存 rect 供后续 OCR 使用
  lastSelectionRect = rect;

  const win = createSelectionWindow();

  // 圆点位置：鼠标位置右下方 8px
  let triggerX = mouseX + 8;
  let triggerY = mouseY + 8;

  // 屏幕边界检测
  const display = screen.getDisplayNearestPoint({ x: mouseX, y: mouseY });
  const bounds = display.bounds;

  if (triggerX + 32 > bounds.x + bounds.width) {
    triggerX = mouseX - 40;
  }
  if (triggerY + 32 > bounds.y + bounds.height) {
    triggerY = mouseY - 40;
  }

  // 设置窗口（圆点模式：32x32）
  win.setBounds({
    x: Math.round(triggerX),
    y: Math.round(triggerY),
    width: 32,
    height: 32,
  });
  win.show();

  const sendData = () => {
    win.webContents.send("selection:show-trigger", {
      mouseX,
      mouseY,
      rect, // 传递 rect 给渲染进程
      theme: store.get("theme", "light"),
    });
  };

  if (win.webContents.isLoading()) {
    win.webContents.once("did-finish-load", sendData);
  } else {
    setTimeout(sendData, 50);
  }
}

// 保存最后一次选区矩形（用于 OCR 兜底）
let lastSelectionRect = null;

// 标记是否正在拖动便利贴（防止触发新的划词）
let isDraggingOverlay = false;

/**
 * 隐藏划词翻译窗口
 */
function hideSelectionWindow() {
  if (selectionWindow && !selectionWindow.isDestroyed()) {
    selectionWindow.hide();
    selectionWindow.webContents.send("selection:hide");
  }
}

/**
 * 切换划词翻译开关
 */
function toggleSelectionTranslate() {
  selectionEnabled = !selectionEnabled;
  store.set("selectionEnabled", selectionEnabled);

  // 更新托盘菜单
  updateTrayMenu();

  // 如果禁用，隐藏窗口并停止监听
  if (!selectionEnabled) {
    hideSelectionWindow();
    stopSelectionHook();
  } else {
    startSelectionHook();
  }

  console.log("[Selection] Enabled:", selectionEnabled);
  return selectionEnabled;
}

// 划词监听相关变量
let selectionHook = null;
let mouseDownPos = null;
let mouseDownTime = 0;

/**
 * 启动划词监听
 */
function startSelectionHook() {
  if (selectionHook || !selectionEnabled) return;

  try {
    const { uIOhook } = require("uiohook-napi");

    uIOhook.on("mousedown", (e) => {
      if (e.button === 1) {
        // 左键
        // 获取当前鼠标的屏幕坐标
        const cursorPos = screen.getCursorScreenPoint();

        // 检查是否点击在 selectionWindow 内（圆点/便利贴）
        if (
          selectionWindow &&
          !selectionWindow.isDestroyed() &&
          selectionWindow.isVisible()
        ) {
          const bounds = selectionWindow.getBounds();
          if (
            cursorPos.x >= bounds.x &&
            cursorPos.x <= bounds.x + bounds.width &&
            cursorPos.y >= bounds.y &&
            cursorPos.y <= bounds.y + bounds.height
          ) {
            // 点击在圆点/便利贴上，设置拖动标志
            console.log(
              "[Selection] Click on selection window, setting drag flag"
            );
            isDraggingOverlay = true;
            mouseDownPos = null;
            return;
          }
        }

        // 不在 selectionWindow 内，清除拖动标志
        isDraggingOverlay = false;

        mouseDownPos = { x: cursorPos.x, y: cursorPos.y };
        mouseDownTime = Date.now();

        console.log("[Selection] Mouse down at:", mouseDownPos);

        // 检查是否点击在主窗口/玻璃窗内
        if (isClickInOurWindows(mouseDownPos.x, mouseDownPos.y)) {
          console.log("[Selection] Click in main/glass window, ignoring");
          mouseDownPos = null;
          return;
        }

        // 点击在其他地方，隐藏之前的窗口
        hideSelectionWindow();
      }
    });

    uIOhook.on("mouseup", async (e) => {
      if (e.button === 1) {
        // 🔴 核心修复：如果正在拖动便利贴，忽略这次 mouseup
        if (isDraggingOverlay) {
          console.log("[Selection] Was dragging overlay, ignoring mouseup");
          isDraggingOverlay = false;
          mouseDownPos = null;
          return;
        }

        if (!mouseDownPos) return;

        // 使用 Electron 的 screen 模块获取准确坐标
        const cursorPos = screen.getCursorScreenPoint();
        const mouseUpPos = { x: cursorPos.x, y: cursorPos.y };

        // 检查 mouseup 是否在 selectionWindow 内
        if (
          selectionWindow &&
          !selectionWindow.isDestroyed() &&
          selectionWindow.isVisible()
        ) {
          const bounds = selectionWindow.getBounds();
          if (
            mouseUpPos.x >= bounds.x &&
            mouseUpPos.x <= bounds.x + bounds.width &&
            mouseUpPos.y >= bounds.y &&
            mouseUpPos.y <= bounds.y + bounds.height
          ) {
            console.log(
              "[Selection] Mouse up on selection window, ignoring drag detection"
            );
            mouseDownPos = null;
            return;
          }
        }

        console.log("[Selection] Mouse up at:", mouseUpPos);

        const distance = Math.sqrt(
          Math.pow(mouseUpPos.x - mouseDownPos.x, 2) +
            Math.pow(mouseUpPos.y - mouseDownPos.y, 2)
        );
        const duration = Date.now() - mouseDownTime;

        console.log(
          "[Selection] Distance:",
          distance.toFixed(0),
          "Duration:",
          duration
        );

        // 防误触：距离 > 20px 且时间 > 150ms 才视为划词
        if (distance > 20 && duration > 150) {
          console.log(
            "[Selection] Drag detected! Showing trigger (no copy yet)"
          );

          // 计算选区矩形（用于 OCR 兜底）
          const rect = {
            x: Math.min(mouseDownPos.x, mouseUpPos.x),
            y: Math.min(mouseDownPos.y, mouseUpPos.y),
            width: Math.abs(mouseUpPos.x - mouseDownPos.x),
            height: Math.abs(mouseUpPos.y - mouseDownPos.y),
          };

          // 只显示圆点，不复制。点击圆点时才复制
          showSelectionTrigger(mouseUpPos.x, mouseUpPos.y, rect);
        }

        mouseDownPos = null;
      }
    });

    uIOhook.start();
    selectionHook = uIOhook;
    console.log("[Selection] Hook started");
  } catch (err) {
    console.error("[Selection] Failed to start hook:", err.message);
    selectionEnabled = false;
    store.set("selectionEnabled", false);
    updateTrayMenu();
  }
}

/**
 * 停止划词监听
 */
function stopSelectionHook() {
  if (selectionHook) {
    try {
      selectionHook.stop();
      selectionHook = null;
      console.log("[Selection] Hook stopped");
    } catch (err) {
      console.error("[Selection] Failed to stop hook:", err);
    }
  }
}

/**
 * 检查坐标是否在我们的窗口内（不包括 selectionWindow，因为它需要接收点击）
 */
function isClickInOurWindows(x, y) {
  // 注意：不检查 selectionWindow，因为圆点需要接收点击事件
  const windows = [mainWindow, glassWindow];
  for (const win of windows) {
    if (win && !win.isDestroyed() && win.isVisible()) {
      if (win.isMinimized() || !win.isFocused()) continue;
      const bounds = win.getBounds();
      if (
        x >= bounds.x &&
        x <= bounds.x + bounds.width &&
        y >= bounds.y &&
        y <= bounds.y + bounds.height
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * 稳定获取选中文字（清空+轮询方案）
 */
async function fetchSelectedText() {
  try {
    // 1. 备份现有剪贴板
    const backup = clipboard.readText();
    console.log(
      "[Selection] Backup clipboard:",
      backup?.substring(0, 30) || "(empty)"
    );

    // 2. 清空剪贴板（关键！作为信号量）
    clipboard.clear();

    // 3. 触发系统复制
    simulateCtrlC();

    // 4. 轮询等待（最多 500ms，每 50ms 检查一次）
    for (let i = 0; i < 10; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const text = clipboard.readText();
      if (text && text.trim()) {
        console.log("[Selection] Got text after", (i + 1) * 50, "ms");
        // 延迟恢复剪贴板
        setTimeout(() => {
          if (backup) clipboard.writeText(backup);
        }, 500);
        return text.trim();
      }
    }

    // 5. 超时，恢复剪贴板
    console.log("[Selection] Clipboard polling timeout");
    if (backup) clipboard.writeText(backup);
    return null;
  } catch (err) {
    console.error("[Selection] fetchSelectedText error:", err);
    return null;
  }
}

/**
 * OCR 兜底方案
 */
async function getTextByOCR(rect) {
  try {
    // 区域太小则跳过
    if (rect.width < 20 || rect.height < 10) {
      console.log("[Selection] Region too small for OCR");
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

    console.log("[Selection] OCR region:", captureRect);

    // 截取区域
    const screenshot = await screenshotModule.captureRegion(captureRect);

    if (!screenshot) {
      console.log("[Selection] Screenshot failed");
      return null;
    }

    // 使用 Tesseract OCR
    const Tesseract = require("tesseract.js");
    const result = await Tesseract.recognize(
      Buffer.from(screenshot.replace(/^data:image\/\w+;base64,/, ""), "base64"),
      "chi_sim+eng",
      { logger: () => {} }
    );

    return result.data.text;
  } catch (err) {
    console.error("[Selection] OCR error:", err);
    return null;
  }
}

/**
 * 使用 Windows API 模拟 Ctrl+C
 */
function simulateCtrlC() {
  if (process.platform !== "win32") return;

  try {
    const koffi = require("koffi");
    const user32 = koffi.load("user32.dll");

    const keybd_event = user32.func(
      "void keybd_event(uint8, uint8, uint32, uintptr)"
    );

    const VK_CONTROL = 0x11;
    const VK_C = 0x43;
    const KEYEVENTF_KEYUP = 0x0002;

    // 按下 Ctrl
    keybd_event(VK_CONTROL, 0x1d, 0, 0);
    // 按下 C
    keybd_event(VK_C, 0x2e, 0, 0);
    // 释放 C
    keybd_event(VK_C, 0x2e, KEYEVENTF_KEYUP, 0);
    // 释放 Ctrl
    keybd_event(VK_CONTROL, 0x1d, KEYEVENTF_KEYUP, 0);

    console.log("[Selection] Ctrl+C simulated");
  } catch (err) {
    console.error("[Selection] Failed to simulate Ctrl+C:", err);
  }
}

/**
 * 停止全局鼠标监听
 */
// stopMouseHook 已移除，不再需要全局鼠标监听

/**
 * 更新托盘菜单
 */
function updateTrayMenu() {
  if (!tray) return;

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
    {
      label: "玻璃窗口",
      click: () => {
        toggleGlassWindow();
      },
    },
    { type: "separator" },
    {
      label: "划词翻译",
      type: "checkbox",
      checked: selectionEnabled,
      click: () => {
        toggleSelectionTranslate();
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
    { type: "separator" },
    {
      label: "退出",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
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

  console.log(
    "[Main] startScreenshot, fromHotkey:",
    fromHotkey,
    "wasMainWindowVisible:",
    wasMainWindowVisible
  );

  // 隐藏主窗口
  if (wasMainWindowVisible) {
    mainWindow.hide();
  }

  // 等待主窗口完全隐藏
  await new Promise((resolve) => setTimeout(resolve, 300));

  // 获取所有显示器信息
  const displays = screen.getAllDisplays();
  const primaryDisplay = screen.getPrimaryDisplay();

  console.log(
    "[Main] All displays:",
    displays.map((d) => ({
      id: d.id,
      bounds: d.bounds,
      scaleFactor: d.scaleFactor,
    }))
  );

  // 计算所有显示器的总边界
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  let maxScaleFactor = 1;
  displays.forEach((display) => {
    minX = Math.min(minX, display.bounds.x);
    minY = Math.min(minY, display.bounds.y);
    maxX = Math.max(maxX, display.bounds.x + display.bounds.width);
    maxY = Math.max(maxY, display.bounds.y + display.bounds.height);
    maxScaleFactor = Math.max(maxScaleFactor, display.scaleFactor);
  });

  const totalWidth = maxX - minX;
  const totalHeight = maxY - minY;
  const totalBounds = { minX, minY, maxX, maxY, totalWidth, totalHeight };

  console.log("[Main] Total screen area:", totalBounds);

  // 优先使用 node-screenshots
  if (screenshotModule.isNodeScreenshotsAvailable()) {
    console.log("[Main] Using node-screenshots for capture");
    screenshotData = await screenshotModule.captureWithNodeScreenshots(
      displays,
      totalBounds
    );
  }

  // 回退到 desktopCapturer
  if (!screenshotData) {
    console.log("[Main] Using desktopCapturer fallback");
    screenshotData = await screenshotModule.captureWithDesktopCapturer(
      displays,
      primaryDisplay,
      totalBounds,
      maxScaleFactor
    );
  }

  if (screenshotData) {
    screenshotModule.setScreenshotData(screenshotData);
    console.log("[Main] Screenshot data saved, type:", screenshotData.type);
  } else {
    console.error("[Main] Failed to capture screenshot");
  }

  console.log("[Main] Total screen bounds:", { minX, minY, maxX, maxY });

  // 注册临时的 ESC 全局快捷键用于取消截图
  globalShortcut.register("Escape", () => {
    console.log(
      "[Main] ESC pressed (global shortcut), fromHotkey:",
      screenshotFromHotkey,
      "wasMainWindowVisible:",
      wasMainWindowVisible
    );
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
    globalShortcut.unregister("Escape");
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
    height: totalHeight,
  });

  console.log(
    "[Main] Screenshot window bounds set to:",
    screenshotWindow.getBounds()
  );

  // 传递屏幕边界信息和配置给选区窗口
  screenshotWindow.webContents.on("did-finish-load", async () => {
    screenshotWindow.webContents.send("screen-bounds", {
      minX,
      minY,
      maxX,
      maxY,
    });

    // 读取设置中的确认按钮选项
    let showConfirmButtons = true; // 默认显示
    try {
      const settings = store.get("settings");
      if (settings?.screenshot?.showConfirmButtons !== undefined) {
        showConfirmButtons = settings.screenshot.showConfirmButtons;
      }
    } catch (e) {
      console.log("[Main] Could not read screenshot settings:", e.message);
    }

    // 发送配置
    screenshotWindow.webContents.send("screenshot-config", {
      showConfirmButtons: showConfirmButtons,
    });

    // 确保窗口获得焦点
    screenshotWindow.focus();
    screenshotWindow.webContents.focus();

    // 打印实际窗口大小
    console.log(
      "[Main] Screenshot window actual bounds:",
      screenshotWindow.getBounds()
    );
  });

  screenshotWindow.loadFile(path.join(__dirname, "screenshot.html"));

  // 在 Windows 上确保窗口置顶
  screenshotWindow.setAlwaysOnTop(true, "screen-saver");

  // 确保窗口获得焦点以接收键盘事件
  screenshotWindow.focus();

  screenshotWindow.on("closed", () => {
    screenshotWindow = null;
    // 清理全局快捷键
    globalShortcut.unregister("Escape");
  });
}

/**
 * 处理截图选区
 */
async function handleScreenshotSelection(bounds) {
  console.log("[Main] handleScreenshotSelection called, bounds:", bounds);

  // 取消注册 ESC 快捷键
  globalShortcut.unregister("Escape");

  try {
    // 先关闭选区窗口
    if (screenshotWindow) {
      screenshotWindow.close();
      screenshotWindow = null;
    }

    // 使用 screenshotModule 处理截图
    const data = screenshotModule.getScreenshotData() || screenshotData;

    if (!data) {
      throw new Error("没有预先截取的屏幕图像");
    }

    let dataURL;

    // 根据截图类型处理
    if (data.type === "node-screenshots") {
      console.log("[Main] Processing with node-screenshots");
      dataURL = screenshotModule.processSelection(bounds);
    } else {
      // desktopCapturer 回退处理
      console.log("[Main] Processing with desktopCapturer fallback");
      dataURL = processDesktopCapturerSelection(data, bounds);
    }

    console.log("[Main] DataURL generated, length:", dataURL?.length || 0);

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

    await new Promise((resolve) => setTimeout(resolve, 100));

    // 发送截图到渲染进程
    if (mainWindow && dataURL) {
      console.log("[Main] Sending screenshot-captured to renderer...");
      mainWindow.webContents.send("screenshot-captured", dataURL);
    }

    return dataURL;
  } catch (error) {
    console.error("[Main] Screenshot error:", error);

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
    throw new Error("没有可用的截图源");
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
  cropBounds.width = Math.max(
    1,
    Math.min(cropBounds.width, screenshotSize.width - cropBounds.x)
  );
  cropBounds.height = Math.max(
    1,
    Math.min(cropBounds.height, screenshotSize.height - cropBounds.y)
  );

  console.log("[Main] Crop bounds:", cropBounds);

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
  tray.setToolTip("T-Translate");

  // 初始化菜单
  updateTrayMenu();

  // 单击托盘图标切换划词翻译
  tray.on("click", () => {
    toggleSelectionTranslate();
  });

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

  // 打开/关闭玻璃翻译窗口 Ctrl+Alt+G
  globalShortcut.register("CommandOrControl+Alt+G", () => {
    toggleGlassWindow();
  });

  // 划词翻译现在是鼠标拖拽自动触发，不需要快捷键
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

  ipcMain.handle("selection:resize", (event, { width, height }) => {
    if (selectionWindow && !selectionWindow.isDestroyed()) {
      // 使用 setSize 只改变大小，不改变位置，避免漂移
      selectionWindow.setSize(Math.round(width), Math.round(height));
    }
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
    console.log(
      "[Main] Screenshot cancelled, fromHotkey:",
      screenshotFromHotkey,
      "wasMainWindowVisible:",
      wasMainWindowVisible
    );
    // 清理预截图数据
    screenshotData = null;
    screenshotModule.clearScreenshotData();

    // 取消注册 ESC 快捷键
    globalShortcut.unregister("Escape");

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

  // ========== 玻璃翻译窗口 IPC ==========

  // 获取玻璃窗口边界
  ipcMain.handle("glass:get-bounds", () => {
    if (glassWindow) {
      return glassWindow.getBounds();
    }
    return null;
  });

  // 截取玻璃窗口覆盖区域
  ipcMain.handle("glass:capture-region", async (event, bounds) => {
    try {
      if (!glassWindow || glassWindow.isDestroyed()) {
        throw new Error("玻璃窗口不存在");
      }

      // Windows 下窗口已设置为截图不可见，无需隐藏
      // macOS/Linux 仍需要隐藏窗口（后续可实现 macOS 原生方案）
      const needHideWindow =
        process.platform !== "win32" || !setWindowDisplayAffinity;

      if (needHideWindow) {
        // 非 Windows 或 API 不可用时，使用隐藏窗口方案
        glassWindow.webContents.send("glass:hide-for-capture");
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      // 使用 node-screenshots 截取指定区域
      const screenshot = await screenshotModule.captureRegion(bounds);

      if (needHideWindow) {
        glassWindow.webContents.send("glass:show-after-capture");
      }

      if (screenshot) {
        return { success: true, imageData: screenshot };
      } else {
        throw new Error("截图失败");
      }
    } catch (error) {
      console.error("[Glass] Capture error:", error);
      if (glassWindow && !glassWindow.isDestroyed()) {
        glassWindow.webContents.send("glass:show-after-capture");
      }
      return { success: false, error: error.message };
    }
  });

  // 翻译文本（玻璃窗口）
  ipcMain.handle("glass:translate", async (event, text) => {
    try {
      // 发送翻译请求到主窗口的翻译服务
      // 或者直接调用 LLM
      mainWindow?.webContents.send("glass:translate-request", text);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // 设置穿透模式 - 使用智能穿透，控制栏始终可点击
  ipcMain.handle("glass:set-pass-through", (event, enabled) => {
    if (glassWindow && !glassWindow.isDestroyed()) {
      console.log("[Glass] Setting pass-through mode:", enabled);
      if (enabled) {
        // 启用穿透，使用 forward 让渲染进程可以根据鼠标位置控制
        glassWindow.setIgnoreMouseEvents(true, { forward: true });
      } else {
        // 完全关闭穿透
        glassWindow.setIgnoreMouseEvents(false);
      }
      return true;
    }
    return false;
  });

  // 动态设置穿透（根据鼠标位置，仅在穿透模式开启时使用）
  ipcMain.handle("glass:set-ignore-mouse", (event, ignore) => {
    if (glassWindow && !glassWindow.isDestroyed()) {
      if (ignore) {
        glassWindow.setIgnoreMouseEvents(true, { forward: true });
      } else {
        glassWindow.setIgnoreMouseEvents(false);
      }
      return true;
    }
    return false;
  });

  // 设置置顶
  ipcMain.handle("glass:set-always-on-top", (event, enabled) => {
    if (glassWindow) {
      glassWindow.setAlwaysOnTop(enabled);
      return true;
    }
    return false;
  });

  // 关闭玻璃窗口
  ipcMain.handle("glass:close", () => {
    if (glassWindow) {
      glassWindow.close();
      return true;
    }
    return false;
  });

  // 获取玻璃窗口设置（合并主程序设置和本地设置）
  ipcMain.handle("glass:get-settings", async () => {
    // 从主程序设置读取
    const mainSettings = store.get("settings", {});
    const glassConfig = mainSettings.glassWindow || {};

    // 本地设置（窗口位置等）
    const localSettings = store.get("glassLocalSettings", {});

    // 尝试从主窗口获取当前目标语言
    let currentTargetLang = mainSettings.translation?.defaultTargetLang ?? "zh";

    // 通过 IPC 从主窗口获取实时的目标语言
    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        currentTargetLang = await mainWindow.webContents.executeJavaScript(`
          (function() {
            try {
              // 尝试从 Zustand store 获取
              const store = window.__TRANSLATION_STORE__;
              if (store) {
                return store.getState().currentTranslation.targetLanguage || 'zh';
              }
              return 'zh';
            } catch(e) {
              return 'zh';
            }
          })()
        `);
      } catch (e) {
        console.log(
          "[Glass] Could not get target language from main window:",
          e.message
        );
      }
    }

    const merged = {
      // 从主程序设置
      refreshInterval: glassConfig.refreshInterval ?? 3000,
      smartDetect: glassConfig.smartDetect ?? true,
      streamOutput: glassConfig.streamOutput ?? true,
      ocrEngine: glassConfig.ocrEngine ?? "llm-vision",
      defaultOpacity: glassConfig.defaultOpacity ?? 0.85,
      autoPin: glassConfig.autoPin ?? true,
      // 翻译设置 - 使用实时获取的目标语言
      targetLanguage: currentTargetLang,
      // 本地设置
      opacity: localSettings.opacity ?? glassConfig.defaultOpacity ?? 0.85,
      isPinned: localSettings.isPinned ?? glassConfig.autoPin ?? true,
    };

    console.log("[Glass] Get settings:", merged);
    return merged;
  });

  // 保存玻璃窗口本地设置（窗口位置、透明度等）
  ipcMain.handle("glass:save-settings", (event, settings) => {
    const current = store.get("glassLocalSettings", {});
    store.set("glassLocalSettings", { ...current, ...settings });
    return true;
  });

  // 添加到收藏（从玻璃窗口）
  ipcMain.handle("glass:add-to-favorites", (event, item) => {
    // 转发到主窗口处理
    mainWindow?.webContents.send("add-to-favorites", item);
    return true;
  });

  // 添加到历史记录（从玻璃窗口）
  ipcMain.handle("glass:add-to-history", (event, item) => {
    // 转发到主窗口处理
    mainWindow?.webContents.send("add-to-history", item);
    return true;
  });

  // 同步目标语言到主程序（从玻璃窗口）
  ipcMain.handle("glass:sync-target-language", (event, langCode) => {
    // 转发到主窗口处理
    mainWindow?.webContents.send("sync-target-language", langCode);
    return true;
  });

  // 打开玻璃窗口
  ipcMain.handle("glass:open", () => {
    createGlassWindow();
    return true;
  });

  // ========== 剪贴板 IPC（玻璃窗口使用） ==========

  ipcMain.handle("clipboard:write-text", (event, text) => {
    clipboard.writeText(text);
    return true;
  });

  ipcMain.handle("clipboard:read-text", () => {
    return clipboard.readText();
  });

  // ========== 划词翻译 IPC ==========

  // 获取划词翻译设置
  ipcMain.handle("selection:get-settings", () => {
    const settings = store.get("settings", {});
    return (
      settings.selection || {
        triggerIcon: "dot",
        triggerSize: 24,
        triggerColor: "#3b82f6",
        customIconPath: "",
        hoverDelay: 300,
        triggerTimeout: 5000,
        resultTimeout: 3000,
        minChars: 2,
        maxChars: 500,
      }
    );
  });

  // 隐藏划词翻译窗口
  ipcMain.handle("selection:hide", () => {
    hideSelectionWindow();
    return true;
  });

  // 设置划词翻译窗口位置
  ipcMain.handle("selection:set-position", (event, x, y) => {
    if (selectionWindow && !selectionWindow.isDestroyed()) {
      selectionWindow.setPosition(Math.round(x), Math.round(y));
    }
    return true;
  });

  // 划词翻译添加到历史记录
  ipcMain.handle("selection:add-to-history", (event, item) => {
    mainWindow?.webContents.send("add-to-history", item);
    return true;
  });

  // 切换划词翻译
  ipcMain.handle("selection:toggle", () => {
    return toggleSelectionTranslate();
  });

  // 获取划词翻译状态
  ipcMain.handle("selection:get-enabled", () => {
    return selectionEnabled;
  });

  // 设置划词翻译窗口位置和大小（用于便利贴模式）
  ipcMain.handle("selection:set-bounds", (event, bounds) => {
    if (selectionWindow && !selectionWindow.isDestroyed()) {
      console.log("[Selection] Setting bounds:", bounds);
      selectionWindow.setBounds({
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
      });
    }
  });

  // 开始拖动窗口
  ipcMain.handle("selection:start-drag", () => {
    if (selectionWindow && !selectionWindow.isDestroyed()) {
      // 返回当前窗口位置
      const bounds = selectionWindow.getBounds();
      return { x: bounds.x, y: bounds.y };
    }
    return null;
  });

  // 移动窗口（拖动中）- 使用 setBounds 明确保持大小不变
  ipcMain.handle("selection:move-window", (event, { deltaX, deltaY }) => {
    if (selectionWindow && !selectionWindow.isDestroyed()) {
      const bounds = selectionWindow.getBounds();

      // 使用 setBounds 而不是 setPosition，明确指定所有参数
      selectionWindow.setBounds({
        x: Math.round(bounds.x + deltaX),
        y: Math.round(bounds.y + deltaY),
        width: bounds.width, // 保持原大小
        height: bounds.height, // 保持原大小
      });
    }
  });

  // 获取选中的文字（点击圆点时调用）
  // 先尝试 Ctrl+C，失败则 OCR 兜底
  ipcMain.handle("selection:get-text", async (event, rect) => {
    console.log("[Selection] Getting selected text...");

    // 1. 先尝试 Ctrl+C 复制
    const text = await fetchSelectedText();

    if (text && text.trim()) {
      console.log("[Selection] Got text via Ctrl+C:", text.substring(0, 50));
      return { text: text.trim(), method: "clipboard" };
    }

    // 2. 复制失败，尝试 OCR 兜底
    console.log("[Selection] Ctrl+C failed, trying OCR...");
    const ocrRect = rect || lastSelectionRect;

    if (ocrRect && ocrRect.width > 10 && ocrRect.height > 5) {
      try {
        const ocrText = await getTextByOCR(ocrRect);
        if (ocrText && ocrText.trim()) {
          console.log(
            "[Selection] Got text via OCR:",
            ocrText.substring(0, 50)
          );
          return { text: ocrText.trim(), method: "ocr" };
        }
      } catch (err) {
        console.error("[Selection] OCR failed:", err);
      }
    }

    console.log("[Selection] Both methods failed");
    return { text: null, method: null };
  });

  // 隐藏划词翻译窗口
  ipcMain.handle("selection:hide", () => {
    hideSelectionWindow();
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

  // 初始化划词翻译
  selectionEnabled = store.get("selectionEnabled", false);
  if (selectionEnabled) {
    // 延迟启动，等待其他组件初始化
    setTimeout(() => {
      startSelectionHook();
    }, 2000);
  }
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
  stopSelectionHook();
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
