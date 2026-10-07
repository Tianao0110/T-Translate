// Pinned screenshots: each crop from flow.js becomes a frameless always-on-top
// window at the spot it was captured from. The image stays in memory only,
// here and in the pin's renderer (components/PinWindow); IPC in ipc/screenshot.js.
// Docked pins line up along a screen edge (geometry in dock-layout.js).
// While the capture overlay is up, one hidden window loads ahead (prewarm)
// and the next pin takes it.

const { BrowserWindow, clipboard, nativeImage, screen } = require('electron');
const PATHS = require('../shared/paths');
const { store, isDev } = require('../state');
const { hardenWebContents } = require('../windows/window-manager');
const logger = require('../platform/logger')('Pin');
const { dockSide, stackSlots, peekBounds } = require('./dock-layout');
const { CHANNELS } = require('../shared/channels');

const MAX_PINS = 8;
const READY_TIMEOUT_MS = 10000;
const MAX_SIDE = 16384;

// BrowserWindow id -> { window, image, width, height, dock? }, oldest first.
// dock = { displayId, side, order, width, height, thumb, peeking }.
const pins = new Map();
let dockOrder = 0;
// The prewarmed window, not yet a pin.
let warm = null;

// The renderer draws the image 1:1 at the top-left; any extra window pixels stay transparent.
function buildWindow() {
  const win = new BrowserWindow({
    width: 1,
    height: 1,
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

  // 'floating' level, like the overlay and the selection window.
  win.setAlwaysOnTop(true, 'floating');
  const id = win.id;

  if (isDev) {
    win.loadURL(PATHS.pages.pin.url);
  } else {
    win.loadFile(PATHS.pages.pin.file);
  }

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
    if (warm === win) warm = null;
    const pin = pins.get(id);
    if (!pin) return;
    clearTimeout(pin.readyTimer);
    pins.delete(id);
    if (pin.dock) restack(pin.dock.displayId, pin.dock.side);
  });

  hardenWebContents(win, 'Pin window');
  return win;
}

// Capture overlay up: load a pin window ahead so the pin shows the moment the
// selection lands (flow.js); discardWarm() when the capture is abandoned.
function prewarm() {
  if (warm && !warm.isDestroyed()) return;
  warm = buildWindow();
}

function discardWarm() {
  const win = warm;
  warm = null;
  if (win && !win.isDestroyed()) win.destroy();
}

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

  const win = warm && !warm.isDestroyed() ? warm : buildWindow();
  warm = null;
  win.setBounds({ x, y, width, height });

  const id = win.id;
  // Shown when the renderer reports the image painted (markReady); a pin that never does is dropped.
  const readyTimer = setTimeout(() => {
    if (win.isDestroyed() || win.isVisible()) return;
    logger.warn(`Pin ${id} never reported ready, closing`);
    win.destroy();
  }, READY_TIMEOUT_MS);
  pins.set(id, { window: win, image, width, height, readyTimer });
  // A renderer that already asked (prewarmed) gets its image pushed.
  win.webContents.send(CHANNELS.PIN.INIT, getInitFor(pins.get(id)));

  logger.info(`Pin ${id} created (${width}x${height}), total ${pins.size}`);
  return win;
}

function pinOf(sender) {
  const win = BrowserWindow.fromWebContents(sender);
  return win ? pins.get(win.id) || null : null;
}

// The image plus the settings the renderer's recognize + translate pass needs;
// null for a prewarmed window (its image arrives as PIN.INIT).
function getInit(sender) {
  const pin = pinOf(sender);
  return pin ? getInitFor(pin) : null;
}

function getInitFor(pin) {
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
  if (!pin || pin.dock || pin.window.isDestroyed() || !Number.isFinite(x) || !Number.isFinite(y)) return;
  pin.window.setBounds({ x: Math.round(x), y: Math.round(y), width: pin.width, height: pin.height });
}

