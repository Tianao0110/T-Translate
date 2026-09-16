// The four windows: main, floating overlay, selection (with frozen cards)
// and the screenshot overlay. Deps injected via init(); every window goes
// through hardenWebContents. Behaviour notes: docs/design/main-process.md §5.

const { BrowserWindow, shell } = require('electron');
const PATHS = require('../shared/paths');
const displayHelper = require('../platform/display-helper');
const { isInternalUrl, mayOpenExternally } = require('../security/url-policy');

let store = null;
let runtime = null;
let windows = null;
let isDev = false;
let logger = null;
let makeWindowInvisibleToCapture = null;
let crashGuard = null;
let onMainRendererGiveUp = null;

const frozenSelectionWindows = new Map();
let selectionWindowIdCounter = 0;
const MAX_FROZEN_WINDOWS = 8;

function init(deps) {
  store = deps.store;
  runtime = deps.runtime;
  windows = deps.windows;
  isDev = deps.isDev;
  logger = deps.logger || console;
  makeWindowInvisibleToCapture = deps.makeWindowInvisibleToCapture || (() => {});
  crashGuard = deps.crashGuard || null;
  onMainRendererGiveUp = deps.onMainRendererGiveUp || null;

  logger.info?.('Window manager initialized') || console.log('Window manager initialized');
}

// Navigation + window.open policy (security/url-policy.js) for every window.
function hardenWebContents(win, name) {
  win.webContents.on('will-navigate', (event, url) => {
    if (isInternalUrl(url, isDev)) return;
    event.preventDefault();
    logger.warn?.(`${name}: blocked navigation to external URL`);
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (mayOpenExternally(url)) {
      shell.openExternal(url);
    } else {
      logger.warn?.(`${name}: blocked window.open to a non-http URL`);
    }
    return { action: 'deny' };
  });
}

// ===== Main window =====

function createMainWindow() {
  if (windows.main) {
    windows.main.focus();
    return windows.main;
  }

  const windowBounds = store.get('windowBounds');
  const windowPosition = displayHelper.normalizeWindowPosition(store.get('windowPosition'));

  const savedBounds = {
    width: windowBounds.width,
    height: windowBounds.height,
    x: windowPosition.x,
    y: windowPosition.y,
  };

  const validBounds = displayHelper.ensureBoundsOnDisplay(savedBounds, {
    minVisiblePixels: 100,
    centerOnInvalid: true,
  });

  if (validBounds.adjusted) {
    logger?.info?.('Main window position adjusted to valid display');
  }

  const mainWindow = new BrowserWindow({
    width: validBounds.width,
    height: validBounds.height,
    x: validBounds.x,
    y: validBounds.y,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: PATHS.preloads.main,
    },
    autoHideMenuBar: true,
    menuBarVisible: false,
    icon: PATHS.resources.icon,
    frame: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    show: false,
    backgroundColor: '#ffffff',
    alwaysOnTop: store.get('alwaysOnTop', false),
  });

  mainWindow.removeMenu();

  if (isDev) {
    mainWindow.loadURL(PATHS.pages.main.url);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(PATHS.pages.main.file);
  }

  mainWindow.once('ready-to-show', () => {
    if (!store.get('startMinimized')) {
      mainWindow.show();
    }
  });

  mainWindow.on('resize', () => {
    if (!mainWindow.isMaximized()) {
      store.set('windowBounds', mainWindow.getBounds());
    }
  });

  mainWindow.on('move', () => {
    if (!mainWindow.isMaximized()) {
      const [x, y] = mainWindow.getPosition();
      store.set('windowPosition', { x, y });
    }
  });

  mainWindow.on('maximize', () => {
    mainWindow.webContents.send('maximize-change', true);
  });

  mainWindow.on('unmaximize', () => {
    mainWindow.webContents.send('maximize-change', false);
  });

  // Close hides; the tray's quit sets isQuitting.
  mainWindow.on('close', (event) => {
    if (!runtime.isQuitting && process.platform !== 'darwin') {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    windows.main = null;
  });

  hardenWebContents(mainWindow, 'Main window');

  // Renderer self-heal (crash-guard); past the limit main.js relaunches into safe mode.
  crashGuard?.attachRendererRecovery(mainWindow, {
    name: 'Main window',
    isQuitting: () => runtime.isQuitting,
    onGiveUp: (details) => onMainRendererGiveUp?.(details),
  });

  windows.main = mainWindow;
  logger.info?.('Main window created');
  return mainWindow;
}

// ===== Floating window =====

