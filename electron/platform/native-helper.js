// Win32 helpers over koffi: Ctrl+C simulation, the CapsLock toggle, capture
// exclusion, and the clipboard-free layers of the selection probe
// (controller.js calls them; the clipboard layer is selection/clipboard-capture.js).
// Class lists and koffi pitfalls: docs/design/selection.md §2.

const logger = require('./logger')('Native');

// ===== Win32 API init =====

let win32API = null;

// Lazy-loads koffi + user32 / kernel32 / psapi; null on non-Windows or failure.
function initWin32API() {
  if (process.platform !== 'win32') return null;
  if (win32API !== null) return win32API;

  try {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    const kernel32 = koffi.load('kernel32.dll');
    const psapi = koffi.load('psapi.dll');

    const POINT = koffi.struct('POINT', {
      x: 'int32',
      y: 'int32',
    });

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

    const RECT = koffi.struct('RECT', {
      left: 'int32',
      top: 'int32',
      right: 'int32',
      bottom: 'int32',
    });

    win32API = {
      // Keyboard simulation
      keybd_event: user32.func('void keybd_event(uint8, uint8, uint32, uintptr)'),
      GetAsyncKeyState: user32.func('int16 GetAsyncKeyState(int)'),
      GetKeyState: user32.func('int16 GetKeyState(int)'),

      // Window detection
      WindowFromPoint: user32.func('void* WindowFromPoint(POINT)'),
      GetAncestor: user32.func('void* GetAncestor(void*, uint32)'),
      GetWindowThreadProcessId: user32.func('uint32 GetWindowThreadProcessId(void*, uint32*)'),
      GetClassNameW: user32.func('int GetClassNameW(void*, uint16*, int)'),
      GetForegroundWindow: user32.func('void* GetForegroundWindow()'),
      GetWindowRect: user32.func('int GetWindowRect(void*, _Out_ RECT* rect)'),
      // _Inout_: cbSize goes in, the focus / caret handles come out.
      GetGUIThreadInfo: user32.func('int GetGUIThreadInfo(uint32, _Inout_ GUITHREADINFO* info)'),
      SendMessageTimeoutW: user32.func('intptr SendMessageTimeoutW(void*, uint32, uintptr*, uintptr*, uint32, uint32, uintptr*)'),

      // Process info
      OpenProcess: kernel32.func('void* OpenProcess(uint32, int, uint32)'),
      CloseHandle: kernel32.func('int CloseHandle(void*)'),
      GetModuleBaseNameW: psapi.func('uint32 GetModuleBaseNameW(void*, void*, uint16*, uint32)'),

      // Capture-affinity
      SetWindowDisplayAffinity: user32.func('SetWindowDisplayAffinity', 'bool', ['void*', 'uint']),

      _koffi: koffi,

      // Constants
      VK_CONTROL: 0x11,
      VK_CAPITAL: 0x14,
      VK_C: 0x43,
      KEYEVENTF_KEYUP: 0x0002,
      GA_ROOT: 2,
      PROCESS_QUERY_INFORMATION: 0x0400,
      PROCESS_VM_READ: 0x0010,
      WDA_EXCLUDEFROMCAPTURE: 0x00000011,
      WDA_NONE: 0x00000000,
      EM_GETSEL: 0x00B0,
      GUI_CARETBLINKING: 0x0001,
      SMTO_ABORTIFHUNG: 0x0002,
      SMTO_BLOCK: 0x0001,
      EM_GETSEL_TIMEOUT_MS: 200,

      GUITHREADINFO,
    };

    logger.info('Windows API loaded successfully');
    return win32API;
  } catch (e) {
    logger.warn('Failed to load koffi:', e.message);
    win32API = false;
    return null;
  }
}

// ===== Keyboard simulation =====

// Simulates Ctrl+C, releasing a stuck Ctrl / C first.
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
    const { keybd_event, GetAsyncKeyState, VK_CONTROL, VK_C, KEYEVENTF_KEYUP } = api;

    const ctrlDown = (GetAsyncKeyState(VK_CONTROL) & 0x8000) !== 0;
    const cDown = (GetAsyncKeyState(VK_C) & 0x8000) !== 0;

    if (ctrlDown || cDown) {
      logger.debug(`Cleaning stuck keys: Ctrl=${ctrlDown}, C=${cDown}`);
      if (cDown) keybd_event(VK_C, 0x2e, KEYEVENTF_KEYUP, 0);
      if (ctrlDown) keybd_event(VK_CONTROL, 0x1d, KEYEVENTF_KEYUP, 0);
    }

    keybd_event(VK_CONTROL, 0x1d, 0, 0);
    keybd_event(VK_C, 0x2e, 0, 0);
    keybd_event(VK_C, 0x2e, KEYEVENTF_KEYUP, 0);
    keybd_event(VK_CONTROL, 0x1d, KEYEVENTF_KEYUP, 0);

    logger.debug('simulateCtrlC: success');
    return true;
  } catch (e) {
    logger.error('simulateCtrlC failed:', e);
    return false;
  }
}

