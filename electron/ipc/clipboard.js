// Clipboard IPC handlers — text r/w + image read.

const { ipcMain, clipboard } = require('electron');
const { CHANNELS } = require('../shared/channels');
const logger = require('../utils/logger')('IPC:Clipboard');

function register(ctx) {
  // ===== Text =====

  // handle() version — used by floating window and similar.
  ipcMain.handle(CHANNELS.CLIPBOARD.WRITE_TEXT, (event, text) => {
    try {
      clipboard.writeText(text);
      logger.debug('Write text, length:', text?.length || 0);
      return true;
    } catch (error) {
      logger.error('Write text error:', error.message);
      return false;
    }
  });

  // on() version — legacy channel name kept for backwards compatibility.
  ipcMain.on(CHANNELS.CLIPBOARD.WRITE_TEXT_LEGACY, (event, text) => {
    try {
      clipboard.writeText(text);
      logger.debug('Write text (legacy), length:', text?.length || 0);
    } catch (error) {
      logger.error('Write text error:', error.message);
    }
  });

  ipcMain.handle(CHANNELS.CLIPBOARD.READ_TEXT, () => {
    try {
      const text = clipboard.readText();
      logger.debug('Read text, length:', text?.length || 0);
      return text;
    } catch (error) {
      logger.error('Read text error:', error.message);
      return '';
    }
  });

  // Legacy channel name.
  ipcMain.handle(CHANNELS.CLIPBOARD.READ_TEXT_LEGACY, () => {
    try {
      return clipboard.readText();
    } catch (error) {
      logger.error('Read text error:', error.message);
      return '';
    }
  });

  // ===== Image =====

  // Returns a DataURL or null if clipboard has no image.
  ipcMain.handle(CHANNELS.CLIPBOARD.READ_IMAGE, () => {
    try {
      const image = clipboard.readImage();
      if (!image.isEmpty()) {
        const dataURL = image.toDataURL();
        logger.debug('Read image, size:', image.getSize());
        return dataURL;
      }
      return null;
    } catch (error) {
      logger.error('Read image error:', error.message);
      return null;
    }
  });

  // ===== Internal helpers (not exposed to renderer) =====

  function getAvailableFormats() {
    return clipboard.availableFormats();
  }

  function clearClipboard() {
    clipboard.clear();
  }

  logger.info('Clipboard IPC handlers registered');

  return {
    getAvailableFormats,
    clearClipboard,
  };
}

module.exports = register;
