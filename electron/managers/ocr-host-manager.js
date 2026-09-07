// Owner of the OCR host utilityProcess (services/ocr-host/ocr-host.js):
// spawns it on first use, matches replies to requests, and survives its
// death. A crash rejects every in-flight request with OCR_HOST_CRASHED and
// the next request respawns; repeated crashes back off so a broken native
// cannot be respawned in a tight loop. Nothing here knows about packs or
// images — ocr-engine.js resolves those and calls in.
//
// Factory + default instance: the unit test hands in a fake fork.

const path = require('path');

const READY_TIMEOUT_MS = 20000;
const REQUEST_TIMEOUT_MS = 60000;
// Three crashes inside two minutes = stop respawning for a minute.
const CRASH_WINDOW_MS = 120000;
const CRASH_LIMIT = 3;
const CRASH_BACKOFF_MS = 60000;

function createOcrHostManager({ fork, logger, workerPath, readyTimeoutMs = READY_TIMEOUT_MS, requestTimeoutMs = REQUEST_TIMEOUT_MS, now = Date.now }) {
  let child = null;
  let ready = null; // Promise resolved when the host says 'ready'
  let readySettle = null; // { reject, timer } while that promise is open
  let nextId = 1;
  const pending = new Map(); // id -> { resolve, reject, timer }
  let provider = 'cpu';
  let crashes = [];
  let backoffUntil = 0;
  let shuttingDown = false;

  function fail(id, code, message) {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    clearTimeout(p.timer);
    const err = new Error(message);
    err.code = code;
    p.reject(err);
  }

  function failAll(code, message) {
    for (const id of [...pending.keys()]) fail(id, code, message);
  }

  function onMessage(msg) {
    if (!msg || !msg.type) return;
    if (msg.type === 'log') {
      (logger[msg.level] || logger.info).call(logger, `host: ${msg.message}`);
      return;
    }
    if (msg.type === 'result') {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.ok) p.resolve(msg.value);
      else {
        const err = new Error(msg.error?.message || 'OCR failed');
        err.code = msg.error?.code || 'OCR_FAILED';
        p.reject(err);
      }
    }
  }

  function onExit(proc, code) {
    // A killed host reports its exit after its replacement is already up:
    // only the live child's death means anything here.
    if (proc !== child) return;
    const expected = shuttingDown;
    child = null;
    ready = null;
    if (readySettle) {
      // Died before saying ready: whoever is awaiting spawn() must hear it
      // as a crash, not sit out the ready timeout.
      clearTimeout(readySettle.timer);
      const settle = readySettle;
      readySettle = null;
      settle.reject(Object.assign(new Error('OCR host crashed during startup'), { code: 'OCR_HOST_CRASHED' }));
    }
    if (expected) return;
    logger.error(`OCR host exited unexpectedly (code ${code})`);
    const t = now();
    crashes = crashes.filter((c) => t - c < CRASH_WINDOW_MS);
    crashes.push(t);
    if (crashes.length >= CRASH_LIMIT) {
      backoffUntil = t + CRASH_BACKOFF_MS;
      logger.error(`OCR host crashed ${crashes.length} times — not respawning for ${CRASH_BACKOFF_MS / 1000}s`);
    }
    failAll('OCR_HOST_CRASHED', 'OCR host crashed');
  }

  function spawn() {
    if (child) return ready;
    if (now() < backoffUntil) {
      const err = new Error('OCR host unavailable after repeated crashes');
      err.code = 'OCR_HOST_UNAVAILABLE';
      return Promise.reject(err);
    }
    shuttingDown = false;
    child = fork(workerPath, [], { serviceName: 't-translate-ocr', stdio: 'pipe' });
    child.stdout?.on('data', (d) => logger.debug(`host: ${String(d).trim()}`));
    child.stderr?.on('data', (d) => logger.warn(`host: ${String(d).trim()}`));
    const spawned = child;
    spawned.on('exit', (code) => onExit(spawned, code));
    ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        logger.error('OCR host ready timeout');
        readySettle = null;
        reject(Object.assign(new Error('OCR host did not start'), { code: 'OCR_HOST_TIMEOUT' }));
        kill();
      }, readyTimeoutMs);
      readySettle = { reject, timer };
      spawned.on('message', (msg) => {
        if (msg && msg.type === 'ready') {
          clearTimeout(timer);
          readySettle = null;
          resolve();
          return;
        }
        onMessage(msg);
      });
    });
    spawned.postMessage({ type: 'init', provider });
    return ready;
  }

  function kill() {
    if (!child) return;
    shuttingDown = true;
    try {
      child.kill();
    } catch {
      // already gone
    }
    child = null;
    ready = null;
    failAll('OCR_HOST_CRASHED', 'OCR host stopped');
  }

  async function request(type, payload) {
    await spawn();
    if (!child) {
      const err = new Error('OCR host not running');
      err.code = 'OCR_HOST_CRASHED';
      throw err;
    }
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => fail(id, 'OCR_TIMEOUT', 'OCR request timed out'), requestTimeoutMs);
      pending.set(id, { resolve, reject, timer });
      child.postMessage({ type, id, ...payload });
    });
  }

  return {
    recognize: (payload) => request('recognize', payload),
    health: (payload) => request('health', payload),
    // Fire-and-forget: a host that is not running has nothing cached.
    evict(packId) {
      if (child) child.postMessage({ type: 'evict', packId });
    },
    setProvider(next) {
      provider = next === 'webgpu' ? 'webgpu' : 'cpu';
      if (child) child.postMessage({ type: 'set-provider', provider });
    },
    provider: () => provider,
    // Loads the natives ahead of the first recognition.
    prewarm: () => spawn().catch((e) => logger.warn(`OCR host prewarm failed: ${e.message}`)),
    shutdown() {
      if (!child) return;
      shuttingDown = true;
      try {
        child.postMessage({ type: 'shutdown' });
      } catch {
        // port already closed
      }
      kill();
    },
    running: () => !!child,
    pendingCount: () => pending.size,
  };
}

function defaultManager() {
  const { utilityProcess } = require('electron');
  return createOcrHostManager({
    fork: (file, args, opts) => utilityProcess.fork(file, args, opts),
    logger: require('../utils/logger')('OCR-Host'),
    workerPath: path.join(__dirname, '../services/ocr-host/ocr-host.js'),
  });
}

let _default = null;
module.exports = {
  createOcrHostManager,
  get: () => (_default ||= defaultManager()),
};
