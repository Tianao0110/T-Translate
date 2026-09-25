// The ASR session inside the worker: silero VAD windows, the open-segment
// mirror with its layered forced splits, SenseVoice finals or the
// high-accuracy tier's (T-Engine's speech host, through the main process),
// the streaming draft engine, the language pin, the signal watchdog and the
// metrics window. Audio arrives through handlePcm (from capture.js or the
// host's pcm messages); finals and drafts leave as parentPort messages.
// Protocol: audio-worker.js header.

const {
  makeRepeatTracker,
  segmentRecord,
  eventRecord,
  metricsRecord,
  makeSignalWatchdog,
  makeVadThresholdPolicy,
  isNegligibleFinal,
  makeAgc,
  pickCutWindow,
} = require('./probe-metrics');
const { parseAsrResultJson } = require('./asr-result');
const { post, logLine, fatal, textLogged } = require('./io');
const capture = require('./capture');
const tts = require('./tts');

// Segmentation and VAD tuning; every number is explained in
// docs/design/listen.md (§2 segmentation, §3 VAD).
const SAMPLE_RATE = 16000;
const VAD_WINDOW = 512;
const PARTIAL_INTERVAL_MS = 1000;
// Layered forced splits: valley / text-quiescence from SOFT, hard cut at HARD.
const SOFT_SPLIT_FROM_S = 5;
const HARD_SPLIT_S = 9;
const VALLEY_WINDOWS = 8; // x 512 samples = 0.256s of sustained quiet
const VALLEY_RATIO = 0.3;
const VALLEY_FLOOR = 1e-4;
const TEXT_QUIESCENCE_MS = 800;
// silero threshold by content; the policy is makeVadThresholdPolicy.
const VAD_THRESHOLD_SPEECH = 0.5;
const VAD_THRESHOLD_MUSIC = 0.3;

const ASR_LANGUAGES = new Set(['zh', 'en', 'ja', 'ko', 'yue', '']);

let sherpa = null;
let sherpaAddon = null;
let asrPaths = null; // declared by attach; loaded by start
let asrLanguage = '';
let vad = null;
let vadThreshold = VAD_THRESHOLD_SPEECH;
let vadPolicy = makeVadThresholdPolicy({ speech: VAD_THRESHOLD_SPEECH, music: VAD_THRESHOLD_MUSIC });
let vadRebuildTo = null; // pending threshold change, applied at a segment boundary
let recognizer = null;
// High-accuracy tier: finals come from T-Engine's speech host (hq-transcribe
// out, hq-result back, hq-cancel when the answer is too late). They carry no
// language / BGM tags, so the language pin and the music policy never fire
// from them; SenseVoice stays loaded and takes any final the host does not
// answer in time, any segment that queued too long behind slower ones, and
// every segment for HQ_COOLDOWN_MS after a timeout.
const hqActive = () => !!(asrPaths && asrPaths.remoteHq);
const HQ_TIMEOUT_MS = 10000;
const HQ_BACKLOG_MS = 2500;
const HQ_COOLDOWN_MS = 30000;
let hqCooldownUntil = 0;
let hqSeq = 0;
const hqWaiters = new Map(); // id -> { resolve, timer }
// Auto-language sessions pin the recognizer once LANG_PIN_STREAK finals agree;
// the rebuild happens between segments inside the decode chain.
const LANG_PIN_STREAK = 3;
let pinnedLanguage = '';
let langStreak = { lang: '', count: 0 };
let pendingPinLang = null;
// Optional streaming draft engine: 'stream' for zh/en, 'pseudo' (re-decode of
// the open segment) otherwise, 'none' on the high-accuracy tier without it.
let online = null;
let onlineStream = null;
let partialEngine = 'pseudo'; // 'pseudo' | 'stream' | 'none'
let autoEngineDecided = false;
let lastStreamText = '';
let lastDraftGrowthAt = 0; // ms timestamp of the last draft-text change
let sessionLive = false;

