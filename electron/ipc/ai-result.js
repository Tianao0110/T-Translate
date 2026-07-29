// AI action result windows. A result is a derivative of the translation it came
// from, so it must not outlive that session: every window is owned by the
// window that asked for it and dies with it. The reverse does NOT hold —
// closing a result window leaves the card alone, so the user can dismiss a
// summary and keep reading the translation.
//
// Ownership is taken from the sender rather than a name the renderer passes:
// the selection card, each frozen copy of it, and the floating window are all
// separate windows, and only the main process can tell them apart reliably.

const { CHANNELS } = require('../shared/channels');
const PATHS = require('../shared/paths');
const makeLogger = require('../utils/logger');

const logger = makeLogger('IPC:AIResult');

const MAX_WINDOWS = 6; // a stuck loop must not paper the desktop
const WIDTH = 420;
const HEIGHT = 460;
const GAP = 12; // breathing room between the spawning card and the result

// Opaque per theme. A transparent window would drag a plain reading pane into
// the frameless-glow trap the overlay windows have to live with.
const BACKGROUNDS = { light: '#f7f8fa', dark: '#211f1d', fresh: '#f2f9f7' };

const resultWindows = new Map(); // id -> { window, ownerId, payload }
let idCounter = 0;

function closeById(id) {
  const entry = resultWindows.get(id);
  if (!entry) return false;
  try {
    if (!entry.window.isDestroyed()) entry.window.close();
  } catch (e) {
    logger.warn('Failed to close AI result window:', e.message);
  }
  resultWindows.delete(id);
  return true;
}

function closeOwnedBy(ownerId) {
  let closed = 0;
  for (const [id, entry] of resultWindows) {
    if (entry.ownerId !== ownerId) continue;
    closeById(id);
    closed++;
  }
  return closed;
}

function closeAllResultWindows() {
  for (const id of [...resultWindows.keys()]) closeById(id);
}

// Beside the card that spawned it, never over it — the point is comparing the
// two. Snaps back onto a display when there is no room to the right.
function placeBeside(ownerWindow, displayHelper) {
  let anchor = null;
  try {
    anchor = ownerWindow && !ownerWindow.isDestroyed() ? ownerWindow.getBounds() : null;
  } catch (e) { /* window died mid-call */ }

  const base = anchor
    ? { x: anchor.x + anchor.width + GAP, y: anchor.y }
    : { x: 200, y: 200 };

  return displayHelper.ensureBoundsOnDisplay(
    { ...base, width: WIDTH, height: HEIGHT },
    { minVisiblePixels: 80, centerOnInvalid: false }
  );
}

// 'hide' counts as the session ending: the selection card and the main window
// both hide rather than close, so waiting for 'closed' would leave orphans
// floating over the desktop.
function trackOwner(ownerWindow) {
  if (!ownerWindow || ownerWindow.isDestroyed() || ownerWindow.__aiResultHooked) return;
  ownerWindow.__aiResultHooked = true;
  const ownerId = ownerWindow.id;
  const drop = () => closeOwnedBy(ownerId);
  ownerWindow.on('hide', drop);
  ownerWindow.once('closed', drop);
}

// Platform pieces arrive through ctx (the IPC layer's DI rule) rather than
// top-level requires: a CJS `require('electron')` bypasses the test alias, so
// injection is what keeps the linkage rules below unit-testable.
function register(ctx = {}) {
  const { ipcMain, BrowserWindow } = ctx.electron || require('electron');
  const displayHelper = ctx.displayHelper || require('../utils/display-helper');

  ipcMain.handle(CHANNELS.AI_RESULT.OPEN, (event, payload = {}) => {
    const ownerWindow = BrowserWindow.fromWebContents(event.sender);
    if (!ownerWindow) return { success: false, error: 'no owner window' };

    const theme = BACKGROUNDS[payload.theme] ? payload.theme : 'light';

    // One result per surface: a second summary from the same card replaces the
    // first instead of stacking windows the user has to sweep up.
    closeOwnedBy(ownerWindow.id);
    while (resultWindows.size >= MAX_WINDOWS) {
      closeById(resultWindows.keys().next().value);
    }

    const id = `ai_${++idCounter}`;
    const bounds = placeBeside(ownerWindow, displayHelper);

    try {
      const win = new BrowserWindow({
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        width: bounds.width,
        height: bounds.height,
        minWidth: 300,
        minHeight: 200,
        frame: false,
        transparent: false,
        backgroundColor: BACKGROUNDS[theme],
        resizable: true,
        movable: true,
        minimizable: false,
        maximizable: false,
        skipTaskbar: true,
        show: false,
        webPreferences: {
          preload: PATHS.preloads.aiResult,
          contextIsolation: true,
          nodeIntegration: false,
        },
      });

      // 'floating', not 'screen-saver': these windows can stay up a while and
      // must not sit above the user's own pinned tools.
      win.setAlwaysOnTop(true, 'floating');

      if (PATHS.isDev) {
        win.loadURL(`${PATHS.pages.aiResult.url}?id=${id}`);
      } else {
        win.loadFile(PATHS.pages.aiResult.file, { query: { id } });
      }

      win.once('ready-to-show', () => win.show());
      win.on('closed', () => resultWindows.delete(id));

      resultWindows.set(id, {
        window: win,
        ownerId: ownerWindow.id,
        payload: {
          id,
          actionId: payload.actionId || '',
          title: payload.title || '',
          content: payload.content || '',
          provider: payload.provider || '',
          theme,
        },
      });

      trackOwner(ownerWindow);

      logger.debug(`AI result window ${id} opened for window ${ownerWindow.id}`);
      return { success: true, id };
    } catch (error) {
      logger.error('Failed to open AI result window:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(CHANNELS.AI_RESULT.PAYLOAD, (event, id) => resultWindows.get(id)?.payload || null);

  ipcMain.handle(CHANNELS.AI_RESULT.CLOSE, (event, id) => closeById(id));

  logger.info('AI result IPC handlers registered');
}

module.exports = register;
module.exports.closeAllResultWindows = closeAllResultWindows;
