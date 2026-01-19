// electron/utils/native-helper.js
// 底层系统 API 调用工具
// 包含：模拟按键、窗口检测等 Native 操作

const logger = require('./logger')('Native');

// ==================== Windows API 初始化 ====================

let win32API = null;

/**
 * 初始化 Windows API（懒加载）
 */
function initWin32API() {
  if (process.platform !== 'win32') return null;
  if (win32API !== null) return win32API;
  
  try {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    const kernel32 = koffi.load('kernel32.dll');
    const psapi = koffi.load('psapi.dll');
    
    // 定义 POINT 结构体
    const POINT = koffi.struct('POINT', {
      x: 'int32',
      y: 'int32',
    });
    
    // 定义 GUITHREADINFO 结构体
    const GUITHREADINFO = koffi.struct('GUITHREADINFO', {
      cbSize: 'uint32',
      flags: 'uint32',
      hwndActive: 'void*',
      hwndFocus: 'void*',
      hwndCapture: 'void*',
      hwndMenuOwner: 'void*',
      hwndMoveSize: 'void*',
      hwndCaret: 'void*',
      rcCaret_left: 'int32',
      rcCaret_top: 'int32',
      rcCaret_right: 'int32',
      rcCaret_bottom: 'int32',
    });
    
    win32API = {
      // 键盘模拟
      keybd_event: user32.func('void keybd_event(uint8, uint8, uint32, uintptr)'),
      
      // 窗口检测
      WindowFromPoint: user32.func('void* WindowFromPoint(POINT)'),
      GetAncestor: user32.func('void* GetAncestor(void*, uint32)'),
      GetWindowThreadProcessId: user32.func('uint32 GetWindowThreadProcessId(void*, uint32*)'),
      GetClassNameW: user32.func('int GetClassNameW(void*, uint16*, int)'),
      GetForegroundWindow: user32.func('void* GetForegroundWindow()'),
      GetGUIThreadInfo: user32.func('int GetGUIThreadInfo(uint32, GUITHREADINFO*)'),
      SendMessageW: user32.func('intptr SendMessageW(void*, uint32, uintptr*, uintptr*)'),
      
      // 进程信息
      OpenProcess: kernel32.func('void* OpenProcess(uint32, int, uint32)'),
      CloseHandle: kernel32.func('int CloseHandle(void*)'),
      GetModuleBaseNameW: psapi.func('uint32 GetModuleBaseNameW(void*, void*, uint16*, uint32)'),
      
      // 截图穿透
      SetWindowDisplayAffinity: user32.func('SetWindowDisplayAffinity', 'bool', ['void*', 'uint']),
      
      // 常量
      VK_CONTROL: 0x11,
      VK_C: 0x43,
      KEYEVENTF_KEYUP: 0x0002,
      GA_ROOT: 2,
      PROCESS_QUERY_INFORMATION: 0x0400,
      PROCESS_VM_READ: 0x0010,
      WDA_EXCLUDEFROMCAPTURE: 0x00000011,
      EM_GETSEL: 0x00B0,
      GUI_CARETBLINKING: 0x0001,
      
      // 结构体类型引用
      GUITHREADINFO,
    };
    
    logger.info('Windows API loaded successfully');
    return win32API;
  } catch (e) {
    logger.warn('Failed to load koffi:', e.message);
    win32API = false; // 标记为不可用，避免重复尝试
    return null;
  }
}

// ==================== 键盘模拟 ====================

/**
 * 模拟 Ctrl+C 复制（仅 Windows）
 * @returns {boolean} 是否成功
 */
function simulateCtrlC() {
  if (process.platform !== 'win32') {
    logger.debug('simulateCtrlC: not Windows, skipping');
    return false;
  }
  
  const api = initWin32API();
  if (!api) {
    logger.warn('simulateCtrlC: Win32 API not available');
    return false;
  }
  
  try {
    const { keybd_event, VK_CONTROL, VK_C, KEYEVENTF_KEYUP } = api;
    
    // 按下 Ctrl
    keybd_event(VK_CONTROL, 0x1d, 0, 0);
    // 按下 C
    keybd_event(VK_C, 0x2e, 0, 0);
    // 释放 C
    keybd_event(VK_C, 0x2e, KEYEVENTF_KEYUP, 0);
    // 释放 Ctrl
    keybd_event(VK_CONTROL, 0x1d, KEYEVENTF_KEYUP, 0);
    
    logger.debug('simulateCtrlC: success');
    return true;
  } catch (e) {
    logger.error('simulateCtrlC failed:', e);
    return false;
  }
}