// Rolling input buffer feeding fixed-size VAD windows.
let pending = new Float32Array(0);
let audioInSamples = 0;
let segmentCount = 0;
// Session clock in samples fed to the VAD; segment starts from both sources
// are rebased onto it (sherpa's own clock restarts on every reset).
let vadFedSamples = 0;
let vadBaseSamples = 0;

// Open-segment mirror: the VAD only hands over closed segments, so the open
// one is copied here for drafts and forced splits, and cleared on close.
let openChunks = [];
let openLen = 0;
let lastPartialLen = 0;
let partialGen = 0; // bumped on close so a stale in-flight partial is dropped
// Per-window RMS bookkeeping for valley splits.
let openRmsSum = 0;
let openWinCount = 0;
let recentRms = []; // last VALLEY_WINDOWS window RMS values
// Pre-roll: recent silent windows prepended when a segment opens.
const PRE_ROLL_WINDOWS = 19; // ~0.6s
let preRoll = [];
// Per-chunk RMS of the open segment, so a hard cut lands in a quiet window.
let openChunkRms = [];
// Carry-over after a forced cut: audio from the cut point to the VAD's next
// acknowledgment, prefixed to the next final without overlap.
let carry = null; // { chunks: Float32Array[], len, startSample }
let carryForDecode = null; // { samples: Float32Array, startSample }
const CUT_LOOKBACK_WINDOWS = 47; // ~1.5s in which to find the quietest window
const CUT_MIN_TAIL_WINDOWS = 8; // ~0.26s always kept for the next segment's head
const CARRY_MAX_S = 3; // a carry nobody re-acknowledges is finalized on its own

function rmsOf(arr) {
  let sumSq = 0;
  for (let i = 0; i < arr.length; i++) sumSq += arr[i] * arr[i];
  return Math.sqrt(sumSq / (arr.length || 1));
}

function concatChunks(chunks, len) {
  const out = new Float32Array(len);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}
// Level normalization ahead of the VAD (makeAgc); metrics read the raw signal.
const agc = makeAgc();

// Level + speech-time accumulators, reset each metrics window.
let rmsSum = 0;
let rmsCount = 0;
let rmsMax = 0;
let speechWindows = 0;

const isRepeat = makeRepeatTracker();
const watchdog = makeSignalWatchdog();
let lastHint = null;
let decodeChain = Promise.resolve();
let partialTimer = null;
let hintTimer = null;
let metricsTimer = null;
let lastCpu = null;
let lastMetricsMs = null;

// Called once from init with the loaded sherpa modules and the model paths
// the host declared; nothing is loaded until start().
function attach({ sherpa: mod, sherpaAddon: addon, models }) {
  sherpa = mod;
  sherpaAddon = addon;
  asrPaths = models?.asr || null;
  asrLanguage = normalizeLanguage(asrPaths?.language);
}

function normalizeLanguage(lang) {
  return ASR_LANGUAGES.has(lang) ? lang : '';
}

