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

// Opt-in probe diagnostics (TT_SELECTION_DEBUG=1): control class + method
// per gesture, never text.
const SELECTION_DEBUG = /^(1|true)$/i.test((process.env.TT_SELECTION_DEBUG || '').trim());
function debugProbe(stage, data) {
  if (SELECTION_DEBUG) logger.info(`[probe:${stage}]`, JSON.stringify(data));
}

// Terminal window classes: the sticky-direct path never injects Ctrl+C into
// these, it shows the trigger icon instead.
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

// The settings payload every selection-window path sends.
function buildSelectionSettingsPayload() {
  const s = store.get('settings.selection', {}) || {};
  return {
    triggerTimeout: s.triggerTimeout || 4000,
    showSourceByDefault: s.showSourceByDefault || false,
    autoCloseOnCopy: s.autoCloseOnCopy || false,
    minChars: s.minChars || 2,
    maxChars: s.maxChars || 500,
    windowOpacity: s.windowOpacity || 95,
    rainbowWindow: s.rainbowWindow || false,
    // UI language: the persistent window refreshes its i18n on each show.
    language: store.get('settings.interface.language') || undefined,
  };
}

// Cached mirror of settings.selection for the mouse-hook hot path.
let cachedSelectionSettings = store.get('settings.selection', {});
store.onDidChange('settings.selection', (value) => {
  cachedSelectionSettings = value || {};
});

// Cancellation for an in-flight delayed confirm: a newer one cancels it.
let pendingConfirmCancel = null;

// Foreground window snapshot taken at mousedown, compared at mouseup.
let gestureWindowSnapshot = null;

// True when the gesture moved the foreground window itself (title-bar drag).
function isWindowDragGesture() {
  if (!gestureWindowSnapshot) return false;
  const { getForegroundWindowSnapshot } = require('../platform/native-helper');
  const now = getForegroundWindowSnapshot();
  if (!now || now.id !== gestureWindowSnapshot.id) return false;
  const moved = Math.abs(now.left - gestureWindowSnapshot.left) > 10 ||
                Math.abs(now.top - gestureWindowSnapshot.top) > 10;
  return moved;
}

// Double / triple click: wait out the multi-click window, then probe.
async function handleDelayedConfirm(x, y) {
  if (pendingConfirmCancel) pendingConfirmCancel();
  let cancelled = false;
  const myCancel = () => { cancelled = true; };
  pendingConfirmCancel = myCancel;

  try {
    const { hasTextSelection } = require('../platform/native-helper');
    const { detectSelectionViaClipboard } = require('./clipboard-capture');

    // Any click inside this window cancels us and re-schedules.
    await new Promise(resolve => setTimeout(resolve, FSM_CONFIG.DOUBLE_CLICK_TIME));

    if (cancelled) {
      logger.debug('Delayed confirm cancelled by newer mouseup (likely triple-click)');
      return;
    }

    // A title-bar double-click resizes after our mouseup: re-check here.
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
    if (selectionStateMachine) {
      selectionStateMachine.reset();
    }
  } finally {
    // Only release the slot if still the current owner.
    if (pendingConfirmCancel === myCancel) pendingConfirmCancel = null;
  }
}

// Shows the trigger icon at (mouseX, mouseY). `prefetchedText` is text the
// Layer 3 probe already captured; the renderer uses it on click instead of
// fetching again.
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

  // Square and above Electron's frameless-window minimum (docs/design/selection.md §5).
  const TRIGGER_SIZE = 40;
  const GAP = 8;

  // Icon position with screen-edge clamping.
  let triggerX = mouseX + GAP;
  let triggerY = mouseY + GAP;

  const display = screen.getDisplayNearestPoint({ x: mouseX, y: mouseY });
  // workArea keeps the icon off the taskbar and matches the renderer's clamp.
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
      // Work area of the display the selection happened on, for the card clamp.
      screenBounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
      theme: interfaceSettings.theme || 'light',
      settings: buildSelectionSettingsPayload(),
      translation: {
        targetLanguage: currentTargetLang,
        sourceLanguage: currentSourceLang,
        sameLanguageBehavior: translationSettings.sameLanguageBehavior || 'original',
      },
      text: prefetchedText,
      // Sticky-direct capture came back empty: failed icon, a click retries.
      failed: !!options.failed,
    });
  };

  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', sendData);
  } else {
    setTimeout(sendData, 50);
  }
}

