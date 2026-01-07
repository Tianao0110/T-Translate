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
  try {
    return store.get(key);
  } catch (error) {
    console.error('[Store] Get error:', error);
    return null;
  }
});

ipcMain.handle("store-set", async (event, key, val) => {
  try {
    store.set(key, val);
    return { success: true };
  } catch (error) {
    console.error('[Store] Set error:', error);
    return { success: false, error: error.message };
  }
});

// 全局变量
let mainWindow = null;
let screenshotWindow = null;
let glassWindow = null; // 玻璃翻译窗口
let subtitleCaptureWindow = null; // 字幕采集区窗口
let subtitleCaptureRect = null; // 字幕采集区坐标
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
    minWidth: 150,
    minHeight: 80,
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
  if (process.platform === "win32" && setWindowDisplayAffinity) {
    // 在窗口加载完成后设置（比 ready-to-show 更可靠）
    glassWindow.webContents.on("did-finish-load", () => {
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

// ==================== 字幕采集区窗口 ====================

/**
 * 创建字幕采集区选择窗口
 * 这是一个透明的红框窗口，用于让用户框选视频字幕区域
 */
function createSubtitleCaptureWindow() {
  if (subtitleCaptureWindow && !subtitleCaptureWindow.isDestroyed()) {
    subtitleCaptureWindow.show();
    subtitleCaptureWindow.focus();
    return;
  }

  // 获取保存的采集区位置
  const savedRect = store.get("subtitleCaptureRect", {
    width: 600,
    height: 80,
    x: undefined,
    y: undefined,
  });

  subtitleCaptureWindow = new BrowserWindow({
    width: savedRect.width,
    height: savedRect.height,
    x: savedRect.x,
    y: savedRect.y,
    minWidth: 100,
    minHeight: 40,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    hasShadow: false,
    backgroundColor: "#00000000",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload-subtitle-capture.js"),
    },
  });

  // Windows: 设置窗口为截图不可见（关键！否则会截到红框）
  if (process.platform === "win32" && setWindowDisplayAffinity) {
    // 在窗口加载完成后设置
    subtitleCaptureWindow.webContents.on("did-finish-load", () => {
      makeWindowInvisibleToCapture(subtitleCaptureWindow);
    });
  }

  // 加载采集区窗口页面
  if (isDev) {
    subtitleCaptureWindow.loadURL("http://localhost:5173/src/windows/subtitle-capture.html");
  } else {
    subtitleCaptureWindow.loadFile(
      path.join(__dirname, "../dist/src/windows/subtitle-capture.html")
    );
  }

  // 窗口移动/缩放时保存位置并更新采集区坐标
  const updateCaptureRect = () => {
    if (subtitleCaptureWindow && !subtitleCaptureWindow.isDestroyed()) {
      const bounds = subtitleCaptureWindow.getBounds();
      subtitleCaptureRect = bounds;
      store.set("subtitleCaptureRect", bounds);
      // 通知玻璃窗口更新采集区
      if (glassWindow && !glassWindow.isDestroyed()) {
        glassWindow.webContents.send("subtitle:capture-rect-updated", bounds);
      }
    }
  };

  subtitleCaptureWindow.on("moved", updateCaptureRect);
  subtitleCaptureWindow.on("resized", updateCaptureRect);

  subtitleCaptureWindow.on("closed", () => {
    subtitleCaptureWindow = null;
  });

  // ESC 关闭窗口
  subtitleCaptureWindow.webContents.on("before-input-event", (event, input) => {
    if (input.key === "Escape") {
      subtitleCaptureWindow.close();
    }
  });

  // 初始化采集区坐标
  subtitleCaptureRect = savedRect;
  console.log("[Main] Subtitle capture window created, rect:", subtitleCaptureRect);
}

/**
 * 切换字幕采集区窗口显示/隐藏
 */
function toggleSubtitleCaptureWindow() {
  if (subtitleCaptureWindow && !subtitleCaptureWindow.isDestroyed()) {
    if (subtitleCaptureWindow.isVisible()) {
      // 关闭窗口（释放资源，坐标已保存）
      subtitleCaptureWindow.close();
      subtitleCaptureWindow = null;
    } else {
      subtitleCaptureWindow.show();
      subtitleCaptureWindow.focus();
    }
  } else {
    createSubtitleCaptureWindow();
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

  // 获取设置
  const settings = store.get("settings", {});
  const selectionSettings = settings.selection || {};
  const interfaceSettings = settings.interface || {};
  const translationSettings = settings.translation || {};
  
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
      rect,
      // 传递主题和设置
      theme: interfaceSettings.theme || "light",
      settings: {
        triggerTimeout: selectionSettings.triggerTimeout || 4000,
        showSourceByDefault: selectionSettings.showSourceByDefault || false,
        autoCloseOnCopy: selectionSettings.autoCloseOnCopy || false,
        minChars: selectionSettings.minChars || 2,
        maxChars: selectionSettings.maxChars || 500,
      },
      // 传递翻译设置（与主程序一致）
      translation: {
        targetLanguage: translationSettings.targetLanguage || "zh",
        sourceLanguage: translationSettings.sourceLanguage || "auto",
      }
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

        // 防误触：
        // - 距离 > 50px（过滤双击、右键菜单、拖拽文件等短距离操作）
        // - 时间 > 200ms（过滤快速点击）
        // - 时间 < 5000ms（过滤长时间按住不动）
        if (distance > 50 && duration > 200 && duration < 5000) {
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
  
  // API 健康检查
  ipcMain.handle("api:health-check", async () => {
    try {
      const settings = store.get("settings", {});
      const endpoint = settings.connection?.apiEndpoint || "http://localhost:1234/v1";
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch(`${endpoint}/models`, {
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        const data = await response.json();
        return {
          success: true,
          models: data?.data || [],
          message: "连接正常"
        };
      } else {
        return {
          success: false,
          models: [],
          message: `服务器返回 ${response.status}`
        };
      }
    } catch (error) {
      return {
        success: false,
        models: [],
        message: error.name === 'AbortError' ? '连接超时' : '无法连接服务'
      };
    }
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

  // ========== 字幕采集区 IPC ==========

  // 打开/关闭字幕采集区选择窗口
  ipcMain.handle("subtitle:toggle-capture-window", () => {
    toggleSubtitleCaptureWindow();
    return { success: true };
  });

  // 获取字幕采集区坐标
  ipcMain.handle("subtitle:get-capture-rect", () => {
    if (subtitleCaptureRect) {
      return subtitleCaptureRect;
    }
    // 尝试从存储读取
    const saved = store.get("subtitleCaptureRect");
    if (saved) {
      subtitleCaptureRect = saved;
      return saved;
    }
    return null;
  });

  // 设置字幕采集区坐标（从设置面板手动输入）
  ipcMain.handle("subtitle:set-capture-rect", (event, rect) => {
    if (rect && rect.x !== undefined && rect.y !== undefined) {
      subtitleCaptureRect = rect;
      store.set("subtitleCaptureRect", rect);
      // 如果采集区窗口存在，同步位置
      if (subtitleCaptureWindow && !subtitleCaptureWindow.isDestroyed()) {
        subtitleCaptureWindow.setBounds(rect);
      }
      return { success: true };
    }
    return { success: false, error: "Invalid rect" };
  });

  // 清除字幕采集区
  ipcMain.handle("subtitle:clear-capture-rect", () => {
    subtitleCaptureRect = null;
    store.delete("subtitleCaptureRect");
    if (subtitleCaptureWindow && !subtitleCaptureWindow.isDestroyed()) {
      subtitleCaptureWindow.close();
    }
    return { success: true };
  });

  // 截取字幕采集区（用于字幕模式）
  ipcMain.handle("subtitle:capture-region", async () => {
    try {
      if (!subtitleCaptureRect) {
        throw new Error("未设置字幕采集区");
      }

      // 使用 node-screenshots 截取指定区域
      const screenshot = await screenshotModule.captureRegion(subtitleCaptureRect);

      if (screenshot) {
        return { success: true, imageData: screenshot };
      } else {
        throw new Error("截图失败");
      }
    } catch (error) {
      console.error("[Subtitle] Capture error:", error);
      return { success: false, error: error.message };
    }
  });

  // 检查采集区窗口是否可见
  ipcMain.handle("subtitle:is-capture-window-visible", () => {
    if (subtitleCaptureWindow && !subtitleCaptureWindow.isDestroyed()) {
      return subtitleCaptureWindow.isVisible();
    }
    return false;
  });

  // 截取玻璃窗口覆盖区域
  ipcMain.handle("glass:capture-region", async (event, bounds) => {
    try {
      if (!glassWindow || glassWindow.isDestroyed()) {
        throw new Error("玻璃窗口不存在");
      }

      // 保存原始透明度
      let originalOpacity = 1;
      try {
        originalOpacity = glassWindow.getOpacity();
      } catch (e) {
        originalOpacity = 0.85;
      }

      // 强制隐藏窗口（设置透明度为 0）
      // 即使 koffi 存在，也要这样做，因为 koffi 可能在热重载后失效
      try {
        glassWindow.setOpacity(0);
        await new Promise((resolve) => setTimeout(resolve, 80));
      } catch (e) {
        console.warn("[Glass] Failed to set opacity:", e.message);
      }

      // 使用 node-screenshots 截取指定区域
      const screenshot = await screenshotModule.captureRegion(bounds);

      // 恢复窗口透明度
      try {
        glassWindow.setOpacity(originalOpacity > 0 ? originalOpacity : 0.85);
      } catch (e) {
        console.warn("[Glass] Failed to restore opacity:", e.message);
      }

      if (screenshot) {
        return { success: true, imageData: screenshot };
      } else {
        throw new Error("截图失败");
      }
    } catch (error) {
      console.error("[Glass] Capture error:", error);
      // 确保窗口恢复可见
      if (glassWindow && !glassWindow.isDestroyed()) {
        try {
          glassWindow.setOpacity(0.85);
        } catch (e) {
          // 忽略
        }
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
    const ocrConfig = mainSettings.ocr || {};

    // 本地设置（窗口位置等）
    const localSettings = store.get("glassLocalSettings", {});

    // 尝试从主窗口获取当前目标语言和原文语言
    let currentTargetLang = mainSettings.translation?.defaultTargetLang ?? "zh";
    let currentSourceLang = mainSettings.translation?.defaultSourceLang ?? "auto";

    // 通过 IPC 从主窗口获取实时的目标语言
    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        const langSettings = await mainWindow.webContents.executeJavaScript(`
          (function() {
            try {
              // 尝试从 Zustand store 获取
              const store = window.__TRANSLATION_STORE__;
              if (store) {
                const state = store.getState();
                return {
                  targetLanguage: state.currentTranslation?.targetLanguage || 'zh',
                  sourceLanguage: state.currentTranslation?.sourceLanguage || 'auto'
                };
              }
              return { targetLanguage: 'zh', sourceLanguage: 'auto' };
            } catch(e) {
              return { targetLanguage: 'zh', sourceLanguage: 'auto' };
            }
          })()
        `);
        currentTargetLang = langSettings.targetLanguage;
        currentSourceLang = langSettings.sourceLanguage;
      } catch (e) {
        console.log(
          "[Glass] Could not get language settings from main window:",
          e.message
        );
      }
    }

    const merged = {
      // 从主程序设置
      refreshInterval: glassConfig.refreshInterval ?? 3000,
      smartDetect: glassConfig.smartDetect ?? true,
      streamOutput: glassConfig.streamOutput ?? true,
      // 使用全局 OCR 引擎设置
      ocrEngine: ocrConfig.engine ?? glassConfig.ocrEngine ?? "llm-vision",
      globalOcrEngine: ocrConfig.engine ?? "llm-vision",  // 全局设置
      defaultOpacity: glassConfig.defaultOpacity ?? 0.85,
      autoPin: glassConfig.autoPin ?? true,
      lockTargetLang: glassConfig.lockTargetLang ?? true,  // 锁定目标语言
      // 翻译设置 - 使用实时获取的语言
      targetLanguage: currentTargetLang,
      sourceLanguage: currentSourceLang,
      // 主题 - 跟随主程序
      theme: mainSettings.interface?.theme ?? "light",
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
    
    // 如果设置了透明度，实时应用
    if (settings.opacity !== undefined && glassWindow && !glassWindow.isDestroyed()) {
      glassWindow.setOpacity(settings.opacity);
    }
    
    return true;
  });

  // 实时设置透明度
  ipcMain.handle("glass:set-opacity", (event, opacity) => {
    if (glassWindow && !glassWindow.isDestroyed()) {
      glassWindow.setOpacity(opacity);
      // 同时保存
      const current = store.get("glassLocalSettings", {});
      store.set("glassLocalSettings", { ...current, opacity });
      return true;
    }
    return false;
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

  // 通知玻璃窗重新加载设置（从主程序调用）
  ipcMain.handle("glass:notify-settings-changed", () => {
    if (glassWindow && !glassWindow.isDestroyed()) {
      glassWindow.webContents.send("glass:settings-changed");
      return true;
    }
    return false;
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

  // ========== OCR 相关 IPC ==========

  // 检查 Windows OCR 是否可用
  ipcMain.handle("ocr:check-windows-ocr", async () => {
    if (process.platform !== "win32") {
      return { available: false, reason: "非 Windows 系统" };
    }

    try {
      // 检查 Windows 10+ 版本
      const os = require("os");
      const release = os.release();
      const majorVersion = parseInt(release.split(".")[0]);
      
      if (majorVersion < 10) {
        return { available: false, reason: "需要 Windows 10 或更高版本" };
      }
      
      // 检查可用的 OCR 语言
      const { execSync } = require("child_process");
      const psScript = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$langs = [Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages
$langs | ForEach-Object { $_.LanguageTag }
      `.trim();
      
      try {
        const result = execSync(
          `powershell -NoProfile -ExecutionPolicy Bypass -Command "${psScript.replace(/"/g, '\\"')}"`,
          { encoding: "utf8", timeout: 10000, windowsHide: true }
        );
        
        const languages = result.trim().split('\n').filter(l => l.trim());
        console.log("[OCR] Windows OCR available languages:", languages);
        
        return { 
          available: languages.length > 0, 
          languages: languages,
          reason: languages.length > 0 ? null : "未安装任何 OCR 语言包"
        };
      } catch (e) {
        console.error("[OCR] Failed to get Windows OCR languages:", e.message);
        return { available: true, languages: [], reason: "无法获取语言列表" };
      }
    } catch (error) {
      console.error("[OCR] Check Windows OCR failed:", error);
      return { available: false, reason: error.message };
    }
  });

  // 使用 Windows OCR 识别
  ipcMain.handle("ocr:windows-ocr", async (event, imageData, options = {}) => {
    if (process.platform !== "win32") {
      return { success: false, error: "Windows OCR 仅在 Windows 系统上可用" };
    }

    try {
      // 从 data URL 提取 base64
      let base64Data = imageData;
      if (imageData.startsWith("data:image")) {
        base64Data = imageData.split(",")[1];
      }

      // 保存临时图片文件
      const tempDir = require("os").tmpdir();
      const tempFile = require("path").join(
        tempDir,
        `t-translate-ocr-${Date.now()}.png`
      );
      const fs = require("fs");
      fs.writeFileSync(tempFile, Buffer.from(base64Data, "base64"));
      
      console.log("[OCR] Windows OCR temp file:", tempFile);
      console.log("[OCR] Windows OCR language:", options.language || "zh-Hans");

      // 使用 PowerShell 调用 Windows OCR API
      const { execSync } = require("child_process");
      const language = options.language || "zh-Hans";
      
      // 语言代码映射（Windows OCR 使用 BCP-47 标签）
      const langMap = {
        'zh-Hans': 'zh-Hans-CN',
        'zh-Hant': 'zh-Hant-TW', 
        'en': 'en-US',
        'ja': 'ja-JP',
        'ko': 'ko-KR',
        'fr': 'fr-FR',
        'de': 'de-DE',
        'es': 'es-ES',
        'ru': 'ru-RU',
      };
      const winLang = langMap[language] || language;

      // 改进的 PowerShell 脚本
      const psScript = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime

$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.RandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]

# 异步方法转同步的辅助函数
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { 
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' 
})[0]

Function Await($WinRtTask, $ResultType) {
    $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
    $netTask = $asTask.Invoke($null, @($WinRtTask))
    $netTask.Wait(-1) | Out-Null
    $netTask.Result
}

try {
    # 打开图片文件
    $filePath = "${tempFile.replace(/\\/g, "\\\\")}"
    $file = [System.IO.File]::OpenRead($filePath)
    $stream = [Windows.Storage.Streams.RandomAccessStream]::FromStream($file)
    
    # 解码图片
    $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    
    # 尝试创建指定语言的 OCR 引擎
    $ocrEngine = $null
    try {
        $ocrEngine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage("${winLang}")
    } catch {}
    
    # 如果失败，尝试用户配置语言
    if ($null -eq $ocrEngine) {
        $ocrEngine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
    }
    
    # 如果还是失败，获取所有可用语言并使用第一个
    if ($null -eq $ocrEngine) {
        $availableLangs = [Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages
        if ($availableLangs.Count -gt 0) {
            $ocrEngine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($availableLangs[0].LanguageTag)
        }
    }
    
    if ($null -eq $ocrEngine) {
        Write-Error "ERROR: No OCR engine available"
        exit 1
    }
    
    # 识别
    $result = Await ($ocrEngine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
    
    # 输出结果
    if ($result.Text) {
        $result.Text
    } else {
        # 尝试从行中获取文本
        $lines = @()
        foreach ($line in $result.Lines) {
            $lines += $line.Text
        }
        $lines -join [Environment]::NewLine
    }
    
    # 清理
    $stream.Dispose()
    $file.Dispose()
} catch {
    Write-Error $_.Exception.Message
    exit 1
}
      `.trim();

      console.log("[OCR] Executing Windows OCR PowerShell script...");
      
      const result = execSync(
        `powershell -NoProfile -ExecutionPolicy Bypass -Command "${psScript.replace(/"/g, '\\"')}"`,
        {
          encoding: "utf8",
          maxBuffer: 10 * 1024 * 1024,
          windowsHide: true,
        }
      );

      // 删除临时文件
      try {
        fs.unlinkSync(tempFile);
      } catch (e) {
        // 忽略删除错误
      }

      const text = result.trim();
      console.log("[OCR] Windows OCR raw result length:", result.length);
      console.log("[OCR] Windows OCR result:", text.substring(0, 200) || "(empty)");

      return {
        success: true,
        text: text,
        confidence: text ? 0.9 : 0,
      };
    } catch (error) {
      console.error("[OCR] Windows OCR failed:", error);
      return {
        success: false,
        error: error.message || "Windows OCR 识别失败",
      };
    }
  });

  // 检查 PaddleOCR 是否可用
  ipcMain.handle("ocr:check-paddle-ocr", async () => {
    // 尝试 @gutenye/ocr-node（ESM 模块，需要动态 import）
    try {
      await import("@gutenye/ocr-node");
      console.log("[OCR] @gutenye/ocr-node is available");
      return { available: true, version: "gutenye" };
    } catch (e) {
      console.log("[OCR] @gutenye/ocr-node not available:", e.message);
    }
    
    // 尝试 multilingual-purejs-ocr
    try {
      await import("multilingual-purejs-ocr");
      console.log("[OCR] multilingual-purejs-ocr is available");
      return { available: true, version: "purejs" };
    } catch (e) {
      console.log("[OCR] multilingual-purejs-ocr not available:", e.message);
    }
    
    return { available: false };
  });

  // 使用 PaddleOCR 识别
  ipcMain.handle("ocr:paddle-ocr", async (event, imageData, options = {}) => {
    const path = require("path");
    const fs = require("fs");
    const os = require("os");

    console.log("[OCR] ocr:paddle-ocr called, processing image...");

    // 从 data URL 提取 base64
    let base64Data = imageData;
    if (imageData.startsWith("data:image")) {
      base64Data = imageData.split(",")[1];
    }

    // 转换为 Buffer
    const imageBuffer = Buffer.from(base64Data, "base64");

    // 保存临时文件
    const tempDir = os.tmpdir();
    const tempFile = path.join(tempDir, `t-translate-paddle-${Date.now()}.png`);
    fs.writeFileSync(tempFile, imageBuffer);
    console.log("[OCR] Temp file saved:", tempFile);

    try {
      let result;
      let lastError = null;
      
      // 尝试 multilingual-purejs-ocr（优先，因为有明确的 API）
      try {
        console.log("[OCR] Trying multilingual-purejs-ocr (dynamic import)...");
        const pureJsModule = await import("multilingual-purejs-ocr");
        console.log("[OCR] multilingual-purejs-ocr imported, keys:", Object.keys(pureJsModule));
        
        // 获取 Ocr 类
        const OcrClass = pureJsModule.Ocr || pureJsModule.default?.Ocr || pureJsModule.default;
        console.log("[OCR] OcrClass type:", typeof OcrClass, "name:", OcrClass?.name);
        
        if (typeof OcrClass !== 'function') {
          throw new Error("Ocr class not found in multilingual-purejs-ocr");
        }
        
        // 使用懒加载的实例
        if (!global.pureJsOcrInstance) {
          console.log("[OCR] Creating new multilingual-purejs-ocr instance...");
          global.pureJsOcrInstance = new OcrClass();
          console.log("[OCR] multilingual-purejs-ocr instance created");
        }
        
        // 读取图片为 Buffer
        const imgBuffer = fs.readFileSync(tempFile);
        
        console.log("[OCR] Running multilingual-purejs-ocr.recognize...");
        // 根据 API 文档调用
        result = await global.pureJsOcrInstance.recognize(imgBuffer);
        console.log("[OCR] multilingual-purejs-ocr raw result:", typeof result, result);
        
        if (result) {
          let text = '';
          let lines = [];
          
          // 处理不同的返回格式
          if (typeof result === 'string') {
            text = result;
          } else if (result.text) {
            text = result.text;
            lines = result.lines || [];
          } else if (Array.isArray(result)) {
            lines = result.map(item => ({
              text: item.text || item[1]?.[0] || String(item),
              confidence: item.score || item.confidence || item[1]?.[1] || 0.9,
            }));
            text = lines.map(l => l.text).join('\n');
          }
          
          if (text) {
            console.log("[OCR] multilingual-purejs-ocr result:", text.substring(0, 100));

            // 清理临时文件
            try { fs.unlinkSync(tempFile); } catch (e) {}

            return {
              success: true,
              text: text,
              confidence: 0.9,
              lines: lines,
              engine: "purejs-ocr",
            };
          }
        }
      } catch (pureJsError) {
        console.log("[OCR] multilingual-purejs-ocr failed:", pureJsError.message);
        lastError = pureJsError;
      }
      
      // 尝试 @gutenye/ocr-node
      try {
        console.log("[OCR] Trying @gutenye/ocr-node (dynamic import)...");
        const ocrModule = await import("@gutenye/ocr-node");
        console.log("[OCR] @gutenye/ocr-node imported, keys:", Object.keys(ocrModule));
        
        // 尝试各种可能的导出方式
        let Ocr = ocrModule.default;
        if (!Ocr || typeof Ocr.create !== 'function') {
          Ocr = ocrModule.Ocr;
        }
        if (!Ocr || typeof Ocr.create !== 'function') {
          // 可能模块本身就是 Ocr 类
          if (typeof ocrModule.create === 'function') {
            Ocr = ocrModule;
          }
        }
        
        console.log("[OCR] Ocr object:", Ocr ? Object.keys(Ocr) : 'undefined');
        
        if (!Ocr || typeof Ocr.create !== 'function') {
          throw new Error("Cannot find Ocr.create in @gutenye/ocr-node, available: " + Object.keys(ocrModule).join(', '));
        }
        
        if (!global.gutenyeOcrInstance) {
          console.log("[OCR] Initializing @gutenye/ocr-node...");
          global.gutenyeOcrInstance = await Ocr.create();
          console.log("[OCR] @gutenye/ocr-node initialized successfully");
        }

        console.log("[OCR] Running OCR detection...");
        result = await global.gutenyeOcrInstance.detect(tempFile);
        console.log("[OCR] Detection result:", result?.length || 0, "items");
        
        if (result && result.length > 0) {
          const lines = result.map((item) => ({
            text: item.text,
            confidence: item.score || 0.9,
            box: item.box || item.frame,
          }));

          const fullText = lines.map((l) => l.text).join("\n");
          const avgConfidence = lines.reduce((sum, l) => sum + l.confidence, 0) / lines.length;

          console.log("[OCR] @gutenye/ocr-node result:", fullText.substring(0, 100));

          // 清理临时文件
          try { fs.unlinkSync(tempFile); } catch (e) {}

          return {
            success: true,
            text: fullText,
            confidence: avgConfidence,
            lines: lines,
            engine: "gutenye-ocr",
          };
        }
      } catch (gutenyeError) {
        console.log("[OCR] @gutenye/ocr-node failed:", gutenyeError.message);
        lastError = lastError || gutenyeError;
      }

      // 清理临时文件
      try { fs.unlinkSync(tempFile); } catch (e) {}

      // 没有可用的 OCR 引擎或无结果
      if (lastError) {
        return {
          success: false,
          error: `PaddleOCR 引擎加载失败: ${lastError.message}`,
        };
      }
      
      // 识别成功但没有文字
      return {
        success: true,
        text: "",
        confidence: 0,
        lines: [],
        engine: "purejs-ocr",
      };
      
    } catch (error) {
      console.error("[OCR] PaddleOCR failed:", error);
      // 清理临时文件
      try { fs.unlinkSync(tempFile); } catch (e) {}
      return {
        success: false,
        error: error.message || "PaddleOCR 识别失败",
      };
    }
  });

  // 获取可用的 OCR 引擎列表
  ipcMain.handle("ocr:get-available-engines", async () => {
    const engines = [
      {
        id: "llm-vision",
        name: "LLM Vision",
        description: "使用本地 LLM 视觉模型识别",
        available: true,
        isOnline: false,
        tier: 2,
      },
    ];

    // 检查 RapidOCR
    let rapidAvailable = false;
    try {
      require.resolve("@gutenye/ocr-node");
      rapidAvailable = true;
    } catch (e) {
      try {
        require.resolve("multilingual-purejs-ocr");
        rapidAvailable = true;
      } catch (e2) {
        // 模块未安装
      }
    }

    engines.push({
      id: "rapid-ocr",
      name: "RapidOCR",
      description: "本地 OCR，基于 PP-OCRv4，速度快",
      available: rapidAvailable,
      isOnline: false,
      tier: 1,
    });

    // 在线 OCR API
    engines.push({
      id: "ocrspace",
      name: "OCR.space",
      description: "在线 OCR，免费 25000次/月",
      available: true,
      isOnline: true,
      tier: 3,
    });

    engines.push({
      id: "google-vision",
      name: "Google Vision",
      description: "识别效果最好，200+ 语言",
      available: true,
      isOnline: true,
      tier: 3,
    });

    engines.push({
      id: "azure-ocr",
      name: "Azure OCR",
      description: "免费额度高，5000次/月",
      available: true,
      isOnline: true,
      tier: 3,
    });

    engines.push({
      id: "baidu-ocr",
      name: "百度 OCR",
      description: "中文识别最强，国内快",
      available: true,
      isOnline: true,
      tier: 3,
    });

    return engines;
  });

  // 检查 OCR 引擎安装状态
  ipcMain.handle("ocr:check-installed", async () => {
    const status = {
      'llm-vision': true,  // 内置
      'rapid-ocr': false,
    };

    // 检查模块是否安装 (安全方式)
    const checkModule = (moduleName) => {
      try {
        require.resolve(moduleName);
        return true;
      } catch (e) {
        return false;
      }
    };
    
    // 检查 @gutenye/ocr-node (RapidOCR)
    if (checkModule("@gutenye/ocr-node")) {
      status['rapid-ocr'] = true;
    }

    console.log('[OCR] Installed status:', status);
    return status;
  });

  // 下载 OCR 引擎
  ipcMain.handle("ocr:download-engine", async (event, engineId) => {
    const { exec, spawn } = require("child_process");
    const util = require("util");
    const execAsync = util.promisify(exec);

    console.log(`[OCR] Downloading engine: ${engineId}`);

    try {
      let packageName;
      let packageDesc;
      
      switch (engineId) {
        case 'paddle-ocr':
          // 使用 multilingual-purejs-ocr - 基于 PaddleOCR v3/v4 的纯 JS 实现
          packageName = 'multilingual-purejs-ocr';
          packageDesc = 'PaddleOCR (multilingual-purejs-ocr)';
          break;
        case 'rapid-ocr':
          // 使用 @gutenye/ocr-node - 基于 PP-OCRv4 + ONNX Runtime
          packageName = '@gutenye/ocr-node';
          packageDesc = 'RapidOCR (@gutenye/ocr-node)';
          break;
        default:
          return { success: false, error: '未知的引擎 ID' };
      }

      // 获取应用目录
      const appPath = app.getAppPath();
      const isPackaged = app.isPackaged;
      
      // 安装路径 - 开发模式下使用项目根目录
      let installPath;
      if (isPackaged) {
        installPath = app.getPath('userData');
      } else {
        // 开发模式：尝试多种方式找到项目根目录
        const fs = require('fs');
        const possiblePaths = [
          appPath,
          path.dirname(appPath),
          process.cwd(),
          path.join(process.cwd(), '..'),
          path.resolve(__dirname, '..'),
          path.resolve(__dirname, '../..'),
        ];
        
        console.log('[OCR] Searching for project root, checking paths:', possiblePaths);
        
        for (const checkPath of possiblePaths) {
          try {
            const packageJsonPath = path.join(checkPath, 'package.json');
            if (fs.existsSync(packageJsonPath)) {
              // 验证这是我们的项目（检查 package.json 内容）
              const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
              if (pkg.name === 't-translate' || pkg.dependencies?.electron) {
                installPath = checkPath;
                console.log('[OCR] Found project root:', installPath);
                break;
              }
            }
          } catch (e) {
            // 忽略错误，继续尝试下一个路径
          }
        }
        
        // 最后备选：使用 process.cwd()
        if (!installPath) {
          installPath = process.cwd();
          console.log('[OCR] Using process.cwd() as fallback:', installPath);
        }
      }

      // 安全检查：确保路径不是根目录
      if (installPath === '/' || installPath === 'C:\\' || installPath === 'F:\\' || installPath.match(/^[A-Z]:\\$/)) {
        console.error('[OCR] Invalid install path (root directory):', installPath);
        return { 
          success: false, 
          error: '无法确定安装路径，请手动在项目目录运行: npm install ' + packageName 
        };
      }

      console.log(`[OCR] App path: ${appPath}`);
      console.log(`[OCR] Installing ${packageName} to ${installPath}`);

      // 发送进度
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('ocr:download-progress', { 
          engineId, 
          progress: 10, 
          status: `正在下载 ${packageDesc}...` 
        });
      }

      // 检查 npm 是否可用
      try {
        await execAsync('npm --version', { timeout: 10000 });
      } catch (e) {
        return { 
          success: false, 
          error: 'npm 不可用，请确保已安装 Node.js 并添加到环境变量' 
        };
      }

      // 发送进度
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('ocr:download-progress', { 
          engineId, 
          progress: 30, 
          status: '正在安装依赖...' 
        });
      }

      // 执行 npm install
      const { stdout, stderr } = await execAsync(
        `npm install ${packageName} --save --legacy-peer-deps`,
        { 
          cwd: installPath,
          timeout: 600000,  // 10 分钟超时（模型文件可能较大）
          env: { ...process.env, npm_config_loglevel: 'error' }
        }
      );

      console.log('[OCR] npm install stdout:', stdout);
      if (stderr && !stderr.includes('npm WARN')) {
        console.log('[OCR] npm install stderr:', stderr);
      }

      // 清理全局 OCR 实例缓存，以便下次使用新安装的模块
      if (engineId === 'paddle-ocr') {
        global.pureJsOcrInstance = null;
      } else if (engineId === 'rapid-ocr') {
        global.gutenyeOcrInstance = null;
      }

      // 发送完成
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('ocr:download-progress', { 
          engineId, 
          progress: 100, 
          status: '安装完成！' 
        });
      }

      return { 
        success: true, 
        message: `${packageDesc} 安装成功`,
        needRestart: true,  // 提示需要重启
        restartMessage: '为确保 OCR 引擎正常工作，建议重启应用'
      };
    } catch (error) {
      console.error('[OCR] Download failed:', error);
      
      // 更友好的错误信息
      let errorMessage = '下载失败';
      if (error.message?.includes('ENOENT')) {
        errorMessage = 'npm 命令未找到，请确保已安装 Node.js';
      } else if (error.message?.includes('ETIMEDOUT') || error.message?.includes('timeout')) {
        errorMessage = '下载超时，请检查网络连接后重试';
      } else if (error.message?.includes('EACCES')) {
        errorMessage = '权限不足，请以管理员身份运行';
      } else if (error.message?.includes('404') || error.message?.includes('Not Found')) {
        errorMessage = '包不存在或已下架，请稍后重试';
      } else if (error.message) {
        errorMessage = error.message.substring(0, 200);
      }
      
      return { success: false, error: errorMessage };
    }
  });

  // 删除 OCR 引擎
  ipcMain.handle("ocr:remove-engine", async (event, engineId) => {
    const { exec } = require("child_process");
    const util = require("util");
    const execAsync = util.promisify(exec);

    console.log(`[OCR] Removing engine: ${engineId}`);

    try {
      // 首先检查当前安装状态
      const checkModule = (moduleName) => {
        try {
          require.resolve(moduleName);
          return true;
        } catch (e) {
          return false;
        }
      };

      const paddleInstalled = checkModule("multilingual-purejs-ocr");
      const rapidInstalled = checkModule("@gutenye/ocr-node");
      
      // 计算可用的本地 OCR 引擎数量（不含 Windows OCR 和 LLM Vision）
      let localEngineCount = 0;
      if (paddleInstalled) localEngineCount++;
      if (rapidInstalled) localEngineCount++;

      // 确定要删除的包
      let packageName;
      let isTargetInstalled = false;
      
      switch (engineId) {
        case 'paddle-ocr':
          packageName = 'multilingual-purejs-ocr';
          isTargetInstalled = paddleInstalled;
          break;
        case 'rapid-ocr':
          packageName = '@gutenye/ocr-node';
          isTargetInstalled = rapidInstalled;
          break;
        case 'llm-vision':
          return { success: false, error: 'LLM Vision 是内置引擎，无法卸载' };
        case 'windows-ocr':
          return { success: false, error: 'Windows OCR 是系统引擎，无法卸载' };
        default:
          return { success: false, error: '无法删除该引擎' };
      }

      // 检查是否已安装
      if (!isTargetInstalled) {
        return { success: false, error: '该引擎未安装' };
      }

      // 保护：至少保留一个本地 OCR 引擎（不含 Windows OCR）
      if (localEngineCount <= 1) {
        return { 
          success: false, 
          error: '无法卸载：必须保留至少一个本地 OCR 引擎。请先安装其他引擎后再卸载此引擎。' 
        };
      }

      const appPath = app.getAppPath();
      const isPackaged = app.isPackaged;
      
      // 获取安装路径（与安装时使用相同逻辑）
      let installPath;
      if (isPackaged) {
        installPath = app.getPath('userData');
      } else {
        const fs = require('fs');
        const possiblePaths = [
          appPath,
          path.dirname(appPath),
          process.cwd(),
          path.join(process.cwd(), '..'),
        ];
        
        for (const checkPath of possiblePaths) {
          try {
            const packageJsonPath = path.join(checkPath, 'package.json');
            if (fs.existsSync(packageJsonPath)) {
              const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
              if (pkg.name === 't-translate' || pkg.dependencies?.electron) {
                installPath = checkPath;
                break;
              }
            }
          } catch (e) {}
        }
        
        if (!installPath) {
          installPath = process.cwd();
        }
      }
      
      // 安全检查
      if (installPath === '/' || installPath.match(/^[A-Z]:\\$/)) {
        return { success: false, error: '无法确定卸载路径' };
      }

      console.log(`[OCR] Uninstalling ${packageName} from ${installPath}`);

      await execAsync(
        `npm uninstall ${packageName}`,
        { 
          cwd: installPath,
          timeout: 60000,
        }
      );

      // 清理全局实例
      if (engineId === 'paddle-ocr') {
        global.paddleOcrInstance = null;
      } else if (engineId === 'rapid-ocr') {
        global.rapidOcrInstance = null;
      }

      return { success: true, message: `${packageName} 已卸载` };
    } catch (error) {
      console.error('[OCR] Remove failed:', error);
      return { success: false, error: error.message || '卸载失败' };
    }
  });

  // ========== 在线 OCR API ==========

  // OCR.space API
  // OCR.space API
  ipcMain.handle("ocr:ocrspace", async (event, imageData, options = {}) => {
    try {
      const apiKey = options.apiKey;
      if (!apiKey) {
        return { success: false, error: "未配置 OCR.space API Key" };
      }

      // 1. 数据准备
      let base64Data = imageData;
      let mimeType = "image/png";
      if (imageData.startsWith("data:image")) {
        const mimeMatch = imageData.match(/^data:(image\/\w+);base64,/);
        if (mimeMatch) {
          mimeType = mimeMatch[1];
        }
        base64Data = imageData.split(",")[1];
      }

      const fileTypeMap = {
        "image/png": "PNG",
        "image/jpeg": "JPG",
        "image/jpg": "JPG",
        "image/gif": "GIF",
        "image/bmp": "BMP",
        "image/webp": "WEBP",
        "image/tiff": "TIFF",
      };
      const fileType = fileTypeMap[mimeType] || "PNG";

      // OCR.space 专用代码表：https://ocr.space/OCRAPI#PostParameters
      let targetLang = options.language || "chs";
      const langMap = {
        "zh-Hans": "chs", // 简体中文
        "zh-CN": "chs",
        "zh-Hant": "cht", // 繁体中文
        "zh-TW": "cht",
        en: "eng", // 英语
        "en-US": "eng",
        ja: "jpn", // 日语
        ko: "kor", // 韩语
        fr: "fre", // 法语
        de: "ger", // 德语
        ru: "rus", // 俄语
      };
      // 如果映射表中存在，就用映射后的代码，否则默认用 chs
      if (langMap[targetLang]) {
        targetLang = langMap[targetLang];
      }

      console.log(
        "[OCR] OCR.space request - filetype:",
        fileType,
        "language (mapped):",
        targetLang
      );

      // 2. 构建请求参数 (URLSearchParams 方案)
      const params = new URLSearchParams();
      params.append("base64Image", `data:${mimeType};base64,${base64Data}`);
      params.append("filetype", fileType);
      params.append("language", targetLang);
      params.append("isOverlayRequired", "false");
      params.append("OCREngine", options.engine || "2");

      // 3. 发送请求
      const response = await fetch("https://api.ocr.space/parse/image", {
        method: "POST",
        headers: {
          apikey: apiKey,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params,
      });

      const result = await response.json();
      console.log(
        "[OCR] OCR.space response:",
        JSON.stringify(result).substring(0, 200)
      );

      if (result.IsErroredOnProcessing) {
        return {
          success: false,
          error:
            result.ErrorMessage?.[0] ||
            result.ErrorMessage ||
            "OCR.space 处理失败",
        };
      }

      const text = result.ParsedResults?.[0]?.ParsedText || "";
      console.log("[OCR] OCR.space result:", text.substring(0, 100));

      return {
        success: true,
        text: text.trim(),
        confidence: 0.95,
        engine: "ocrspace",
      };
    } catch (error) {
      console.error("[OCR] OCR.space failed:", error);
      return { success: false, error: error.message };
    }
  });

  // Google Cloud Vision API
  ipcMain.handle("ocr:google-vision", async (event, imageData, options = {}) => {
    try {
      const apiKey = options.apiKey;
      if (!apiKey) {
        return { success: false, error: "未配置 Google Cloud Vision API Key" };
      }

      // 从 data URL 提取 base64
      let base64Data = imageData;
      if (imageData.startsWith("data:image")) {
        base64Data = imageData.split(",")[1];
      }

      const response = await fetch(
        `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requests: [{
              image: { content: base64Data },
              features: [{ type: "TEXT_DETECTION" }],
              imageContext: {
                languageHints: options.languages || ["zh", "en"],
              },
            }],
          }),
        }
      );

      const result = await response.json();

      if (result.error) {
        return { success: false, error: result.error.message };
      }

      const text = result.responses?.[0]?.fullTextAnnotation?.text || "";
      console.log("[OCR] Google Vision result:", text.substring(0, 100));

      return {
        success: true,
        text: text.trim(),
        confidence: 0.98,
        engine: "google-vision",
      };
    } catch (error) {
      console.error("[OCR] Google Vision failed:", error);
      return { success: false, error: error.message };
    }
  });

  // Microsoft Azure OCR API
  ipcMain.handle("ocr:azure-ocr", async (event, imageData, options = {}) => {
    try {
      const apiKey = options.apiKey;
      const region = options.region || "eastus";
      
      if (!apiKey) {
        return { success: false, error: "未配置 Azure OCR API Key" };
      }

      // 从 data URL 提取 base64
      let base64Data = imageData;
      if (imageData.startsWith("data:image")) {
        base64Data = imageData.split(",")[1];
      }

      const imageBuffer = Buffer.from(base64Data, "base64");

      const response = await fetch(
        `https://${region}.api.cognitive.microsoft.com/vision/v3.2/ocr?language=${options.language || "zh-Hans"}&detectOrientation=true`,
        {
          method: "POST",
          headers: {
            "Ocp-Apim-Subscription-Key": apiKey,
            "Content-Type": "application/octet-stream",
          },
          body: imageBuffer,
        }
      );

      const result = await response.json();

      if (result.error) {
        return { success: false, error: result.error.message };
      }

      // 提取文字
      const lines = [];
      for (const region of result.regions || []) {
        for (const line of region.lines || []) {
          const lineText = line.words?.map(w => w.text).join(" ") || "";
          lines.push(lineText);
        }
      }

      const text = lines.join("\n");
      console.log("[OCR] Azure OCR result:", text.substring(0, 100));

      return {
        success: true,
        text: text.trim(),
        confidence: 0.95,
        engine: "azure-ocr",
      };
    } catch (error) {
      console.error("[OCR] Azure OCR failed:", error);
      return { success: false, error: error.message };
    }
  });

  // 百度 OCR API
  ipcMain.handle("ocr:baidu-ocr", async (event, imageData, options = {}) => {
    try {
      const apiKey = options.apiKey;
      const secretKey = options.secretKey;
      
      if (!apiKey || !secretKey) {
        return { success: false, error: "未配置百度 OCR API Key" };
      }

      // 获取 access_token
      const tokenResponse = await fetch(
        `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${apiKey}&client_secret=${secretKey}`,
        { method: "POST" }
      );
      const tokenResult = await tokenResponse.json();

      if (!tokenResult.access_token) {
        return { success: false, error: "获取百度 access_token 失败" };
      }

      // 从 data URL 提取 base64
      let base64Data = imageData;
      if (imageData.startsWith("data:image")) {
        base64Data = imageData.split(",")[1];
      }

      // 调用 OCR API
      const params = new URLSearchParams();
      params.append("image", base64Data);
      params.append("language_type", options.language || "CHN_ENG");
      params.append("detect_direction", "true");
      params.append("paragraph", "true");

      const response = await fetch(
        `https://aip.baidubce.com/rest/2.0/ocr/v1/accurate_basic?access_token=${tokenResult.access_token}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params,
        }
      );

      const result = await response.json();

      if (result.error_code) {
        return { success: false, error: result.error_msg || "百度 OCR 失败" };
      }

      const text = result.words_result?.map(w => w.words).join("\n") || "";
      console.log("[OCR] Baidu OCR result:", text.substring(0, 100));

      return {
        success: true,
        text: text.trim(),
        confidence: 0.96,
        engine: "baidu-ocr",
      };
    } catch (error) {
      console.error("[OCR] Baidu OCR failed:", error);
      return { success: false, error: error.message };
    }
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
  
  // 内存监控（每5分钟检查一次）
  setInterval(() => {
    const usage = process.memoryUsage();
    const heapUsedMB = Math.round(usage.heapUsed / 1024 / 1024);
    console.log(`[Memory] Heap: ${heapUsedMB}MB`);
    
    // 如果内存超过 500MB，尝试垃圾回收
    if (heapUsedMB > 500 && global.gc) {
      console.log('[Memory] Running garbage collection...');
      global.gc();
    }
  }, 5 * 60 * 1000);
});

/**
 * 全局未捕获异常处理
 */
process.on('uncaughtException', (error) => {
  console.error('[FATAL] Uncaught exception:', error);
  // 不立即退出，尝试继续运行
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[ERROR] Unhandled rejection at:', promise, 'reason:', reason);
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
