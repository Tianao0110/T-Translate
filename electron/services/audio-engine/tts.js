// Neural TTS inside the worker: one sherpa OfflineTts at a time, loaded from
// a resolved voice pack, streaming one sentence per chunk to the host. Also
// owns the mute gate the ASR side consults while a window plays our voice.
// Protocol: audio-worker.js header.

const { post, logLine } = require('./io');
const { eventRecord, makeTtsGate } = require('./probe-metrics');
const { hasCjk, verbalizeEnglishNumbers, scaleSpeed } = require('./tts-text-en');

let sherpa = null;

// 4 threads: kokoro fp32 measured RTF 0.23-0.28 at 4 on a desktop CPU, and
// the ASR side runs on 2, so both fit a 6-core box without starving capture.
const TTS_THREADS = 4;
const TTS_ENGINES = new Set(['kokoro', 'vits']);
// 'cpu' | 'webgpu' — set by init and tts-set-provider. On the GPU the
// runtime does the parallelism; extra CPU threads only contend (1 thread).
let ttsProvider = 'cpu';
// Bumped on every engine load; a queued unload from before the bump is void.
let ttsGen = 0;
let tts = null;
let ttsPackId = '';
let ttsLoading = null; // Promise<OfflineTts> while createAsync runs
let ttsChain = Promise.resolve(); // one synthesis at a time
const ttsCancelled = new Set();
// Mute gate: while a window plays TTS (any engine) the captured audio is
// dropped here, plus a tail for the loopback path's latency, so the app's own
// voice never reaches the VAD. Works on every Windows build, unlike process
// exclusion, and needs no audio client restart.
const TTS_GATE_TAIL_MS = 300;
const ttsGate = makeTtsGate({ tailMs: TTS_GATE_TAIL_MS });

// Called once from init with the loaded sherpa module and the backend the
// host chose ('cpu' | 'webgpu').
function attach({ sherpa: mod, provider }) {
  sherpa = mod;
  ttsProvider = provider === 'webgpu' ? 'webgpu' : 'cpu';
}

// Dropping the last reference is what releases the .onnx handles; queued up
// behind any running synthesis so a pack swap never pulls files from under
// the addon thread. The ack lets the host wait for exactly that moment.
function unloadTts() {
  // A load that starts while this release waits behind a running synthesis
  // supersedes it: the state then belongs to the new engine.
  const gen = ttsGen;
  ttsChain = ttsChain.then(async () => {
    if (ttsLoading) {
      try {
        await ttsLoading;
      } catch {
        // load already failed — nothing to release
      }
    }
    if (ttsGen !== gen) return;
    tts = null;
    ttsPackId = '';
    ttsLoading = null;
    logLine(eventRecord('unload', 'tts'));
    post({ type: 'tts-unloaded' });
  });
}

function ttsConfigFor(pack) {
  const p = pack.paths || {};
  const list = (v) => (Array.isArray(v) ? v : v ? [v] : []);
  const common = {
    numThreads: ttsProvider === 'webgpu' ? 1 : TTS_THREADS,
    provider: ttsProvider,
    debug: 0,
  };
  let model;
  if (pack.engine === 'kokoro') {
    model = {
      kokoro: {
        model: p.model,
        voices: p.voices,
        tokens: p.tokens,
        dataDir: p.dataDir || '',
        dictDir: p.dictDir || '',
        lexicon: list(p.lexicon).join(','),
      },
      ...common,
    };
  } else {
    model = {
      vits: {
        model: p.model,
        tokens: p.tokens,
        lexicon: list(p.lexicon).join(','),
        dictDir: p.dictDir || '',
        ...(p.dataDir ? { dataDir: p.dataDir } : {}),
      },
      ...common,
    };
  }
  // One sentence per batch is what makes the progress callback stream: the
  // first chunk is the first sentence, not the whole paragraph.
  return { model, ruleFsts: list(p.ruleFsts).join(','), maxNumSentences: 1 };
}

