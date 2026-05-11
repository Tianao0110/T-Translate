// IPC unified registry — dependency injection root.
// All IPC handlers register here; submodules never `require` the parent (avoids cycles).

const logger = require('../utils/logger')('IPC');

const registerSystemIPC = require('./system');
const registerStoreIPC = require('./store');
const registerShortcutsIPC = require('./shortcuts');
const registerScreenshotIPC = require('./screenshot');
const registerClipboardIPC = require('./clipboard');
const registerGlassIPC = require('./glass');
const registerSelectionIPC = require('./selection');
const registerSecureStorageIPC = require('./secure-storage');
const registerOcrIPC = require('./ocr');
const registerPrivacyIPC = require('./privacy');
const { registerThemeIPC } = require('./theme');

/**
 * Initialize all IPC handlers. Pass `deps` for dependency injection; the shared
 * `context` built here is forwarded to every submodule (no module fetches its
 * own dependencies — that's the rule that keeps this layer cycle-free).
 *
 * @param {Object} deps
 * @param {Object} deps.windows  Window-ref manager
 * @param {Object} deps.runtime  Runtime state
 * @param {Object} deps.store    Persistent store
 * @param {Object} deps.app      Electron app instance
 * @param {Object} deps.managers Manager functions (startScreenshot, toggleGlassWindow, …)
 */
function initIPC(deps) {
  logger.info('Initializing IPC handlers...');

  const requiredDeps = ['windows', 'runtime', 'store', 'app'];
  for (const dep of requiredDeps) {
    if (!deps[dep]) {
      logger.error(`Missing required dependency: ${dep}`);
      throw new Error(`IPC initialization failed: missing ${dep}`);
    }
  }

  // Shared context — forwarded to every register* call.
  const context = {
    // Window getters (lazy — avoid capturing null at construction time)
    getMainWindow: () => deps.windows.main,
    getGlassWindow: () => deps.windows.glass,
    getScreenshotWindow: () => deps.windows.screenshot,
    getSelectionWindow: () => deps.windows.selection,

    runtime: deps.runtime,
    store: deps.store,
    app: deps.app,
    // Managers passed in (avoids circular dep on window-manager).
    managers: deps.managers || {},
  };

  // ===== Register all submodules =====

  registerSystemIPC(context);

  registerStoreIPC(context);
  registerShortcutsIPC(context);

  registerScreenshotIPC(context);
  registerClipboardIPC(context);

  registerGlassIPC(context);

  registerSelectionIPC(context);
  registerSecureStorageIPC(context);

  registerOcrIPC(context);
  registerPrivacyIPC(context);

  registerThemeIPC({ store: deps.store, logger });

  logger.success('All IPC handlers initialized');

  return context;
}

// Placeholder for hot-reload / test cleanup. Electron doesn't expose a "remove all
// handlers" API, so real cleanup needs per-handler tracking — TODO if we ever need it.
function cleanupIPC() {
  logger.info('IPC cleanup requested (manual cleanup may be needed)');
}

module.exports = {
  initIPC,
  cleanupIPC,
};
