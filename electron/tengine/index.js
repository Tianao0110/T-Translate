// T-Engine: the program's engine layer. One adapter per engine (engines/),
// each owning its host process, and the two lines the rest of the program
// reads — status() as a snapshot and on() as the event stream. Nothing here
// decides anything about the product; that stays in the main process (see
// docs/T-ENGINE.md, "边界").
//
// createTengine() is the factory tests use with fake engines; get() is the
// program's instance, which wires the real hosts lazily.

const path = require('path');
const { PROVIDER, ENGINES, gpuCapableIds, engineById } = require('./registry');

function createTengine({ logger } = {}) {
  const engines = new Map();
  const listeners = new Set();

  function emit(event) {
    for (const fn of listeners) {
      try {
        fn(event);
      } catch (e) {
        logger?.warn?.(`tengine listener failed: ${e.message}`);
      }
    }
  }

  // An adapter serves its own id plus every engine id it lists in
  // `engines` (the audio host carries both the voice and the recognizer).
  function register(engine) {
    if (!engine?.id) throw new Error('engine needs an id');
    engines.set(engine.id, engine);
    for (const id of engine.engines || []) engines.set(id, engine);
    return engine;
  }

  function get(id) {
    const e = engines.get(id);
    if (!e) throw new Error(`unknown engine: ${id}`);
    return e;
  }

  return {
    PROVIDER,
    ENGINES,
    register,
    get,
    has: (id) => engines.has(id),
    ids: () => [...engines.keys()],
    // Adds a listener for {engine, host, kind, at, ...} events; returns the
    // unsubscribe function.
    on(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    emit,
    status() {
      return {
        provider: PROVIDER,
        // An adapter serving several engines answers for each of them; the
        // row keeps its own id.
        engines: ENGINES.map((row) => {
          const live = engines.get(row.id);
          return { ...row, ...(live ? live.status() : { provider: 'cpu', lastHealth: null, host: null }), id: row.id };
        }),
      };
    },
    setProvider(id, provider) {
      get(id).setProvider(provider);
    },
    health: (id, payload) => get(id).health(payload),
    shutdownAll() {
      for (const e of engines.values()) {
        try {
          e.shutdown?.();
        } catch {
          // host already gone
        }
      }
    },
  };
}

let _default = null;

// The program's instance: real utilityProcess hosts, created on first use.
function get() {
  if (_default) return _default;
  const { utilityProcess } = require('electron');
  const createLogger = require('../utils/logger');
  const logger = createLogger('T-Engine');
  const tengine = createTengine({ logger });
  const fork = (file, args, opts) => utilityProcess.fork(file, args, opts);
  const { createOcrEngine } = require('./engines/ocr');
  const { createAudioEngine } = require('./engines/audio');
  tengine.register(
    createOcrEngine({
      fork,
      logger: createLogger('OCR-Host'),
      workerPath: path.join(__dirname, '../services/ocr-host/ocr-host.js'),
      onEvent: (evt) => tengine.emit({ engine: 'ocr', ...evt }),
    }),
  );
  tengine.register(
    createAudioEngine({
      fork,
      logger: createLogger('AudioEngine'),
      workerPath: path.join(__dirname, '../services/audio-engine/audio-worker.js'),
      onEvent: (evt) => tengine.emit(evt),
    }),
  );
  _default = tengine;
  return tengine;
}

module.exports = { createTengine, get, PROVIDER, ENGINES, gpuCapableIds, engineById };