// Resolves to the loaded engine for `pack`, swapping out a different one.
function ensureTts(pack) {
  if (!pack || !TTS_ENGINES.has(pack.engine) || !pack.paths?.model) {
    return Promise.reject(new Error('tts-bad-pack'));
  }
  if (tts && ttsPackId === pack.id) return Promise.resolve(tts);
  if (ttsLoading && ttsPackId === pack.id) return ttsLoading;
  if (!sherpa) return Promise.reject(new Error('tts-not-initialized'));

  ttsGen += 1;
  tts = null;
  ttsPackId = pack.id;
  const t0 = Date.now();
  ttsLoading = sherpa.OfflineTts.createAsync(ttsConfigFor(pack)).then(
    (engine) => {
      // A newer load superseded this one while it ran: let it go.
      if (ttsPackId !== pack.id) return engine;
      // WebGPU compiles its pipelines on the first synthesis of each
      // language (2.8 s for Chinese measured); take that hit here, once,
      // instead of on the user's first sentence. Failures are not fatal:
      // sherpa already fell back to the CPU inside the session if it had to.
      if (ttsProvider === 'webgpu') {
        for (const w of Array.isArray(pack.warmup) ? pack.warmup : []) {
          try {
            engine.generate({ text: w.text, sid: w.sid, speed: 1, enableExternalBuffer: false });
          } catch (err) {
            logLine(eventRecord('tts-warmup-failed', String(err.message)));
            break;
          }
        }
      }
      tts = engine;
      ttsLoading = null;
      const loadMs = Date.now() - t0;
      logLine(eventRecord('tts-load', `${pack.id} ${loadMs}ms`));
      post({
        type: 'tts-ready',
        packId: pack.id,
        loadMs,
        numSpeakers: engine.numSpeakers,
        sampleRate: engine.sampleRate,
      });
      return engine;
    },
    (err) => {
      if (ttsPackId === pack.id) {
        ttsPackId = '';
        ttsLoading = null;
      }
      post({ type: 'tts-error', packId: pack.id, message: `load failed: ${err.message}` });
      throw err;
    }
  );
  return ttsLoading;
}

function load(msg) {
  // Already resident: say so again, so a caller waiting on tts-ready (the
  // GPU self-test) is not left hanging on a load that never happens.
  if (tts && msg.pack && ttsPackId === msg.pack.id) {
    post({ type: 'tts-ready', packId: msg.pack.id, loadMs: 0, numSpeakers: tts.numSpeakers, sampleRate: tts.sampleRate });
    return;
  }
  ensureTts(msg.pack).catch(() => {
    // reported through tts-error above
  });
}

// The provider is baked into the engine config: a loaded voice is dropped
// and the next load (or tts-load) rebuilds it on the new backend.
function setProvider(msg) {
  const next = msg.provider === 'webgpu' ? 'webgpu' : 'cpu';
  if (next === ttsProvider) return;
  ttsProvider = next;
  logLine(eventRecord('tts-provider', next));
  // Forget the pack id now: the release itself queues behind any running
  // synthesis, but a tts-load arriving in between must not match the old
  // engine and hand back the wrong backend.
  ttsPackId = '';
  if (tts || ttsLoading) unloadTts();
}

function generate(msg) {
  const id = String(msg.id || '');
  const text = typeof msg.text === 'string' ? msg.text.trim() : '';
  if (!id || !text) return post({ type: 'tts-error', id, message: 'tts-empty' });
  const sid = Number.isInteger(msg.sid) && msg.sid >= 0 ? msg.sid : 0;
  const speed = scaleSpeed(msg.speed, msg.pack?.speedScale, text);

  // The packs' Chinese rule FSTs would read English digits in Chinese;
  // English text gets its numbers spelled out first (tts-text-en).
  const spoken = hasCjk(text) ? text : verbalizeEnglishNumbers(text);

  ttsChain = ttsChain
    .then(async () => {
      if (ttsCancelled.delete(id)) return post({ type: 'tts-done', id, cancelled: true });
      const engine = msg.pack ? await ensureTts(msg.pack) : tts;
      if (!engine) throw new Error('tts-not-loaded');
      const t0 = Date.now();
      let samplesOut = 0;
      let sampleRate = engine.sampleRate;
      let cancelled = false;
      await engine.generateAsync({
        text: spoken,
        sid: Math.min(sid, Math.max(0, engine.numSpeakers - 1)),
        speed,
        enableExternalBuffer: false,
        onProgress: (info) => {
          if (ttsCancelled.has(id)) {
            cancelled = true;
            return 0;
          }
          const samples = info.samples;
          if (samples && samples.length) {
            samplesOut += samples.length;
            if (info.sampleRate) sampleRate = info.sampleRate;
            post({ type: 'tts-chunk', id, samples, sampleRate, progress: info.progress });
          }
          return 1;
        },
      });
      ttsCancelled.delete(id);
      const genMs = Date.now() - t0;
      const audioS = samplesOut / (sampleRate || 1);
      logLine(eventRecord('tts', `${ttsPackId} sid ${sid} ${audioS.toFixed(2)}s in ${genMs}ms${cancelled ? ' (cancelled)' : ''}`));
      post({ type: 'tts-done', id, cancelled, audioS, genMs });
    })
    .catch((err) => {
      ttsCancelled.delete(id);
      post({ type: 'tts-error', id, message: String(err && err.message ? err.message : err) });
    });
}

function cancel(msg) {
  const id = String(msg.id || '');
  if (id) ttsCancelled.add(id);
}

function gate(msg) {
  const on = msg.on === true;
  ttsGate.set(on, Date.now());
  logLine(eventRecord('tts-gate', on ? 'on' : 'off'));
  if (on) post({ type: 'level', value: 0 });
}

const gateBlocked = (now) => ttsGate.blocked(now);
// Resolves once any running synthesis has finished; shutdown waits on it.
const drain = () => ttsChain.catch(() => {});

module.exports = { attach, load, setProvider, generate, cancel, gate, gateBlocked, unload: unloadTts, drain };
