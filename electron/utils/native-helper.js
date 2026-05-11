// Low-level Win32 helpers: key simulation, window detection, three-layer selection probe.

const logger = require('./logger')('Native');

// ===== Win32 API init =====

let win32API = null;

// Lazy-load koffi + user32/kernel32/psapi bindings. Returns null on non-Windows or
// load failure (marks the cache so we don't retry every call).
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
      GetGUIThreadInfo: user32.func('int GetGUIThreadInfo(uint32, GUITHREADINFO*)'),
      SendMessageW: user32.func('intptr SendMessageW(void*, uint32, uintptr*, uintptr*)'),

      // Process info
      OpenProcess: kernel32.func('void* OpenProcess(uint32, int, uint32)'),
      CloseHandle: kernel32.func('int CloseHandle(void*)'),
      GetModuleBaseNameW: psapi.func('uint32 GetModuleBaseNameW(void*, void*, uint16*, uint32)'),

      // Capture-affinity
      SetWindowDisplayAffinity: user32.func('SetWindowDisplayAffinity', 'bool', ['void*', 'uint']),

      // Constants
      VK_CONTROL: 0x11,
      VK_CAPITAL: 0x14,      // CapsLock virtual-key
      VK_C: 0x43,
      KEYEVENTF_KEYUP: 0x0002,
      GA_ROOT: 2,
      PROCESS_QUERY_INFORMATION: 0x0400,
      PROCESS_VM_READ: 0x0010,
      WDA_EXCLUDEFROMCAPTURE: 0x00000011,
      EM_GETSEL: 0x00B0,
      GUI_CARETBLINKING: 0x0001,

      GUITHREADINFO,
    };

    logger.info('Windows API loaded successfully');
    return win32API;
  } catch (e) {
    logger.warn('Failed to load koffi:', e.message);
    win32API = false; // Cache as unavailable to avoid retry storms.
    return null;
  }
}

// ===== Keyboard simulation =====

// Simulate Ctrl+C on Windows. Cleans up any stuck Ctrl/C keystate first
// (Word and similar can leave keys "pressed" from prior input, which would
// cause our synthetic Ctrl+C to instead type a literal 'c').
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

    // Stuck-key cleanup: GetAsyncKeyState high bit (0x8000) = pressed right now.
    const ctrlDown = (GetAsyncKeyState(VK_CONTROL) & 0x8000) !== 0;
    const cDown = (GetAsyncKeyState(VK_C) & 0x8000) !== 0;

    if (ctrlDown || cDown) {
      logger.debug(`Cleaning stuck keys: Ctrl=${ctrlDown}, C=${cDown}`);
      if (cDown) keybd_event(VK_C, 0x2e, KEYEVENTF_KEYUP, 0);
      if (ctrlDown) keybd_event(VK_CONTROL, 0x1d, KEYEVENTF_KEYUP, 0);
    }

    // Ctrl+C sequence. Release C before Ctrl so the modifier doesn't outlive the key.
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

// CapsLock LED state (the toggle), NOT the physical key-press.
// GetKeyState low bit (0x0001) = toggle; high bit would be the physical press (not used here).
// Fail-safe: returns false on non-Windows or API unavailable.
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

// ===== Window detection =====

// Returns info about the window under (x, y). Windows only.
// Result: { className, childClassName, processName, isInputBox, isFileManager, isDesktop, isFileView }
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

    const point = { x: Math.round(x), y: Math.round(y) };
    const childHwnd = WindowFromPoint(point);
    if (!childHwnd) return null;

    const childClassBuffer = Buffer.alloc(512);
    GetClassNameW(childHwnd, childClassBuffer, 256);
    const childClassName = childClassBuffer.toString('utf16le').replace(/\0/g, '');

    // Top-level (root) HWND for app-level classification.
    const rootHwnd = GetAncestor(childHwnd, GA_ROOT) || childHwnd;

    const classNameBuffer = Buffer.alloc(512);
    GetClassNameW(rootHwnd, classNameBuffer, 256);
    const className = classNameBuffer.toString('utf16le').replace(/\0/g, '');

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

