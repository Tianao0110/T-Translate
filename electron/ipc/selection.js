// Selection translate IPC handlers

const { ipcMain, clipboard, screen } = require('electron');
const { CHANNELS } = require('../shared/channels');
const logger = require('../utils/logger')('IPC:Selection');
const { simulateCtrlC } = require('../utils/native-helper');

function register(ctx) {
  const { getMainWindow, getSelectionWindow, runtime, store, managers } = ctx;

  // Lazy-load screenshot module (heavy native deps)
  let screenshotModule = null;
  const getScreenshotModule = () => {
    if (!screenshotModule) {
      screenshotModule = require('../screenshot-module');
    }
    return screenshotModule;
  };

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

  ipcMain.handle(CHANNELS.SELECTION.HIDE, () => {
    const selectionWindow = getSelectionWindow();
    if (selectionWindow && !selectionWindow.isDestroyed()) {
      selectionWindow.hide();
      selectionWindow.webContents.send(CHANNELS.SELECTION.HIDE);
    }
    return true;
  });

  ipcMain.handle(CHANNELS.SELECTION.SET_POSITION, (event, x, y) => {
    const selectionWindow = getSelectionWindow();
    if (selectionWindow && !selectionWindow.isDestroyed()) {
      selectionWindow.setPosition(Math.round(x), Math.round(y));
    }
    return true;
  });

  ipcMain.handle(CHANNELS.SELECTION.SET_BOUNDS, (event, bounds) => {
    const selectionWindow = getSelectionWindow();
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

  ipcMain.handle(CHANNELS.SELECTION.RESIZE, (event, { width, height }) => {
    const selectionWindow = getSelectionWindow();
    if (selectionWindow && !selectionWindow.isDestroyed()) {
      selectionWindow.setSize(Math.round(width), Math.round(height));
    }
    return true;
  });

  ipcMain.handle(CHANNELS.SELECTION.START_DRAG, () => {
    const selectionWindow = getSelectionWindow();
    if (selectionWindow && !selectionWindow.isDestroyed()) {
      const bounds = selectionWindow.getBounds();
      return { x: bounds.x, y: bounds.y };
    }
    return null;
  });

  // ===== Settings =====

  // Shallow-merge defaults so v0.2.3 users upgrading still get new keys with default values
  ipcMain.handle(CHANNELS.SELECTION.GET_SETTINGS, () => {
    const settings = store.get('settings', {});
    const defaults = {
      triggerIcon: 'dot',
      triggerSize: 24,
      triggerColor: '#3b82f6',
      customIconPath: '',
      hoverDelay: 300,
      triggerTimeout: 5000,
      resultTimeout: 3000,
      minChars: 2,
      maxChars: 500,
      stickyViaCapsLock: false,
      stickyWarningShown: false,
    };
    return { ...defaults, ...(settings.selection || {}) };
  });

  // ===== Text capture =====

  // Anti-misfire: clipboard may contain a file drop instead of selected text;
  // distinguish via available formats so we don't translate file paths blindly.
  ipcMain.handle(CHANNELS.SELECTION.GET_TEXT, async (event, rect) => {
    const text = await fetchSelectedText();

    const formats = clipboard.availableFormats();

    const isFileDrop = formats.some(f =>
      f.includes('FileNameW') ||
      f.includes('FileContents') ||
      f.includes('CF_HDROP') ||
      f === 'text/uri-list'
    );

    if (isFileDrop) {
      if (text && text.trim()) {
        const looksLikePath = /^[A-Za-z]:\\|^\/|^\\\\|^file:\/\//.test(text.trim());

        if (looksLikePath) {
          const filename = extractFilenameForTranslation(text.trim());
          if (filename) {
            return { text: filename, method: 'filename', original: text.trim() };
          }
        } else {
          // File-format present but text payload is not a path — treat as text
          return { text: cleanTextBlankLines(text.trim()), method: 'clipboard' };
        }
      }

      // No text payload: user is dragging files
      return { text: null, method: null, reason: 'file_drop' };
    }

    if (text && text.trim()) {
      return { text: cleanTextBlankLines(text.trim()), method: 'clipboard' };
    }

    // Clipboard path failed — try OCR fallback on the captured rect
    const ocrRect = rect || runtime.lastSelectionRect;

    if (ocrRect && ocrRect.width > 8 && ocrRect.height > 4) {
      try {
        const ocrText = await getTextByOCR(ocrRect, getScreenshotModule(), {
          language: store.get('settings.ocr.recognitionLanguage', 'auto'),
          preprocess: {
            enabled: store.get('settings.ocr.enablePreprocess', true),
            scale: store.get('settings.ocr.scaleFactor', 2),
          },
        });
        if (ocrText && ocrText.trim()) {
          return { text: cleanTextBlankLines(ocrText.trim()), method: 'ocr' };
        }
      } catch (err) {
        logger.error('OCR failed:', err);
      }
    }

    return { text: null, method: null };
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

  ipcMain.handle(CHANNELS.SELECTION.GET_WINDOW_ID, (event) => {
    const selectionWindow = getSelectionWindow();
    if (selectionWindow && !selectionWindow.isDestroyed()) {
      return selectionWindow._windowId || null;
    }
    return null;
  });

  ipcMain.handle(CHANNELS.SELECTION.FROZEN_WINDOWS_COUNT, () => {
    const windowManager = require('../managers/window-manager');
    return windowManager.getFrozenSelectionWindowsCount();
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

// Serialization lock: a single Promise chain ensures only one fetchSelectedText is
// in flight at a time. Without this, the 500ms delayed restore from the previous
// call can interleave with the next call's backup-read, leaving the clipboard
// polluted with whichever restore finishes last.
let lastRestoreComplete = Promise.resolve();

// Reliable selected-text capture via clear+poll. Clears the clipboard as a semaphore,
// fires Ctrl+C, polls for up to 800ms, then restores the original clipboard contents.
async function fetchSelectedText() {
  // Append to the serialization chain: wait for the previous restore to finish.
  const prevRestore = lastRestoreComplete;
  let resolveMyRestore;
  const myRestorePromise = new Promise(r => { resolveMyRestore = r; });
  lastRestoreComplete = myRestorePromise;

  // Don't block on a previously rejected restore.
  await prevRestore.catch(() => {});

  let backup = null;
  let foundText = null;
  try {
    backup = clipboard.readText();

    // Clear as semaphore — polling treats empty as "not yet copied".
    clipboard.clear();

    simulateCtrlC();

    // Poll up to 800ms (16 × 50ms).
    for (let i = 0; i < 16; i++) {
      await new Promise(resolve => setTimeout(resolve, 50));
      const text = clipboard.readText();
      if (text && text.trim()) {
        foundText = text.trim();
        break;
      }
    }

    return foundText;
  } catch (err) {
    logger.error('fetchSelectedText error:', err);
    return null;
  } finally {
    // On success: delay restore by 500ms so the caller can synchronously
    // read clipboard formats (e.g. detect file drop) before we overwrite it.
    // On failure: restore immediately. Either branch MUST call resolveMyRestore,
    // otherwise the chain locks up and the next fetch never starts.
    if (foundText) {
      setTimeout(() => {
        try { if (backup !== null) clipboard.writeText(backup); } catch (e) { logger.warn('restore failed:', e.message); }
        resolveMyRestore();
      }, 500);
    } else {
      try { if (backup !== null) clipboard.writeText(backup); } catch (e) { logger.warn('restore failed:', e.message); }
      resolveMyRestore();
    }
  }
}

// OCR fallback via the local PP-OCR engine.
async function getTextByOCR(rect, screenshotModule, ocrOptions = {}) {
  try {
    // Reject sub-word regions: PaddleOCR produces garbage on tiny crops.
    if (rect.width < 12 || rect.height < 6) {
      return null;
    }

    const padding = 5;
    const captureRect = {
      x: rect.x - padding,
      y: rect.y - padding,
      width: rect.width + padding * 2,
      height: rect.height + padding * 2,
    };

    const screenshot = await screenshotModule.captureRegion(captureRect);

    if (!screenshot) {
      return null;
    }

    const ocrEngine = require('../utils/ocr-engine');
    const result = await ocrEngine.recognize(screenshot, ocrOptions);

    if (result.success && result.text) {
      return result.text;
    }

    return null;
  } catch (err) {
    logger.error('OCR error:', err);
    return null;
  }
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
