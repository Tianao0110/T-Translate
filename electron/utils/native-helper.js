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
      // _Inout_ so koffi copies the filled struct back to JS: cbSize goes in,
      // the focus/caret handles come out. Without it the output was never
      // marshaled back and focus/caret detection silently returned nothing.
      GetGUIThreadInfo: user32.func('int GetGUIThreadInfo(uint32, _Inout_ GUITHREADINFO* info)'),
      // Timeout variant so a hung target window can't block the main process.
      SendMessageTimeoutW: user32.func('intptr SendMessageTimeoutW(void*, uint32, uintptr*, uintptr*, uint32, uint32, uintptr*)'),

      // Process info
      OpenProcess: kernel32.func('void* OpenProcess(uint32, int, uint32)'),
      CloseHandle: kernel32.func('int CloseHandle(void*)'),
      GetModuleBaseNameW: psapi.func('uint32 GetModuleBaseNameW(void*, void*, uint16*, uint32)'),

      // Capture-affinity
      SetWindowDisplayAffinity: user32.func('SetWindowDisplayAffinity', 'bool', ['void*', 'uint']),

      _koffi: koffi, // for koffi.address() pointer identity

      // Constants
      VK_CONTROL: 0x11,
      VK_CAPITAL: 0x14,      // CapsLock virtual-key
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

// ===== Capture-exclusion =====

// Hide window from screen capture (Win32 SetWindowDisplayAffinity).
function makeWindowInvisibleToCapture(electronWindow) {
  if (process.platform !== 'win32') return false;

  const api = initWin32API();
  if (!api) return false;

  try {
    // getNativeWindowHandle() returns a Buffer *containing* the HWND. Handing
    // that Buffer to a koffi `void*` passes a pointer to the buffer's bytes,
    // not the handle — Win32 then gets a bogus window and returns false every
    // single time. Measured: IsWindow(buffer) false, IsWindow(decoded) true.
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

// Undo the exclusion (WDA_NONE) — the user's "let me screenshot the overlay"
// setting. Same HWND-decode dance as above.
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

/**
 * Three-layer selection probe.
 *   Layer 1: focus + control-class filter (cheap, zero side effects)
 *   Layer 2: standard Edit/RichEdit controls → EM_GETSEL (sync, clipboard-free)
 *   Layer 3: complex apps → clipboard fallback (utils/clipboard-capture.js)
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

    // Carried on every verdict so the TT_SELECTION_DEBUG probe shows whether
    // GetGUIThreadInfo resolved the real focused control (focusResolved:true)
    // or we fell back to the top-level foreground window — the direct health
    // signal for the _Inout_ marshaling fix.
    const diag = { focusResolved: !focusInfo.usedForeground, hasCaret: !!focusInfo.hasCaret };

    // Focus now resolves to the real focused control (post _Inout_ fix), so
    // the control-class lists are matched EXACTLY — a substring match would let
    // e.g. 'OlkPeoplePickerEdit' hit the 'Edit' standard-control rule and route
    // Outlook's picker through EM_GETSEL. Only the complex-app list stays fuzzy;
    // it holds deliberate prefixes/substrings ('Chrome_WidgetWin_', 'Olk', 'WebView').
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
    // NOTE: Word's '_WwG' is deliberately NOT here — EM_GETSEL returns 0/0 on it
    // (not a real Edit control), which would short-circuit to "no selection". It
    // lives only in complexAppClasses so Word routes to the clipboard fallback.
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

      // PDF readers — page views hold a selection without a Win32 caret, so
      // they must be routed to the clipboard probe explicitly. (AVL_AVView
      // confirmed via probe log; previously fell through to unknown_no_caret
      // and the clipboard layer was never even attempted.)
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

    // Unknown class with no caret — most likely no selection.
    return { hasSelection: false, method: 'unknown_no_caret', reason: `unknown class without caret: ${cls}`, ...diag };

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

// Identity + position snapshot of the foreground window. Taken at mousedown and
// compared at mouseup: same window at a different position means the gesture was
// a window drag (title bar), which must never fire the selection probe — the
// probe's Ctrl+C would land in whatever the dragged app has focused (in a
// terminal that's a SIGINT to the running process).
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

// Foreground/focused control class name, for policy checks (e.g. terminal
// detection before injecting Ctrl+C). Returns '' when unavailable.
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

// EM_GETSEL: read [start, end) of the current selection in a standard Edit/RichEdit.
// Uses SendMessageTimeoutW (SMTO_ABORTIFHUNG) so a frozen target window can't
// block the main process — a hung/timed-out call returns success:false and the
// caller falls through to the clipboard layer.
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
  // Key simulation
  simulateCtrlC,
  isCapsLockOn,  // Sticky-direct mode reads the CapsLock toggle bit (synchronous).

  // Three-layer selection probe (Layers 1+2, clipboard-free).
  // Layer 3 clipboard fallback lives in utils/clipboard-capture.js.
  hasTextSelection,
  getForegroundClassName,
  getForegroundWindowSnapshot,

  // Capture-exclusion
  makeWindowInvisibleToCapture,
  makeWindowVisibleToCapture,
};
