// The ASR session inside the worker: silero VAD windows, the open-segment
// mirror with its layered forced splits, SenseVoice / Qwen3-ASR finals, the
// streaming draft engine, the language pin, the signal watchdog and the
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
const { parseAsrResultJson, stripAsrFrame } = require('./asr-result');
const { post, logLine, fatal, textLogged } = require('./io');
const capture = require('./capture');
const tts = require('./tts');

const SAMPLE_RATE = 16000;
const VAD_WINDOW = 512;
// 1.0s: RTF 0.033 leaves headroom even with a force-split-capped open segment
// re-decode sharing the chain with finals (was 1.5s; user verdict: sluggish).
const PARTIAL_INTERVAL_MS = 1000;
// Layered forced segmentation, aligned with the pro-subtitle ceiling of ~7s
// per cue (Netflix/BBC style) and sherpa's own endpointing philosophy (relax
// the acceptable-pause threshold as the segment drags on):
//   < SOFT s   only the VAD's 0.35s silence closes a segment (natural breaks)
//   >= SOFT s  valley split: the moment the last VALLEY_WINDOWS windows all
//              drop below an adaptive RMS floor (a breath, ~0.26s), finalize
//              right there — the cut AND the VAD re-acknowledgment both land
//              in silence, so nothing is lost
//   >= HARD s  hard split (sung vocals over BGM may never yield a valley).
//              Costs ~1-2 characters at the seam; the price of any output.
// sherpa's own maxSpeechDuration stays a distrusted backstop (21s/31s
// segments were logged under a 12/18 cap).
const SOFT_SPLIT_FROM_S = 5;
const HARD_SPLIT_S = 9;
const VALLEY_WINDOWS = 8; // x 512 samples = 0.256s of sustained quiet
// 0.3 (was 0.2): real BGM raises the energy floor, so at 0.2 valleys almost
// never fired on actual content (probe logs: 0/14 narration, 1/10 song) and
// hard 9s dominated. A false valley in music lands in an instrumental gap —
// which IS a sentence boundary — so widening is cheap.
const VALLEY_RATIO = 0.3;
const VALLEY_FLOOR = 1e-4; // absolute floor so near-digital-silence always counts
// Text-quiescence split (stream-draft sessions only): sung vocals and voiced
// pauses keep the ACOUSTIC floor high, but the draft engine stops emitting
// characters the moment the sentence ends — a semantic pause detector the
// two-pass architecture gives us for free (industry counterpart: endpoint
// rules on trailing non-emission, and neural caption segmentation replacing
// pause-based splits). 0.8s of no draft growth on a >=5s segment closes it.
const TEXT_QUIESCENCE_MS = 800;
// silero threshold by content: 0.5 for speech, 0.3 once the finals say the
// audio is music (sung vocals over a beat hover under 0.5 and whole lyric
// lines never open — 86% of lines at 0.5 vs 100% at 0.3 on a real song
// through process loopback, speech unaffected). The policy lives in
// probe-metrics; the swap happens only between segments.
const VAD_THRESHOLD_SPEECH = 0.5;
const VAD_THRESHOLD_MUSIC = 0.3;

const ASR_LANGUAGES = new Set(['zh', 'en', 'ja', 'ko', 'yue', '']);

let sherpa = null;
let sherpaAddon = null;
let asrPaths = null; // declared by init; loaded by asr-start
let asrLanguage = '';
let vad = null;
let vadThreshold = VAD_THRESHOLD_SPEECH;
let vadPolicy = makeVadThresholdPolicy({ speech: VAD_THRESHOLD_SPEECH, music: VAD_THRESHOLD_MUSIC });
let vadRebuildTo = null; // pending threshold change, applied at a segment boundary
let recognizer = null;
// High-accuracy tier (Qwen3-ASR), decided by the manager per session. Its
// results carry no language or BGM tags, so the language pin and the music
// VAD policy below simply never fire under it.
const hqActive = () => !!(asrPaths && asrPaths.useHq && asrPaths.hq);
// Auto-language sessions pin the recognizer to the first language that wins
// three finals in a row. SenseVoice's per-segment detection drifts on mixed or
// musical audio (a Chinese song drew ja/yue/en tags on 5 of 31 finals), and a
// segment decoded under the wrong language is garbage, not "less accurate".
// The pin rebuilds the recognizer once, between segments, inside the decode
// chain so no in-flight final sees a half-built model.
const LANG_PIN_STREAK = 3;
let pinnedLanguage = '';
let langStreak = { lang: '', count: 0 };
let pendingPinLang = null;
// Two-pass draft engine (optional): a streaming zipformer emits word-by-word
// drafts while SenseVoice keeps owning finals (spike report: first token
// ~0.86s, 13ms/chunk, zero hallucination over 23s). Per-session choice:
//   zh/en chosen            -> 'stream'
//   ja/ko/yue chosen        -> 'pseudo' (model has no such languages)
//   auto                    -> start 'pseudo', first final's lang tag decides
// Missing model / load failure -> 'pseudo' silently (drafts are a bonus, the
// final chain never depends on them).
let online = null;
let onlineStream = null;
let partialEngine = 'pseudo'; // 'pseudo' | 'stream'
let autoEngineDecided = false;
let lastStreamText = '';
let lastDraftGrowthAt = 0; // ms timestamp of the last draft-text change
let sessionLive = false;

