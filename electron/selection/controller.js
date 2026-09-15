// Selection translate in the main process: the global mouse hook feeds the
// gesture state machine, a confirmed selection is probed (Win32 first, the
// clipboard as fallback) and the selection window is shown with the text.
// The screenshot flow reuses the same window for its loading dot and result.
// Wired from main.js; the IPC layer reaches these through `managers`.

const { screen } = require('electron');
const { store, runtime, windows } = require('../state');
const { CHANNELS } = require('../shared/channels');
const { t } = require('../shared/main-i18n');
const { isCapsLockOn } = require('../platform/native-helper');
const { fetchSelectedText } = require('../ipc/selection');
const { SelectionStateMachine, STATES, CONFIG: FSM_CONFIG } = require('./selection-state-machine');
const windowManager = require('../windows/window-manager');
const { updateTrayMenu } = require('../windows/tray-manager');
const logger = require('../platform/logger')('Selection');

let selectionStateMachine = null;

// Opt-in probe diagnostics (set TT_SELECTION_DEBUG=1). Records which detection
// layer resolved each gesture, by control class + method only — never text
// content — so the app-matrix pass can see where a given app lands.
// Tolerant parse: cmd's `set X=1 && …` includes the trailing space in the value.
const SELECTION_DEBUG = /^(1|true)$/i.test((process.env.TT_SELECTION_DEBUG || '').trim());
function debugProbe(stage, data) {
  if (SELECTION_DEBUG) logger.info(`[probe:${stage}]`, JSON.stringify(data));
}

// Terminal window classes where a blind Ctrl+C is a SIGINT (kills the running
// process). The sticky-direct path downgrades to the click-to-confirm trigger
// icon for these instead of auto-injecting.
const TERMINAL_CLASSES = [
  'CASCADIA_HOSTING_WINDOW_CLASS', // Windows Terminal
  'ConsoleWindowClass',            // conhost / cmd / classic console
  'VirtualConsoleClass',           // some console hosts
  'mintty',                        // Git Bash / MSYS2
  'PuTTY',                         // PuTTY
];
function isTerminalClass(className) {
  if (!className) return false;
  return TERMINAL_CLASSES.some((c) => className.includes(c));
}

// Single source for the settings payload every selection-window path sends —
// kills per-call-site drift (screenshot Modes 2/3 were missing showSourceByDefault
// and triggerTimeout, and defaults disagreed across sites).
function buildSelectionSettingsPayload() {
  const s = store.get('settings.selection', {}) || {};
  return {
    triggerTimeout: s.triggerTimeout || 4000,
    showSourceByDefault: s.showSourceByDefault || false,
    autoCloseOnCopy: s.autoCloseOnCopy || false,
    minChars: s.minChars || 2,
    maxChars: s.maxChars || 500,
    windowOpacity: s.windowOpacity || 95,
    // Rainbow signature skin takes over the selection window in every theme
    // when on; off = each theme's own matched skin (fresh has an aqua one).
    rainbowWindow: s.rainbowWindow || false,
    // UI language, so the persistent window refreshes its i18n on each show —
    // language (unlike theme) has no cross-window broadcast.
    language: store.get('settings.interface.language') || undefined,
  };
}

// Cached mirror of settings.selection — electron-store re-reads and re-parses
// the whole settings file from disk on every .get(), too slow for the global
// mousedown/mouseup hot path.
let cachedSelectionSettings = store.get('settings.selection', {});
store.onDidChange('settings.selection', (value) => {
  cachedSelectionSettings = value || {};
});

// Cancellation for in-flight delayed-confirm: a newer confirm (triple-click's
// third mouseup) cancels the older one so only the final selection gets probed.
let pendingConfirmCancel = null;

// Foreground window snapshot taken at mousedown; compared at mouseup to detect
// window-drag gestures (see getForegroundWindowSnapshot).
let gestureWindowSnapshot = null;