function createFloatingWindow() {
  if (windows.floatingWindow) {
    windows.floatingWindow.focus();
    return windows.floatingWindow;
  }

  const savedBounds = store.get('floatingWindowBounds', {
    width: 400,
    height: 200,
    x: undefined,
    y: undefined,
  });

  const floatingWindowBounds = displayHelper.ensureBoundsOnDisplay(savedBounds, {
    minVisiblePixels: 100,
    centerOnInvalid: true,
  });

  if (floatingWindowBounds.adjusted) {
    logger?.info?.('Floating window position adjusted to valid display');
  }

  const floatingWindow = new BrowserWindow({
    width: floatingWindowBounds.width,
    height: floatingWindowBounds.height,
    x: floatingWindowBounds.x,
    y: floatingWindowBounds.y,
    minWidth: 150,
    minHeight: 80,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    resizable: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: PATHS.preloads.floatingWindow,
      backgroundThrottling: false, // the refresh loop must run while unfocused
    },
  });

  // Hidden from capture so OCR never reads our own overlay, unless opted in.
  if (process.platform === 'win32') {
    floatingWindow.webContents.on('did-finish-load', () => {
      const captureVisible = !!store.get('settings.floatingWindow.captureVisible', false);
      if (!captureVisible) makeWindowInvisibleToCapture(floatingWindow);
    });
  }

  if (isDev) {
    floatingWindow.loadURL(PATHS.pages.floatingWindow.url);
  } else {
    floatingWindow.loadFile(PATHS.pages.floatingWindow.file);
  }

  // Debounced persist: the title-bar drag fires 'moved' per frame.
  let persistBoundsTimer = null;
  const persistBounds = () => {
    if (persistBoundsTimer) clearTimeout(persistBoundsTimer);
    persistBoundsTimer = setTimeout(() => {
      persistBoundsTimer = null;
      if (floatingWindow && !floatingWindow.isDestroyed()) {
        store.set('floatingWindowBounds', floatingWindow.getBounds());
      }
    }, 300);
  };

  floatingWindow.on('moved', persistBounds);
  floatingWindow.on('resized', persistBounds);

  floatingWindow.on('closed', () => {
    windows.floatingWindow = null;
    // Detached panes are orphans without their parent: reap them.
    try {
      require('../ipc/floating-window').closeAllChildPaneWindows();
    } catch (e) {
      logger.warn?.('Failed to close child panes with floating window:', e.message);
    }
  });

  // Windows can drop the alwaysOnTop z-order on blur: re-apply at 'floating' level.
  floatingWindow.on('blur', () => {
    if (floatingWindow.isDestroyed()) return;
    if (floatingWindow.isAlwaysOnTop()) {
      floatingWindow.setAlwaysOnTop(false);
      floatingWindow.setAlwaysOnTop(true);
    }
  });

  // ESC / Space are the renderer's (FloatingWindow keydown), on purpose.
  // Renderer self-heal: an auxiliary window closes instead of relaunching the app.
  crashGuard?.attachRendererRecovery(floatingWindow, {
    name: 'Floating window',
    isQuitting: () => runtime.isQuitting,
    onGiveUp: () => {
      try { floatingWindow.destroy(); } catch { /* already gone */ }
    },
  });

  hardenWebContents(floatingWindow, 'Floating window');

  windows.floatingWindow = floatingWindow;
  logger.info?.('Floating window created');
  return floatingWindow;
}

function toggleFloatingWindow() {
  if (windows.floatingWindow) {
    if (windows.floatingWindow.isVisible()) {
      windows.floatingWindow.close();
    } else {
      windows.floatingWindow.show();
      windows.floatingWindow.focus();
    }
  } else {
    createFloatingWindow();
  }
}

// ===== Selection translate windows =====
// One active window, hidden between selections; a frozen card leaves the
// active slot so the next selection gets a fresh one.

