// Pinned screenshots: each crop from flow.js becomes a frameless always-on-top
// window at the spot it was captured from. The image stays in memory only,
// here and in the pin's renderer (components/PinWindow); IPC in ipc/screenshot.js.

const { BrowserWindow, clipboard, nativeImage } = require('electron');
const PATHS = require('../shared/paths');
const { store, isDev } = require('../state');
const { hardenWebContents } = require('../windows/window-manager');
const logger = require('../platform/logger')('Pin');

const MAX_PINS = 8;
const READY_TIMEOUT_MS = 10000;

// BrowserWindow id -> { window, image, width, height }, oldest first.
const pins = new Map();

function createPin(image, bounds) {
  while (pins.size >= MAX_PINS) {
    const [oldestId, oldest] = pins.entries().next().value;
    pins.delete(oldestId);
    if (!oldest.window.isDestroyed()) oldest.window.close();
  }

  const width = Math.max(1, Math.round(bounds.width));
  const height = Math.max(1, Math.round(bounds.height));

  const x = Math.round(bounds.x);
  const y = Math.round(bounds.y);

  // The renderer draws the image 1:1 at the top-left; any extra window pixels stay transparent.
  const win = new BrowserWindow({
    x,
    y,
    width,
    height,
    frame: false,
    thickFrame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: PATHS.preloads.pin,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // the preload requires preloads/stack-bridge.js
    },
  });

  win.setBounds({ x, y, width, height });
  // 'floating' level, like the overlay and the selection window.
  win.setAlwaysOnTop(true, 'floating');

  const id = win.id;
  pins.set(id, { window: win, image, width, height });

  if (isDev) {
    win.loadURL(PATHS.pages.pin.url);
  } else {
    win.loadFile(PATHS.pages.pin.file);
  }

  // Shown when the renderer reports the image painted (markReady); a pin that never does is dropped.
  const readyTimer = setTimeout(() => {
    if (win.isDestroyed() || win.isVisible()) return;
    logger.warn(`Pin ${id} never reported ready, closing`);
    win.destroy();
  }, READY_TIMEOUT_MS);

  // Re-apply the z-order Windows drops on blur.
  win.on('blur', () => {
    if (win.isDestroyed() || !win.isAlwaysOnTop()) return;
    win.setAlwaysOnTop(false);
    win.setAlwaysOnTop(true, 'floating');
  });

  win.webContents.on('render-process-gone', (event, details) => {
    logger.warn(`Pin ${id} renderer gone: ${details?.reason || 'unknown'}`);
    if (!win.isDestroyed()) win.destroy();
  });

  win.on('closed', () => {
    clearTimeout(readyTimer);
    pins.delete(id);
  });

  hardenWebContents(win, 'Pin window');

  logger.info(`Pin ${id} created (${width}x${height}), total ${pins.size}`);
  return win;
}

function pinOf(sender) {
  const win = BrowserWindow.fromWebContents(sender);
  return win ? pins.get(win.id) || null : null;
}

// The image plus the settings the renderer's recognize + translate pass needs.
function getInit(sender) {
  const pin = pinOf(sender);
  if (!pin) return null;
  const settings = store.get('settings') || {};
  return {
    image: pin.image,
    theme: settings.interface?.theme || 'light',
    targetLanguage: settings.translation?.targetLanguage || 'zh',
    sameLanguageBehavior: settings.translation?.sameLanguageBehavior || 'original',
    ocrEngine: settings.ocr?.engine || 'llm-vision',
  };
}

function markReady(sender) {
  const pin = pinOf(sender);
  if (pin && !pin.window.isDestroyed() && !pin.window.isVisible()) pin.window.show();
}

// Manual drag from the renderer; the window keeps its captured size.
function movePin(sender, x, y) {
  const pin = pinOf(sender);
  if (!pin || pin.window.isDestroyed() || !Number.isFinite(x) || !Number.isFinite(y)) return;
  pin.window.setBounds({ x: Math.round(x), y: Math.round(y), width: pin.width, height: pin.height });
}

// copy: 'image' puts the captured image on the clipboard, 'view' the rendered
// page inside `rect` (DIP), anything else nothing.
async function closePin(sender, { copy = null, rect = null } = {}) {
  const pin = pinOf(sender);
  if (!pin) return;
  try {
    if (copy === 'image') {
      clipboard.writeImage(nativeImage.createFromDataURL(pin.image));
    } else if (copy === 'view' && isRect(rect) && !pin.window.isDestroyed()) {
      clipboard.writeImage(await pin.window.webContents.capturePage(rect));
    }
  } catch (e) {
    logger.warn('Copying the pin failed:', e.message);
  }
  if (!pin.window.isDestroyed()) pin.window.close();
}

function isRect(r) {
  return !!r && [r.x, r.y, r.width, r.height].every(Number.isInteger) && r.width > 0 && r.height > 0;
}

// Hit test for the select-to-translate mouse hook (selection/controller.js).
function isPointInPins(x, y) {
  for (const { window: win } of pins.values()) {
    if (win.isDestroyed() || !win.isVisible()) continue;
    const b = win.getBounds();
    if (x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height) return true;
  }
  return false;
}

module.exports = { createPin, getInit, markReady, movePin, closePin, isPointInPins };