// ===== Capture-exclusion =====

// Hide window from screen capture (Win32 SetWindowDisplayAffinity).
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

// ===== Three-layer selection detection =====

// Debounce against repeated clipboard probes (e.g. double-click can fire two mouseups fast).
let lastClipboardCheckTime = 0;
const CLIPBOARD_CHECK_COOLDOWN = 100;

/**
 * Three-layer selection probe.
 *   Layer 1: focus + control-class filter (cheap, zero side effects)
 *   Layer 2: standard Edit/RichEdit controls → EM_GETSEL (sync, clipboard-free)
 *   Layer 3: complex apps → clipboard fallback (separate function `checkSelectionViaClipboard`)
 *
 * Returns { hasSelection: boolean|null, method: string, reason: string }.
 *   hasSelection === null means "Layer 1+2 can't decide, caller should run Layer 3".
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
    // ----- Layer 1: focus + class filter -----
    const focusInfo = getFocusedWindowInfo(api);

    if (!focusInfo.hwndFocus) {
      return { hasSelection: null, method: 'focus', reason: focusInfo.reason || 'no window' };
    }

    logger.debug(`Focus window: "${focusInfo.className}" (caret: ${focusInfo.hasCaret}, usedForeground: ${focusInfo.usedForeground})`);

    // Classes that definitely can't hold a text selection.
    const noTextClasses = [
      'Progman', 'WorkerW',             // Desktop
      'SHELLDLL_DefView',               // File manager view
      'SysListView32', 'SysTreeView32', // List / tree controls
      'Button', 'Static',               // Buttons / labels
      'msctls_trackbar32',              // Slider
      'ScrollBar',
    ];

    if (noTextClasses.some(cls => focusInfo.className.includes(cls))) {
      return { hasSelection: false, method: 'class_filter', reason: `non-text control: ${focusInfo.className}` };
    }

    // ----- Layer 2: standard edit controls (EM_GETSEL) -----
    const standardEditClasses = [
      'Edit',
      'RICHEDIT50W', 'RichEdit20W', 'RichEdit',
      'RichEditD2DPT',     // Win11 Notepad
      'TextBox',           // .NET TextBox
      '_WwG',              // Word editor surface
    ];

    if (standardEditClasses.some(cls => focusInfo.className.includes(cls))) {
      const selResult = getEditControlSelection(api, focusInfo.hwndFocus);
      if (selResult.success) {
        const hasSelection = selResult.start !== selResult.end;
        return {
          hasSelection,
          method: 'em_getsel',
          reason: hasSelection ? `range ${selResult.start}-${selResult.end}` : 'empty selection',
        };
      }
      logger.debug('EM_GETSEL failed, falling back');
    }

    // ----- Layer 3 dispatch: decide whether clipboard fallback is needed -----
    //
    // Complex apps where neither focus-class nor EM_GETSEL gives a clean answer.
    // Includes both top-level window classes and renderer content-area classes.
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
    ];

    const isComplexApp = complexAppClasses.some(cls => focusInfo.className.includes(cls));

    if (isComplexApp || focusInfo.hasCaret) {
      return {
        hasSelection: null,
        method: 'needs_clipboard',
        reason: isComplexApp ? `complex app: ${focusInfo.className}` : 'has caret, unknown control',
      };
    }

    // Unknown class with no caret — most likely no selection.
    return { hasSelection: false, method: 'unknown_no_caret', reason: `unknown class without caret: ${focusInfo.className}` };

  } catch (e) {
    logger.error('hasTextSelection error:', e);
    return { hasSelection: null, method: 'error', reason: e.message };
  }
}

// Get focused-window info via GetForegroundWindow + GetGUIThreadInfo.
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

  // cbSize must match the GUITHREADINFO struct size exactly. On x64:
  // uint32(4) + uint32(4) + 6×void*(48) + 4×int32(16) = 72 bytes.
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

  // Prefer the focused control hwnd; fall back to foreground top-level.
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
    usedForeground: !guiInfo.hwndFocus, // Flag whether we fell back to foreground hwnd.
  };
}

// EM_GETSEL: read [start, end) of the current selection in a standard Edit/RichEdit.
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
 * Layer 3: clipboard fallback. Called only when Layers 1+2 returned `null`.
 * Snapshot → Ctrl+C → wait → compare → restore. Detects selection by diff.
 *
 * @returns {Promise<{hasSelection: boolean|null, text: string}>}
 */