// Zoom from the renderer: new bounds, kept as the size later moves use.
function resizePin(sender, x, y, width, height) {
  const pin = pinOf(sender);
  if (!pin || pin.dock || pin.window.isDestroyed()) return;
  if (![x, y, width, height].every(Number.isFinite) || width < 1 || height < 1 || width > MAX_SIDE || height > MAX_SIDE) return;
  pin.width = Math.round(width);
  pin.height = Math.round(height);
  pin.window.setBounds({ x: Math.round(x), y: Math.round(y), width: pin.width, height: pin.height });
}

// One animation frame from the renderer (docking, preview, smooth zoom):
// allowed while docked, unlike drags and edge resizes.
function framePin(sender, x, y, width, height) {
  const pin = pinOf(sender);
  if (!pin || pin.window.isDestroyed()) return;
  if (![x, y, width, height].every(Number.isFinite) || width < 1 || height < 1 || width > MAX_SIDE || height > MAX_SIDE) return;
  pin.width = Math.round(width);
  pin.height = Math.round(height);
  pin.window.setBounds({ x: Math.round(x), y: Math.round(y), width: pin.width, height: pin.height });
}

function workAreaOf(displayId) {
  const display = screen.getAllDisplays().find((d) => d.id === displayId) || screen.getPrimaryDisplay();
  return display.workArea;
}

// Re-lays one edge's thumbnails in dock order. Each pin animates to its new
// slot itself (PIN.SLOT); a previewing pin, or `skipId` (the one docking,
// which gets its slot as the return value), only has the slot recorded.
function restack(displayId, side, skipId = null) {
  const docked = [...pins.values()]
    .filter((p) => p.dock && p.dock.displayId === displayId && p.dock.side === side && !p.window.isDestroyed())
    .sort((a, b) => a.dock.order - b.dock.order);
  const slots = stackSlots(docked.map((p) => p.dock), side, workAreaOf(displayId));
  docked.forEach((p, i) => {
    p.dock.thumb = slots[i];
    if (p.window.id !== skipId && !p.dock.peeking) p.window.webContents.send(CHANNELS.PIN.SLOT, slots[i]);
  });
}

// Double-click: shrink to `size` (DIP) at the nearer left / right edge of
// the pin's display. Returns the thumbnail bounds.
function dockPin(sender, size) {
  const pin = pinOf(sender);
  if (!pin || pin.window.isDestroyed() || pin.dock) return null;
  const width = Math.round(size?.width);
  const height = Math.round(size?.height);
  if (!(width >= 1 && height >= 1 && width <= MAX_SIDE && height <= MAX_SIDE)) return null;
  const bounds = pin.window.getBounds();
  const display = screen.getDisplayMatching(bounds);
  const side = dockSide(bounds, display.workArea);
  pin.dock = { displayId: display.id, side, order: ++dockOrder, width, height, thumb: null, peeking: false };
  restack(display.id, side, pin.window.id);
  return pin.dock.thumb;
}

// Double-click on a docked pin: it leaves the edge (the renderer animates
// back to the bounds it had) and the rest of that edge closes up.
function undockPin(sender) {
  const pin = pinOf(sender);
  if (!pin || !pin.dock || pin.window.isDestroyed()) return;
  const { displayId, side } = pin.dock;
  pin.dock = null;
  restack(displayId, side);
}

// Hover on a docked pin: where the preview opens at `size` (capped to the
// work area), or the thumbnail it falls back to. The renderer animates there.
function peekPin(sender, on, size) {
  const pin = pinOf(sender);
  if (!pin || !pin.dock || !pin.dock.thumb || pin.window.isDestroyed()) return null;
  if (!on || !(size?.width >= 1 && size?.height >= 1)) {
    pin.dock.peeking = false;
    return pin.dock.thumb;
  }
  pin.dock.peeking = true;
  return peekBounds(pin.dock.thumb, pin.dock.side, size, workAreaOf(pin.dock.displayId));
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

module.exports = { prewarm, discardWarm, createPin, getInit, markReady, movePin, resizePin, framePin, dockPin, undockPin, peekPin, closePin, isPointInPins };
