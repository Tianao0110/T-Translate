// The local OCR engine as T-Engine sees it: owns the OCR host process and
// answers in the contract's terms (provider, health, status). Pack
// resolution stays in ocr/ocr-engine.js, which owns the install roots
// and hands fully resolved model paths in.

const { createHostManager } = require('../host-manager');

const CODES = {
  crashed: 'OCR_HOST_CRASHED',
  unavailable: 'OCR_HOST_UNAVAILABLE',
  startTimeout: 'OCR_HOST_TIMEOUT',
  requestTimeout: 'OCR_TIMEOUT',
  failed: 'OCR_FAILED',
};

// The host and its sessions go after this long without a request; the next
// request respawns it (docs/design/ocr.md §2).
const IDLE_SHUTDOWN_MS = 3 * 60 * 1000;

function createOcrEngine({
  fork, logger, workerPath, now = Date.now, onEvent = () => {}, readyTimeoutMs, requestTimeoutMs,
  idleShutdownMs = IDLE_SHUTDOWN_MS, timers = { set: setTimeout, clear: clearTimeout },
}) {
  let provider = 'cpu';
  let lastHealth = null;
  let inFlight = 0;
  let idleTimer = null;
  const host = createHostManager({
    name: 'ocr',
    serviceName: 't-translate-ocr',
    workerPath,
    fork,
    logger,
    now,
    codes: CODES,
    // The host reads the provider once at init; a live switch goes through
    // set-provider below.
    initPayload: () => ({ provider }),
    onEvent,
    ...(readyTimeoutMs ? { readyTimeoutMs } : {}),
    ...(requestTimeoutMs ? { requestTimeoutMs } : {}),
  });

  function armIdle() {
    if (idleTimer) timers.clear(idleTimer);
    idleTimer = null;
    if (inFlight > 0 || !idleShutdownMs) return;
    idleTimer = timers.set(() => {
      idleTimer = null;
      if (inFlight > 0 || !host.running()) return;
      logger.info?.(`ocr host idle for ${Math.round(idleShutdownMs / 1000)}s, shutting down`);
      host.shutdown();
    }, idleShutdownMs);
    if (typeof idleTimer?.unref === 'function') idleTimer.unref();
  }

  async function tracked(fn) {
    if (idleTimer) timers.clear(idleTimer);
    idleTimer = null;
    inFlight++;
    try {
      return await fn();
    } finally {
      inFlight--;
      armIdle();
    }
  }

  return {
    id: 'ocr',
    host,
    recognize: (payload) => tracked(() => host.request('recognize', payload)),
    layout: (payload) => tracked(() => host.request('layout', payload)),
    evict(packId) {
      host.post({ type: 'evict', packId });
    },
    // 'webgpu' | 'cpu'. A running host drops its cached sessions so the
    // switch is live without a restart.
    setProvider(next) {
      provider = next === 'webgpu' ? 'webgpu' : 'cpu';
      host.post({ type: 'set-provider', provider });
    },
    provider: () => provider,
    // Builds the given pack's session in the host and records what it
    // actually ran on — the self-test behind the GPU switch.
    health: (payload) => tracked(async () => {
      const t0 = now();
      try {
        const r = await host.request('health', payload);
        lastHealth = { ok: !!r?.ok, provider: r?.provider || provider, fallback: r?.fallback || null, loadMs: Math.round(now() - t0), at: now() };
        return r;
      } catch (e) {
        lastHealth = { ok: false, provider, fallback: e.message, code: e.code || null, loadMs: Math.round(now() - t0), at: now() };
        throw e;
      }
    }),
    prewarm: () => host.prewarm().then(armIdle),
    shutdown: () => host.shutdown(),
    running: () => host.running(),
    status: () => ({ id: 'ocr', provider, lastHealth, host: host.status() }),
  };
}

module.exports = { createOcrEngine, CODES, IDLE_SHUTDOWN_MS };