// True when the gesture moved the foreground window itself (title-bar drag,
// double-click maximize): the user was manipulating a window, not selecting
// text — probing would inject Ctrl+C into it (SIGINT in terminals).
function isWindowDragGesture() {
  if (!gestureWindowSnapshot) return false;
  const { getForegroundWindowSnapshot } = require('../platform/native-helper');
  const now = getForegroundWindowSnapshot();
  if (!now || now.id !== gestureWindowSnapshot.id) return false;
  const moved = Math.abs(now.left - gestureWindowSnapshot.left) > 10 ||
                Math.abs(now.top - gestureWindowSnapshot.top) > 10;
  return moved;
}

// Delayed-confirm path for double/triple click. The system needs time to react before
// we can check if text actually got selected.
async function handleDelayedConfirm(x, y) {
  if (pendingConfirmCancel) pendingConfirmCancel();
  let cancelled = false;
  const myCancel = () => { cancelled = true; };
  pendingConfirmCancel = myCancel;

  try {
    const { hasTextSelection } = require('../platform/native-helper');
    const { detectSelectionViaClipboard } = require('./clipboard-capture');

    // Wait out the FULL multi-click window before probing. Probing earlier (was
    // 80ms) fired between the 2nd and 3rd click of a triple-click: the probe's
    // synthetic Ctrl+C landed mid-sequence, broke the app's own triple-click
    // expansion, and captured the double-click word instead of the paragraph.
    // Any click that arrives within this window cancels us and re-schedules.
    await new Promise(resolve => setTimeout(resolve, FSM_CONFIG.DOUBLE_CLICK_TIME));

    if (cancelled) {
      logger.debug('Delayed confirm cancelled by newer mouseup (likely triple-click)');
      return;
    }

    // Double-click on a title bar maximizes the window — that resize lands
    // after our mouseup, so re-check here (post-wait) before probing.
    if (isWindowDragGesture()) {
      logger.debug('Delayed confirm: window moved/resized (title-bar double-click) — skip probe');
      debugProbe('delayed', { skipped: 'window-drag gesture' });
      selectionStateMachine.reset();
      return;
    }

    // ----- Layer 1+2: clipboard-free probe -----
    const selectionCheck = hasTextSelection();
    logger.debug(`Selection check: ${selectionCheck.hasSelection} (${selectionCheck.method}: ${selectionCheck.reason})`);
    debugProbe('delayed', selectionCheck);

    if (selectionCheck.hasSelection === true) {
      logger.debug('Delayed confirm: selection detected via Win32 API (layer 1-2)');
      showSelectionTrigger(x, y);
      selectionStateMachine.reset();
      return;
    }

    if (selectionCheck.hasSelection === false) {
      logger.debug('Delayed confirm: no selection detected (layer 1-2)');
      selectionStateMachine.reset();
      return;
    }

    // ----- Layer 3: clipboard fallback for complex apps -----
    // Office / Outlook need longer waits + retry.
    const reason = selectionCheck.reason || '';
    const isOfficeApp = reason.includes('OpusApp') ||
                        reason.includes('EXCEL') ||
                        reason.includes('PPTFrameClass') ||
                        reason.includes('rctrl_renwnd32') ||
                        reason.includes('AfxWndW') ||
                        reason.includes('NetUIHWND') ||
                        reason.includes('SUPERGRID') ||
                        reason.includes('OlkPeoplePickerEdit') ||
                        reason.includes('Outlook Host');
    logger.debug(`Delayed confirm: layer 3 - clipboard fallback (office=${isOfficeApp})`);

    const clipboardResult = await detectSelectionViaClipboard({ isComplexApp: isOfficeApp });

    if (cancelled) {
      logger.debug('Delayed confirm cancelled mid-clipboard-fetch');
      return;
    }

    if (clipboardResult.hasSelection === true) {
      logger.debug(`Delayed confirm: text selected via clipboard "${clipboardResult.text.substring(0, 20)}..."`);
      showSelectionTrigger(x, y, clipboardResult.text);
    } else if (clipboardResult.hasSelection === null) {
      // Debounced or errored.
      logger.debug('Delayed confirm: clipboard check skipped or failed');
    } else {
      logger.debug('Delayed confirm: no text selected, skip trigger');
    }

    selectionStateMachine.reset();
  } catch (err) {
    logger.error('handleDelayedConfirm error:', err);
    // Belt-and-suspenders reset.
    if (selectionStateMachine) {
      selectionStateMachine.reset();
    }
  } finally {
    // Only release the slot if I'm still the current owner — a newer confirm
    // may have already overwritten pendingConfirmCancel with its own token.
    if (pendingConfirmCancel === myCancel) pendingConfirmCancel = null;
  }
}