function start(msg) {
  if (!asrPaths) return fatal('asr-start without asr model paths');
  if (sessionLive) return;

  if (msg && msg.language !== undefined) {
    const lang = normalizeLanguage(msg.language);
    if (lang !== asrLanguage && recognizer) {
      // Language is baked into the recognizer config: rebuild.
      recognizer = null;
    }
    asrLanguage = lang;
  }

  const t0 = Date.now();
  try {
    // A resident worker must not carry a music-tuned VAD into the next session.
    if (vad && vadThreshold !== VAD_THRESHOLD_SPEECH) vad = null;
    if (!vad) {
      vadThreshold = VAD_THRESHOLD_SPEECH;
      vad = createVad(vadThreshold);
    }
    // A pin from the previous session must not leak into this one.
    if (pinnedLanguage && recognizer) recognizer = null;
    pinnedLanguage = '';
    langStreak = { lang: '', count: 0 };
    pendingPinLang = null;
    if (!recognizer) recognizer = createRecognizer(asrLanguage);
  } catch (err) {
    return fatal(`model load failed: ${err.message}`);
  }

  // Draft engine, only for zh/en or auto sessions; a load failure keeps pseudo.
  const canStream = asrLanguage === 'zh' || asrLanguage === 'en' || asrLanguage === '';
  if (canStream && asrPaths.streaming && !online) {
    try {
      online = new sherpa.OnlineRecognizer({
        featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
        modelConfig: {
          transducer: {
            encoder: asrPaths.streaming.encoder,
            decoder: asrPaths.streaming.decoder,
            joiner: asrPaths.streaming.joiner,
          },
          tokens: asrPaths.streaming.tokens,
          numThreads: 2,
          provider: 'cpu',
          debug: 0,
        },
        decodingMethod: 'greedy_search',
        enableEndpoint: 0, // segmentation stays with the VAD + layered splits
      });
      onlineStream = online.createStream();
    } catch (err) {
      logLine(eventRecord('stream-load-failed', err.message));
      online = null;
      onlineStream = null;
    }
  }
  partialEngine =
    online && (asrLanguage === 'zh' || asrLanguage === 'en') ? 'stream' : 'pseudo';
  autoEngineDecided = asrLanguage !== ''; // auto keeps the decision open
  if (hqActive()) {
    // No language tags to decide by: the draft engine as loaded, or finals only.
    partialEngine = online ? 'stream' : 'none';
    autoEngineDecided = true;
  }
  lastStreamText = '';

  const loadMs = Date.now() - t0;
  // Session-scoped counters.
  audioInSamples = 0;
  vadFedSamples = 0;
  vadBaseSamples = 0;
  segmentCount = 0;
  rmsSum = rmsCount = rmsMax = speechWindows = 0;
  vadPolicy = makeVadThresholdPolicy({ speech: VAD_THRESHOLD_SPEECH, music: VAD_THRESHOLD_MUSIC });
  vadRebuildTo = null;
  agc.reset();
  carry = null;
  carryForDecode = null;
  preRoll = [];
  hqCooldownUntil = 0;
  sessionLive = true;
  logLine({
    ts: Date.now(),
    type: 'asr_start',
    loadMs,
    language: asrLanguage || 'auto',
    engine: hqActive() ? 'qwen3-asr' : 'sense-voice',
    partialEngine,
    streamingPresent: !!asrPaths.streaming,
  });
  watchdog.start(Date.now());
  lastCpu = process.cpuUsage();
  lastMetricsMs = Date.now();

  hintTimer = setInterval(checkHint, 2000);
  metricsTimer = setInterval(emitMetrics, 30000);
  partialTimer = setInterval(maybeDecodePartial, PARTIAL_INTERVAL_MS);
  post({ type: 'asr-ready', loadMs });
}

// silero VAD; the numbers are explained in docs/design/listen.md §3.
function createVad(threshold) {
  return new sherpa.Vad(
    {
      sileroVad: {
        model: asrPaths.vadPath,
        threshold,
        minSpeechDuration: 0.15,
        minSilenceDuration: 0.5,
        maxSpeechDuration: 18,
        windowSize: VAD_WINDOW,
      },
      sampleRate: SAMPLE_RATE,
      numThreads: 1,
      debug: 0,
    },
    120
  );
}

function createRecognizer(language) {
  return new sherpa.OfflineRecognizer({
    featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
    modelConfig: {
      senseVoice: {
        model: asrPaths.modelPath,
        language,
        useInverseTextNormalization: 1,
      },
      tokens: asrPaths.tokensPath,
      numThreads: 2,
      provider: 'cpu',
      debug: 0,
    },
  });
}

