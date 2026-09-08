// Built-in model IPC: the model folder's state for the settings page, a
// rescan, opening the folder, and the developer door (probe + trial report).
// Text never crosses here — translation and AI actions reach the model
// through the stack facade, not this file.

const { ipcMain, shell } = require('electron');
const { CHANNELS } = require('../shared/channels');
const { LLM_MODELS_DIR } = require('../shared/llm-packs');
const { dataDir } = require('../utils/data-root');
const { modelDir } = require('../utils/model-root');
const tengine = require('../tengine');
const llmManager = require('../managers/llm-manager');
const logger = require('../utils/logger')('IPC:LLM');

function register(ctx) {
  const engine = tengine.get();
  llmManager.init({
    store: ctx.store,
    tengine: engine,
    adapter: engine.get('llm'),
    logsDir: dataDir('logs'),
    modelsDir: modelDir(LLM_MODELS_DIR),
    logger,
  });

  ipcMain.handle(CHANNELS.LLM.STATUS, async () => llmManager.status());

  ipcMain.handle(CHANNELS.LLM.RESCAN, async () => {
    await llmManager.rescan();
    return llmManager.status();
  });

  ipcMain.handle(CHANNELS.LLM.OPEN_DIR, async () => {
    const error = await shell.openPath(llmManager.dir());
    return error ? { success: false, error } : { success: true };
  });

  ipcMain.handle(CHANNELS.LLM.UNLOAD, async () => {
    const unloaded = await llmManager.unload('manual');
    return { success: true, unloaded };
  });

  ipcMain.handle(CHANNELS.LLM.PROBE, async (_event, file) => {
    try {
      const report = await llmManager.probe(String(file || ''));
      return { success: true, report };
    } catch (e) {
      return { success: false, error: e.message, code: e.code || null };
    }
  });

  ipcMain.handle(CHANNELS.LLM.TRIAL_REPORT, async (_event, file) => llmManager.trialReport(String(file || '')));

  logger.info('LLM IPC handlers registered');
}

module.exports = register;
