// Storage IPC: where app data and model packs live, the one-time move of
// packs an older build left in userData, and clearing that old userData
// folder once a relocated install has carried everything over. Engines hold
// model files open, so both the move and the clear first stop the listen
// session, release the voice and drop OCR sessions.

const fs = require('fs');
const path = require('path');
const { ipcMain, shell, app } = require('electron');
const { CHANNELS } = require('../shared/channels');
const logger = require('../utils/logger')('IPC:Models');
const modelRoot = require('../utils/model-root');
const { scanLegacy, migrateLegacy } = require('../utils/model-migrate');
const { legacyUserData, isRelocated } = require('../utils/app-paths');
const { dataRoot } = require('../utils/data-root');
const audioEngine = require('../managers/audio-engine-manager');
const ocrEngine = require('../utils/ocr-engine');

let busy = false;

// The old %APPDATA% folder is offered for cleanup only when userData really
// moved away from it and it still holds something. Electron recreates the
// default userData directory on every launch, empty — that shell is not
// old data and must not bring the button back.
function legacyDataRoot() {
  const legacy = legacyUserData();
  if (!isRelocated() || !legacy) return null;
  try {
    return fs.readdirSync(legacy).length > 0 ? legacy : null;
  } catch {
    return null;
  }
}

function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

async function releaseModelFiles(reason) {
  await audioEngine.stopSessionAndWait(reason);
  await audioEngine.unloadTtsAndWait(reason);
  ocrEngine.evictSessions();
}

function register() {
  ipcMain.handle(CHANNELS.MODELS.STORAGE_INFO, async () => {
    const state = modelRoot.storageState();
    const legacy = scanLegacy({ legacyRoot: state.legacyRoot, activeRoot: state.root });
    return {
      dataRoot: dataRoot(),
      dataFallback: app.isPackaged && !isRelocated(),
      root: state.root,
      fallback: state.fallback,
      legacyRoot: state.legacyRoot,
      legacyPacks: legacy.packs.length,
      legacyBytes: legacy.bytes,
      legacyDataRoot: legacyDataRoot(),
      busy,
    };
  });

  ipcMain.handle(CHANNELS.MODELS.MIGRATE, async (event) => {
    if (busy) return { success: false, error: 'busy' };
    const state = modelRoot.storageState();
    if (state.fallback || state.legacyRoot === state.root) {
      return { success: false, error: 'no-target' };
    }
    busy = true;
    try {
      await releaseModelFiles('migrate');
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
      busy = false;
    }
  });

  // Deletes the pre-v0.4.7 userData folder. Refused while it still holds
  // model packs (move them first — 700 MB is not something to drop by
  // accident) and, belt and braces, if it is the live folder or a parent.
  ipcMain.handle(CHANNELS.MODELS.CLEAN_LEGACY, async () => {
    if (busy) return { success: false, error: 'busy' };
    const legacy = legacyDataRoot();
    if (!legacy) return { success: false, error: 'no-legacy' };
    if (isInside(legacy, dataRoot()) || isInside(legacy, modelRoot.modelsRoot())) {
      return { success: false, error: 'live' };
    }
    const state = modelRoot.storageState();
    if (scanLegacy({ legacyRoot: legacy, activeRoot: state.root }).packs.length > 0) {
      return { success: false, error: 'packs' };
    }
    busy = true;
    try {
      await releaseModelFiles('clean-legacy');
      await fs.promises.rm(legacy, { recursive: true, force: true });
      logger.info(`old user data folder removed: ${legacy}`);
      return { success: true };
    } catch (e) {
      logger.error('old user data cleanup failed:', e);
      return { success: false, error: e.message };
    } finally {
      busy = false;
    }
  });

  ipcMain.handle(CHANNELS.MODELS.OPEN_FOLDER, async (_event, which) => {
    const target = which === 'data' ? dataRoot() : modelRoot.storageState().root;
    const error = await shell.openPath(target);
    return error ? { success: false, error } : { success: true };
  });

  logger.info('Models IPC handlers registered');
}

module.exports = register;