// Show the trigger icon at (mouseX, mouseY). Reads language settings from electron-store
// (TranslationPanel mirrors them on every change — single source of truth).
//
// `prefetchedText` (v0.2.5 Phase B): when the caller already captured selected text
// (Layer 3 path), pass it through. The renderer stores it in a ref and uses it
// directly on icon click, skipping the second clipboard fetch (which is the root cause
// of the "press but no content" issue in complex apps with focus-transfer behavior).
async function showSelectionTrigger(mouseX, mouseY, prefetchedText = null, options = {}) {
  logger.debug(`showSelectionTrigger called (prefetched=${prefetchedText ? prefetchedText.length + ' chars' : 'none'}, failed=${!!options.failed})`);

  if (!runtime.selectionEnabled) {
    logger.debug('showSelectionTrigger: selection translate disabled, no icon');
    return;
  }

  const settings = store.get('settings', {});
  const interfaceSettings = settings.interface || {};
  const translationSettings = settings.translation || {};

  const currentTargetLang = translationSettings.targetLanguage || 'zh';
  const currentSourceLang = translationSettings.sourceLanguage || 'auto';
  logger.debug(`Language from electron-store: ${currentSourceLang} -> ${currentTargetLang}`);

  const win = windowManager.createSelectionWindow();

  // Trigger window must be square, else the icon's border-radius:50% renders
  // an ellipse. Electron 42 on Windows clamps frameless/transparent windows to
  // a ~30x37 minimum, so the old 28x28 came out non-square. 40 clears the clamp
  // on every DPI tested; the renderer also pins the icon to a fixed size so a
  // clamp on some other DPI still can't distort it.
  const TRIGGER_SIZE = 40;
  const GAP = 8;

  // Icon position with screen-edge clamping.
  let triggerX = mouseX + GAP;
  let triggerY = mouseY + GAP;

  const display = screen.getDisplayNearestPoint({ x: mouseX, y: mouseY });
  // workArea (not bounds) so the icon never tucks under the taskbar, and shares
  // the same reference frame as the card's renderer-side availWidth/Height clamp.
  const bounds = display.workArea;

  if (triggerX + TRIGGER_SIZE > bounds.x + bounds.width) {
    triggerX = mouseX - TRIGGER_SIZE - GAP;
  }
  if (triggerY + TRIGGER_SIZE > bounds.y + bounds.height) {
    triggerY = mouseY - TRIGGER_SIZE - GAP;
  }

  win.setBounds({
    x: Math.round(triggerX),
    y: Math.round(triggerY),
    width: TRIGGER_SIZE,
    height: TRIGGER_SIZE,
  });
  win.show();

  const sendData = () => {
    win.webContents.send(CHANNELS.SELECTION.SHOW_TRIGGER, {
      mouseX,
      mouseY,
      // Work area of the display the selection happened on, so the renderer
      // clamps card placement to the RIGHT monitor (window.screen is only the
      // current display and carries no global origin).
      screenBounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
      theme: interfaceSettings.theme || 'light',
      settings: buildSelectionSettingsPayload(),
      translation: {
        targetLanguage: currentTargetLang,
        sourceLanguage: currentSourceLang,
        sameLanguageBehavior: translationSettings.sameLanguageBehavior || 'original',
      },
      // v0.2.5 Phase B pass-through — see function docstring.
      text: prefetchedText,
      // Sticky-direct capture came back empty: render the icon in a failed
      // state (red + shake); a click retries via GET_TEXT.
      failed: !!options.failed,
    });
  };

  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', sendData);
  } else {
    setTimeout(sendData, 50);
  }
}

/**
 * CapsLock sticky direct path: skip the trigger icon, capture text and pop the card
 * straight away. Invoked from the mouseup handler when FSM returns `{ skipIcon: true }`.
 *
 * Failure modes are silent: if no text captured OR window create failed, the function
 * returns without showing anything (the user sees nothing, not an error).
 *
 * payload shape intentionally mirrors SHOW_TRIGGER so the renderer's two paths stay
 * consistent.
 */