// Rolling input buffer feeding fixed-size VAD windows.
let pending = new Float32Array(0);
let audioInSamples = 0;
let segmentCount = 0;
// Samples actually handed to the VAD, and the value that counter had at the
// last vad.reset(). Sherpa's own segment.start restarts at zero on every
// reset, and forced splits reset constantly — so raw VAD starts jump BACKWARDS
// mid-session and the exported SRT timeline goes with them (probe logs showed
// 17.10 -> 22.18 -> 0.23). Both segment sources are rebased onto this clock.
let vadFedSamples = 0;
let vadBaseSamples = 0;

// Open-segment accumulator for provisional decoding. VAD only hands over
// CLOSED segments; while isDetected() is true we mirror the audio ourselves,
// decode it every PARTIAL_INTERVAL_MS, and clear on close. The final decode of
// the closed segment then replaces the provisional text downstream — this is
// the v0.4.0 contract in miniature: transcript area mutable, translation only
// ever consumes finals.
let openChunks = [];
let openLen = 0;
let lastPartialLen = 0;
let partialGen = 0; // bumped on close so a stale in-flight partial is dropped
// Per-window RMS bookkeeping for valley splits.
let openRmsSum = 0;
let openWinCount = 0;
let recentRms = []; // last VALLEY_WINDOWS window RMS values
// Pre-roll: recent windows kept during silence. When detection flips on, the
// VAD's ~0.15s acknowledgment has already swallowed the utterance head —
// without this, every segment AFTER a forced split starts a character short
// ("些技术" for "这些技术" in the breath harness). 0.6s (was 0.32s): on read
// speech the VAD opens late by up to ~1.5s on soft onsets, and the longer
// head was part of the English pipeline going 14.7% -> 10.6% WER.
const PRE_ROLL_WINDOWS = 19; // ~0.6s
let preRoll = [];
// Per-chunk RMS of the open segment (every chunk is one VAD window), so a
// hard cut can land in the quietest recent window instead of at 9.0s sharp.
let openChunkRms = [];
// Carry-over after a forced cut: the audio from the cut point up to the VAD's
// next acknowledgment. It is the head of the next sentence — before this it
// was lost (every segment after a hard cut opened a letter or two short:
// "ut your", "rote about") — so it is carried explicitly, and prefixed to the
// next final without overlap using global sample positions.
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
// Level normalization ahead of the VAD (see makeAgc). Applied to the windows
// the VAD and the mirrored segments see; the level meter and the rms metrics
// keep reading the raw signal, so a quiet source still looks quiet in the log.
const agc = makeAgc();

// Level + speech-time accumulators, reset each metrics window. These exist
// because a session log without them cannot answer the only question a stall
// raises: was the audio quiet, or was the VAD deaf to audible audio?
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
      // Language is baked into the recognizer config — rebuild. (The probe
      // manager restarts the whole worker instead; this path serves the
      // future resident engine.)
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

  // Draft engine, loaded only when it can possibly serve this session (zh/en
  // or auto). Its failure is never fatal — worst case drafts stay pseudo.
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
    // Qwen3 finals carry no language tag, so the auto decision on the first
    // final can never happen: trust the draft engine outright when it is
    // loaded, and never re-decode drafts with a 1 GB model — finals only.
    partialEngine = online ? 'stream' : 'none';
    autoEngineDecided = true;
  }
  lastStreamText = '';

  const loadMs = Date.now() - t0;
  // Session-scoped counters. The manager forks a fresh worker per session
  // today, but the resident scheduler will not — a second session must not
  // inherit the first one's clock.
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

