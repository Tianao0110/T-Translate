// GPU acceleration switch. One persisted flag (settings.gpu.enabled) that
// the main process applies to every engine in tengine/registry.js that can
// take the GPU — local OCR (onnxruntime-node) and the neural voice
// (sherpa-onnx) today — all on the one WebGPU execution provider.
//
// Enabling is a self-test, not a hope: each engine loads its model on the
// GPU in its own utilityProcess and warms up; an engine that cannot goes
// back to the CPU on its own and says why. The switch sticks when at least
// one engine made it, and the settings page shows each engine's real
// backend. Providers swap live (sessions rebuilt on the next request), so
// nothing here restarts the app.
//
// Listen stays on the CPU by table: its models are int8, and quantized
// graphs run 3–6x slower on WebGPU (measured 2026-09-07, see gstack
// v049-gpu-research).

const { ipcMain } = require('electron');
const { CHANNELS } = require('../shared/channels');
const tengine = require('../tengine');
const logger = require('../utils/logger')('IPC:GPU');
const ocrEngine = require('../utils/ocr-engine');
const audioEngine = require('../managers/audio-engine-manager');

const { PROVIDER: GPU_PROVIDER, ENGINES: GPU_ENGINES } = tengine;
const KEY = 'settings.gpu.enabled';

// How each GPU-capable engine is driven. Keyed by the table's ids so the
// table stays plain data.
const DRIVERS = {
  ocr: {
    setProvider: (p) => tengine.get().setProvider('ocr', p),
    selfTest: async () => {
      // ocr-engine resolves the base pack's model paths; the health call
      // itself is the engine adapter's.
      const s = await ocrEngine.hostStatus();
      return { ok: s.ok && s.provider === GPU_PROVIDER && !s.fallback, provider: s.provider, fallback: s.fallback || null };
    },
  },
  tts: {
    setProvider: (p) => tengine.get().setProvider('tts', p),
    // The manager picks the voice pack and brings the process up; the load,
    // the wait and the fallback verdict are the audio adapter's.
    selfTest: async () => {
      const s = await audioEngine.ttsSelfTest();
      return { ok: s.ok, provider: s.provider, fallback: s.fallback || s.error || null };
    },
  },
};

function register(ctx) {
  const { store } = ctx;
  // Last self-test per engine, so the page shows the live backend without
  // spawning anything just to ask.
  const last = {}; // id -> { ok, provider, fallback, at }

  const enabled = () => store.get(KEY, false) === true;

  function applyProvider(provider) {
    for (const engine of GPU_ENGINES) {
      if (engine.gpu && DRIVERS[engine.id]) DRIVERS[engine.id].setProvider(provider);
    }
  }

  applyProvider(enabled() ? GPU_PROVIDER : 'cpu');

  function snapshot() {
    return {
      enabled: enabled(),
      supported: process.platform === 'win32',
      provider: GPU_PROVIDER,
      engines: GPU_ENGINES.map((e) => ({
        id: e.id,
        gpu: e.gpu,
        reason: e.reason || null,
        // Live state: a self-test result when there is one, else what the
        // switch implies. Engines that never take the GPU are always cpu.
        state: e.gpu ? (last[e.id] || { provider: enabled() ? GPU_PROVIDER : 'cpu', fallback: null, pending: enabled() }) : { provider: 'cpu' },
      })),
    };
  }

  ipcMain.handle(CHANNELS.GPU.STATUS, async () => snapshot());

  ipcMain.handle(CHANNELS.GPU.SET_ENABLED, async (_event, on) => {
    if (!on) {
      store.set(KEY, false);
      applyProvider('cpu');
      for (const e of GPU_ENGINES) if (e.gpu) last[e.id] = { ok: true, provider: 'cpu', fallback: null, at: Date.now() };
      logger.info('GPU acceleration off');
      return { success: true, ...snapshot() };
    }

    applyProvider(GPU_PROVIDER);
    const capable = GPU_ENGINES.filter((e) => e.gpu && DRIVERS[e.id]);
    const results = await Promise.all(
      capable.map(async (e) => {
        try {
          const r = await DRIVERS[e.id].selfTest();
          return { id: e.id, ...r };
        } catch (err) {
          return { id: e.id, ok: false, provider: 'cpu', fallback: err.message };
        }
      }),
    );
    let any = false;
    for (const r of results) {
      last[r.id] = { ...r, at: Date.now() };
      if (r.ok) any = true;
      else {
        // That engine runs on the CPU from here; the others are unaffected.
        DRIVERS[r.id].setProvider('cpu');
        logger.warn(`GPU self-test failed for ${r.id}, staying on CPU: ${r.fallback}`);
      }
    }
    store.set(KEY, any);
    logger.info(any ? `GPU acceleration on (${results.filter((r) => r.ok).map((r) => r.id).join(', ')})` : 'GPU acceleration unavailable on every engine');
    return { success: any, ...snapshot() };
  });

  logger.info('GPU IPC handlers registered');
}

module.exports = register;