// '<|zh|>' -> 'zh' for the languages the recognizer can be pinned to.
function tagToLanguage(tag) {
  const m = /^<\|([a-z]+)\|>$/.exec(tag || '');
  return m && m[1] && ASR_LANGUAGES.has(m[1]) ? m[1] : '';
}

function applyLanguagePin() {
  const lang = pendingPinLang;
  pendingPinLang = null;
  pinnedLanguage = lang;
  decodeChain = decodeChain
    .then(() => {
      recognizer = null; // release before loading the replacement (~230MB)
      recognizer = createRecognizer(lang);
      logLine(eventRecord('lang-pinned', lang));
      // The pin also settles the draft engine when the first final could not.
      if (!autoEngineDecided && online) {
        autoEngineDecided = true;
        if (lang === 'zh' || lang === 'en') {
          partialEngine = 'stream';
          logLine(eventRecord('partial-engine', `stream (pinned ${lang})`));
        } else {
          online = null;
          onlineStream = null;
          logLine(eventRecord('partial-engine', `pseudo (pinned ${lang})`));
        }
      }
    })
    .catch((err) => {
      logLine(eventRecord('lang-pin-failed', String(err.message)));
      pinnedLanguage = '';
      if (!recognizer) recognizer = createRecognizer(asrLanguage);
    });
}

// Only between segments (a fresh silero starts in its non-speech state).
function applyVadThreshold() {
  const next = vadRebuildTo;
  vadRebuildTo = null;
  try {
    vad = createVad(next);
    vadThreshold = next;
    vadBaseSamples = vadFedSamples; // new instance, new segment clock
    logLine(eventRecord('vad-threshold', String(next)));
  } catch (err) {
    logLine(eventRecord('vad-threshold-failed', String(err.message)));
  }
}

function checkHint() {
  capture.zeroLevelIfIdle(Date.now());
  const hint = watchdog.hint(Date.now());
  if (hint !== lastHint) {
    lastHint = hint;
    // The level rides along so a stall can be told from a quiet stream.
    if (hint) {
      logLine(eventRecord(hint, `rmsAvg=${(rmsCount ? rmsSum / rmsCount : 0).toFixed(4)} rmsMax=${rmsMax.toFixed(4)}`));
    }
    post({ type: 'hint', kind: hint });
    // Loud audio without finals: relax the VAD for the rest of the session.
    if (hint === 'no-speech' && vadThreshold === VAD_THRESHOLD_SPEECH) {
      const next = vadPolicy.hold();
      if (next !== null) {
        vadRebuildTo = next;
        logLine(eventRecord('vad-relax', `no-speech at ${vadThreshold}`));
      }
    }
  }
}

function emitMetrics() {
  const now = Date.now();
  const cpu = process.cpuUsage(lastCpu);
  const wallMs = now - lastMetricsMs;
  lastCpu = process.cpuUsage();
  lastMetricsMs = now;
  // Capture health (capture.js stats), when the worker owns the client.
  const capStats = capture.stats();
  const rec = metricsRecord({
    rssMb: process.memoryUsage().rss / 1024 / 1024,
    cpuPct: wallMs > 0 ? ((cpu.user + cpu.system) / 1000 / wallMs) * 100 : 0,
    audioInS: audioInSamples / SAMPLE_RATE,
    segments: segmentCount,
    rmsAvg: rmsCount ? rmsSum / rmsCount : 0,
    rmsMax,
    speechS: (speechWindows * VAD_WINDOW) / SAMPLE_RATE,
    vadThreshold,
    endpointDb: capStats?.endpointDb,
    agcGain: agc.gain(),
  });
  if (capStats) {
    rec.capSilent = capStats.silentPackets;
    rec.capGaps = capStats.discontinuities;
  }
  rmsSum = 0;
  rmsCount = 0;
  rmsMax = 0;
  speechWindows = 0;
  logLine(rec);
  post({ type: 'metrics', rec });
}