/**
 * 模拟按键（通用）
 * @param {number} vkCode - 虚拟键码
 * @param {number} scanCode - 扫描码
 * @returns {boolean}
 */
function simulateKeyPress(vkCode, scanCode = 0) {
  if (process.platform !== 'win32') return false;
  
  const api = initWin32API();
  if (!api) return false;
  
  try {
    const { keybd_event, KEYEVENTF_KEYUP } = api;
    keybd_event(vkCode, scanCode, 0, 0);
    keybd_event(vkCode, scanCode, KEYEVENTF_KEYUP, 0);
    return true;
  } catch (e) {
    logger.error('simulateKeyPress failed:', e);
    return false;
  }
}

// ==================== 窗口检测 ====================

/**
 * 获取指定坐标处的窗口信息（仅 Windows）
 * @param {number} x - 屏幕 X 坐标
 * @param {number} y - 屏幕 Y 坐标
 * @returns {Object|null} { className, processName, isInputBox, isFileManager, isDesktop }
 */
function getWindowInfoAtPoint(x, y) {
  if (process.platform !== 'win32') return null;
  
  const api = initWin32API();
  if (!api) return null;
  
  try {
    const {
      WindowFromPoint, GetAncestor, GetWindowThreadProcessId,
      OpenProcess, CloseHandle, GetModuleBaseNameW, GetClassNameW,
      GA_ROOT, PROCESS_QUERY_INFORMATION, PROCESS_VM_READ,
    } = api;
    
    // 获取子窗口
    const point = { x: Math.round(x), y: Math.round(y) };
    const childHwnd = WindowFromPoint(point);
    if (!childHwnd) return null;
    
    // 获取子窗口类名
    const childClassBuffer = Buffer.alloc(512);
    GetClassNameW(childHwnd, childClassBuffer, 256);
    const childClassName = childClassBuffer.toString('utf16le').replace(/\0/g, '');
    
    // 获取顶层窗口
    const rootHwnd = GetAncestor(childHwnd, GA_ROOT) || childHwnd;
    
    // 获取顶层窗口类名
    const classNameBuffer = Buffer.alloc(512);
    GetClassNameW(rootHwnd, classNameBuffer, 256);
    const className = classNameBuffer.toString('utf16le').replace(/\0/g, '');
    
    // 获取进程名
    const pidBuffer = Buffer.alloc(4);
    GetWindowThreadProcessId(rootHwnd, pidBuffer);
    const pid = pidBuffer.readUInt32LE(0);
    
    let processName = '';
    const hProcess = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, 0, pid);
    if (hProcess) {
      const processNameBuffer = Buffer.alloc(512);
      GetModuleBaseNameW(hProcess, null, processNameBuffer, 256);
      processName = processNameBuffer.toString('utf16le').replace(/\0/g, '').toLowerCase();
      CloseHandle(hProcess);
    }
    
    // 判断窗口类型
    const inputBoxClasses = [
      'Edit', 'RICHEDIT50W', 'RichEdit20W', 'RichEdit', 'TextBox', '_WwG',
      'Chrome_RenderWidgetHostHWND', 'MozillaWindowClass', 'CASCADIA_HOSTING_WINDOW_CLASS',
    ];
    
    const fileManagerProcesses = [
      'explorer.exe', 'totalcmd.exe', 'totalcmd64.exe',
      'doublecmd.exe', 'xyplorer.exe', 'q-dir.exe', 'freecommander.exe',
    ];
    
    const desktopClasses = ['Progman', 'WorkerW'];
    
    const fileViewClasses = [
      'SHELLDLL_DefView', 'DirectUIHWND', 'SysListView32', 'SysTreeView32',
      'CabinetWClass', 'ExploreWClass', 'TMyListBox', 'LCLListBox',
    ];
    
    return {
      className,
      childClassName,
      processName,
      isInputBox: inputBoxClasses.some(cls => childClassName.includes(cls)),
      isFileManager: fileManagerProcesses.includes(processName),
      isDesktop: desktopClasses.some(cls => className.includes(cls)),
      isFileView: fileViewClasses.some(cls => className.includes(cls)),
    };
  } catch (e) {
    logger.error('getWindowInfoAtPoint failed:', e);
    return null;
  }
}