async function handleHotkeyDirectPath(x, y) {
  logger.debug('handleHotkeyDirectPath called', { x, y });

  if (!runtime.selectionEnabled) {
    logger.debug('Selection disabled, hotkey silent no-op');
    return;
  }

  // Terminal: never blind-inject Ctrl+C (a no-selection copy is a SIGINT that
  // kills the running process). Downgrade to the trigger icon so the copy only
  // happens if the user explicitly clicks it.
  const { getForegroundClassName } = require('../platform/native-helper');
  if (isTerminalClass(getForegroundClassName())) {
    logger.debug('Sticky direct in terminal — downgrading to trigger icon');
    showSelectionTrigger(x, y);
    return;
  }

  const settings = store.get('settings', {});
  const interfaceSettings = settings.interface || {};
  const translationSettings = settings.translation || {};
  const currentTargetLang = translationSettings.targetLanguage || 'zh';
  const currentSourceLang = translationSettings.sourceLanguage || 'auto';

  const win = windowManager.createSelectionWindow();
  if (!win || win.isDestroyed()) {
    logger.warn('Hotkey: createSelectionWindow returned null/destroyed, aborting');
    return;
  }

  // Match showSelectionTrigger geometry (mouse + 8, 40×40 square — see the
  // border-radius/clamp note there). Renderer resizes to card size on result.
  const winW = 40;
  const winH = 40;
  let posX = x + 8;
  let posY = y + 8;

  const display = screen.getDisplayNearestPoint({ x: posX, y: posY });
  const displayBounds = display.workArea; // keep off the taskbar (matches trigger path)

  if (posX + winW > displayBounds.x + displayBounds.width) {
    posX = x - winW - 8;
  }
  if (posY + winH > displayBounds.y + displayBounds.height) {
    posY = y - winH - 8;
  }

  win.setBounds({
    x: Math.round(posX),
    y: Math.round(posY),
    width: winW,
    height: winH,
  });

  const payloadBase = {
    // Anchor + display work area so the card lands at the selection point on the
    // correct monitor (P1-6 / P1-8) rather than the last trigger's spot.
    mouseX: x,
    mouseY: y,
    screenBounds: { x: displayBounds.x, y: displayBounds.y, width: displayBounds.width, height: displayBounds.height },
    theme: interfaceSettings.theme || 'light',
    settings: buildSelectionSettingsPayload(),
    translation: {
      targetLanguage: currentTargetLang,
      sourceLanguage: currentSourceLang,
      sameLanguageBehavior: translationSettings.sameLanguageBehavior || 'original',
    },
  };

  const whenReady = (fn) => {
    if (win.isDestroyed()) return;
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', fn);
    else fn();
  };

  // Show a loading dot right away — capture takes ~0.8s and a silent gap felt broken.
  whenReady(() => {
    if (win.isDestroyed()) return;
    win.webContents.send(CHANNELS.SELECTION.SHOW_DIRECT, { ...payloadBase, phase: 'capturing' });
    win.show();
  });

  const text = await fetchSelectedText();
  if (win.isDestroyed()) return;

  if (text && text.trim()) {
    whenReady(() => win.webContents.send(CHANNELS.SELECTION.SHOW_DIRECT, { ...payloadBase, phase: 'translate', text: text.trim() }));
  } else {
    // Empty capture: don't fail silently. Flip to a clickable "failed" trigger
    // (red + shake) so the user can retry via the icon, which re-runs GET_TEXT.
    logger.debug('Hotkey: no text captured, showing failed trigger');
    showSelectionTrigger(x, y, null, { failed: true });
  }
}

function hideSelectionWindow() {
  if (windows.selection && !windows.selection.isDestroyed()) {
    windows.selection.hide();
    windows.selection.webContents.send(CHANNELS.SELECTION.HIDE);
  }
}

