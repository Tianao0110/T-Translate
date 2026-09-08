// T-Engine host framework: the main-process side of every engine
// utilityProcess. Spawns on demand, pipes the host's stdio into the logger,
// matches replies to requests for request/reply hosts (OCR) and hands every
// other message to the adapter for event-stream hosts (audio), and survives
// the host's death: a crash rejects every in-flight request, the next spawn
// respawns, and — for hosts that opt in — repeated crashes back off so a
// broken native cannot be respawned in a tight loop. Knows nothing about
// models, images or audio: the engine adapter (engines/*.js) owns the
// protocol payloads and hands in the error codes its callers depend on.
//
// Every lifecycle change is also reported through onEvent (spawn, ready,
// exit, discard, backoff, timeouts): that stream, plus status(), is what
// the rest of the program reads instead of judging the engine itself.
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
  // Called with the options given to spawn(); its result is merged into
  // the init message.
  initPayload = () => ({}),
  // Message type that means "init acknowledged".
  readyType = 'ready',
  // Event-stream hosts: every message that is not a matched reply or a log
  // line lands here (the ready message included).
  onMessage = null,
  // Raw stderr lines, for adapters that must scrape a runtime's only word
  // on something (sherpa's provider fallback).
  onStderr = null,
  // Whether repeated crashes back off. Off for hosts whose adapter decides
  // restarts itself (the audio session's one-shot restart).
  crashBackoff = true,
  codes = {},
  readyTimeoutMs = READY_TIMEOUT_MS,
  requestTimeoutMs = REQUEST_TIMEOUT_MS,
  now = Date.now,
  onEvent = () => {},
}) {
  const CODES = { ...DEFAULT_CODES, ...codes };
  let child = null;
  let ready = null; // Promise resolved when the host says ready
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
  // A process we killed and are still waiting to see die: its exit is
  // reported (expected) so adapters can finish their bookkeeping, but it no
  // longer counts as the live host.
  let dying = null;

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

  function handleMessage(msg) {
    if (!msg || !msg.type) return;
    if (msg.type === 'log') {
      (logger[msg.level] || logger.info).call(logger, `host: ${msg.message}`);
      return;
    }
    if (msg.type === 'result' && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.ok) p.resolve(msg.value);
      else {
        const err = new Error(msg.error?.message || `${name} request failed`);
        err.code = msg.error?.code || CODES.failed;
        p.reject(err);
      }
      return;
    }
    if (onMessage) {
      try {
        onMessage(msg);
      } catch (e) {
        logger.error(`${name} host message handler failed: ${e.message}`);
      }
    }
  }

  function onExit(proc, code) {
    if (proc === dying) {
      dying = null;
      lastExit = { code, expected: true, at: now() };
      emit('exit', { code, expected: true });
      return;
    }
    // A discarded host reports its exit after its replacement is already
    // up: only the live child's death means anything here.
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
      failAll(CODES.crashed, `${name} host stopped`);
      emit('exit', { code, expected: true });
      return;
    }
    logger.error(`${name} host exited unexpectedly (code ${code})`);
    const t = now();
    crashes = crashes.filter((c) => t - c < CRASH_WINDOW_MS);
    crashes.push(t);
    emit('exit', { code, expected: false, crashesInWindow: crashes.length });
    if (crashBackoff && crashes.length >= CRASH_LIMIT) {
      backoffUntil = t + CRASH_BACKOFF_MS;
      logger.error(`${name} host crashed ${crashes.length} times — not respawning for ${CRASH_BACKOFF_MS / 1000}s`);
      emit('backoff', { until: backoffUntil });
    }
    failAll(CODES.crashed, `${name} host crashed`);
  }

  // Ends the process now. running() is false from here; the exit itself
  // still arrives as an expected 'exit' event.
  function kill() {
    if (!child) return;
    shuttingDown = true;
    const proc = child;
    child = null;
    ready = null;
    dying = proc;
    try {
      proc.kill();
    } catch {
      // already gone
    }
    failAll(CODES.crashed, `${name} host stopped`);
  }

  function spawn(opts = {}) {
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
    child.stderr?.on('data', (d) => {
      const line = String(d).trim();
      logger.warn(`host: ${line}`);
      if (onStderr) onStderr(line);
    });
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
        if (msg && msg.type === readyType && readySettle) {
          clearTimeout(timer);
          readySettle = null;
          readyAt = now();
          emit('ready', { readyMs: readyAt - spawnedAt, info: msg.info || null });
          resolve();
        }
        handleMessage(msg);
      });
    });
    spawned.postMessage({ type: 'init', ...initPayload(opts) });
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

  // Fire-and-forget. Returns false when no host is running; a closed port
  // throws so callers that must react (kill, fail a request) can.
  function post(msg) {
    if (!child) return false;
    child.postMessage(msg);
    return true;
  }

  // Marks the next exit as expected: the adapter is taking the host down
  // through its own protocol (a flush, then 'shutdown').
  function expectExit() {
    shuttingDown = true;
  }

  // Drops the current host without exit bookkeeping — used when a session
  // replaces a process that existed for something else. The old process
  // is killed; its late exit is ignored because it is no longer `child`.
  function discard(reason) {
    if (!child) return;
    const old = child;
    child = null;
    ready = null;
    if (readySettle) {
      clearTimeout(readySettle.timer);
      readySettle = null;
    }
    failAll(CODES.crashed, `${name} host replaced`);
    emit('discard', { reason });
    try {
      old.kill();
    } catch {
      // already gone
    }
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
    spawn,
    request,
    post,
    expectExit,
    discard,
    kill,
    // Loads the natives ahead of the first request.
    prewarm: (opts) => spawn(opts).catch((e) => logger.warn(`${name} host prewarm failed: ${e.message}`)),
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