// ==================== 截图穿透 ====================

/**
 * 设置窗口为截图不可见（仅 Windows）
 * @param {BrowserWindow} electronWindow - Electron 窗口实例
 * @returns {boolean} 是否成功
 */
function makeWindowInvisibleToCapture(electronWindow) {
  if (process.platform !== 'win32') return false;
  
  const api = initWin32API();
  if (!api) return false;
  
  try {
    const hwnd = electronWindow.getNativeWindowHandle();
    const result = api.SetWindowDisplayAffinity(hwnd, api.WDA_EXCLUDEFROMCAPTURE);
    
    if (result) {
      logger.debug('Window set to capture-invisible mode');
      return true;
    } else {
      logger.warn('SetWindowDisplayAffinity returned false');
      return false;
    }
  } catch (e) {
    logger.error('makeWindowInvisibleToCapture failed:', e);
    return false;
  }
}

// ==================== 选区检测（三层混合检测） ====================

// 防抖：记录上次剪贴板检测时间
let lastClipboardCheckTime = 0;
const CLIPBOARD_CHECK_COOLDOWN = 100; // 100ms 内不重复检测（避免双击时重复触发）

/**
 * 混合分层检测：判断当前是否有文本选区
 * 
 * 第一层：焦点 + 控件类型判定（Cheap Filter）
 *   - 过滤掉 100% 不可能有选区的情况
 *   - 零副作用，快速
 * 
 * 第二层：标准控件快速路径（Strong & Clean）
 *   - Edit / RichEdit 控件使用 EM_GETSEL
 *   - 零剪贴板，同步，快
 * 
 * 第三层：复杂应用剪贴板兜底（Controlled Fallback）
 *   - 仅在前两层无法判断时使用
 *   - 保存 → Ctrl+C → 读取 → 恢复
 *   - 有防抖机制
 * 
 * @returns {Object} { hasSelection: boolean|null, method: string, reason: string }
 */