function handlePcm(samples) {
  if (!vad || !sessionLive) return;
  // Our own voice is playing: the audio goes nowhere.
  if (tts.gateBlocked(Date.now())) return;
  audioInSamples += samples.length;

  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) sumSq += samples[i] * samples[i];
  const chunkRms = Math.sqrt(sumSq / (samples.length || 1));
  rmsSum += chunkRms;
  rmsCount += 1;
  if (chunkRms > rmsMax) rmsMax = chunkRms;
  watchdog.onChunk(chunkRms, Date.now());

  if (openLen === 0 && !vad.isDetected() && vad.isEmpty()) {
    if (vadRebuildTo !== null) applyVadThreshold();
    if (pendingPinLang) applyLanguagePin();
  }

  const merged = new Float32Array(pending.length + samples.length);
  merged.set(pending, 0);
  merged.set(samples, pending.length);

  let offset = 0;
  try {
    while (offset + VAD_WINDOW <= merged.length) {
      const win = agc.process(merged.subarray(offset, offset + VAD_WINDOW));
      vad.acceptWaveform(win);
      vadFedSamples += VAD_WINDOW;
      offset += VAD_WINDOW;
      drainVadQueue();
      trackOpenSegment(win);
    }
  } catch (err) {
    return fatal(`vad failed: ${err.message}`);
  }
  pending = merged.subarray(offset);
}

// Streaming draft pass: feed a window, decode what is ready, emit on change.
// A draft-engine failure downgrades to pseudo for the rest of the session.
function feedStream(win) {
  if (partialEngine !== 'stream' || !online) return;
  try {
    onlineStream.acceptWaveform({ samples: win, sampleRate: SAMPLE_RATE });
    let steps = 0;
    while (online.isReady(onlineStream)) {
      online.decode(onlineStream);
      steps += 1;
    }
    if (steps > 0) {
      const text = (online.getResult(onlineStream).text || '').trim();
      if (text && text !== lastStreamText) {
        lastStreamText = text;
        lastDraftGrowthAt = Date.now();
        post({ type: 'partial', text });
      }
    }
  } catch (err) {
    logLine(eventRecord('stream-draft-failed', String(err.message)));
    partialEngine = hqActive() ? 'none' : 'pseudo';
    online = null;
    onlineStream = null;
  }
}

// Draft lane reset at segment boundaries (never on final landing).
function resetStreamDraft() {
  lastStreamText = '';
  if (online && onlineStream) {
    try {
      online.reset(onlineStream);
    } catch {
      // survivable — the next natural reset still applies
    }
  }
}

function trackOpenSegment(win) {
  if (vad.isDetected()) {
    speechWindows += 1;
    watchdog.onSpeech(Date.now());
    if (openLen === 0) {
      if (carry) {
        // The carried tail of the last cut is this segment's head.
        for (const c of carry.chunks) {
          openChunks.push(c);
          openChunkRms.push(rmsOf(c));
          openLen += c.length;
          feedStream(c);
        }
        carryForDecode = { samples: concatChunks(carry.chunks, carry.len), startSample: carry.startSample };
        carry = null;
        preRoll = [];
      } else if (preRoll.length) {
        // Segment just opened: prepend the pre-roll.
        for (const p of preRoll) {
          openChunks.push(p);
          openChunkRms.push(rmsOf(p));
          openLen += p.length;
          feedStream(p);
        }
        preRoll = [];
      }
    }
    const copy = new Float32Array(win);
    const rms = rmsOf(copy);
    openChunks.push(copy);
    openChunkRms.push(rms);
    openLen += copy.length;
    feedStream(copy);

    openRmsSum += rms;
    openWinCount += 1;
    recentRms.push(rms);
    if (recentRms.length > VALLEY_WINDOWS) recentRms.shift();

    // Split checks per window: hard cap, then text quiescence, then valley.
    if (openLen >= HARD_SPLIT_S * SAMPLE_RATE) return forceSplit('hard');
    if (openLen >= SOFT_SPLIT_FROM_S * SAMPLE_RATE) {
      if (
        partialEngine === 'stream' &&
        lastStreamText &&
        Date.now() - lastDraftGrowthAt >= TEXT_QUIESCENCE_MS
      ) {
        return forceSplit('quiet');
      }
      if (recentRms.length === VALLEY_WINDOWS) {
        const floor = Math.max(VALLEY_FLOOR, (openRmsSum / openWinCount) * VALLEY_RATIO);
        if (recentRms.every((r) => r < floor)) forceSplit('valley');
      }
    }
  } else if (carry) {
    // Between a forced cut and the VAD's re-acknowledgment.
    carry.chunks.push(new Float32Array(win));
    carry.len += win.length;
    if (carry.len >= CARRY_MAX_S * SAMPLE_RATE) flushCarry('carry-timeout');
  } else {
    preRoll.push(new Float32Array(win));
    if (preRoll.length > PRE_ROLL_WINDOWS) preRoll.shift();
    if (openLen > 0) {
      // Segment closed naturally; the final decode is queued by drainVadQueue.
      resetOpenSegment();
      resetStreamDraft();
      post({ type: 'partial', text: '' });
    }
  }
}

