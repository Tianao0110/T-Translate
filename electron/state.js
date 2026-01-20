// electron/state.js
// 全局状态管理 - 分层管理策略
// 第一层: 持久化配置 (store) - 存硬盘
// 第二层: 运行时状态 (runtime) - 内存中，重启丢失

const Store = require('electron-store');

// ==================== 环境判断 ====================
const isDev = process.env.NODE_ENV === 'development' || !require('electron').app.isPackaged;

// ==================== 持久化配置 ====================
const store = new Store({
  defaults: {
    // 窗口配置
    windowBounds: { width: 1200, height: 800 },
    windowPosition: null,
    alwaysOnTop: false,
    startMinimized: false,
    
    // 玻璃窗口配置
    glassBounds: { width: 400, height: 200 },
    glassLocalSettings: {},
    
    // 字幕采集区
    subtitleCaptureRect: null,
    
    // 划词翻译（注意：每次启动默认关闭，这里只是存储用户偏好）
    selectionEnabled: false,
    
    // 隐私模式
    privacyMode: 'standard',
    
    // 设置
    settings: {
      shortcuts: {},
      translation: {},
      ocr: {},
      interface: {},
      selection: {},
      screenshot: {},
      glassWindow: {},
      providers: {},
      connection: {},
    },
  },
});

// ==================== 运行时状态 ====================
// 这些状态不存硬盘，重启后重置
const runtime = {
  // 应用生命周期
  isQuitting: false,           // 是否正在退出
  isAppReady: false,           // 应用是否已就绪
  
  // 功能开关状态
  selectionEnabled: false,     // 划词翻译开关（每次启动默认关闭）
  
  // 窗口引用（通过 setter 设置，避免循环依赖）
  _windows: {
    main: null,
    glass: null,
    screenshot: null,
    subtitleCapture: null,
    selection: null,
  },
  
  // 截图相关
  screenshotData: null,
  wasMainWindowVisible: false,
  screenshotFromHotkey: false,
  lastScreenshotBounds: null,      // 最近截图的位置
  screenshotSelectionWindow: null, // 截图翻译的加载窗口引用
  
  // 字幕采集区坐标缓存
  subtitleCaptureRect: null,
  
  // 划词翻译相关
  lastSelectionRect: null,
  isDraggingOverlay: false,
  selectionHook: null,
  mouseDownPos: null,
  mouseDownTime: 0,
  isNativeDragging: false,
  
  // 全局快捷键状态
  shortcutsRegistered: false,
};

// ==================== 窗口引用管理 ====================
// 使用 getter/setter 模式，方便追踪窗口引用变化

const windows = {
  get main() { return runtime._windows.main; },
  set main(win) { 
    runtime._windows.main = win;
    if (isDev && win) console.log('[State] Main window set');
  },
  
  get glass() { return runtime._windows.glass; },
  set glass(win) { 
    runtime._windows.glass = win;
    if (isDev && win) console.log('[State] Glass window set');
  },
  
  get screenshot() { return runtime._windows.screenshot; },
  set screenshot(win) { runtime._windows.screenshot = win; },
  
  get subtitleCapture() { return runtime._windows.subtitleCapture; },
  set subtitleCapture(win) { runtime._windows.subtitleCapture = win; },
  
  get selection() { return runtime._windows.selection; },
  set selection(win) { runtime._windows.selection = win; },
  
  // 获取所有窗口
  getAll() {
    return { ...runtime._windows };
  },
  
  // 清理所有窗口引用
  clearAll() {
    Object.keys(runtime._windows).forEach(key => {
      runtime._windows[key] = null;
    });
  },
};

// ==================== 状态操作辅助函数 ====================

/**
 * 重置运行时状态（用于测试或特殊情况）
 */
function resetRuntime() {
  runtime.isQuitting = false;
  runtime.selectionEnabled = false;
  runtime.screenshotData = null;
  runtime.wasMainWindowVisible = false;
  runtime.screenshotFromHotkey = false;
  runtime.subtitleCaptureRect = null;
  runtime.lastSelectionRect = null;
  runtime.isDraggingOverlay = false;
  runtime.mouseDownPos = null;
  runtime.mouseDownTime = 0;
  runtime.isNativeDragging = false;
  windows.clearAll();
}

/**
 * 获取主窗口（兼容旧代码）
 * @returns {BrowserWindow|null}
 */
function getMainWindow() {
  return windows.main;
}

/**
 * 设置主窗口（兼容旧代码）
 * @param {BrowserWindow} win 
 */
function setMainWindow(win) {
  windows.main = win;
}

// ==================== 导出 ====================
module.exports = {
  // 持久化配置
  store,
  
  // 运行时状态
  runtime,
  
  // 窗口引用管理
  windows,
  
  // 环境标识
  isDev,
  
  // 辅助函数
  resetRuntime,
  getMainWindow,
  setMainWindow,
};