// Send OCR'd text to the selection window — Mode 2 of SHOW_RESULT: the window receives
// raw text and translates it itself (so the same translator + history flow gets reused).
function showSelectionWithText(text, notice) {
  clearSelectionLoadingWatchdog(); // OCR resolved — cancel the timeout
  const win = runtime.screenshotSelectionWindow;

  if (!win || win.isDestroyed()) {
    logger.warn('No selection window to send text to');
    return;
  }

  logger.debug('Sending OCR text to selection window');

  const settings = store.get('settings', {});
  const interfaceSettings = settings.interface || {};
  const translationSettings = settings.translation || {};

  const currentTargetLang = translationSettings.targetLanguage || 'zh';

  // Work area of the display the loading window sits on — the card expands from
  // a clamped 28×28 spot near a screen edge, so the renderer needs these bounds
  // to keep the grown card on-screen (the screenshot path has no cursor anchor).
  const wb = win.getBounds();
  const disp = screen.getDisplayNearestPoint({ x: wb.x, y: wb.y });

  win.webContents.send(CHANNELS.SELECTION.SHOW_RESULT, {
    text: text,  // Mode 2: text only, renderer translates.
    notice: notice || undefined, // e.g. "vision model degraded to local OCR"
    targetLanguage: currentTargetLang,
    sameLanguageBehavior: translationSettings.sameLanguageBehavior || 'original',
    theme: interfaceSettings.theme || 'light',
    screenBounds: { x: disp.workArea.x, y: disp.workArea.y, width: disp.workArea.width, height: disp.workArea.height },
    settings: buildSelectionSettingsPayload(),
  });
}

// Show result directly (Mode 3): already-translated text. Used for OCR-failure paths
// where the renderer should display content (or an error) without translating again.
function showSelectionResult(data) {
  clearSelectionLoadingWatchdog(); // OCR resolved (result or error) — cancel the timeout
  const win = runtime.screenshotSelectionWindow;

  if (!win || win.isDestroyed()) {
    logger.warn('No selection window to show result');
    return;
  }

  const settings = store.get('settings', {});
  const interfaceSettings = settings.interface || {};

  win.webContents.send(CHANNELS.SELECTION.SHOW_RESULT, {
    sourceText: data.sourceText || '',
    translatedText: data.translatedText || '',
    isOcrError: data.isOcrError === true,
    theme: interfaceSettings.theme || 'light',
    settings: buildSelectionSettingsPayload(),
  });
}

// Cancel the loading-window watchdog (OCR resolved, or we're tearing down).
function clearSelectionLoadingWatchdog() {
  if (runtime.screenshotLoadingTimer) {
    clearTimeout(runtime.screenshotLoadingTimer);
    runtime.screenshotLoadingTimer = null;
  }
}

// Close the screenshot-OCR loading window. If errorMsg is provided, show it for 4s first.
function hideSelectionLoading(errorMsg) {
  clearSelectionLoadingWatchdog();
  const win = runtime.screenshotSelectionWindow;

  if (win && !win.isDestroyed()) {
    if (errorMsg) {
      win.webContents.send(CHANNELS.SELECTION.SHOW_RESULT, {
        error: errorMsg,
        theme: (store.get('settings.interface.theme')) || 'light',
        settings: buildSelectionSettingsPayload(),
      });
      setTimeout(() => {
        if (win && !win.isDestroyed()) win.close();
      }, 4000);
    } else {
      win.close();
    }
  }

  runtime.screenshotSelectionWindow = null;
}

async function showSelectionLoading(bounds) {
  logger.debug('Showing selection loading window');

  const settings = store.get('settings', {});
  const interfaceSettings = settings.interface || {};

  const win = windowManager.createSelectionWindow();
  runtime.screenshotSelectionWindow = win;

  // Watchdog: if OCR never reports back (renderer not ready, message dropped),
  // don't leave a permanent, unclosable spinner — surface a timeout after 20s.
  clearSelectionLoadingWatchdog();
  runtime.screenshotLoadingTimer = setTimeout(() => {
    logger.warn('Selection loading timed out with no OCR result');
    hideSelectionLoading(t('selection.loadingTimeout'));
  }, 20000);

  // Position at the bottom-right of the captured screenshot area.
  let posX = bounds.x + bounds.width + 10;
  let posY = bounds.y + bounds.height + 10;

  const display = screen.getDisplayNearestPoint({ x: posX, y: posY });
  const screenBounds = display.workArea; // workArea (not bounds) so it clears the taskbar
  const winSize = 28;  // Square loading window, matches selection-trigger size.

  if (posX + winSize > screenBounds.x + screenBounds.width) {
    posX = bounds.x - winSize - 10;
  }
  if (posY + winSize > screenBounds.y + screenBounds.height) {
    posY = bounds.y - winSize - 10;
  }

  posX = Math.max(screenBounds.x, Math.min(posX, screenBounds.x + screenBounds.width - winSize));
  posY = Math.max(screenBounds.y, Math.min(posY, screenBounds.y + screenBounds.height - winSize));

  win.setBounds({ x: Math.round(posX), y: Math.round(posY), width: winSize, height: winSize });
  win.show();

  const sendData = () => {
    win.webContents.send(CHANNELS.SELECTION.SHOW_RESULT, {
      isLoading: true,
      theme: interfaceSettings.theme || 'light',
      settings: buildSelectionSettingsPayload(),
    });
  };

  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', sendData);
  } else {
    setTimeout(sendData, 50);
  }
}

