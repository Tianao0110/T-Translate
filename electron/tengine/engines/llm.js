// The built-in LLM as T-Engine sees it: owns the LLM host process and
// answers in the contract's terms — load / unload / generate (streamed) /
// probe / health / metrics / setProvider / status. Which file to load and
// what to do with the text is the caller's business (the pack manager
// resolves files, the stack builds prompts); this adapter reports numbers.
//
// Every request carries its own reqId so token and progress events can be
// routed to the caller without knowing the host manager's ids.

const { createHostManager } = require('../host-manager');

const CODES = {
  crashed: 'LLM_HOST_CRASHED',
  unavailable: 'LLM_HOST_UNAVAILABLE',
  startTimeout: 'LLM_HOST_TIMEOUT',
  requestTimeout: 'LLM_TIMEOUT',
  failed: 'LLM_FAILED',
};

const LOAD_TIMEOUT_MS = 180000;
const GENERATE_TIMEOUT_MS = 600000;
const PROBE_TIMEOUT_MS = 240000;
const PROGRESS_EVERY_MS = 250;

function toProvider(value) {
  return value === 'cpu' || !value ? 'cpu' : 'gpu';
}

function createLlmEngine({
  fork,
  logger,
  workerPath,
  runtimeDir,
  now = Date.now,
  onEvent = () => {},
  readyTimeoutMs,
  requestTimeoutMs,
  firstTokenMs = 60000,
  stallMs = 15000,
}) {
  let provider = 'cpu';
  let loaded = null; // { file, provider, device, fallback, loadMs, info }
  let lastHealth = null;
  let lastRequest = null;
  let runtime = null; // ready info: build, version, devices
  let seq = 0;
  const streams = new Map(); // reqId -> { onToken, onProgress, lastProgressAt }

  const emit = (kind, detail = {}) => onEvent({ engine: 'llm', host: 'llm', kind, at: now(), ...detail });

  const host = createHostManager({
    name: 'llm',
    serviceName: 't-translate-llm',
    workerPath,
    fork,
    logger,
    now,
    codes: CODES,
    initPayload: () => ({ runtimeDir, firstTokenMs, stallMs }),
    onMessage(msg) {
      if (msg.type === 'ready') {
        runtime = msg.info || null;
        return;
      }
      const s = msg.reqId ? streams.get(msg.reqId) : null;
      if (msg.type === 'token') {
        if (s && s.onToken) s.onToken(msg.text);
        return;
      }
      if (msg.type === 'progress') {
        if (!s) return;
        const t = now();
        if (msg.value < 1 && t - s.lastProgressAt < PROGRESS_EVERY_MS) return;
        s.lastProgressAt = t;
        if (s.onProgress) s.onProgress(msg.value);
        emit('model-progress', { reqId: msg.reqId, value: msg.value });
        return;
      }
      if (msg.type === 'stall') {
        emit('stall', { reqId: msg.reqId, phase: msg.phase });
      }
    },
    onEvent(evt) {
      if (evt.kind === 'exit') {
        loaded = null;
        streams.clear();
      }
      onEvent({ engine: 'llm', ...evt });
    },
    ...(readyTimeoutMs ? { readyTimeoutMs } : {}),
    ...(requestTimeoutMs ? { requestTimeoutMs } : {}),
  });

  const nextId = (prefix) => `${prefix}${++seq}`;

  async function load(file, options = {}, { onProgress = null } = {}) {
    const reqId = nextId('l');
    streams.set(reqId, { onProgress, onToken: null, lastProgressAt: 0 });
    const t0 = now();
    try {
      const info = await host.request('load-model', { reqId, file, options: { ...options, provider } }, { timeoutMs: LOAD_TIMEOUT_MS });
      loaded = { file, provider: info.provider, device: info.device, fallback: info.fallback, loadMs: info.loadMs, info };
      emit('model-loaded', {
        file,
        provider: info.provider,
        device: info.device ? info.device.name : null,
        fallback: info.fallback,
        loadMs: info.loadMs,
        ctxMs: info.ctxMs,
        totalMs: Math.round(now() - t0),
        arch: info.arch,
        sizeBytes: info.sizeBytes,
        nCtx: info.nCtx,
        hasThinking: info.hasThinking,
      });
      return info;
    } catch (e) {
      emit('model-load-failed', { file, code: e.code || null, message: e.message, totalMs: Math.round(now() - t0) });
      throw e;
    } finally {
      streams.delete(reqId);
    }
  }

  async function unload() {
    if (!host.running()) {
      loaded = null;
      return;
    }
    await host.request('unload-model', {});
    loaded = null;
    emit('model-unloaded', {});
  }

  // Streams visible text to onToken; resolves with the result (text and
  // numbers). cancel() aborts the running or queued request; the result
  // then says stop: 'cancel' (or 'stall' when the watchdog did it).
  function generate(request, onToken = null) {
    const reqId = nextId('g');
    streams.set(reqId, { onToken, onProgress: null, lastProgressAt: 0 });
    const t0 = now();
    const promise = host
      .request('generate', { reqId, ...request }, { timeoutMs: GENERATE_TIMEOUT_MS })
      .then((result) => {
        lastRequest = {
          requestKind: request.kind || 'generate',
          promptTokens: result.promptTokens,
          reusedTokens: result.reusedTokens,
          genTokens: result.genTokens,
          promptMs: result.promptMs,
          firstMs: result.firstMs,
          totalMs: result.totalMs,
          tokPerSec: result.tokPerSec,
          stop: result.stop,
          thinkLeak: result.thinkLeak,
          provider: loaded ? loaded.provider : provider,
          at: now(),
        };
        emit('request', lastRequest);
        return result;
      })
      .catch((e) => {
        emit('request-failed', { requestKind: request.kind || 'generate', code: e.code || null, totalMs: Math.round(now() - t0) });
        throw e;
      })
      .finally(() => streams.delete(reqId));
    return {
      reqId,
      promise,
      cancel: () => host.post({ type: 'cancel', reqId }),
    };
  }

  async function probe(file, options = {}) {
    const reqId = nextId('p');
    const t0 = now();
    const { report } = await host.request('probe', { reqId, file, options: { ...options, provider } }, { timeoutMs: PROBE_TIMEOUT_MS });
    // The probe unloads whatever was resident to measure the file alone.
    loaded = null;
    emit('probe', {
      file,
      verdict: report.verdict,
      steps: report.steps.map((s) => ({ name: s.name, ok: s.ok, ms: s.ms, code: s.code || null })),
      arch: report.meta ? report.meta.arch : null,
      quant: report.meta ? report.meta.quant : null,
      tokPerSec: report.generate ? report.generate.tokPerSec : null,
      totalMs: Math.round(now() - t0),
    });
    return report;
  }

  // The self-test behind the GPU switch: the given file on the current
  // provider plus a short generation, recorded as lastHealth.
  async function health({ file, options = {} } = {}) {
    const reqId = nextId('h');
    const t0 = now();
    try {
      const r = await host.request('health', { reqId, file, options: { ...options, provider } }, { timeoutMs: LOAD_TIMEOUT_MS });
      loaded = { file, provider: r.provider, device: r.device, fallback: r.fallback, loadMs: r.loadMs, info: loaded && loaded.file === file ? loaded.info : null };
      lastHealth = { ok: !!r.ok, provider: r.provider, device: r.device ? r.device.name : null, fallback: r.fallback || null, loadMs: r.loadMs, firstMs: r.firstMs, tokPerSec: r.tokPerSec, totalMs: Math.round(now() - t0), at: now() };
      emit('health', lastHealth);
      return r;
    } catch (e) {
      lastHealth = { ok: false, provider, device: null, fallback: e.message, code: e.code || null, loadMs: null, firstMs: null, tokPerSec: null, totalMs: Math.round(now() - t0), at: now() };
      emit('health', lastHealth);
      throw e;
    }
  }

  return {
    id: 'llm',
    host,
    load,
    unload,
    generate,
    probe,
    health,
    metrics: () => host.request('metrics', {}),
    // 'cpu' or anything GPU-ish ('gpu' | 'webgpu' | 'vulkan'). Takes effect
    // on the next load; a resident model stays where it is until the
    // caller reloads or runs health.
    setProvider(next) {
      provider = toProvider(next);
    },
    provider: () => provider,
    loaded: () => loaded,
    runtime: () => runtime,
    prewarm: () => host.prewarm(),
    shutdown: () => {
      loaded = null;
      host.shutdown();
    },
    running: () => host.running(),
    status: () => ({
      id: 'llm',
      provider,
      loaded: loaded ? { file: loaded.file, provider: loaded.provider, device: loaded.device ? loaded.device.name : null, fallback: loaded.fallback, loadMs: loaded.loadMs } : null,
      runtime: runtime ? { build: runtime.build, version: runtime.version, gpuOffload: runtime.gpuOffload, devices: (runtime.devices || []).map((d) => ({ name: d.name, typeName: d.typeName, description: d.description, memory: d.memory })) } : null,
      lastHealth,
      lastRequest,
      host: host.status(),
    }),
  };
}

module.exports = { createLlmEngine, CODES, toProvider };