function resetOpenSegment() {
  openChunks = [];
  openLen = 0;
  lastPartialLen = 0;
  partialGen += 1; // stale in-flight partials get dropped
  openRmsSum = 0;
  openWinCount = 0;
  recentRms = [];
  openChunkRms = [];
}

// A carry nobody re-acknowledged gets its own final.
function flushCarry(reason) {
  if (!carry) return;
  const { chunks, len, startSample } = carry;
  carry = null;
  logLine(eventRecord('carry-flush', `${reason} ${(len / SAMPLE_RATE).toFixed(2)}s`));
  enqueueDecode({ samples: concatChunks(chunks, len), start: startSample });
}

// Force-close the open segment and reset the VAD. 'valley' / 'quiet' cut at
// the end; 'hard' cuts in the quietest recent window and carries the rest.
function forceSplit(reason) {
  let cutAfter = openChunks.length - 1;
  if (reason === 'hard') {
    const k = pickCutWindow(openChunkRms, { lookback: CUT_LOOKBACK_WINDOWS, minTail: CUT_MIN_TAIL_WINDOWS });
    if (k >= 0) cutAfter = k;
  }
  const head = openChunks.slice(0, cutAfter + 1);
  const tail = openChunks.slice(cutAfter + 1);
  const tailLen = tail.reduce((a, c) => a + c.length, 0);
  const buf = concatChunks(head, openLen - tailLen);
  const startSample = Math.max(0, vadFedSamples - openLen);
  resetOpenSegment();
  resetStreamDraft();
  try {
    vad.reset();
    vadBaseSamples = vadFedSamples; // sherpa's segment clock restarts here
  } catch {
    // reset failure is survivable — the next natural close still works
  }
  carry = tailLen ? { chunks: tail, len: tailLen, startSample: vadFedSamples - tailLen } : null;
  carryForDecode = null;
  logLine(eventRecord('force-split', `${reason} ${(buf.length / SAMPLE_RATE).toFixed(1)}s` + (tailLen ? ` carry ${(tailLen / SAMPLE_RATE).toFixed(2)}s` : '')));
  enqueueDecode({ samples: buf, start: startSample });
}

function maybeDecodePartial() {
  if (!sessionLive || !recognizer) return;
  // Pseudo drafts only: re-decode the open segment (stream drafts come from feedStream).
  if (partialEngine !== 'pseudo') return;
  if (openLen === 0 || openLen === lastPartialLen) return;
  lastPartialLen = openLen;

  const buf = new Float32Array(openLen);
  let off = 0;
  for (const c of openChunks) {
    buf.set(c, off);
    off += c.length;
  }
  const gen = partialGen;
  decodeChain = decodeChain
    .then(async () => {
      if (!recognizer || !sessionLive) return;
      const stream = recognizer.createStream();
      stream.acceptWaveform({ samples: buf, sampleRate: SAMPLE_RATE });
      const result = await decodeOffline(stream);
      // Segment closed while we were decoding — the '' clear already went out.
      if (gen !== partialGen) return;
      const text = (result.text || '').trim();
      if (text) post({ type: 'partial', text });
    })
    .catch((err) => fatal(`partial decode failed: ${err.message}`));
}

