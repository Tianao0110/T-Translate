// IPC for T-Caption's local channel (electron/companion/): owns the channel
// instance, hands the settings page its status and pushes changes to the
// main window. main.js stops it on quit through getCompanion().

const { ipcMain } = require('electron');
const { CHANNELS } = require('../shared/channels');
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
}

module.exports = { registerCompanionIPC, getCompanion: () => companion };