// CapsLock sticky direct path: no trigger icon, capture and translate at
// once. Invoked from mouseup when the FSM returns { skipIcon: true }; the
// payload mirrors SHOW_TRIGGER.
async function handleHotkeyDirectPath(x, y) {
  logger.debug('handleHotkeyDirectPath called', { x, y });

  if (!runtime.selectionEnabled) {
    logger.debug('Selection disabled, hotkey silent no-op');
    return;
  }

  // Terminals get the trigger icon: no blind Ctrl+C.
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

  // Same geometry as showSelectionTrigger; the renderer resizes to the card.
  const winW = 40;
  const winH = 40;
  let posX = x + 8;
  let posY = y + 8;

  const display = screen.getDisplayNearestPoint({ x: posX, y: posY });
  const displayBounds = display.workArea;

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

  // Loading dot right away; the capture takes ~0.8s.
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
    // Empty capture: a clickable failed trigger, so the user can retry.
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

// SHOW_RESULT mode 2: raw OCR text, the window translates it itself.
function showSelectionWithText(text, notice) {
  clearSelectionLoadingWatchdog();
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

  // Work area of the display the loading window sits on, for the card clamp.
  const wb = win.getBounds();
  const disp = screen.getDisplayNearestPoint({ x: wb.x, y: wb.y });

  win.webContents.send(CHANNELS.SELECTION.SHOW_RESULT, {
    text: text,
    notice: notice || undefined,
    targetLanguage: currentTargetLang,
    sameLanguageBehavior: translationSettings.sameLanguageBehavior || 'original',
    theme: interfaceSettings.theme || 'light',
    screenBounds: { x: disp.workArea.x, y: disp.workArea.y, width: disp.workArea.width, height: disp.workArea.height },
    settings: buildSelectionSettingsPayload(),
  });
}

// SHOW_RESULT mode 3: already-translated text or an OCR error, no translation.
function showSelectionResult(data) {
  clearSelectionLoadingWatchdog();
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

function clearSelectionLoadingWatchdog() {
  if (runtime.screenshotLoadingTimer) {
    clearTimeout(runtime.screenshotLoadingTimer);
    runtime.screenshotLoadingTimer = null;
  }
}

// Closes the screenshot-OCR loading window; an errorMsg shows for 4s first.
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

  // Watchdog: a spinner nobody closes times out after 20s.
  clearSelectionLoadingWatchdog();
  runtime.screenshotLoadingTimer = setTimeout(() => {
    logger.warn('Selection loading timed out with no OCR result');
    hideSelectionLoading(t('selection.loadingTimeout'));
  }, 20000);

  // Position at the bottom-right of the captured screenshot area.
  let posX = bounds.x + bounds.width + 10;
  let posY = bounds.y + bounds.height + 10;

  const display = screen.getDisplayNearestPoint({ x: posX, y: posY });
  const screenBounds = display.workArea;
  const winSize = 28;

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
    hookOk = startSelectionHook() !== false;
  }

  updateTrayMenu();
  windows.main?.webContents?.send(CHANNELS.SELECTION.STATE_CHANGED, runtime.selectionEnabled);
  logger.info('Selection translate:', runtime.selectionEnabled ? 'enabled' : 'disabled');

  // 'hookFailed' lets the UI show an error instead of a "disabled" toast.
  return { enabled: runtime.selectionEnabled, error: hookOk ? null : 'hookFailed' };
}