function drainVadQueue() {
  while (!vad.isEmpty()) {
    // enableExternalBuffer must stay false under Electron (docs/design/listen.md §7).
    const seg = vad.front(false);
    vad.pop();
    // Rebased: seg.start is relative to the last reset, not to the session.
    let samples = seg.samples;
    let start = vadBaseSamples + seg.start;
    if (carryForDecode) {
      // Prefix the carried head, minus whatever the VAD's own segment already
      // covers (its start can sit a few windows before the acknowledgment).
      const prefixLen = Math.min(carryForDecode.samples.length, Math.max(0, start - carryForDecode.startSample));
      if (prefixLen > 0) {
        const joined = new Float32Array(prefixLen + samples.length);
        joined.set(carryForDecode.samples.subarray(0, prefixLen), 0);
        joined.set(samples, prefixLen);
        samples = joined;
        start -= prefixLen;
      }
      carryForDecode = null;
    }
    enqueueDecode({ samples, start });
  }
}

function enqueueDecode(seg) {
  const queued = { ...seg, queuedAt: Date.now() };
  decodeChain = decodeChain
    .then(() => decodeSegment(queued))
    .catch((err) => fatal(`decode failed: ${err.message}`));
}

// Decode, re-reading the raw result when sherpa's JSON is malformed (asr-result.js).
async function decodeOffline(stream) {
  let result;
  try {
    result = await recognizer.decodeAsync(stream);
  } catch (err) {
    if (!(err instanceof SyntaxError)) throw err;
    logLine(eventRecord('result-unescaped', err.message));
    result = parseAsrResultJson(sherpaAddon.getOfflineStreamResultAsJson(stream.handle));
  }
  return result;
}

async function decodeLocal(samples) {
  const stream = recognizer.createStream();
  stream.acceptWaveform({ samples, sampleRate: SAMPLE_RATE });
  return decodeOffline(stream);
}

// One segment to the speech host; resolves with the main process's answer,
// or with a timeout after withdrawing the request.
function transcribeRemote(samples) {
  const id = ++hqSeq;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      hqWaiters.delete(id);
      post({ type: 'hq-cancel', id });
      resolve({ ok: false, code: 'timeout' });
    }, HQ_TIMEOUT_MS);
    hqWaiters.set(id, { resolve, timer });
    post({ type: 'hq-transcribe', id, samples: new Float32Array(samples) });
  });
}

// The main process's answer to an hq-transcribe.
function handleHqResult(msg) {
  const w = msg ? hqWaiters.get(msg.id) : null;
  if (!w) return;
  clearTimeout(w.timer);
  hqWaiters.delete(msg.id);
  w.resolve(msg);
}

// The host's final; SenseVoice's while the host cools down, when the segment
// queued too long, or when the host could not answer.
async function decodeHq(seg) {
  const now = Date.now();
  if (now < hqCooldownUntil) {
    logLine(eventRecord('hq-fallback', 'cooldown'));
    return decodeLocal(seg.samples);
  }
  const waited = now - seg.queuedAt;
  if (waited > HQ_BACKLOG_MS) {
    logLine(eventRecord('hq-fallback', `backlog ${waited}ms`));
    return decodeLocal(seg.samples);
  }
  const r = await transcribeRemote(seg.samples);
  if (r.ok) return { text: r.text || '', lang: '', event: '' };
  if (r.code === 'timeout') hqCooldownUntil = Date.now() + HQ_COOLDOWN_MS;
  logLine(eventRecord('hq-fallback', String(r.code || 'failed')));
  return decodeLocal(seg.samples);
}