function hasTextSelection() {
  if (process.platform !== 'win32') {
    return { hasSelection: null, method: 'none', reason: 'not windows' };
  }
  
  const api = initWin32API();
  if (!api) {
    return { hasSelection: null, method: 'none', reason: 'api not available' };
  }
  
  try {
    // ========== 第一层：焦点 + 控件类型判定 ==========
    const focusInfo = getFocusedWindowInfo(api);
    
    if (!focusInfo.hwndFocus) {
      // 没有前台窗口 → 需要兜底检测
      return { hasSelection: null, method: 'focus', reason: focusInfo.reason || 'no window' };
    }
    
    logger.debug(`Focus window: "${focusInfo.className}" (caret: ${focusInfo.hasCaret}, usedForeground: ${focusInfo.usedForeground})`);
    
    // 检查是否是"肯定无选区"的控件类型
    const noTextClasses = [
      'Progman', 'WorkerW',           // 桌面
      'SHELLDLL_DefView',             // 文件管理器视图
      'SysListView32', 'SysTreeView32', // 列表/树控件
      'Button', 'Static',             // 按钮、标签
      'msctls_trackbar32',            // 滑块
      'ScrollBar',                    // 滚动条
    ];
    
    if (noTextClasses.some(cls => focusInfo.className.includes(cls))) {
      return { hasSelection: false, method: 'class_filter', reason: `non-text control: ${focusInfo.className}` };
    }
    
    // ========== 第二层：标准控件快速路径 ==========
    const standardEditClasses = [
      'Edit',                         // 标准输入框
      'RICHEDIT50W', 'RichEdit20W', 'RichEdit', // RichEdit 系列
      'TextBox',                      // .NET TextBox
      '_WwG',                         // Word 编辑区
    ];
    
    if (standardEditClasses.some(cls => focusInfo.className.includes(cls))) {
      const selResult = getEditControlSelection(api, focusInfo.hwndFocus);
      if (selResult.success) {
        const hasSelection = selResult.start !== selResult.end;
        return { 
          hasSelection, 
          method: 'em_getsel', 
          reason: hasSelection ? `range ${selResult.start}-${selResult.end}` : 'empty selection'
        };
      }
      // EM_GETSEL 失败，继续到第三层
      logger.debug('EM_GETSEL failed, falling back');
    }
    
    // ========== 第三层准备：判断是否需要剪贴板兜底 ==========
    
    // 复杂应用（浏览器 / VSCode / Electron）
    // 复杂应用（浏览器 / VSCode / Electron）
    // 包括顶层窗口和渲染内容区域的类名
    const complexAppClasses = [
      // Chrome/Edge/Electron
      'Chrome_RenderWidgetHostHWND',  // 渲染内容区域
      'Chrome_WidgetWin_',            // 顶层窗口（Chrome_WidgetWin_0, Chrome_WidgetWin_1 等）
      
      // WebView2 (Edge-based)
      'WebView',                      // 通用 WebView（包括 TeamsWebView 等）
      
      // Firefox
      'MozillaWindowClass',           // 顶层窗口和内容区域
      
      // Windows Terminal
      'CASCADIA_HOSTING_WINDOW_CLASS',
      
      // VSCode
      'vloVw32', 'vloVw64',
      
      // Office
      'EXCEL7', 'PPTFrameClass', 'OpusApp',  // Excel, PowerPoint, Word
      
      // 其他 Electron 应用
      'Electron',
    ];
    
    const isComplexApp = complexAppClasses.some(cls => focusInfo.className.includes(cls));
    
    if (isComplexApp || focusInfo.hasCaret) {
      // 复杂应用或有光标，需要剪贴板兜底
      return { 
        hasSelection: null, 
        method: 'needs_clipboard', 
        reason: isComplexApp ? `complex app: ${focusInfo.className}` : 'has caret, unknown control'
      };
    }
    
    // 未知控件，且没有光标，大概率无选区
    return { hasSelection: false, method: 'unknown_no_caret', reason: `unknown class without caret: ${focusInfo.className}` };
    
  } catch (e) {
    logger.error('hasTextSelection error:', e);
    return { hasSelection: null, method: 'error', reason: e.message };
  }
}

/**
 * 获取焦点窗口信息
 */
function getFocusedWindowInfo(api) {
  const {
    GetForegroundWindow, GetWindowThreadProcessId, GetGUIThreadInfo,
    GetClassNameW, GUITHREADINFO,
  } = api;
  
  // 获取前台窗口
  const hwndForeground = GetForegroundWindow();
  if (!hwndForeground) {
    return { hwndFocus: null, reason: 'no foreground window' };
  }
  
  // 获取线程 ID
  const pidBuffer = Buffer.alloc(4);
  const threadId = GetWindowThreadProcessId(hwndForeground, pidBuffer);
  if (!threadId) {
    return { hwndFocus: null, reason: 'no thread id' };
  }
  
  // 获取 GUI 线程信息
  const guiInfo = {
    cbSize: 48,
    flags: 0,
    hwndActive: null,
    hwndFocus: null,
    hwndCapture: null,
    hwndMenuOwner: null,
    hwndMoveSize: null,
    hwndCaret: null,
    rcCaret_left: 0,
    rcCaret_top: 0,
    rcCaret_right: 0,
    rcCaret_bottom: 0,
  };
  
  const result = GetGUIThreadInfo(threadId, guiInfo);
  
  // 使用焦点窗口，如果为空则使用前台窗口
  const targetHwnd = (result && guiInfo.hwndFocus) ? guiInfo.hwndFocus : hwndForeground;
  
  // 获取窗口类名
  const classBuffer = Buffer.alloc(512);
  GetClassNameW(targetHwnd, classBuffer, 256);
  const className = classBuffer.toString('utf16le').replace(/\0/g, '');
  
  logger.debug(`getFocusedWindowInfo: foreground=${!!hwndForeground}, focus=${!!guiInfo.hwndFocus}, class="${className}"`);
  
  return {
    hwndFocus: targetHwnd,
    hwndCaret: guiInfo.hwndCaret,
    className,
    hasCaret: !!guiInfo.hwndCaret,
    usedForeground: !guiInfo.hwndFocus,  // 标记是否使用了前台窗口
  };
}

