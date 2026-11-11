// IPC for T-Caption's local channel (electron/companion/): owns the channel
// instance, hands the settings page its status and pushes changes to the
// main window. main.js stops it on quit through getCompanion().

const fs = require('fs');
const path = require('path');
const { ipcMain, shell } = require('electron');
const { CHANNELS } = require('../shared/channels');
const PATHS = require('../shared/paths');
const engineManager = require('../listen/audio-engine-manager');
const { initCompanion } = require('../companion');
const logger = require('../platform/logger')('Companion');

const CO = CHANNELS.COMPANION;

let companion = null;

function registerCompanionIPC(ctx) {
  const { store, getMainWindow } = ctx;

  companion = initCompanion({
    store,
    engineManager,
    translateStream: ctx.stackHooks?.translateStream || null,
    detectLanguage: ctx.stackHooks?.detectLanguage || null,
    logger,
    version: ctx.app.getVersion(),
    getPrivacyMode: () => store.get('privacyMode', 'standard'),
    onStatus: (status) => {
      const win = getMainWindow();
      if (win && !win.isDestroyed()) win.webContents.send(CO.STATUS, status);
    },
  });

  ipcMain.handle(CO.GET_STATUS, () => companion.status());
  ipcMain.handle(CO.OPEN_PAIRING, () => companion.openPairing());
  ipcMain.handle(CO.REGENERATE_TOKEN, () => companion.regenerateToken());

  // The extension shipped with the app, for the browser's "Load unpacked".
  ipcMain.handle(CO.OPEN_EXTENSION_FOLDER, async () => {
    const dir = PATHS.resources.extension;
    if (!fs.existsSync(path.join(dir, 'manifest.json'))) return { ok: false, error: 'missing', path: dir };
    const error = await shell.openPath(dir);
    return error ? { ok: false, error, path: dir } : { ok: true, path: dir };
  });
}

module.exports = { registerCompanionIPC, getCompanion: () => companion };
