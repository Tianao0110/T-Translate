// Main process entry — slimmed.
// Window creation lives in managers/window-manager.js.

const {
  app,
  BrowserWindow,
  globalShortcut,
  screen,
} = require('electron');
const path = require('path');

const { store, runtime, windows, isDev } = require('./state');
const { CHANNELS } = require('./shared/channels');
const { initIPC } = require('./ipc');
const { registerAllShortcuts, unregisterAllShortcuts } = require('./ipc/shortcuts');
const { makeWindowInvisibleToCapture, isCapsLockOn } = require('./utils/native-helper');
const { fetchSelectedText } = require('./ipc/selection');
const { SelectionStateMachine, STATES } = require('./utils/selection-state-machine');

let selectionStateMachine = null;
const logger = require('./utils/logger')('Main');

const { createMenu } = require('./managers/menu-manager');
const { createTray, updateTrayMenu, destroyTray } = require('./managers/tray-manager');
const windowManager = require('./managers/window-manager');

const screenshotModule = require('./screenshot-module');

const displayHelper = require('./utils/display-helper');

// ===== Selection translate logic =====

// Cached mirror of settings.selection — electron-store re-reads and re-parses
// the whole settings file from disk on every .get(), too slow for the global
// mousedown/mouseup hot path.
let cachedSelectionSettings = store.get('settings.selection', {});
store.onDidChange('settings.selection', (value) => {
  cachedSelectionSettings = value || {};
});

// Cancellation for in-flight delayed-confirm. Triple-click fires two mouseups
// back-to-back; without this, both confirms race and the first one (still inside
// its 80ms wait) grabs the partial double-click word selection instead of the
// final paragraph one. Newer confirm cancels older.
let pendingConfirmCancel = null;

