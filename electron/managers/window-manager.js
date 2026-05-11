// Window manager: main, glass overlay, selection (with freeze-multi support),
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

// ===== Glass overlay window =====

function createGlassWindow() {
  if (windows.glass) {
    windows.glass.focus();
    return windows.glass;
  }

  const savedBounds = store.get('glassBounds', {
    width: 400,
    height: 200,
    x: undefined,
    y: undefined,
  });

  const glassBounds = displayHelper.ensureBoundsOnDisplay(savedBounds, {
    minVisiblePixels: 100,
    centerOnInvalid: true,
  });

  if (glassBounds.adjusted) {
    logger?.info?.('Glass window position adjusted to valid display');
  }

  const glassWindow = new BrowserWindow({
    width: glassBounds.width,
    height: glassBounds.height,
    x: glassBounds.x,
    y: glassBounds.y,
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
      preload: PATHS.preloads.glass,
      backgroundThrottling: false, // glass refresh must run while unfocused
      webSecurity: false, // allow cross-origin (e.g. Google Translate)
    },
  });

  // WDA_EXCLUDEFROMCAPTURE so OCR doesn't re-read our own overlay
  if (process.platform === 'win32') {
    glassWindow.webContents.on('did-finish-load', () => {
      makeWindowInvisibleToCapture(glassWindow);
    });
  }

  if (isDev) {
    glassWindow.loadURL(PATHS.pages.glass.url);
  } else {
    glassWindow.loadFile(PATHS.pages.glass.file);
  }

  glassWindow.on('moved', () => {
    if (glassWindow) {
      store.set('glassBounds', glassWindow.getBounds());
    }
  });

  glassWindow.on('resized', () => {
    if (glassWindow) {
      store.set('glassBounds', glassWindow.getBounds());
    }
  });

  glassWindow.on('closed', () => {
    windows.glass = null;
  });

  glassWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'Escape') {
      glassWindow.close();
    } else if (input.key === ' ' && !input.control && !input.alt && !input.meta) {
      glassWindow.webContents.send(CHANNELS.GLASS?.REFRESH || 'glass:refresh');
    }
  });

  windows.glass = glassWindow;
  logger.info?.('Glass window created');
  return glassWindow;
}

function toggleGlassWindow() {
  if (windows.glass) {
    if (windows.glass.isVisible()) {
      windows.glass.close();
    } else {
      windows.glass.show();
      windows.glass.focus();
    }
  } else {
    createGlassWindow();
  }
}

// ===== Selection translate windows (freeze-to-multi pattern) =====
// Active window gets replaced on each selection. User can "freeze" the current
// window to detach it into the pool, so the next selection spawns a fresh one.

function createSelectionWindow() {
  if (windows.selection && !windows.selection.isDestroyed()) {
    const isFrozen = windows.selection._isFrozen;
    if (!isFrozen) {
      return windows.selection;
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

  selectionWindow.setAlwaysOnTop(true, 'screen-saver');
  selectionWindow.setIgnoreMouseEvents(false);

  if (isDev) {
    selectionWindow.loadURL(PATHS.pages.selection.url);
  } else {
    selectionWindow.loadFile(PATHS.pages.selection.file);
  }

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

  // Evict oldest frozen window when at capacity (Map preserves insertion order)
  if (frozenSelectionWindows.size >= MAX_FROZEN_WINDOWS) {
    const oldestId = frozenSelectionWindows.keys().next().value;
    const oldestWindow = frozenSelectionWindows.get(oldestId);
    if (oldestWindow && !oldestWindow.isDestroyed()) {
      oldestWindow.close();
    }
    frozenSelectionWindows.delete(oldestId);
    logger.debug?.(`Closed oldest frozen window ${oldestId} due to limit`);
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

function getFrozenSelectionWindowsCount() {
  return frozenSelectionWindows.size;
}

function closeAllFrozenSelectionWindows() {
  for (const [id, win] of frozenSelectionWindows) {
    if (win && !win.isDestroyed()) {
      win.close();
    }
  }
  frozenSelectionWindows.clear();
  logger.info?.('All frozen selection windows closed');
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
  createGlassWindow,
  createSelectionWindow,
  createScreenshotWindow,
  toggleGlassWindow,
  freezeSelectionWindow,
  closeFrozenSelectionWindow,
  getFrozenSelectionWindowsCount,
  closeAllFrozenSelectionWindows,
};