// Wires the global mouse hook into the FSM; false if the native hook failed.
function startSelectionHook() {
  if (runtime.selectionHook || !runtime.selectionEnabled) return true;

  try {
    const { uIOhook } = require('uiohook-napi');

    if (!selectionStateMachine) {
      selectionStateMachine = new SelectionStateMachine();
    }
    selectionStateMachine.reset();

    // uIOhook is a singleton whose .stop() keeps listeners: clear ours first.
    uIOhook.removeAllListeners('mousedown');
    uIOhook.removeAllListeners('mousemove');
    uIOhook.removeAllListeners('mouseup');

    // ----- mousedown -----
    uIOhook.on('mousedown', (e) => {
      if (e.button !== 1) return;

      const cursorPos = screen.getCursorScreenPoint();
      const { x, y } = cursorPos;

      // Coordinate-space check: uiohook event coords vs Electron DIP coords.
      if (SELECTION_DEBUG) {
        const ratio = x > 100 ? (e.x / x) : null;
        const verdict = ratio === null ? 'click further from screen corner and retry'
          : Math.abs(ratio - 1) < 0.05 ? 'SAME coordinate space -> switching to event coords is SAFE'
          : `uiohook is ~${ratio.toFixed(2)}x (physical pixels) -> DO NOT switch, keep getCursorScreenPoint`;
        debugProbe('coords', { uiohook: { x: e.x, y: e.y }, electronDip: { x, y }, verdict });
      }

      // Click inside one of our selection windows: not a gesture.
      if (windowManager.isPointInSelectionWindows(x, y)) {
        runtime.isDraggingOverlay = true;
        return;
      }

      runtime.isDraggingOverlay = false;

      if (isClickInOurWindows(x, y)) {
        return;
      }

      // Keep the trigger through a multi-click (hiding it would flicker).
      const isMultiClick = selectionStateMachine.peekMultiClick(x, y);

      if (!isMultiClick) {
        hideSelectionWindow();
      }

      // Fresh gesture: a cached capture never leaks into the next selection.
      require('./clipboard-capture').invalidateCache();

      gestureWindowSnapshot = require('../platform/native-helper').getForegroundWindowSnapshot();

      // Sticky direct: setting on + CapsLock LED on.
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

        // Mouseup inside our selection window is a click on the trigger.
        if (windows.selection && !windows.selection.isDestroyed() && windows.selection.isVisible()) {
          const bounds = windows.selection.getBounds();
          if (x >= bounds.x && x <= bounds.x + bounds.width &&
              y >= bounds.y && y <= bounds.y + bounds.height) {
            selectionStateMachine.reset();
            return;
          }
        }

        const stickyActive = !!cachedSelectionSettings.stickyViaCapsLock && isCapsLockOn();

        const result = selectionStateMachine.onMouseUp(x, y, stickyActive);

        if (result.shouldShow) {
          // A title-bar drag looks like a fast selection: never probe it.
          if (isWindowDragGesture()) {
            logger.debug('Gesture moved the foreground window (title-bar drag) — skip probe');
            debugProbe('drag', { skipped: 'window-drag gesture' });
            selectionStateMachine.reset();
            return;
          }

          if (result.skipIcon) {
            await handleHotkeyDirectPath(x, y);
            selectionStateMachine.reset();
            return;
          }

          if (result.needsDelayedConfirm) {
            handleDelayedConfirm(x, y);
            return;
          }

          // Normal drag: the three-layer probe (native-helper), then the clipboard.
          const { hasTextSelection } = require('../platform/native-helper');
          const { detectSelectionViaClipboard } = require('./clipboard-capture');
          const selectionCheck = hasTextSelection();
          logger.debug(`Normal drag selection check: ${selectionCheck.hasSelection} (${selectionCheck.method}: ${selectionCheck.reason})`);
          debugProbe('drag', selectionCheck);

          if (selectionCheck.hasSelection === true) {
            showSelectionTrigger(x, y);
            selectionStateMachine.reset();
            return;
          }

          if (selectionCheck.hasSelection === false) {
            logger.debug('Normal drag: no selection detected, skip trigger');
            selectionStateMachine.reset();
            return;
          }

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
  if (selectionStateMachine) {
    selectionStateMachine.reset();
  }

  if (runtime.selectionHook) {
    try {
      // .stop() only halts the native thread; the listeners must go too.
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
        // optional
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
  stopSelectionHook,
  showSelectionWithText,
  showSelectionResult,
  showSelectionLoading,
  hideSelectionLoading,
  preheatSelectionModules,
};