// Delayed-confirm path for double/triple click. The system needs time to react before
// we can check if text actually got selected.
async function handleDelayedConfirm(x, y, rect) {
  if (pendingConfirmCancel) pendingConfirmCancel();
  let cancelled = false;
  const myCancel = () => { cancelled = true; };
  pendingConfirmCancel = myCancel;

  try {
    const { hasTextSelection, checkSelectionViaClipboard } = require('./utils/native-helper');

    // Wait a beat — double-click selection is async on Windows. Office / Outlook
    // may need longer (toolbars pop up etc.).
    await new Promise(resolve => setTimeout(resolve, 80));

    if (cancelled) {
      logger.debug('Delayed confirm cancelled by newer mouseup (likely triple-click)');
      return;
    }

    // ----- Layer 1+2: clipboard-free probe -----
    const selectionCheck = hasTextSelection();
    logger.debug(`Selection check: ${selectionCheck.hasSelection} (${selectionCheck.method}: ${selectionCheck.reason})`);

    if (selectionCheck.hasSelection === true) {
      logger.debug('Delayed confirm: selection detected via Win32 API (layer 1-2)');
      showSelectionTrigger(x, y, rect);
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

    const clipboardResult = await checkSelectionViaClipboard({ isComplexApp: isOfficeApp });

    if (cancelled) {
      logger.debug('Delayed confirm cancelled mid-clipboard-fetch');
      return;
    }

    if (clipboardResult.hasSelection === true) {
      logger.debug(`Delayed confirm: text selected via clipboard "${clipboardResult.text.substring(0, 20)}..."`);
      showSelectionTrigger(x, y, rect, clipboardResult.text);
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
async function showSelectionTrigger(mouseX, mouseY, rect, prefetchedText = null) {
  logger.debug(`showSelectionTrigger called (prefetched=${prefetchedText ? prefetchedText.length + ' chars' : 'none'})`);

  if (!runtime.selectionEnabled) return;

  const settings = store.get('settings', {});
  const selectionSettings = settings.selection || {};
  const interfaceSettings = settings.interface || {};
  const translationSettings = settings.translation || {};

  runtime.lastSelectionRect = rect;

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
      rect,
      theme: interfaceSettings.theme || 'light',
      settings: {
        triggerTimeout: selectionSettings.triggerTimeout || 4000,
        showSourceByDefault: selectionSettings.showSourceByDefault || false,
        autoCloseOnCopy: selectionSettings.autoCloseOnCopy || false,
        minChars: selectionSettings.minChars || 2,
        maxChars: selectionSettings.maxChars || 500,
        windowOpacity: selectionSettings.windowOpacity || 95,
      },
      translation: {
        targetLanguage: currentTargetLang,
        sourceLanguage: currentSourceLang,
      },
      // v0.2.5 Phase B pass-through — see function docstring.
      text: prefetchedText,
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
async function handleHotkeyDirectPath(x, y, rect) {
  logger.debug('handleHotkeyDirectPath called', { x, y, rect });

  if (!runtime.selectionEnabled) {
    logger.debug('Selection disabled, hotkey silent no-op');
    return;
  }

  const text = await fetchSelectedText();
  if (!text || !text.trim()) {
    logger.debug('Hotkey: no text captured, silent fail (no window opened)');
    return;
  }

  const settings = store.get('settings', {});
  const selectionSettings = settings.selection || {};
  const interfaceSettings = settings.interface || {};
  const translationSettings = settings.translation || {};
  const currentTargetLang = translationSettings.targetLanguage || 'zh';
  const currentSourceLang = translationSettings.sourceLanguage || 'auto';

  runtime.lastSelectionRect = rect;

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

  // SHOW_DIRECT must wait for webContents to be ready, otherwise the message is dropped.
  const sendData = () => {
    win.webContents.send(CHANNELS.SELECTION.SHOW_DIRECT, {
      text: text.trim(),
      theme: interfaceSettings.theme || 'light',
      settings: {
        triggerTimeout: selectionSettings.triggerTimeout || 4000,
        showSourceByDefault: selectionSettings.showSourceByDefault || false,
        autoCloseOnCopy: selectionSettings.autoCloseOnCopy || false,
        minChars: selectionSettings.minChars || 2,
        maxChars: selectionSettings.maxChars || 500,
        windowOpacity: selectionSettings.windowOpacity || 95,
      },
      translation: {
        targetLanguage: currentTargetLang,
        sourceLanguage: currentSourceLang,
      },
    });
    win.show();
  };

  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', sendData);
  } else {
    setTimeout(sendData, 50);
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
function showSelectionWithText(text) {
  const win = runtime.screenshotSelectionWindow;

  if (!win || win.isDestroyed()) {
    logger.warn('No selection window to send text to');
    return;
  }

  logger.debug('Sending OCR text to selection window');

  const settings = store.get('settings', {});
  const interfaceSettings = settings.interface || {};
  const selectionSettings = settings.selection || {};
  const translationSettings = settings.translation || {};

  const currentTargetLang = translationSettings.targetLanguage || 'zh';

  win.webContents.send(CHANNELS.SELECTION.SHOW_RESULT, {
    text: text,  // Mode 2: text only, renderer translates.
    targetLanguage: currentTargetLang,
    theme: interfaceSettings.theme || 'light',
    settings: {
      windowOpacity: selectionSettings.windowOpacity || 95,
      autoCloseOnCopy: selectionSettings.autoCloseOnCopy || false,
    },
  });
}

// Show result directly (Mode 3): already-translated text. Used for OCR-failure paths
// where the renderer should display content (or an error) without translating again.
function showSelectionResult(data) {
  const win = runtime.screenshotSelectionWindow;

  if (!win || win.isDestroyed()) {
    logger.warn('No selection window to show result');
    return;
  }

  const settings = store.get('settings', {});
  const interfaceSettings = settings.interface || {};
  const selectionSettings = settings.selection || {};

  win.webContents.send(CHANNELS.SELECTION.SHOW_RESULT, {
    sourceText: data.sourceText || '',
    translatedText: data.translatedText || '',
    isOcrError: data.isOcrError === true,
    theme: interfaceSettings.theme || 'light',
    settings: {
      windowOpacity: selectionSettings.windowOpacity || 95,
      autoCloseOnCopy: selectionSettings.autoCloseOnCopy || false,
    },
  });
}

// Close the screenshot-OCR loading window. If errorMsg is provided, show it for 4s first.
function hideSelectionLoading(errorMsg) {
  const win = runtime.screenshotSelectionWindow;

  if (win && !win.isDestroyed()) {
    if (errorMsg) {
      win.webContents.send(CHANNELS.SELECTION.SHOW_RESULT, {
        sourceText: '',
        translatedText: '',
        error: errorMsg,
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
  const selectionSettings = settings.selection || {};

  const win = windowManager.createSelectionWindow();
  runtime.screenshotSelectionWindow = win;

  // Position at the bottom-right of the captured screenshot area.
  let posX = bounds.x + bounds.width + 10;
  let posY = bounds.y + bounds.height + 10;

  const display = screen.getDisplayNearestPoint({ x: posX, y: posY });
  const screenBounds = display.bounds;
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
      settings: { windowOpacity: selectionSettings.windowOpacity || 95 },
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

  updateTrayMenu();

  if (!runtime.selectionEnabled) {
    hideSelectionWindow();
    stopSelectionHook();
  } else {
    startSelectionHook();
  }

  windows.main?.webContents?.send(CHANNELS.SELECTION.STATE_CHANGED, runtime.selectionEnabled);
  logger.info('Selection translate:', runtime.selectionEnabled ? 'enabled' : 'disabled');
  return runtime.selectionEnabled;
}

// Wire the global mouse hook (uIOhook) and route mousedown/move/up into the FSM.
function startSelectionHook() {
  if (runtime.selectionHook || !runtime.selectionEnabled) return;

  try {
    const { uIOhook } = require('uiohook-napi');

    if (!selectionStateMachine) {
      selectionStateMachine = new SelectionStateMachine();
    }
    selectionStateMachine.reset();

    // ----- mousedown -----
    uIOhook.on('mousedown', (e) => {
      if (e.button !== 1) return; // Left button only.

      const cursorPos = screen.getCursorScreenPoint();
      const { x, y } = cursorPos;

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
          const rect = result.rect || {
            x: x - 50,
            y: y - 20,
            width: 100,
            height: 40,
          };

          // Sticky direct: skip the icon, skip Layer 1+2 probe, go straight to capture + translate.
          if (result.skipIcon) {
            await handleHotkeyDirectPath(x, y, rect);
            selectionStateMachine.reset();
            return;
          }

          // Multi-click: needs delayed confirm (system selects text async after the click).
          if (result.needsDelayedConfirm) {
            handleDelayedConfirm(x, y, rect);
            return;
          }

          // Normal drag: run the three-layer selection probe.
          const { hasTextSelection, checkSelectionViaClipboard } = require('./utils/native-helper');
          const selectionCheck = hasTextSelection();
          logger.debug(`Normal drag selection check: ${selectionCheck.hasSelection} (${selectionCheck.method}: ${selectionCheck.reason})`);

          if (selectionCheck.hasSelection === true) {
            // Layer 1+2 confirmed selection.
            showSelectionTrigger(x, y, rect);
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
          const clipboardResult = await checkSelectionViaClipboard({ isComplexApp: isOfficeApp });

          if (clipboardResult.hasSelection === true) {
            showSelectionTrigger(x, y, rect, clipboardResult.text);
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
  } catch (err) {
    logger.error('Failed to start selection hook:', err.message);
    runtime.selectionEnabled = false;
    store.set('selectionEnabled', false);
    updateTrayMenu();
  }
}

function stopSelectionHook() {
  // Reset state machine first (clears timers).
  if (selectionStateMachine) {
    selectionStateMachine.reset();
  }

  if (runtime.selectionHook) {
    try {
      runtime.selectionHook.stop();
      runtime.selectionHook = null;
      logger.info('Selection hook stopped');
    } catch (err) {
      logger.error('Failed to stop selection hook:', err);
    }
  }
}

function isClickInOurWindows(x, y) {
  const windowsToCheck = [windows.main, windows.floatingWindow];
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

// ===== Screenshot =====

async function startScreenshot(fromHotkey = false) {
  if (windows.screenshot) {
    windows.screenshot.close();
    windows.screenshot = null;
  }

  runtime.screenshotFromHotkey = fromHotkey;
  runtime.wasMainWindowVisible = windows.main && windows.main.isVisible();

  logger.info('Starting screenshot, fromHotkey:', fromHotkey);

  if (runtime.wasMainWindowVisible) {
    windows.main.hide();
  }

  await new Promise(resolve => setTimeout(resolve, 300));

  // Span all displays — compute the union bounding box.
  const displays = screen.getAllDisplays();
  const primaryDisplay = screen.getPrimaryDisplay();

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let maxScaleFactor = 1;

  displays.forEach(display => {
    minX = Math.min(minX, display.bounds.x);
    minY = Math.min(minY, display.bounds.y);
    maxX = Math.max(maxX, display.bounds.x + display.bounds.width);
    maxY = Math.max(maxY, display.bounds.y + display.bounds.height);
    maxScaleFactor = Math.max(maxScaleFactor, display.scaleFactor);
  });

  const totalWidth = maxX - minX;
  const totalHeight = maxY - minY;
  const totalBounds = { minX, minY, maxX, maxY, totalWidth, totalHeight };

  // Prefer node-screenshots (faster) and fall back to Electron's desktopCapturer.
  let screenshotData = null;
  if (screenshotModule.isNodeScreenshotsAvailable()) {
    screenshotData = await screenshotModule.captureWithNodeScreenshots(displays, totalBounds);
  }
  if (!screenshotData) {
    screenshotData = await screenshotModule.captureWithDesktopCapturer(
      displays, primaryDisplay, totalBounds, maxScaleFactor
    );
  }

  if (screenshotData) {
    screenshotModule.setScreenshotData(screenshotData);
    runtime.screenshotData = screenshotData;
  } else {
    logger.error('Failed to capture screenshot');
    return null;
  }

  // ESC cancels the screenshot selection.
  globalShortcut.register('Escape', () => {
    if (windows.screenshot) {
      windows.screenshot.close();
      windows.screenshot = null;
    }
    screenshotModule.clearScreenshotData();
    runtime.screenshotData = null;

    if (!runtime.screenshotFromHotkey && runtime.wasMainWindowVisible && windows.main) {
      windows.main.show();
      windows.main.focus();
    }

    runtime.wasMainWindowVisible = false;
    runtime.screenshotFromHotkey = false;
    globalShortcut.unregister('Escape');
  });

  const screenshotWindow = windowManager.createScreenshotWindow(totalBounds);

  screenshotWindow.webContents.on('did-finish-load', () => {
    screenshotWindow.webContents.send(CHANNELS.SCREENSHOT.SCREEN_BOUNDS, { minX, minY, maxX, maxY });

    let showConfirmButtons = true;
    try {
      const settings = store.get('settings');
      if (settings?.screenshot?.showConfirmButtons !== undefined) {
        showConfirmButtons = settings.screenshot.showConfirmButtons;
      }
    } catch (e) {}

    screenshotWindow.webContents.send(CHANNELS.SCREENSHOT.CONFIG, { showConfirmButtons });
    screenshotWindow.focus();
    screenshotWindow.webContents.focus();
  });

  screenshotWindow.on('closed', () => {
    try { globalShortcut.unregister('Escape'); } catch (e) {}
  });

  return screenshotData;
}

async function handleScreenshotSelection(bounds) {
  logger.info('Handling screenshot selection:', bounds);

  try { globalShortcut.unregister('Escape'); } catch (e) {}

  try {
    if (windows.screenshot) {
      windows.screenshot.close();
      windows.screenshot = null;
    }

    const data = screenshotModule.getScreenshotData() || runtime.screenshotData;
    if (!data) {
      throw new Error('No screenshot data available');
    }

    let dataURL;
    if (data.type === 'node-screenshots') {
      dataURL = screenshotModule.processSelection(bounds);
    } else {
      dataURL = processDesktopCapturerSelection(data, bounds);
    }

    // Save screenshot position for chaining into the selection-translate window.
    runtime.lastScreenshotBounds = {
      x: bounds.x + bounds.width,
      y: bounds.y + bounds.height,
      centerX: bounds.x + bounds.width / 2,
      centerY: bounds.y + bounds.height / 2,
      timestamp: Date.now(),
    };
    logger.debug('Screenshot position saved:', runtime.lastScreenshotBounds);

    runtime.screenshotData = null;
    screenshotModule.clearScreenshotData();
    runtime.screenshotFromHotkey = false;

    const settings = store.get('settings', {});
    const screenshotSettings = settings.screenshot || {};
    const outputMode = screenshotSettings.outputMode || 'bubble';

    if (outputMode === 'main') {
      // Main-window mode: show main window and hand off the captured dataURL.
      runtime.wasMainWindowVisible = false;
      if (windows.main) {
        windows.main.show();
        windows.main.focus();
      }
      await new Promise(resolve => setTimeout(resolve, 100));
      if (windows.main && dataURL) {
        windows.main.webContents.send(CHANNELS.SCREENSHOT.CAPTURED, dataURL);
      }
    } else {
      // Bubble mode: background-process the screenshot, no main-window show.
      logger.info('Screenshot bubble mode: processing in background');

      await showSelectionLoading(bounds);

      // Make sure main window is loaded for background processing — but force it
      // hidden so ready-to-show doesn't pop it visible.
      if (!windows.main) {
        windowManager.createMainWindow();
        await new Promise(resolve => setTimeout(resolve, 500));
        if (windows.main && !windows.main.isDestroyed()) {
          windows.main.hide();
        }
      }

      if (windows.main && dataURL) {
        // String literal (not constant) for cross-version compat.
        windows.main.webContents.send('screenshot-captured-silent', dataURL);
      }
    }

    return dataURL;
  } catch (error) {
    logger.error('Screenshot selection error:', error);

    runtime.screenshotData = null;
    screenshotModule.clearScreenshotData();
    runtime.wasMainWindowVisible = false;
    runtime.screenshotFromHotkey = false;

    if (windows.main && runtime.wasMainWindowVisible) {
      windows.main.show();
      windows.main.focus();
    }

    return null;
  }
}

// Crop the captured desktopCapturer thumbnail to the user's selected rect.
// Coordinates are translated from screen-space to thumbnail-space via scale factors.
function processDesktopCapturerSelection(data, bounds) {
  const { sources, totalBounds } = data;

  if (!sources || sources.length === 0) {
    throw new Error('No screenshot sources available');
  }

  const fullScreenshot = sources[0].thumbnail;
  const screenshotSize = fullScreenshot.getSize();

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

  cropBounds.x = Math.max(0, Math.min(cropBounds.x, screenshotSize.width - 1));
  cropBounds.y = Math.max(0, Math.min(cropBounds.y, screenshotSize.height - 1));
  cropBounds.width = Math.max(1, Math.min(cropBounds.width, screenshotSize.width - cropBounds.x));
  cropBounds.height = Math.max(1, Math.min(cropBounds.height, screenshotSize.height - cropBounds.y));

  const croppedImage = fullScreenshot.crop(cropBounds);
  return croppedImage.toDataURL();
}

// ===== App lifecycle =====

app.whenReady().then(() => {
  logger.info('App ready, initializing...');

  // Auto-launch mode: --startup flag means started by OS, run silent.
  const isStartup = process.argv.includes('--startup');
  if (isStartup) {
    logger.info('Started via auto-launch, running in silent mode');
    store.set('startMinimized', true);
  }

  logger.info('Displays:', displayHelper.getDisplaySummary());

  // React to display add/remove: when a monitor disconnects, reposition windows
  // that were on it back to a valid display.
  displayHelper.onDisplayChange((eventType, display) => {
    logger.info(`Display ${eventType}:`, display?.id, displayHelper.getDisplaySummary());

    if (eventType === 'removed') {
      if (windows.main && !windows.main.isDestroyed()) {
        const bounds = windows.main.getBounds();
        const validBounds = displayHelper.ensureBoundsOnDisplay(bounds);
        if (validBounds.adjusted) {
          logger.info('Main window moved to valid display');
          windows.main.setBounds(validBounds);
        }
      }
      if (windows.floatingWindow && !windows.floatingWindow.isDestroyed()) {
        const bounds = windows.floatingWindow.getBounds();
        const validBounds = displayHelper.ensureBoundsOnDisplay(bounds);
        if (validBounds.adjusted) {
          logger.info('Floating window moved to valid display');
          windows.floatingWindow.setBounds(validBounds);
        }
      }
    }
  });

  windowManager.init({
    store,
    runtime,
    windows,
    isDev,
    logger,
    makeWindowInvisibleToCapture,
    CHANNELS,
  });

  // Use arrow-function wrappers so we don't capture windowManager methods at
  // declaration time (which would freeze them to the initial — possibly null — state).
  const managers = {
    startScreenshot,
    handleScreenshotSelection,
    showSelectionWithText,
    showSelectionResult,
    hideSelectionLoading,
    toggleFloatingWindow: (...args) => windowManager.toggleFloatingWindow(...args),
    createFloatingWindow: (...args) => windowManager.createFloatingWindow(...args),
    toggleSelectionTranslate,
    toggleSubtitleCaptureWindow: (...args) => windowManager.toggleSubtitleCaptureWindow(...args),
  };

  // IPC must be initialized BEFORE any window is created — otherwise renderer may
  // call IPC handlers that haven't been registered yet.
  initIPC({
    windows,
    runtime,
    store,
    app,
    managers,
  });

  windowManager.createMainWindow();

  const ctx = {
    getMainWindow: () => windows.main,
    runtime,
    store,
    managers,
  };

  createMenu(ctx);
  createTray(ctx);

  const failedShortcuts = registerAllShortcuts({
    store,
    getMainWindow: () => windows.main,
    managers,
  });

  if (failedShortcuts.length > 0 && windows.main) {
    windows.main.webContents.once('did-finish-load', () => {
      windows.main.webContents.send('shortcut-conflict', failedShortcuts);
    });
  }

  // Selection translate is off by default — user opts in.
  runtime.selectionEnabled = false;
  store.set('selectionEnabled', false);

  // Memory monitor; trigger GC if heap exceeds 500MB and gc is exposed.
  runtime.memoryMonitorInterval = setInterval(() => {
    const usage = process.memoryUsage();
    const heapUsedMB = Math.round(usage.heapUsed / 1024 / 1024);
    logger.debug(`Memory: ${heapUsedMB}MB`);
    if (heapUsedMB > 500 && global.gc) {
      logger.info('Running garbage collection...');
      global.gc();
    }
  }, 5 * 60 * 1000);

  logger.success('App initialized');

  // Pre-warm selection-translate modules in the background. Longer delay on
  // auto-launch so we don't impact OS boot performance.
  const preheatDelay = isStartup ? 8000 : 3000;
  setTimeout(() => {
    preheatSelectionModules();

    // Auto-launch + user opt-in: enable selection translate after preheat.
    if (isStartup && store.get('settings.startup.autoEnableSelection')) {
      logger.info('Auto-enabling selection translate after startup');
      toggleSelectionTranslate();
    }

    if (isStartup) {
      store.set('startMinimized', false);
    }
  }, preheatDelay);
});

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
      const { SelectionStateMachine } = require('./utils/selection-state-machine');
      selectionStateMachine = new SelectionStateMachine();
      logger.debug('SelectionStateMachine preheated');
    }

    logger.success('Selection modules preheated');
  } catch (err) {
    logger.warn('Preheat failed (non-critical):', err.message);
  }
}

// Global exception handlers — make sure the native hook stops so the process can exit.

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error);
  try { stopSelectionHook(); } catch (e) { /* ignore */ }
});

process.on('unhandledRejection', (reason, promise) => {
  // Print details — bare `{}` rejections are unhelpful otherwise.
  if (reason instanceof Error) {
    logger.error('Unhandled rejection:', reason.message);
    logger.error('Stack:', reason.stack);
  } else {
    try {
      logger.error('Unhandled rejection:', JSON.stringify(reason, null, 2));
    } catch {
      logger.error('Unhandled rejection:', reason);
    }
  }
});

process.on('SIGINT', () => {
  logger.info('Received SIGINT, quitting...');
  runtime.isQuitting = true;
  try { stopSelectionHook(); } catch (e) { /* ignore */ }
  app.quit();
});

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM, quitting...');
  runtime.isQuitting = true;
  try { stopSelectionHook(); } catch (e) { /* ignore */ }
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    windowManager.createMainWindow();
  } else {
    windows.main?.show();
  }
});

// before-quit: stop native hooks first so we don't get callbacks during window destroy.
app.on('before-quit', () => {
  runtime.isQuitting = true;

  stopSelectionHook();

  const allWindows = BrowserWindow.getAllWindows();
  allWindows.forEach(win => {
    if (win && !win.isDestroyed()) {
      win.removeAllListeners('close');
      win.destroy();
    }
  });
});

app.on('will-quit', () => {
  if (runtime.memoryMonitorInterval) {
    clearInterval(runtime.memoryMonitorInterval);
    runtime.memoryMonitorInterval = null;
  }

  unregisterAllShortcuts();

  // Belt-and-suspenders — before-quit already calls this, but in case before-quit
  // was skipped (race during force-close), make sure the native hook is stopped.
  try { stopSelectionHook(); } catch (e) { /* ignore */ }

  destroyTray();

  logger.info('App cleanup completed');

  // Last-resort exit: if uiohook's native thread keeps the process alive >5s, force.
  setTimeout(() => {
    logger.warn('Force exit: process still alive after 5s');
    process.exit(0);
  }, 5000).unref();
});

// Single-instance lock.
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (windows.main) {
      if (windows.main.isMinimized()) windows.main.restore();
      windows.main.focus();
    }
  });
}
