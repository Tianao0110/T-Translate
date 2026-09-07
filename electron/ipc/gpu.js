// GPU acceleration switch. One persisted flag (settings.gpu.enabled), applied
// by the main process to every engine that can take it — today that is the
// local OCR host (PP-OCR on DirectML). Enabling is a self-test, not a hope:
// the host builds the base session on the GPU and warms it up; if that fails
// the switch stays off and the reason is returned. The host swaps providers
// live (sessions are rebuilt on the next recognition), so no restart.
//
// Listen and read-aloud stay on the CPU on purpose: their models are int8
// (DirectML disables quantized ops) and Kokoro's ConvTranspose is rejected
// by DirectML outright — measured 2026-09-07, see gstack v049-gpu-research.

const { ipcMain } = require('electron');
const { CHANNELS } = require('../shared/channels');
const logger = require('../utils/logger')('IPC:GPU');
const ocrEngine = require('../utils/ocr-engine');

const KEY = 'settings.gpu.enabled';
// Engine ids the renderer lists as "these run on the GPU".
const GPU_ENGINES = ['ocr'];

function register(ctx) {
  const { store } = ctx;
  // Last self-test outcome, so the settings page can show the live backend
  // without spawning the host just to ask.
  let last = null; // { provider, fallback, at }

  ocrEngine.setProvider(store.get(KEY, false) === true ? 'dml' : 'cpu');

  ipcMain.handle(CHANNELS.GPU.STATUS, async () => ({
    enabled: store.get(KEY, false) === true,
    engines: GPU_ENGINES,
    supported: process.platform === 'win32',
    last,
  }));

  ipcMain.handle(CHANNELS.GPU.SET_ENABLED, async (_event, enabled) => {
    if (!enabled) {
      store.set(KEY, false);
      ocrEngine.setProvider('cpu');
      last = { provider: 'cpu', fallback: null, at: Date.now() };
      logger.info('GPU acceleration off');
      return { success: true, enabled: false };
    }
    ocrEngine.setProvider('dml');
    try {
      const status = await ocrEngine.hostStatus();
      if (status.provider !== 'dml' || status.fallback) {
        throw new Error(status.fallback || 'DirectML unavailable');
      }
      store.set(KEY, true);
      last = { provider: 'dml', fallback: null, at: Date.now() };
      logger.info('GPU acceleration on (DirectML)');
      return { success: true, enabled: true };
    } catch (e) {
      // Whatever went wrong, the machine runs on the CPU from here.
      ocrEngine.setProvider('cpu');
      store.set(KEY, false);
      last = { provider: 'cpu', fallback: e.message, at: Date.now() };
      logger.warn(`GPU self-test failed, staying on CPU: ${e.message}`);
      return { success: false, enabled: false, error: e.message };
    }
  });

  logger.info('GPU IPC handlers registered');
}

module.exports = register;