// CapsLock toggle state (the LED), not the physical key; false when unavailable.
function isCapsLockOn() {
  if (process.platform !== 'win32') return false;

  const api = initWin32API();
  if (!api) return false;

  try {
    const { GetKeyState, VK_CAPITAL } = api;
    return (GetKeyState(VK_CAPITAL) & 0x0001) !== 0;
  } catch (e) {
    logger.error('isCapsLockOn failed:', e);
    return false;
  }
}

// ===== Capture-exclusion =====

// Hides a window from screen capture (SetWindowDisplayAffinity).
function makeWindowInvisibleToCapture(electronWindow) {
  if (process.platform !== 'win32') return false;

  const api = initWin32API();
  if (!api) return false;

  try {
    // getNativeWindowHandle() is a Buffer containing the HWND: decode it.
    const handleBuffer = electronWindow.getNativeWindowHandle();
    const hwnd = api._koffi.decode(handleBuffer, 'void*');
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

// Undoes the exclusion (WDA_NONE).
function makeWindowVisibleToCapture(electronWindow) {
  if (process.platform !== 'win32') return false;

  const api = initWin32API();
  if (!api) return false;

  try {
    const handleBuffer = electronWindow.getNativeWindowHandle();
    const hwnd = api._koffi.decode(handleBuffer, 'void*');
    const result = api.SetWindowDisplayAffinity(hwnd, api.WDA_NONE);
    if (!result) logger.warn('SetWindowDisplayAffinity(WDA_NONE) returned false');
    return !!result;
  } catch (e) {
    logger.error('makeWindowVisibleToCapture failed:', e);
    return false;
  }
}

// ===== Three-layer selection detection =====

// Layers 1 + 2 of the selection probe: focus + control-class filter, then
// EM_GETSEL on standard edit controls. Returns { hasSelection, method, reason };
// hasSelection === null means the caller should run the clipboard layer.
function hasTextSelection() {
  if (process.platform !== 'win32') {
    return { hasSelection: null, method: 'none', reason: 'not windows' };
  }

  const api = initWin32API();
  if (!api) {
    return { hasSelection: null, method: 'none', reason: 'api not available' };
  }

  try {
    // ----- Layer 1: focus + class filter -----
    const focusInfo = getFocusedWindowInfo(api);

    if (!focusInfo.hwndFocus) {
      return { hasSelection: null, method: 'focus', reason: focusInfo.reason || 'no window' };
    }

    logger.debug(`Focus window: "${focusInfo.className}" (caret: ${focusInfo.hasCaret}, usedForeground: ${focusInfo.usedForeground})`);

    // Diagnostics carried on every verdict for the TT_SELECTION_DEBUG probe.
    const diag = { focusResolved: !focusInfo.usedForeground, hasCaret: !!focusInfo.hasCaret };

    // Exact matches for the control lists; only the complex-app list is fuzzy.
    const cls = focusInfo.className;
    const matchesExact = (list) => list.includes(cls);
    const matchesFuzzy = (list) => list.some((c) => cls.includes(c));

    // Classes that definitely can't hold a text selection.
    const noTextClasses = [
      'Progman', 'WorkerW',             // Desktop
      'SHELLDLL_DefView',               // File manager view
      'SysListView32', 'SysTreeView32', // List / tree controls
      'Button', 'Static',               // Buttons / labels
      'msctls_trackbar32',              // Slider
      'ScrollBar',
    ];

    if (matchesExact(noTextClasses)) {
      return { hasSelection: false, method: 'class_filter', reason: `non-text control: ${cls}`, ...diag };
    }

    // ----- Layer 2: standard edit controls (EM_GETSEL) -----
    const standardEditClasses = [
      'Edit',
      'RICHEDIT50W', 'RichEdit20W', 'RichEdit',
      'RichEditD2DPT',     // Win11 Notepad
      'TextBox',           // .NET TextBox
    ];

    if (matchesExact(standardEditClasses)) {
      const selResult = getEditControlSelection(api, focusInfo.hwndFocus);
      if (selResult.success) {
        const hasSelection = selResult.start !== selResult.end;
        return {
          hasSelection,
          method: 'em_getsel',
          reason: hasSelection ? `range ${selResult.start}-${selResult.end}` : 'empty selection',
          ...diag,
        };
      }
      logger.debug('EM_GETSEL failed, falling back');
    }

    // ----- Layer 3 dispatch: complex apps go to the clipboard fallback -----
    const complexAppClasses = [
      // Chrome / Edge / Electron
      'Chrome_RenderWidgetHostHWND',    // Render content
      'Chrome_WidgetWin_',              // Top-level (Chrome_WidgetWin_0, _1, …)

      // WebView2 (Edge-based)
      'WebView',                        // Generic WebView (incl. TeamsWebView etc.)

      // Firefox
      'MozillaWindowClass',             // Top-level + content area

      // Windows Terminal
      'CASCADIA_HOSTING_WINDOW_CLASS',

      // VSCode
      'vloVw32', 'vloVw64',

      // Office
      'EXCEL7', 'PPTFrameClass', 'OpusApp',  // Excel, PowerPoint, Word
      '_WwG',                           // Word edit area

      // Outlook (classic desktop) — many internal control classes
      'rctrl_renwnd32',                 // Reading pane / editor
      'Olk',                            // Wildcard prefix: OlkPeoplePickerEdit / OlkBrowserHost ...
      'AfxWndW',                        // MFC generic (Outlook uses heavily)
      'NetUIHWND',                      // Office Ribbon / NetUI
      'SUPERGRID',                      // Outlook mail list
      'Outlook Host',                   // New Outlook main content

      // Other Electron apps
      'Electron',

      // Win11 Notepad top-level (child can be RichEditD2DPT)
      'Notepad',

      // PDF readers (a selection without a Win32 caret)
      'AVL_AVView',          // Adobe Acrobat / Reader page view
      'AcrobatSDIWindow',    // Adobe top-level (focus-fallback safety)
      'SUMATRA_PDF_FRAME',   // SumatraPDF
      'Foxit',               // Foxit family (classFoxit… prefixes)
    ];

    const isComplexApp = matchesFuzzy(complexAppClasses);

    if (isComplexApp || focusInfo.hasCaret) {
      return {
        hasSelection: null,
        method: 'needs_clipboard',
        reason: isComplexApp ? `complex app: ${cls}` : 'has caret, unknown control',
        ...diag,
      };
    }

    return { hasSelection: false, method: 'unknown_no_caret', reason: `unknown class without caret: ${cls}`, ...diag };

  } catch (e) {
    logger.error('hasTextSelection error:', e);
    return { hasSelection: null, method: 'error', reason: e.message };
  }
}

// Focused control (or the foreground window) via GetGUIThreadInfo.
function getFocusedWindowInfo(api) {
  const {
    GetForegroundWindow, GetWindowThreadProcessId, GetGUIThreadInfo,
    GetClassNameW,
  } = api;

  const hwndForeground = GetForegroundWindow();
  if (!hwndForeground) {
    return { hwndFocus: null, reason: 'no foreground window' };
  }

  const pidBuffer = Buffer.alloc(4);
  const threadId = GetWindowThreadProcessId(hwndForeground, pidBuffer);
  if (!threadId) {
    return { hwndFocus: null, reason: 'no thread id' };
  }

  // cbSize is the exact x64 GUITHREADINFO size.
  const guiInfo = {
    cbSize: 72,
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

  const targetHwnd = (result && guiInfo.hwndFocus) ? guiInfo.hwndFocus : hwndForeground;

  const classBuffer = Buffer.alloc(512);
  GetClassNameW(targetHwnd, classBuffer, 256);
  const className = classBuffer.toString('utf16le').replace(/\0/g, '');

  logger.debug(`getFocusedWindowInfo: foreground=${!!hwndForeground}, focus=${!!guiInfo.hwndFocus}, class="${className}"`);

  return {
    hwndFocus: targetHwnd,
    hwndCaret: guiInfo.hwndCaret,
    className,
    hasCaret: !!guiInfo.hwndCaret,
    usedForeground: !guiInfo.hwndFocus,
  };
}

// Identity + position of the foreground window, for controller.js's
// window-drag check.
function getForegroundWindowSnapshot() {
  if (process.platform !== 'win32') return null;
  const api = initWin32API();
  if (!api) return null;
  try {
    const hwnd = api.GetForegroundWindow();
    if (!hwnd) return null;
    const rect = {};
    if (!api.GetWindowRect(hwnd, rect)) return null;
    return { id: api._koffi.address(hwnd).toString(), left: rect.left, top: rect.top };
  } catch (e) {
    return null;
  }
}

// Focused control class name ('' when unavailable), for the terminal check.
function getForegroundClassName() {
  if (process.platform !== 'win32') return '';
  const api = initWin32API();
  if (!api) return '';
  try {
    return getFocusedWindowInfo(api).className || '';
  } catch (e) {
    return '';
  }
}

// EM_GETSEL with a timeout; a hung target reads as success:false.
function getEditControlSelection(api, hwnd) {
  const {
    SendMessageTimeoutW, EM_GETSEL,
    SMTO_ABORTIFHUNG, SMTO_BLOCK, EM_GETSEL_TIMEOUT_MS,
  } = api;

  try {
    const startBuffer = Buffer.alloc(8);
    const endBuffer = Buffer.alloc(8);
    const resultBuffer = Buffer.alloc(8);

    const ok = SendMessageTimeoutW(
      hwnd, EM_GETSEL, startBuffer, endBuffer,
      SMTO_ABORTIFHUNG | SMTO_BLOCK, EM_GETSEL_TIMEOUT_MS, resultBuffer
    );
    if (!ok) {
      logger.debug('EM_GETSEL timed out or target hung');
      return { success: false };
    }

    const start = startBuffer.readUInt32LE(0);
    const end = endBuffer.readUInt32LE(0);

    return { success: true, start, end };
  } catch (e) {
    logger.debug('getEditControlSelection failed:', e.message);
    return { success: false };
  }
}

module.exports = {
  simulateCtrlC,
  isCapsLockOn,
  hasTextSelection,
  getForegroundClassName,
  getForegroundWindowSnapshot,
  makeWindowInvisibleToCapture,
  makeWindowVisibleToCapture,
};