async function decodeSegment(seg) {
  if (!recognizer) return;
  const t0 = Date.now();
  const result = hqActive() ? await decodeHq(seg) : await decodeLocal(seg.samples);
  const decodeMs = Date.now() - t0;
  const text = (result.text || '').trim();
  if (!text) return;
  if (result.event === '<|BGM|>' && isNegligibleFinal(text)) {
    // Breath-sized fragment over music: watchdog activity only.
    watchdog.onSegment(Date.now());
    logLine(eventRecord('dropped-short', `${text.length} chars`));
    return;
  }
  segmentCount += 1;
  watchdog.onSegment(Date.now());
  if (asrLanguage === '' && !pinnedLanguage && !pendingPinLang) {
    const lang = tagToLanguage(result.lang);
    if (lang) {
      langStreak = langStreak.lang === lang ? { lang, count: langStreak.count + 1 } : { lang, count: 1 };
      if (langStreak.count >= LANG_PIN_STREAK) pendingPinLang = lang;
    }
  }
  const rec = segmentRecord({
    segStartS: seg.start / SAMPLE_RATE,
    segDurS: seg.samples.length / SAMPLE_RATE,
    decodeMs,
    lang: result.lang,
    event: result.event,
    text,
    repeated: isRepeat(text),
  });
  // The log gets the record without its words unless the host opted in.
  logLine(textLogged() ? rec : { ...rec, text: undefined });
  post({ type: 'segment', rec });

  const nextThreshold = vadPolicy.onFinal(result.event);
  if (nextThreshold !== null) vadRebuildTo = nextThreshold;

  // Auto-language sessions: the first zh/en final switches drafts to the
  // streaming engine; any other tag waits for the language pin.
  if (!autoEngineDecided && online) {
    const lang = result.lang || '';
    if (lang === '<|zh|>' || lang === '<|en|>') {
      autoEngineDecided = true;
      partialEngine = 'stream';
      logLine(eventRecord('partial-engine', `stream (auto ${lang})`));
      for (const c of openChunks) feedStream(c);
    }
  }
}

function stop() {
  if (!sessionLive) return;
  // Capture first: no new audio may arrive while the VAD is flushing.
  capture.stop();
  sessionLive = false;
  if (partialTimer) clearInterval(partialTimer);
  if (hintTimer) clearInterval(hintTimer);
  if (metricsTimer) clearInterval(metricsTimer);
  partialTimer = hintTimer = metricsTimer = null;
  resetOpenSegment();
  flushCarry('stop');
  try {
    if (vad) {
      vad.flush();
      drainVadQueue();
    }
  } catch {
    // flush best-effort — final metrics still go out
  }
  decodeChain.then(() => {
    emitMetrics();
    logLine({
      ts: Date.now(),
      type: 'session_end',
      audioInS: audioInSamples / SAMPLE_RATE,
      segments: segmentCount,
    });
    post({ type: 'asr-stopped' });
  });
}

// Idle eviction / pack swap: release the model files between sessions.
function unload() {
  if (sessionLive) return;
  vad = null;
  vadThreshold = VAD_THRESHOLD_SPEECH;
  recognizer = null;
  pinnedLanguage = '';
  online = null;
  onlineStream = null;
  logLine(eventRecord('unload', 'asr'));
}

function stopTimers() {
  if (partialTimer) clearInterval(partialTimer);
  if (hintTimer) clearInterval(hintTimer);
  if (metricsTimer) clearInterval(metricsTimer);
  partialTimer = hintTimer = metricsTimer = null;
}

// Resolves once every queued decode has finished; shutdown waits on it.
const drain = () => decodeChain;

module.exports = { attach, start, stop, unload, handlePcm, handleHqResult, stopTimers, drain };