function toggleSelectionTranslate() {
  runtime.selectionEnabled = !runtime.selectionEnabled;
  store.set('selectionEnabled', runtime.selectionEnabled);

  let hookOk = true;
  if (!runtime.selectionEnabled) {
    hideSelectionWindow();
    stopSelectionHook();
  } else {
    hookOk = startSelectionHook() !== false; // may flip selectionEnabled back off on failure
  }

  updateTrayMenu(); // after the hook attempt, so it reflects a failed enable
  windows.main?.webContents?.send(CHANNELS.SELECTION.STATE_CHANGED, runtime.selectionEnabled);
  logger.info('Selection translate:', runtime.selectionEnabled ? 'enabled' : 'disabled');

  // Distinguish "user turned it off" from "enable failed" so the UI can show an
  // error instead of a green "disabled" success toast.
  return { enabled: runtime.selectionEnabled, error: hookOk ? null : 'hookFailed' };
}

// Wire the global mouse hook (uIOhook) and route mousedown/move/up into the FSM.
// Returns true on success, false if the native hook failed to start.
function startSelectionHook() {
  if (runtime.selectionHook || !runtime.selectionEnabled) return true;

  try {
    const { uIOhook } = require('uiohook-napi');

    if (!selectionStateMachine) {
      selectionStateMachine = new SelectionStateMachine();
    }
    selectionStateMachine.reset();

    // uIOhook is a singleton EventEmitter and .stop() does NOT drop listeners.
    // Clear ours before re-adding so toggling selection on/off can't accumulate
    // duplicate handlers (which raced each other and broke double-click capture).
    uIOhook.removeAllListeners('mousedown');
    uIOhook.removeAllListeners('mousemove');
    uIOhook.removeAllListeners('mouseup');

    // ----- mousedown -----
    uIOhook.on('mousedown', (e) => {
      if (e.button !== 1) return; // Left button only.

      const cursorPos = screen.getCursorScreenPoint();
      const { x, y } = cursorPos;

      // P3-20 verification aid: uiohook event coords vs Electron DIP coords.
      // On a scaled display (e.g. 1.75x) a physical-pixel uiohook reads ~scale×
      // larger. Verdict is precomputed so the log line answers directly.
      if (SELECTION_DEBUG) {
        const ratio = x > 100 ? (e.x / x) : null; // skip near-origin clicks (ratio unstable)
        const verdict = ratio === null ? 'click further from screen corner and retry'
          : Math.abs(ratio - 1) < 0.05 ? 'SAME coordinate space -> switching to event coords is SAFE'
          : `uiohook is ~${ratio.toFixed(2)}x (physical pixels) -> DO NOT switch, keep getCursorScreenPoint`;
        debugProbe('coords', { uiohook: { x: e.x, y: e.y }, electronDip: { x, y }, verdict });
      }

      // Click inside any of our selection windows (including frozen ones) — treat
      // as a drag-on-overlay and skip the FSM entirely.
      if (windowManager.isPointInSelectionWindows(x, y)) {
        runtime.isDraggingOverlay = true;
        return;
      }

      runtime.isDraggingOverlay = false;

      // Click on our other windows — also ignore.
      if (isClickInOurWindows(x, y)) {
        return;
      }

      // Hide the existing trigger UNLESS this is a multi-click extending selection —
      // hiding mid-double-click causes a visible flicker.
      const isMultiClick = selectionStateMachine.peekMultiClick(x, y);

      if (!isMultiClick) {
        hideSelectionWindow();
      }

      // Fresh gesture: drop any cached capture so it can only be reused within
      // this one selection, never leak into the next.
      require('./clipboard-capture').invalidateCache();

      // Window-drag detection baseline (compared at mouseup).
      gestureWindowSnapshot = require('../platform/native-helper').getForegroundWindowSnapshot();

      // Sticky direct: setting on + CapsLock LED on → bypass trigger icon.
      const stickyActive = !!cachedSelectionSettings.stickyViaCapsLock && isCapsLockOn();

      selectionStateMachine.onMouseDown(x, y, stickyActive);
    });

    // ----- mousemove -----
    uIOhook.on('mousemove', (e) => {
      if (runtime.isDraggingOverlay) return;
      if (!selectionStateMachine) return;

      const state = selectionStateMachine.getState();
      if (state === STATES.IDLE) return;

      const cursorPos = screen.getCursorScreenPoint();
      selectionStateMachine.onMouseMove(cursorPos.x, cursorPos.y);
    });

    // ----- mouseup -----
    uIOhook.on('mouseup', async (e) => {
      try {
        if (e.button !== 1) return;

        if (runtime.isDraggingOverlay) {
          runtime.isDraggingOverlay = false;
          return;
        }

        if (!selectionStateMachine) return;

        const state = selectionStateMachine.getState();
        if (state === STATES.IDLE) return;

        const cursorPos = screen.getCursorScreenPoint();
        const { x, y } = cursorPos;

        // Mouseup inside our selection window — user is clicking our trigger, not
        // ending a fresh selection. Reset and let the renderer's click handler run.
        if (windows.selection && !windows.selection.isDestroyed() && windows.selection.isVisible()) {
          const bounds = windows.selection.getBounds();
          if (x >= bounds.x && x <= bounds.x + bounds.width &&
              y >= bounds.y && y <= bounds.y + bounds.height) {
            selectionStateMachine.reset();
            return;
          }
        }

        // Re-read sticky state at mouseup (user may have released CapsLock mid-drag).
        const stickyActive = !!cachedSelectionSettings.stickyViaCapsLock && isCapsLockOn();

        const result = selectionStateMachine.onMouseUp(x, y, stickyActive);

        if (result.shouldShow) {
          // Title-bar drags kinematically look like fast selections. If the
          // foreground window itself moved with the gesture, bail before any
          // probe/injection (Ctrl+C into a dragged terminal is a SIGINT).
          if (isWindowDragGesture()) {
            logger.debug('Gesture moved the foreground window (title-bar drag) — skip probe');
            debugProbe('drag', { skipped: 'window-drag gesture' });
            selectionStateMachine.reset();
            return;
          }

          // Sticky direct: skip the icon, skip Layer 1+2 probe, go straight to capture + translate.
          if (result.skipIcon) {
            await handleHotkeyDirectPath(x, y);
            selectionStateMachine.reset();
            return;
          }

          // Multi-click: needs delayed confirm (system selects text async after the click).
          if (result.needsDelayedConfirm) {
            handleDelayedConfirm(x, y);
            return;
          }

          // Normal drag: run the three-layer selection probe.
          const { hasTextSelection } = require('../platform/native-helper');
          const { detectSelectionViaClipboard } = require('./clipboard-capture');
          const selectionCheck = hasTextSelection();
          logger.debug(`Normal drag selection check: ${selectionCheck.hasSelection} (${selectionCheck.method}: ${selectionCheck.reason})`);
          debugProbe('drag', selectionCheck);

          if (selectionCheck.hasSelection === true) {
            // Layer 1+2 confirmed selection.
            showSelectionTrigger(x, y);
            selectionStateMachine.reset();
            return;
          }

          if (selectionCheck.hasSelection === false) {
            // Layer 1+2 confirmed no selection (desktop, file manager etc.).
            logger.debug('Normal drag: no selection detected, skip trigger');
            selectionStateMachine.reset();
            return;
          }

          // hasSelection === null (complex app like browser) — run clipboard fallback.
          const dragReason = selectionCheck.reason || '';
          const isOfficeApp = dragReason.includes('OpusApp') ||
                              dragReason.includes('EXCEL') ||
                              dragReason.includes('PPTFrameClass') ||
                              dragReason.includes('rctrl_renwnd32') ||
                              dragReason.includes('AfxWndW') ||
                              dragReason.includes('NetUIHWND') ||
                              dragReason.includes('SUPERGRID') ||
                              dragReason.includes('OlkPeoplePickerEdit') ||
                              dragReason.includes('Outlook Host');
          logger.debug(`Normal drag: complex app, using clipboard fallback (office=${isOfficeApp})`);
          const clipboardResult = await detectSelectionViaClipboard({ isComplexApp: isOfficeApp });

          if (clipboardResult.hasSelection === true) {
            showSelectionTrigger(x, y, clipboardResult.text);
          } else {
            logger.debug('Normal drag: clipboard check found no selection');
          }
          selectionStateMachine.reset();
        } else {
          selectionStateMachine.reset();
        }
      } catch (err) {
        logger.error('mouseup handler error:', err);
        if (selectionStateMachine) {
          selectionStateMachine.reset();
        }
      }
    });

    uIOhook.start();
    runtime.selectionHook = uIOhook;
    logger.info('Selection hook started (state machine mode)');
    return true;
  } catch (err) {
    logger.error('Failed to start selection hook:', err.message);
    runtime.selectionEnabled = false;
    store.set('selectionEnabled', false);
    updateTrayMenu();
    return false;
  }
}

