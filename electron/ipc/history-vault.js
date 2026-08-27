// IPC for the encrypted history vault. Main-window-gated: the persist blob
// holds the user's full translation history, so the two overlay windows
// (whose preloads never expose these channels anyway) are refused at the
// handler too — same defense-in-depth posture as secure-storage.

const { ipcMain, safeStorage } = require('electron');
const path = require('path');
const { CHANNELS } = require('../shared/channels');
const { createHistoryVault } = require('../utils/history-vault');
const logger = require('../utils/logger')('HistoryVault');

const HV = CHANNELS.HISTORY_VAULT;
const VAULT_FILE = 'translation-data.enc';

function registerHistoryVaultIPC(ctx) {
  const vault = createHistoryVault({
    filePath: path.join(ctx.app.getPath('userData'), VAULT_FILE),
    safeStorage,
    logger,
  });

  function fromMainWindow(event) {
    const main = ctx.getMainWindow?.();
    if (main && event.sender === main.webContents) return true;
    logger.warn('history-vault call from non-main window refused');
    return false;
  }

  ipcMain.handle(HV.STATUS, (event) => {
    if (!fromMainWindow(event)) return { available: false, exists: false, fileSize: 0 };
    return vault.status();
  });

  ipcMain.handle(HV.LOAD, (event) => {
    if (!fromMainWindow(event)) return null;
    return vault.load();
  });

  ipcMain.handle(HV.SAVE, (event, jsonString) => {
    if (!fromMainWindow(event)) return { success: false, reason: 'refused' };
    return vault.save(jsonString);
  });

  ipcMain.handle(HV.CLEAR, (event) => {
    if (!fromMainWindow(event)) return { success: false, reason: 'refused' };
    return vault.clear();
  });

  logger.info('History-vault IPC handlers registered');
}

module.exports = registerHistoryVaultIPC;
