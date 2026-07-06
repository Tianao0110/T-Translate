// Window manager: main, floating window, selection (with freeze-multi support),
// and screenshot windows. Deps injected via init() to avoid require cycles.

const { BrowserWindow, shell } = require('electron');
const path = require('path');
const PATHS = require('../shared/paths');
const displayHelper = require('../utils/display-helper');

let store = null;
let runtime = null;
let windows = null;
let isDev = false;
let logger = null;
let makeWindowInvisibleToCapture = null;
let CHANNELS = null;

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
  CHANNELS = deps.CHANNELS || {};

  logger.info?.('Window manager initialized') || console.log('Window manager initialized');
}

// ===== Main window =====

function createMainWindow() {
  if (windows.main) {
    windows.main.focus();
    return windows.main;
  }

  const windowBounds = store.get('windowBounds');
  const windowPosition = store.get('windowPosition');

  const savedBounds = {
    width: windowBounds.width,
    height: windowBounds.height,
    x: windowPosition?.x,
    y: windowPosition?.y,
  };

  // Guard against orphaned positions when a monitor is unplugged
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
      webSecurity: false,
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
      store.set('windowPosition', mainWindow.getPosition());
    }
  });

  mainWindow.on('maximize', () => {
    mainWindow.webContents.send('maximize-change', true);
  });

  mainWindow.on('unmaximize', () => {
    mainWindow.webContents.send('maximize-change', false);
  });

  // Hide instead of quit on close — let tray do final quit via isQuitting flag
  mainWindow.on('close', (event) => {
    if (!runtime.isQuitting && process.platform !== 'darwin') {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    windows.main = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
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
      backgroundThrottling: false, // floating-window refresh must run while unfocused
      webSecurity: false, // allow cross-origin (e.g. Google Translate)
    },
  });

  // WDA_EXCLUDEFROMCAPTURE so OCR doesn't re-read our own overlay
  if (process.platform === 'win32') {
    floatingWindow.webContents.on('did-finish-load', () => {
      makeWindowInvisibleToCapture(floatingWindow);
    });
  }

  if (isDev) {
    floatingWindow.loadURL(PATHS.pages.floatingWindow.url);
  } else {
    floatingWindow.loadFile(PATHS.pages.floatingWindow.file);
  }

  // Debounced persist: the manual title-bar drag streams setBounds per frame,
  // and each one fires 'moved' — writing electron-store (synchronous disk IO)
  // 60×/s would jank the drag. Trailing write after the movement settles.
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
    // Detached panes are alwaysOnTop orphans without their parent — reap them
    // on every close path (ESC, tray toggle, IPC), not just the X button.
    try {
      require('../ipc/floating-window').closeAllChildPaneWindows();
    } catch (e) {
      logger.warn?.('Failed to close child panes with floating window:', e.message);
    }
  });

  // Electron on Windows can drop alwaysOnTop z-order when focus moves away.
  // Re-apply on blur — keep default 'floating' level (no second arg), do NOT
  // elevate to 'screen-saver' which would clobber the user's other pinned tools.
  floatingWindow.on('blur', () => {
    if (floatingWindow.isDestroyed()) return;
    if (floatingWindow.isAlwaysOnTop()) {
      floatingWindow.setAlwaysOnTop(false);
      floatingWindow.setAlwaysOnTop(true);
    }
  });

  // ESC and Space are handled in the renderer (FloatingWindow keydown), which
  // knows the UI priority order (history panel > scattered panes > close) and
  // runs child-window cleanup. A main-process before-input-event shortcut here
  // would bypass all of that — deliberately absent.

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

// ===== Selection translate windows (freeze-to-multi pattern) =====
// Active window gets replaced on each selection. User can "freeze" the current
// window to detach it into the pool, so the next selection spawns a fresh one.

function createSelectionWindow() {
  if (windows.selection && !windows.selection.isDestroyed()) {
    const isFrozen = windows.selection._isFrozen;
    if (!isFrozen) {
      // A persistent hide()-not-close window can outlive its renderer (crash,
      // dev-server restart mid-session). Reusing it then means every trigger
      // icon and result card goes to an invisible corpse — transparent +
      // frameless + dead renderer paints nothing and raises nothing. Recreate.
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
      webSecurity: false,
    },
  });

  selectionWindow._windowId = windowId;
  selectionWindow._isFrozen = false;

  // 'floating' (not 'screen-saver'): a frozen card can live for a long time, and
  // screen-saver level would sit above the user's own pinned tools. Same rule as
  // the floating-window overlay.
  selectionWindow.setAlwaysOnTop(true, 'floating');
  selectionWindow.setIgnoreMouseEvents(false);

  if (isDev) {
    selectionWindow.loadURL(PATHS.pages.selection.url);
  } else {
    selectionWindow.loadFile(PATHS.pages.selection.file);
  }

  // Renderer-death markers for the self-heal above. warn (not debug) so a
  // field log shows exactly when and why the window went dark.
  selectionWindow.webContents.on('render-process-gone', (event, details) => {
    logger.warn?.(`Selection window ${windowId} renderer gone: ${details?.reason || 'unknown'}`);
    selectionWindow._rendererDead = true;
  });
  // ONLY a real main-frame load failure means a dead renderer. did-fail-load
  // also fires for aborted loads (errorCode -3, e.g. a dev-server HMR reload)
  // and subframes — the renderer is perfectly alive in those cases, and
  // marking it dead made the next reuse needlessly destroy a healthy window
  // (the regression behind "loaded a model → selection window went dark":
  // heavier OCR keeps the window alive longer, so a spurious -3 was far more
  // likely to land mid-session).
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

  // At capacity: refuse rather than silently closing the oldest pinned card —
  // that card holds content the user deliberately pinned. Caller surfaces a hint
  // and leaves this card active (it gets replaced by the next selection as usual).
  if (frozenSelectionWindows.size >= MAX_FROZEN_WINDOWS) {
    logger.debug?.(`Freeze refused: at limit (${MAX_FROZEN_WINDOWS})`);
    return { success: false, error: 'limit', frozenCount: frozenSelectionWindows.size };
  }

  currentWindow._isFrozen = true;
  frozenSelectionWindows.set(currentWindow._windowId, currentWindow);

  // Detach from active slot so next selection spawns fresh
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

  windows.screenshot = screenshotWindow;
  logger.info?.('Screenshot window created');
  return screenshotWindow;
}

// Hit-test against active + all frozen selection windows.
// Used by global mouse hook to decide whether to suppress auto-close on click.
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
