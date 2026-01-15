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
    
    win32API = {
      // 键盘模拟
      keybd_event: user32.func('void keybd_event(uint8, uint8, uint32, uintptr)'),
      
      // 窗口检测
      WindowFromPoint: user32.func('void* WindowFromPoint(POINT)'),
      GetAncestor: user32.func('void* GetAncestor(void*, uint32)'),
      GetWindowThreadProcessId: user32.func('uint32 GetWindowThreadProcessId(void*, uint32*)'),
      GetClassNameW: user32.func('int GetClassNameW(void*, uint16*, int)'),
      
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

// ==================== 导出 ====================

module.exports = {
  // API 初始化
  initWin32API,
  
  // 键盘模拟
  simulateCtrlC,
  simulateKeyPress,
  
  // 窗口检测
  getWindowInfoAtPoint,
  
  // 截图穿透
  makeWindowInvisibleToCapture,
  
  // 检查 API 是否可用
  isWin32APIAvailable: () => {
    if (process.platform !== 'win32') return false;
    return initWin32API() !== null;
  },
};
