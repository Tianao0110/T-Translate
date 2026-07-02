// Privacy-mode IPC handlers — set/get + side-effect notes per mode.

const { ipcMain } = require('electron');
const { CHANNELS, PRIVACY_MODES } = require('../shared/channels');
const logger = require('../utils/logger')('IPC:Privacy');

function register(ctx) {
  const { store } = ctx;

  // 'strict' was removed in 0.2.9 — its core promise (no network) maps to offline
  if (store.get('privacyMode') === 'strict') {
    store.set('privacyMode', 'offline');
  }

  ipcMain.handle(CHANNELS.PRIVACY.SET_MODE, (event, mode) => {
    try {
      const validModes = Object.values(PRIVACY_MODES);
      if (!validModes.includes(mode)) {
        return { success: false, error: `Invalid mode: ${mode}` };
      }

      store.set('privacyMode', mode);
      logger.info('Mode changed to:', mode);

      // Log mode-specific behavior so the user-visible effect is traceable.
      if (mode === PRIVACY_MODES.OFFLINE) {
        logger.info('Offline mode enabled - network features restricted');
      }

      return { success: true, mode };
    } catch (error) {
      logger.error('Set mode error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(CHANNELS.PRIVACY.GET_MODE, () => {
    return store.get('privacyMode', PRIVACY_MODES.STANDARD);
  });

  logger.info('Privacy IPC handlers registered');
}

module.exports = register;