/**
 * 获取 Edit 控件的选区范围
 */
function getEditControlSelection(api, hwnd) {
  const { SendMessageW, EM_GETSEL } = api;
  
  try {
    const startBuffer = Buffer.alloc(8);
    const endBuffer = Buffer.alloc(8);
    SendMessageW(hwnd, EM_GETSEL, startBuffer, endBuffer);
    
    const start = startBuffer.readUInt32LE(0);
    const end = endBuffer.readUInt32LE(0);
    
    return { success: true, start, end };
  } catch (e) {
    logger.debug('getEditControlSelection failed:', e.message);
    return { success: false };
  }
}

/**
 * 第三层：剪贴板兜底检测（受控使用）
 * 仅在 hasTextSelection 返回 null 时调用
 * 
 * @returns {Promise<{hasSelection: boolean, text: string}>}
 */
async function checkSelectionViaClipboard() {
  if (process.platform !== 'win32') {
    return { hasSelection: false, text: '' };
  }
  
  // 防抖检查
  const now = Date.now();
  if (now - lastClipboardCheckTime < CLIPBOARD_CHECK_COOLDOWN) {
    logger.debug('Clipboard check skipped (cooldown)');
    return { hasSelection: null, text: '' };
  }
  lastClipboardCheckTime = now;
  
  const { clipboard } = require('electron');
  
  try {
    // 1. 保存剪贴板快照（含格式）
    const snapshot = {
      text: clipboard.readText(),
      html: clipboard.readHTML(),
      rtf: clipboard.readRTF(),
    };
    
    // 2. 模拟 Ctrl+C（不清空剪贴板！）
    simulateCtrlC();
    
    // 3. 延迟等待（20-40ms）
    await new Promise(resolve => setTimeout(resolve, 30));
    
    // 4. 读取当前剪贴板
    const currentText = clipboard.readText();
    
    // 5. 与快照比较，判断是否有"有意义的变化"
    const textChanged = currentText !== snapshot.text;
    const hasNewContent = currentText && currentText.trim().length > 0;
    
    // 6. 恢复剪贴板（无论是否变化都恢复，保持安静）
    if (snapshot.html) {
      clipboard.write({ text: snapshot.text, html: snapshot.html, rtf: snapshot.rtf });
    } else if (snapshot.text) {
      clipboard.writeText(snapshot.text);
    } else {
      // 原本为空，也恢复为空
      clipboard.clear();
    }
    
    // 7. 判定逻辑：
    //    - 剪贴板未变化 → 无 selection（Ctrl+C 没复制到东西）
    //    - 剪贴板变化且非空 → 有 selection
    if (!textChanged) {
      logger.debug('Clipboard unchanged, no selection');
      return { hasSelection: false, text: '' };
    }
    
    if (hasNewContent) {
      logger.debug(`Clipboard changed, has selection: "${currentText.substring(0, 20)}..."`);
      return { hasSelection: true, text: currentText };
    }
    
    // 变化但为空（极少见情况）
    logger.debug('Clipboard changed but empty');
    return { hasSelection: false, text: '' };
    
  } catch (e) {
    logger.error('checkSelectionViaClipboard error:', e);
    return { hasSelection: null, text: '' };
  }
}

// ==================== 导出 ====================// ==================== 导出 ====================

module.exports = {
  // API 初始化
  initWin32API,
  
  // 键盘模拟
  simulateCtrlC,
  simulateKeyPress,
  
  // 窗口检测
  getWindowInfoAtPoint,
  
  // 选区检测（三层混合）
  hasTextSelection,           // 第一层 + 第二层（零剪贴板）
  checkSelectionViaClipboard, // 第三层（剪贴板兜底）
  
  // 截图穿透
  makeWindowInvisibleToCapture,
  
  // 检查 API 是否可用
  isWin32APIAvailable: () => {
    if (process.platform !== 'win32') return false;
    return initWin32API() !== null;
  },
};