// silero ONLY. ten-vad was tried on 2026-08-27 and reverted the same day:
// sherpa's port drops the pitch feature, and on real music (the primary use
// case) it missed most sung vocals — 67s of a song yielded 3 fragment segments
// vs silero's continuous output. Don't re-add it from a clean-speech
// benchmark; it must beat silero on BGM logs first.
function createVad(threshold) {
  return new sherpa.Vad(
    {
      sileroVad: {
        model: asrPaths.vadPath,
        threshold,
        // 0.15 (was 0.25): faster onset acknowledgment.
        minSpeechDuration: 0.15,
        // 0.5 (was 0.35, before that 0.5): 0.35 chopped read sentences at
        // every comma into context-free fragments — FLEURS English pipeline
        // WER 14.7% at 0.35 vs 10.6% at 0.5 (0.6 no better), for +0.15s on
        // each final. The layered force-split below still bounds pause-free
        // speech, so the old "finals never appeared" failure cannot return.
        minSilenceDuration: 0.5,
        // 12 hard-cut 27% of segments (p90 14.9s). 18 clears p90;
        // SenseVoice degrades past ~20s, so no higher.
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
  if (hqActive()) {
    const hq = asrPaths.hq;
    return new sherpa.OfflineRecognizer({
      featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
      modelConfig: {
        qwen3Asr: {
          convFrontend: hq.convFrontend,
          encoder: hq.encoder,
          decoder: hq.decoder,
          tokenizer: hq.tokenizerDir,
          // Finals are ≤9s (hard split), so 512 new tokens is generous. Past
          // its context the model degrades to garbage — another reason the
          // VAD gate is never bypassed for this engine.
          maxNewTokens: 512,
          maxTotalLen: 1024,
          temperature: 0,
          topP: 1,
          seed: 0,
          hotwords: '',
        },
        numThreads: 2,
        provider: 'cpu',
        debug: 0,
      },
    });
  }
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

// Only between segments: a fresh silero starts in its non-speech state, so
// swapping it mid-utterance would drop the rest of that utterance.
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
    // The level goes in the log line: 'no-speech' at rmsMax 0.15 means the VAD
    // was deaf to audible audio, the same hint at rmsMax 0.0005 means the
    // stream really was quiet. Without this the two are indistinguishable
    // afterwards, which is exactly where a stall investigation stalls.
    if (hint) {
      logLine(eventRecord(hint, `rmsAvg=${(rmsCount ? rmsSum / rmsCount : 0).toFixed(4)} rmsMax=${rmsMax.toFixed(4)}`));
    }
    post({ type: 'hint', kind: hint });
    // Loud audio and no final for 12s: whatever this is, 0.5 is not opening
    // on it (36s of audible English through one player did exactly that).
    // Relax for the rest of the session instead of just saying so.
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
  // Capture health, when capture is ours: silent packets mean the OS handed us
  // digital silence (the source stopped), discontinuities mean the pump fell
  // behind. Both look identical in the PCM.
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
  if (tts.gateBlocked(Date.now())) {
    // Dropped on the floor: not into the VAD, not into the level meter (which
    // the UI greys out for the gate), not into the open segment.
    return;
  }
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

// Mirror the open segment window-by-window. Copies, not views — a subarray
// would pin the whole per-callback merge buffer.
// Streaming draft pass: feed a window, decode whatever is ready (13ms per
// 200ms of audio, measured), emit on text change. A draft-engine failure
// downgrades to pseudo for the rest of the session — never fatal.
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

// The draft lane resets at segment boundaries (natural close and forced
// splits): the boundary moment is silence, so nothing in-flight is lost —
// resetting on final landing instead would drop the next segment's head,
// which streams in while the final still decodes.
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
        // A forced cut just happened and the speech went on: the carried
        // audio is this segment's head. The pre-roll would only duplicate it.
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
        // Segment just opened: prepend the pre-roll so the mirrored audio has
        // the utterance head the acknowledgment window swallowed. Mostly
        // silence plus the first ~0.15s of speech; SenseVoice doesn't mind
        // leading quiet.
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

    // All splits checked per window (32ms). Priority: hard cap, then the
    // semantic (text-quiescence) signal, then the acoustic valley.
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
    // Between a forced cut and the VAD's re-acknowledgment: still the same
    // stretch of speech, so it belongs with the carried head, not the pre-roll.
    carry.chunks.push(new Float32Array(win));
    carry.len += win.length;
    if (carry.len >= CARRY_MAX_S * SAMPLE_RATE) flushCarry('carry-timeout');
  } else {
    preRoll.push(new Float32Array(win));
    if (preRoll.length > PRE_ROLL_WINDOWS) preRoll.shift();
    if (openLen > 0) {
      // Segment closed naturally: the final decode is already queued via
      // drainVadQueue.
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

// The speech ended at (or right after) a forced cut and the VAD never
// re-acknowledged: whatever was carried is the tail of that sentence and
// gets its own final rather than waiting forever for a segment to join.
function flushCarry(reason) {
  if (!carry) return;
  const { chunks, len, startSample } = carry;
  carry = null;
  logLine(eventRecord('carry-flush', `${reason} ${(len / SAMPLE_RATE).toFixed(2)}s`));
  enqueueDecode({ samples: concatChunks(chunks, len), start: startSample });
}

// Force-close the open segment: finalize the mirrored audio ourselves and
// reset the VAD so it starts a fresh one. The VAD has not closed, so its
// queue is empty — nothing double-decodes. 'valley' and 'quiet' cuts are
// already at a pause and cut at the end. A 'hard' cut lands in the quietest
// window of the last ~1.5s (between words far more often than 9.0s sharp),
// and everything after that window is carried into the next segment.
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
  // Same shape as a VAD-closed segment; the final replaces the gray line
  // on screen exactly like a natural close.
  enqueueDecode({ samples: buf, start: startSample });
}

function maybeDecodePartial() {
  if (!sessionLive || !recognizer) return;
  // Streaming drafts come word-by-word from feedStream; the pseudo re-decode
  // below only serves sessions the draft engine cannot (ja/ko/yue, no model).
  // 'none' = high-accuracy tier without a draft engine: finals only.
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
    // enableExternalBuffer=false is mandatory under Electron: the V8 memory
    // cage rejects napi external ArrayBuffers ("External buffers are not
    // allowed"), and it only triggers on the FIRST detected speech segment —
    // silence-only runs never reach this call.
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
  decodeChain = decodeChain
    .then(() => decodeSegment(seg))
    .catch((err) => fatal(`decode failed: ${err.message}`));
}

// The wrapper's decodeAsync JSON.parses the result itself and throws on an
// unescaped control character; by then the decode has finished, so the raw
// result is re-read from the stream and parsed leniently instead of letting
// one hallucinated "\n" take the whole host down.
async function decodeOffline(stream) {
  let result;
  try {
    result = await recognizer.decodeAsync(stream);
  } catch (err) {
    if (!(err instanceof SyntaxError)) throw err;
    logLine(eventRecord('result-unescaped', err.message));
    result = parseAsrResultJson(sherpaAddon.getOfflineStreamResultAsJson(stream.handle));
  }
  result.text = stripAsrFrame(result.text);
  return result;
}

async function decodeSegment(seg) {
  if (!recognizer) return;
  const stream = recognizer.createStream();
  stream.acceptWaveform({ samples: seg.samples, sampleRate: SAMPLE_RATE });
  const t0 = Date.now();
  const result = await decodeOffline(stream);
  const decodeMs = Date.now() - t0;
  const text = (result.text || '').trim();
  if (!text) return;
  if (result.event === '<|BGM|>' && isNegligibleFinal(text)) {
    // A breath-sized fragment over music: activity for the watchdog, but
    // never a subtitle line or a translation call.
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
  // The record goes two ways and they are not the same trust level: the
  // renderer needs the text to draw a subtitle, the on-disk log does not need
  // it at all. Tuning (segment length, gaps, RTF, repeats) reads the metrics;
  // only a developer chasing a wrong transcription needs the words, and that
  // is what TT_LISTEN_LOG_TEXT is for. Default: nothing the user heard is
  // written to disk.
  logLine(textLogged() ? rec : { ...rec, text: undefined });
  post({ type: 'segment', rec });

  const nextThreshold = vadPolicy.onFinal(result.event);
  if (nextThreshold !== null) vadRebuildTo = nextThreshold;

  // Auto-language sessions: the first zh/en final switches the drafts to the
  // streaming engine (catching up on the audio already mirrored). A first
  // final tagged anything else is NOT trusted to free the draft engine — on a
  // song intro that tag is noise (yue/ja over an instrumental) — the language
  // pin below makes that call once three finals agree.
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

module.exports = { attach, start, stop, unload, handlePcm, stopTimers, drain };
