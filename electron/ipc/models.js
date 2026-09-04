// Model storage IPC: where packs live, and the one-time move of packs an older
// build left in userData. Engines hold model files open, so a move first
// stops the listen session, releases the voice and drops OCR sessions.

const { ipcMain, shell } = require('electron');
const { CHANNELS } = require('../shared/channels');
const logger = require('../utils/logger')('IPC:Models');
const modelRoot = require('../utils/model-root');
const { scanLegacy, migrateLegacy } = require('../utils/model-migrate');
const audioEngine = require('../managers/audio-engine-manager');
const ocrEngine = require('../utils/ocr-engine');

let migrating = false;

function register() {
  ipcMain.handle(CHANNELS.MODELS.STORAGE_INFO, async () => {
    const state = modelRoot.storageState();
    const legacy = scanLegacy({ legacyRoot: state.legacyRoot, activeRoot: state.root });
    return {
      root: state.root,
      fallback: state.fallback,
      legacyRoot: state.legacyRoot,
      legacyPacks: legacy.packs.length,
      legacyBytes: legacy.bytes,
      migrating,
    };
  });

  ipcMain.handle(CHANNELS.MODELS.MIGRATE, async (event) => {
    if (migrating) return { success: false, error: 'busy' };
    const state = modelRoot.storageState();
    if (state.fallback || state.legacyRoot === state.root) {
      return { success: false, error: 'no-target' };
    }
    migrating = true;
    try {
      await audioEngine.stopSessionAndWait('migrate');
      await audioEngine.unloadTtsAndWait('migrate');
      ocrEngine.evictSessions();
      const result = await migrateLegacy({
        legacyRoot: state.legacyRoot,
        activeRoot: state.root,
        onProgress: (p) => {
          if (!event.sender.isDestroyed()) event.sender.send(CHANNELS.MODELS.MIGRATE_PROGRESS, p);
        },
      });
      logger.info(`models moved to ${state.root}: ${result.moved} moved, ${result.removed} duplicates removed`);
      return { success: true, ...result };
    } catch (e) {
      logger.error('model migration failed:', e);
      return { success: false, error: e.message };
    } finally {
      migrating = false;
    }
  });

  ipcMain.handle(CHANNELS.MODELS.OPEN_FOLDER, async () => {
    const { root } = modelRoot.storageState();
    const error = await shell.openPath(root);
    return error ? { success: false, error } : { success: true };
  });

  logger.info('Models IPC handlers registered');
}

module.exports = register;