function createSelectionWindow() {
  if (windows.selection && !windows.selection.isDestroyed()) {
    const isFrozen = windows.selection._isFrozen;
    if (!isFrozen) {
      // A hide()-not-close window can outlive its renderer: recreate it then.
      if (windows.selection._rendererDead || windows.selection.webContents.isCrashed()) {
        logger.warn?.(`Selection window ${windows.selection._windowId} renderer dead — recreating`);
        try { windows.selection.destroy(); } catch { /* already gone */ }
        windows.selection = null;
      } else {
        return windows.selection;
      }
    }
  }

  const windowId = ++selectionWindowIdCounter;

  const selectionWindow = new BrowserWindow({
    width: 450,
    height: 200,
    show: false,
    frame: false,
    transparent: true,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    webPreferences: {
      preload: PATHS.preloads.selection,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  selectionWindow._windowId = windowId;
  selectionWindow._isFrozen = false;

  // 'floating' level, like the overlay; never 'screen-saver'.
  selectionWindow.setAlwaysOnTop(true, 'floating');
  selectionWindow.setIgnoreMouseEvents(false);

  if (isDev) {
    selectionWindow.loadURL(PATHS.pages.selection.url);
  } else {
    selectionWindow.loadFile(PATHS.pages.selection.file);
  }

  // Renderer-death markers for the recreate above.
  selectionWindow.webContents.on('render-process-gone', (event, details) => {
    logger.warn?.(`Selection window ${windowId} renderer gone: ${details?.reason || 'unknown'}`);
    selectionWindow._rendererDead = true;
  });
  // Only a real main-frame load failure counts; -3 (aborted) and subframes do not.
  selectionWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return;
    logger.warn?.(`Selection window ${windowId} main-frame load failed: ${errorCode} ${errorDescription}`);
    selectionWindow._rendererDead = true;
  });

  selectionWindow.on('closed', () => {
    if (selectionWindow._isFrozen) {
      frozenSelectionWindows.delete(selectionWindow._windowId);
      logger.debug?.(`Frozen selection window ${selectionWindow._windowId} closed, remaining: ${frozenSelectionWindows.size}`);
    }
    if (windows.selection === selectionWindow) {
      windows.selection = null;
    }
  });

  hardenWebContents(selectionWindow, 'Selection window');

  windows.selection = selectionWindow;
  logger.debug?.(`Selection window ${windowId} created`);
  return selectionWindow;
}

function freezeSelectionWindow() {
  const currentWindow = windows.selection;
  if (!currentWindow || currentWindow.isDestroyed()) {
    return { success: false, error: 'No active window' };
  }

  if (currentWindow._isFrozen) {
    return { success: false, error: 'Already frozen' };
  }

  // At capacity: refuse; the caller surfaces a hint.
  if (frozenSelectionWindows.size >= MAX_FROZEN_WINDOWS) {
    logger.debug?.(`Freeze refused: at limit (${MAX_FROZEN_WINDOWS})`);
    return { success: false, error: 'limit', frozenCount: frozenSelectionWindows.size };
  }

  currentWindow._isFrozen = true;
  frozenSelectionWindows.set(currentWindow._windowId, currentWindow);

  windows.selection = null;

  logger.info?.(`Selection window ${currentWindow._windowId} frozen, total frozen: ${frozenSelectionWindows.size}`);

  return {
    success: true,
    windowId: currentWindow._windowId,
    frozenCount: frozenSelectionWindows.size
  };
}

function closeFrozenSelectionWindow(windowId) {
  const frozenWindow = frozenSelectionWindows.get(windowId);
  if (frozenWindow && !frozenWindow.isDestroyed()) {
    frozenWindow.close();
    return { success: true };
  }
  return { success: false, error: 'Window not found' };
}

// ===== Screenshot window =====

function createScreenshotWindow(bounds) {
  if (windows.screenshot) {
    windows.screenshot.close();
    windows.screenshot = null;
  }

  const { minX, minY, totalWidth, totalHeight } = bounds;

  const screenshotWindow = new BrowserWindow({
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
    enableLargerThanScreen: true,
    webPreferences: {
      preload: PATHS.preloads.screenshot,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  screenshotWindow.setBounds({ x: minX, y: minY, width: totalWidth, height: totalHeight });
  screenshotWindow.loadFile(PATHS.pages.screenshot.file);
  screenshotWindow.setAlwaysOnTop(true, 'screen-saver');
  screenshotWindow.focus();

  screenshotWindow.on('closed', () => {
    windows.screenshot = null;
  });

  hardenWebContents(screenshotWindow, 'Screenshot window');

  windows.screenshot = screenshotWindow;
  logger.info?.('Screenshot window created');
  return screenshotWindow;
}

// Hit-test against the active and every frozen selection window (mouse hook).
function isPointInSelectionWindows(x, y) {
  if (windows.selection && !windows.selection.isDestroyed() && windows.selection.isVisible()) {
    const bounds = windows.selection.getBounds();
    if (x >= bounds.x && x <= bounds.x + bounds.width &&
        y >= bounds.y && y <= bounds.y + bounds.height) {
      return true;
    }
  }

  for (const [id, win] of frozenSelectionWindows) {
    if (win && !win.isDestroyed() && win.isVisible()) {
      const bounds = win.getBounds();
      if (x >= bounds.x && x <= bounds.x + bounds.width &&
          y >= bounds.y && y <= bounds.y + bounds.height) {
        return true;
      }
    }
  }

  return false;
}

module.exports = {
  isPointInSelectionWindows,
  init,
  createMainWindow,
  createFloatingWindow,
  createSelectionWindow,
  createScreenshotWindow,
  toggleFloatingWindow,
  freezeSelectionWindow,
  closeFrozenSelectionWindow,
};
