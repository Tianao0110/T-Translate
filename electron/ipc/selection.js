// Selection translate IPC handlers

const { ipcMain, BrowserWindow } = require('electron');
const { CHANNELS } = require('../shared/channels');
const logger = require('../utils/logger')('IPC:Selection');
const { captureSelectedText, hasFileFormat } = require('../utils/clipboard-capture');

// Address the window that actually sent the IPC, not the active-slot window. A
// frozen card is detached from windows.selection, so getSelectionWindow() would
// misroute its own hide/resize/drag onto whatever card is currently active.
const senderWindow = (event) => BrowserWindow.fromWebContents(event.sender);

function register(ctx) {
  const { getMainWindow, runtime, managers } = ctx;

  // Collapse 3+ consecutive blank lines into 2 (paragraph detection over-produces blanks)
  const cleanTextBlankLines = (text) => {
    if (!text) return text;
    return text.replace(/(\n\s*){3,}/g, '\n\n');
  };

  // ===== Toggle =====

  ipcMain.handle(CHANNELS.SELECTION.TOGGLE, () => {
    if (managers.toggleSelectionTranslate) {
      return managers.toggleSelectionTranslate();
    }
    logger.warn('toggleSelectionTranslate not available');
    return false;
  });

  ipcMain.handle(CHANNELS.SELECTION.GET_ENABLED, () => {
    return runtime.selectionEnabled;
  });

  // ===== Window control =====

  ipcMain.handle(CHANNELS.SELECTION.HIDE, (event) => {
    const selectionWindow = senderWindow(event);
    if (selectionWindow && !selectionWindow.isDestroyed()) {
      selectionWindow.hide();
      selectionWindow.webContents.send(CHANNELS.SELECTION.HIDE);
    }
    return true;
  });

  ipcMain.handle(CHANNELS.SELECTION.SET_BOUNDS, (event, bounds) => {
    const selectionWindow = senderWindow(event);
    if (selectionWindow && !selectionWindow.isDestroyed()) {
      selectionWindow.setBounds({
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
      });
    }
    return true;
  });

  ipcMain.handle(CHANNELS.SELECTION.START_DRAG, (event) => {
    const selectionWindow = senderWindow(event);
    if (selectionWindow && !selectionWindow.isDestroyed()) {
      const bounds = selectionWindow.getBounds();
      return { x: bounds.x, y: bounds.y };
    }
    return null;
  });

  // ===== Text capture =====

  // Anti-misfire: clipboard may contain a file drop instead of selected text;
  // distinguish via the formats the copy produced (read fresh inside the
  // capture, before restore) so we don't translate file paths blindly.
  ipcMain.handle(CHANNELS.SELECTION.GET_TEXT, async () => {
    const { text, formats, fileClipboard } = await captureSelectedText();

    // Clipboard held files we refused to clobber — nothing to translate.
    if (fileClipboard) return { text: null };

    if (hasFileFormat(formats)) {
      if (text && text.trim()) {
        const trimmed = text.trim();
        const looksLikePath = /^[A-Za-z]:\\|^\/|^\\\\|^file:\/\//.test(trimmed);
        if (looksLikePath) {
          // A file selection — translate just the filename if it's meaningful.
          return { text: extractFilenameForTranslation(trimmed) || null };
        }
        // File-format present but the text isn't a path — treat as text.
        return { text: cleanTextBlankLines(trimmed) };
      }
      return { text: null }; // dragging files, no text
    }

    if (text && text.trim()) return { text: cleanTextBlankLines(text.trim()) };

    return { text: null };
  });

  // ===== Multi-window management =====

  ipcMain.handle(CHANNELS.SELECTION.FREEZE, () => {
    const windowManager = require('../managers/window-manager');
    return windowManager.freezeSelectionWindow();
  });

  ipcMain.handle(CHANNELS.SELECTION.CLOSE_FROZEN, (event, windowId) => {
    const windowManager = require('../managers/window-manager');
    return windowManager.closeFrozenSelectionWindow(windowId);
  });

  // ===== Data sync =====

  ipcMain.handle(CHANNELS.SELECTION.ADD_TO_HISTORY, (event, item) => {
    const mainWindow = getMainWindow();
    mainWindow?.webContents.send(CHANNELS.DATA.ADD_TO_HISTORY, item);
    return true;
  });

  logger.info('Selection IPC handlers registered');
}

// ===== Helpers =====

// Thin wrapper kept for the hotkey-direct caller (main.js). All the clipboard
// mechanics (mutex, full-format restore, success cache) live in the shared
// capture module so the mouseup probe and this fetch can't clobber each other.
async function fetchSelectedText() {
  const { text } = await captureSelectedText();
  return text;
}

// Extract a translatable filename from a path string (strips dir, extension, separators).
// Returns null if the result has no translation value (too short / pure digits-symbols).
function extractFilenameForTranslation(filePath) {
  try {
    let filename = filePath;

    if (filename.startsWith('file://')) {
      filename = decodeURIComponent(filename.replace('file://', ''));
    }

    const pathParts = filename.split(/[/\\]/);
    filename = pathParts[pathParts.length - 1];

    const dotIndex = filename.lastIndexOf('.');
    if (dotIndex > 0) {
      filename = filename.substring(0, dotIndex);
    }

    filename = filename.replace(/[_-]+/g, ' ').trim();

    if (filename.length < 2 || /^[\d\s\W]+$/.test(filename)) {
      return null;
    }

    return filename;
  } catch (err) {
    logger.error('extractFilenameForTranslation error:', err);
    return null;
  }
}

module.exports = register;
module.exports.fetchSelectedText = fetchSelectedText;