function stopSelectionHook() {
  // Reset state machine first (clears timers).
  if (selectionStateMachine) {
    selectionStateMachine.reset();
  }

  if (runtime.selectionHook) {
    try {
      // Drop our handlers too — .stop() only halts the native thread, listeners
      // persist on the singleton and would double up on the next enable.
      runtime.selectionHook.removeAllListeners('mousedown');
      runtime.selectionHook.removeAllListeners('mousemove');
      runtime.selectionHook.removeAllListeners('mouseup');
      runtime.selectionHook.stop();
      runtime.selectionHook = null;
      logger.info('Selection hook stopped');
    } catch (err) {
      logger.error('Failed to stop selection hook:', err);
    }
  }
}

function isClickInOurWindows(x, y) {
  // Include the screenshot overlay: while it's up (fullscreen, focused), the
  // user's rubber-band drag must not drive the selection FSM and inject Ctrl+C
  // into our own capture surface.
  const windowsToCheck = [windows.main, windows.floatingWindow, windows.screenshot];
  for (const win of windowsToCheck) {
    if (win && !win.isDestroyed() && win.isVisible()) {
      if (win.isMinimized() || !win.isFocused()) continue;
      const bounds = win.getBounds();
      if (x >= bounds.x && x <= bounds.x + bounds.width &&
          y >= bounds.y && y <= bounds.y + bounds.height) {
        return true;
      }
    }
  }
  return false;
}

// Loads the native modules and the selection window ahead of the first
// gesture; main.js calls this a few seconds after startup.
function preheatSelectionModules() {
  logger.info('Preheating selection modules...');

  try {
    require('uiohook-napi');
    logger.debug('uiohook-napi preloaded');

    if (process.platform === 'win32') {
      try {
        require('koffi');
        logger.debug('koffi preloaded');
      } catch (e) {
        // Not critical.
      }
    }

    const preWin = windowManager.createSelectionWindow();
    if (preWin && !preWin.isDestroyed()) {
      preWin.webContents.once('did-finish-load', () => {
        logger.debug('SelectionWindow preheated');
      });
    }

    if (!selectionStateMachine) {
      selectionStateMachine = new SelectionStateMachine();
      logger.debug('SelectionStateMachine preheated');
    }

    logger.success('Selection modules preheated');
  } catch (err) {
    logger.warn('Preheat failed (non-critical):', err.message);
  }
}

module.exports = {
  toggleSelectionTranslate,
  startSelectionHook,
  stopSelectionHook,
  showSelectionWithText,
  showSelectionResult,
  showSelectionLoading,
  hideSelectionLoading,
  hideSelectionWindow,
  preheatSelectionModules,
};
