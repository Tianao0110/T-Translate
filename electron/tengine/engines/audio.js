// The audio host (ASR + neural TTS worker) as T-Engine sees it: owns the
// process, tells the two engines that live in it apart, and does the
// engine-state work the audio manager used to do itself — the model-load
// timer, "did this process ever reach asr-ready", the exit classification a
// restart decision needs, the provider and sherpa's stderr-only fallback
// note, and the voice self-test. Session semantics (which source, which
// language, what the floating window is told) stay in
// managers/audio-engine-manager.js, which subscribes to the messages here.
//
// Protocol: services/audio-engine/audio-worker.js header.

const { createHostManager } = require('../host-manager');

const READY_TIMEOUT_MS = 30000;
// init → asr-start → model load → asr-ready; loading dominates.
const MODEL_LOAD_TIMEOUT_MS = 30000;
const TTS_LOAD_TIMEOUT_MS = 60000;
// The fallback note travels on stderr, a different pipe from the IPC
// reply: give it a moment to land before reading it.
const STDERR_SETTLE_MS = 150;

function createAudioEngine({ fork, logger, workerPath, now = Date.now, onEvent = () => {}, readyTimeoutMs = READY_TIMEOUT_MS, modelLoadTimeoutMs = MODEL_LOAD_TIMEOUT_MS, ttsLoadTimeoutMs = TTS_LOAD_TIMEOUT_MS, settleMs = STDERR_SETTLE_MS }) {
  let provider = 'cpu';
  let providerNote = null;
  let lastHealth = null;
  // ASR engine state inside the live process.
  let asrPhase = 'idle'; // idle | loading | running | stopping
  let asrEverReady = false;
  let asrLoadedAt = 0;
  let loadTimer = null;
  // TTS engine state.
  let ttsLoadedPack = '';
  const ttsLoadWaiters = new Map(); // packId -> { resolve, reject, timer }
  const subscribers = new Set();

  const emit = (kind, detail = {}) => onEvent({ engine: 'audio', kind, at: now(), ...detail });

  function clearLoadTimer() {
    clearTimeout(loadTimer);
    loadTimer = null;
  }

  function settleTtsWaiter(packId, err) {
    const w = ttsLoadWaiters.get(packId);
    if (!w) return;
    ttsLoadWaiters.delete(packId);
    clearTimeout(w.timer);
    if (err) w.reject(err);
    else w.resolve();
  }

  function onMessage(msg) {
    switch (msg.type) {
      case 'asr-ready':
        clearLoadTimer();
        asrPhase = 'running';
        asrEverReady = true;
        asrLoadedAt = now();
        emit('asr-ready', { loadMs: msg.loadMs });
        break;
      case 'asr-stopped':
        asrPhase = 'idle';
        break;
      case 'tts-ready':
        ttsLoadedPack = msg.packId;
        settleTtsWaiter(msg.packId);
        break;
      case 'tts-unloaded':
        ttsLoadedPack = '';
        break;
      case 'tts-error':
        if (!msg.id && msg.packId) settleTtsWaiter(msg.packId, Object.assign(new Error(msg.message || 'tts-load-failed'), { code: 'TTS_LOAD_FAILED' }));
        break;
      case 'fatal':
        emit('fatal', { message: msg.message });
        break;
      default:
        break;
    }
    for (const fn of subscribers) {
      try {
        fn(msg);
      } catch (e) {
        logger.error(`audio subscriber failed on ${msg.type}: ${e.message}`);
      }
    }
  }

  function onStderr(line) {
    // sherpa's only word on a provider it could not enable.
    if (/webgpu/i.test(line) && /fallback to cpu/i.test(line)) {
      providerNote = line;
      emit('fallback', { engine: 'tts', note: line });
    }
  }

  const host = createHostManager({
    name: 'audio',
    serviceName: 't-translate-audio-engine',
    workerPath,
    fork,
    logger,
    now,
    readyTimeoutMs,
    crashBackoff: false,
    // The GPU flag rides on init; everything else is the caller's session.
    initPayload: (opts) => ({ ...(opts.init || {}), gpu: provider === 'webgpu' }),
    onMessage,
    onStderr,
    onEvent: (evt) => {
      if (evt.kind === 'exit' || evt.kind === 'discard') {
        // What was the engine doing when the process went: the restart
        // decision upstream keys on this, not on the exit code.
        const phase = asrPhase === 'loading' && !asrEverReady ? 'model-load' : asrPhase === 'running' || asrPhase === 'stopping' ? 'session' : 'idle';
        const everReady = asrEverReady;
        clearLoadTimer();
        asrPhase = 'idle';
        asrEverReady = false;
        asrLoadedAt = 0;
        ttsLoadedPack = '';
        for (const id of [...ttsLoadWaiters.keys()]) settleTtsWaiter(id, Object.assign(new Error('audio host exited'), { code: 'AUDIO_HOST_EXITED' }));
        onEvent({ engine: 'audio', ...evt, phase, everReady });
        return;
      }
      onEvent({ engine: 'audio', ...evt });
    },
  });

  return {
    id: 'audio',
    engines: ['tts', 'asr'],
    host,
    // The manager's message handler; every worker message after the
    // adapter's own bookkeeping.
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    spawn: (opts) => host.spawn(opts),
    post: (msg) => host.post(msg),
    kill: () => host.kill(),
    discard: (reason) => host.discard(reason),
    expectExit: () => host.expectExit(),
    running: () => host.running(),
    // Begins a listen session's model load and arms the timer that turns a
    // silent load into an engine-dead verdict.
    startAsr(language) {
      asrPhase = 'loading';
      asrEverReady = false;
      clearLoadTimer();
      loadTimer = setTimeout(() => {
        loadTimer = null;
        if (asrPhase !== 'loading') return;
        logger.error('audio host model load timeout');
        emit('timeout', { phase: 'model-load' });
        host.kill();
      }, modelLoadTimeoutMs);
      host.post({ type: 'asr-start', language });
    },
    stopAsr() {
      if (asrPhase === 'running' || asrPhase === 'loading') asrPhase = 'stopping';
      clearLoadTimer();
    },
    asrPhase: () => asrPhase,
    asrEverReady: () => asrEverReady,
    // 'cpu' | 'webgpu'. A loaded voice is dropped by the worker and rebuilt
    // on the new backend at the next request — no restart, no session
    // interruption. Returns whether anything changed.
    setProvider(next) {
      const p = next === 'webgpu' ? 'webgpu' : 'cpu';
      providerNote = null;
      if (p === provider) return false;
      provider = p;
      try {
        host.post({ type: 'tts-set-provider', provider: p });
      } catch {
        // process gone — the next spawn reads the provider
      }
      return true;
    },
    provider: () => provider,
    providerNote: () => providerNote,
    ttsLoadedPack: () => ttsLoadedPack,
    // Loads a voice on the current provider (with its warm-up) and reports
    // what actually happened — the self-test behind the GPU switch. A
    // resident voice on this provider just answers tts-ready again. The
    // caller brings the process up (a TTS-only init is its business).
    async health({ pack } = {}) {
      if (!pack) return { ok: false, provider, fallback: null, error: 'no-pack' };
      if (!host.running()) return { ok: false, provider, fallback: null, error: 'not-running', packId: pack.id };
      providerNote = null;
      const t0 = now();
      try {
        await host.spawn();
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            ttsLoadWaiters.delete(pack.id);
            reject(Object.assign(new Error('tts-load-timeout'), { code: 'TTS_LOAD_TIMEOUT' }));
          }, ttsLoadTimeoutMs);
          ttsLoadWaiters.set(pack.id, { resolve, reject, timer });
          host.post({ type: 'tts-load', pack });
        });
        await new Promise((r) => setTimeout(r, settleMs));
        lastHealth = { ok: !providerNote, provider: providerNote ? 'cpu' : provider, fallback: providerNote, loadMs: Math.round(now() - t0), packId: pack.id, at: now() };
      } catch (e) {
        lastHealth = { ok: false, provider, fallback: providerNote, error: e.message, code: e.code || null, loadMs: Math.round(now() - t0), packId: pack.id, at: now() };
      }
      return lastHealth;
    },
    shutdown: () => host.shutdown(),
    status: () => ({
      id: 'audio',
      provider,
      providerNote,
      lastHealth,
      tts: { loadedPack: ttsLoadedPack },
      asr: { phase: asrPhase, everReady: asrEverReady, loadedAt: asrLoadedAt || null },
      host: host.status(),
    }),
  };
}

module.exports = { createAudioEngine };
