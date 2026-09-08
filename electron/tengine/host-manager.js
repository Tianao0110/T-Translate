// T-Engine host framework: the main-process side of every engine
// utilityProcess. Spawns on first use, matches replies to requests, and
// survives the host's death: a crash rejects every in-flight request and
// the next request respawns; repeated crashes back off so a broken native
// cannot be respawned in a tight loop. Knows nothing about models, images
// or audio — the engine adapter (engines/*.js) owns the protocol payloads
// and hands in the error codes its callers already depend on.
//
// Every lifecycle change is also reported through onEvent (spawn, ready,
// exit, backoff, timeouts): that stream, plus status(), is what the rest of
// the program reads instead of judging the engine itself.
//
// Factory: tests hand in a fake fork.

const READY_TIMEOUT_MS = 20000;
const REQUEST_TIMEOUT_MS = 60000;
// Three crashes inside two minutes = stop respawning for a minute.
const CRASH_WINDOW_MS = 120000;
const CRASH_LIMIT = 3;
const CRASH_BACKOFF_MS = 60000;

const DEFAULT_CODES = {
  crashed: 'HOST_CRASHED',
  unavailable: 'HOST_UNAVAILABLE',
  startTimeout: 'HOST_TIMEOUT',
  requestTimeout: 'REQUEST_TIMEOUT',
  failed: 'REQUEST_FAILED',
};

function createHostManager({
  name,
  serviceName = `t-translate-${name}`,
  workerPath,
  fork,
  logger,
  initPayload = () => ({}),
  codes = {},
  readyTimeoutMs = READY_TIMEOUT_MS,
  requestTimeoutMs = REQUEST_TIMEOUT_MS,
  now = Date.now,
  onEvent = () => {},
}) {
  const CODES = { ...DEFAULT_CODES, ...codes };
  let child = null;
  let ready = null; // Promise resolved when the host says 'ready'
  let readySettle = null; // { reject, timer } while that promise is open
  let nextId = 1;
  const pending = new Map(); // id -> { resolve, reject, timer }
  let crashes = [];
  let backoffUntil = 0;
  let shuttingDown = false;
  let spawnCount = 0;
  let spawnedAt = 0;
  let readyAt = 0;
  let lastExit = null; // { code, expected, at }

  function emit(kind, detail = {}) {
    try {
      onEvent({ host: name, kind, at: now(), ...detail });
    } catch (e) {
      logger.warn(`${name} host event listener failed: ${e.message}`);
    }
  }

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
        const err = new Error(msg.error?.message || `${name} request failed`);
        err.code = msg.error?.code || CODES.failed;
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
    lastExit = { code, expected, at: now() };
    if (readySettle) {
      // Died before saying ready: whoever is awaiting spawn() must hear it
      // as a crash, not sit out the ready timeout.
      clearTimeout(readySettle.timer);
      const settle = readySettle;
      readySettle = null;
      settle.reject(Object.assign(new Error(`${name} host crashed during startup`), { code: CODES.crashed }));
    }
    if (expected) {
      emit('exit', { code, expected: true });
      return;
    }
    logger.error(`${name} host exited unexpectedly (code ${code})`);
    const t = now();
    crashes = crashes.filter((c) => t - c < CRASH_WINDOW_MS);
    crashes.push(t);
    emit('exit', { code, expected: false, crashesInWindow: crashes.length });
    if (crashes.length >= CRASH_LIMIT) {
      backoffUntil = t + CRASH_BACKOFF_MS;
      logger.error(`${name} host crashed ${crashes.length} times — not respawning for ${CRASH_BACKOFF_MS / 1000}s`);
      emit('backoff', { until: backoffUntil });
    }
    failAll(CODES.crashed, `${name} host crashed`);
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
    failAll(CODES.crashed, `${name} host stopped`);
  }

  function spawn() {
    if (child) return ready;
    if (now() < backoffUntil) {
      const err = new Error(`${name} host unavailable after repeated crashes`);
      err.code = CODES.unavailable;
      return Promise.reject(err);
    }
    shuttingDown = false;
    child = fork(workerPath, [], { serviceName, stdio: 'pipe' });
    spawnCount++;
    spawnedAt = now();
    readyAt = 0;
    child.stdout?.on('data', (d) => logger.debug(`host: ${String(d).trim()}`));
    child.stderr?.on('data', (d) => logger.warn(`host: ${String(d).trim()}`));
    const spawned = child;
    spawned.on('exit', (code) => onExit(spawned, code));
    emit('spawn', { spawnCount });
    ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        logger.error(`${name} host ready timeout`);
        readySettle = null;
        emit('timeout', { phase: 'ready' });
        reject(Object.assign(new Error(`${name} host did not start`), { code: CODES.startTimeout }));
        kill();
      }, readyTimeoutMs);
      readySettle = { reject, timer };
      spawned.on('message', (msg) => {
        if (msg && msg.type === 'ready') {
          clearTimeout(timer);
          readySettle = null;
          readyAt = now();
          emit('ready', { readyMs: readyAt - spawnedAt, info: msg.info || null });
          resolve();
          return;
        }
        onMessage(msg);
      });
    });
    spawned.postMessage({ type: 'init', ...initPayload() });
    return ready;
  }

  async function request(type, payload, { timeoutMs = requestTimeoutMs } = {}) {
    await spawn();
    if (!child) {
      const err = new Error(`${name} host not running`);
      err.code = CODES.crashed;
      throw err;
    }
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        emit('timeout', { phase: 'request', type });
        fail(id, CODES.requestTimeout, `${name} request timed out`);
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      child.postMessage({ type, id, ...payload });
    });
  }

  // Fire-and-forget; a host that is not running has nothing to tell.
  function post(msg) {
    if (child) child.postMessage(msg);
  }

  function status() {
    const t = now();
    return {
      name,
      running: !!child,
      ready: !!child && readyAt > 0,
      pending: pending.size,
      spawnCount,
      readyMs: readyAt && spawnedAt ? readyAt - spawnedAt : null,
      crashesInWindow: crashes.filter((c) => t - c < CRASH_WINDOW_MS).length,
      backoffUntil: t < backoffUntil ? backoffUntil : 0,
      lastExit,
    };
  }

  return {
    name,
    request,
    post,
    // Loads the natives ahead of the first request.
    prewarm: () => spawn().catch((e) => logger.warn(`${name} host prewarm failed: ${e.message}`)),
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
    status,
  };
}

module.exports = { createHostManager, DEFAULT_CODES };