async function checkSelectionViaClipboard(options = {}) {
  if (process.platform !== 'win32') {
    return { hasSelection: false, text: '' };
  }

  // Cooldown debounce.
  const now = Date.now();
  if (now - lastClipboardCheckTime < CLIPBOARD_CHECK_COOLDOWN) {
    logger.debug('Clipboard check skipped (cooldown)');
    return { hasSelection: null, text: '' };
  }
  lastClipboardCheckTime = now;

  const { clipboard } = require('electron');

  // Office and similar apps need longer wait + a retry — their clipboard pipeline is slow.
  const isComplexApp = options.isComplexApp || false;
  const waitTime = isComplexApp ? 200 : 50;
  const maxRetries = isComplexApp ? 2 : 1;

  try {
    // Snapshot all formats so we can fully restore.
    const snapshot = {
      text: clipboard.readText(),
      html: clipboard.readHTML(),
      rtf: clipboard.readRTF(),
    };

    let currentText = snapshot.text;
    let textChanged = false;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      simulateCtrlC();

      await new Promise(resolve => setTimeout(resolve, waitTime));

      currentText = clipboard.readText();

      textChanged = currentText !== snapshot.text;

      if (textChanged) {
        logger.debug(`Clipboard changed on attempt ${attempt + 1}`);
        break;
      }

      if (attempt < maxRetries - 1) {
        logger.debug(`Clipboard unchanged, retrying (attempt ${attempt + 1}/${maxRetries})`);
      }
    }

    const hasNewContent = currentText && currentText.trim().length > 0;

    // Always restore (even on miss) — caller shouldn't observe our probing.
    if (snapshot.html) {
      clipboard.write({ text: snapshot.text, html: snapshot.html, rtf: snapshot.rtf });
    } else if (snapshot.text) {
      clipboard.writeText(snapshot.text);
    } else {
      clipboard.clear();
    }

    // Decision:
    //   unchanged → no selection (Ctrl+C copied nothing)
    //   changed + non-empty → selection captured
    //   changed but empty → rare edge, treat as no selection
    if (!textChanged) {
      logger.debug('Clipboard unchanged after all attempts, no selection');
      return { hasSelection: false, text: '' };
    }

    if (hasNewContent) {
      logger.debug(`Clipboard changed, has selection: "${currentText.substring(0, 20)}..."`);
      return { hasSelection: true, text: currentText };
    }

    logger.debug('Clipboard changed but empty');
    return { hasSelection: false, text: '' };

  } catch (e) {
    logger.error('checkSelectionViaClipboard error:', e);
    return { hasSelection: null, text: '' };
  }
}

module.exports = {
  initWin32API,

  // Key simulation
  simulateCtrlC,
  simulateKeyPress,
  isCapsLockOn,  // Sticky-direct mode reads the CapsLock toggle bit (synchronous).

  // Window detection
  getWindowInfoAtPoint,

  // Three-layer selection probe
  hasTextSelection,           // Layers 1+2 (clipboard-free)
  checkSelectionViaClipboard, // Layer 3 (clipboard fallback)

  // Capture-exclusion
  makeWindowInvisibleToCapture,

  isWin32APIAvailable: () => {
    if (process.platform !== 'win32') return false;
    return initWin32API() !== null;
  },
};
