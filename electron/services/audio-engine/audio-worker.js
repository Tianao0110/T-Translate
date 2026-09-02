// Audio engine worker — ASR now, TTS protocol slot for v0.4.x. Runs inside an
// Electron utilityProcess so a native/model crash never takes the main process
// down. One process for both capabilities on purpose: they share a single
// sherpa/onnxruntime copy, and "no TTS while transcribing" is a product rule,
// so there is no concurrency to arbitrate.
//
// Capture lives here too since v0.4.1: the native WASAPI layer
// (utils/win-audio-capture) hands 16 kHz mono float32 straight to the VAD, so
// audio never crosses a process boundary before it is recognized — no renderer
// round trip, no resampler, and no screen-capture request.
//
// Protocol (process.parentPort):
//   in : {type:'init', models:{asr?:{modelPath,tokensPath,vadPath,language?}},
//         logPath, logText, meta}        declare paths + open log; loads nothing
//        {type:'asr-start', language?}   load ASR if needed, begin a session
//        {type:'capture-start', mode, pid}  'system' | 'include' | 'exclude'
//        {type:'capture-stop'}           release the audio client
//        {type:'pcm', samples}           inject 16 kHz mono float32 instead of
//                                        capturing (smoke harness replaying a
//                                        wav). Main-process only — no renderer
//                                        channel reaches this since v0.4.1
//        {type:'asr-stop'}               flush session, keep models warm
//        {type:'unload', what}           'asr'|'tts' — idle-eviction hook for
//                                        the future resident scheduler
//        {type:'shutdown'}               graceful process exit
//        {type:'tts-generate'|'tts-cancel'}  reserved (v0.4.x) — see below
//   out: {type:'ready'}                  init done (nothing loaded yet)
//        {type:'asr-ready', loadMs}      ASR loaded + session live
//        {type:'partial', text}          open-segment provisional text; ''
//                                        clears it (segment closed)
//        {type:'segment', rec} | {type:'hint', kind} | {type:'metrics', rec}
//        {type:'capture-started', mode} | {type:'capture-error', message}
//        {type:'capture-event', kind, detail}  device lost / reacquired
//        {type:'level', value}            0..1-ish capture RMS, ~12/s
//        {type:'asr-stopped'} | {type:'fatal', message}
//
// TTS slot (NOT implemented here — v0.4.x): tts-generate {id, text, sid,
// speed} → tts-result {id, samples, sampleRate} | tts-error {id, message};
// tts-cancel {id} = drop the result (sherpa generate cannot be interrupted).
// ⚠ When implementing: TtsRequest.enableExternalBuffer MUST be false — same
// Electron V8-cage landmine as Vad.front(false) below, and it only explodes
// on the first real synthesis.
//
// Audio frames are transcribed and dropped — nothing here ever writes audio to
// disk. The JSONL session log (local only) carries timing metrics; the
// recognized WORDS stay out of it unless the host passes logText (env
// TT_LISTEN_LOG_TEXT=1), so watching a video leaves no transcript behind.

const fs = require('fs');
const {
  makeRepeatTracker,
  segmentRecord,
  eventRecord,
  metricsRecord,
  makeSignalWatchdog,
  makeVadThresholdPolicy,
} = require('./probe-metrics');

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
let asrPaths = null; // declared by init; loaded by asr-start
let asrLanguage = '';
let vad = null;
let vadThreshold = VAD_THRESHOLD_SPEECH;
let vadPolicy = makeVadThresholdPolicy({ speech: VAD_THRESHOLD_SPEECH, music: VAD_THRESHOLD_MUSIC });
let vadRebuildTo = null; // pending threshold change, applied at a segment boundary
let recognizer = null;
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
let logStream = null;
// Recognized text is kept OUT of the session log unless the host says otherwise
// (TT_LISTEN_LOG_TEXT=1). Metrics alone answer every tuning question.
let logText = false;
let sessionLive = false;
let shuttingDown = false;

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
// ("些技术" for "这些技术" in the breath harness).
const PRE_ROLL_WINDOWS = 10; // ~0.32s
let preRoll = [];

// Native capture handle (utils/win-audio-capture). Null whenever no audio is
// being pulled — the zero-idle rule applies to the audio client too.
let capture = null;
let lastLevelPostAt = 0;
const LEVEL_INTERVAL_MS = 80;

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

function post(msg) {
  try {
    process.parentPort.postMessage(msg);
  } catch {
    // parent gone — nothing sane left to do
  }
}

function logLine(rec) {
  if (!logStream) return;
  try {
    logStream.write(JSON.stringify(rec) + '\n');
  } catch {
    // log failure must never break transcription
  }
}

function fatal(message) {
  logLine(eventRecord('fatal', message));
  post({ type: 'fatal', message: String(message) });
  teardown(() => process.exit(1));
}

function handleInit(msg) {
  try {
    sherpa = require('sherpa-onnx-node');
  } catch (err) {
    return fatal(`sherpa-onnx-node load failed: ${err.message}`);
  }
  try {
    logStream = fs.createWriteStream(msg.logPath, { flags: 'a' });
  } catch (err) {
    return fatal(`log open failed: ${err.message}`);
  }

  asrPaths = msg.models?.asr || null;
  asrLanguage = normalizeLanguage(asrPaths?.language);
  logText = msg.logText === true;
  logLine({ ts: Date.now(), type: 'session_start', logText, ...(msg.meta || {}) });
  post({ type: 'ready' });
}

function normalizeLanguage(lang) {
  return ASR_LANGUAGES.has(lang) ? lang : '';
}

function handleAsrStart(msg) {
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
    if (!recognizer) {
      recognizer = new sherpa.OfflineRecognizer({
        featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
        modelConfig: {
          senseVoice: {
            model: asrPaths.modelPath,
            language: asrLanguage,
            useInverseTextNormalization: 1,
          },
          tokens: asrPaths.tokensPath,
          numThreads: 2,
          provider: 'cpu',
          debug: 0,
        },
      });
    }
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
  sessionLive = true;
  logLine({
    ts: Date.now(),
    type: 'asr_start',
    loadMs,
    language: asrLanguage || 'auto',
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
        // 0.35 (was 0.5): video narration pauses often sit under 0.5s, so
        // 0.5 never closed a segment there (user-visible: finals never
        // appeared). The 0.83s gap-p25 from probe logs only argued against
        // RAISING it. Force-split below covers truly pause-free speech.
        minSilenceDuration: 0.35,
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
  const capStats = capture?.stats?.();
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

// ===== capture =====

async function handleCaptureStart(msg) {
  stopCapture();
  try {
    // Required lazily: a machine without the native layer must still be able
    // to load models and report a clean capture error, not fail at import.
    const winAudio = require('../../utils/win-audio-capture');
    capture = await winAudio.startCapture({
      mode: msg.mode || 'system',
      pid: msg.pid || 0,
      onPcm: (pcm) => {
        emitLevel(pcm);
        handlePcm(pcm);
      },
      onEvent: (kind, detail) => {
        logLine(eventRecord(kind, detail));
        post({ type: 'capture-event', kind, detail });
      },
    });
    logLine(eventRecord('capture-start', capture.mode + (msg.pid ? ` pid=${msg.pid}` : '')));
    post({ type: 'capture-started', mode: capture.mode });
  } catch (err) {
    capture = null;
    logLine(eventRecord('capture-failed', String(err.message)));
    post({ type: 'capture-error', message: String(err.message) });
  }
}

function stopCapture() {
  if (!capture) return;
  try {
    capture.stop();
  } catch {
    // already torn down
  }
  capture = null;
  post({ type: 'level', value: 0 }); // the meter must not freeze on the last loud frame
}

// Same curve the renderer used to compute from its own audio callback, kept
// identical so the meter behaves exactly as before the capture moved here.
function emitLevel(samples) {
  const now = Date.now();
  if (now - lastLevelPostAt < LEVEL_INTERVAL_MS) return;
  lastLevelPostAt = now;
  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) sumSq += samples[i] * samples[i];
  const rms = Math.sqrt(sumSq / (samples.length || 1));
  post({ type: 'level', value: Math.min(1, Math.sqrt(rms) * 2.2) });
}

function handlePcm(samples) {
  if (!vad || !sessionLive) return;
  audioInSamples += samples.length;

  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) sumSq += samples[i] * samples[i];
  const chunkRms = Math.sqrt(sumSq / (samples.length || 1));
  rmsSum += chunkRms;
  rmsCount += 1;
  if (chunkRms > rmsMax) rmsMax = chunkRms;
  watchdog.onChunk(chunkRms, Date.now());

  if (vadRebuildTo !== null && openLen === 0 && !vad.isDetected() && vad.isEmpty()) applyVadThreshold();

  const merged = new Float32Array(pending.length + samples.length);
  merged.set(pending, 0);
  merged.set(samples, pending.length);

  let offset = 0;
  try {
    while (offset + VAD_WINDOW <= merged.length) {
      const win = merged.subarray(offset, offset + VAD_WINDOW);
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
    partialEngine = 'pseudo';
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
    // Segment just opened: prepend the pre-roll so the mirrored audio has the
    // utterance head the acknowledgment window swallowed. Mostly silence plus
    // the first ~0.15s of speech; SenseVoice doesn't mind leading quiet.
    if (openLen === 0 && preRoll.length) {
      for (const p of preRoll) {
        openChunks.push(p);
        openLen += p.length;
        feedStream(p);
      }
      preRoll = [];
    }
    const copy = new Float32Array(win);
    openChunks.push(copy);
    openLen += copy.length;
    feedStream(copy);

    let sumSq = 0;
    for (let i = 0; i < win.length; i++) sumSq += win[i] * win[i];
    const rms = Math.sqrt(sumSq / win.length);
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
}

// Force-close the open segment: finalize the mirrored audio ourselves and
// reset the VAD so it starts a fresh one. The VAD has not closed, so its
// queue is empty — nothing double-decodes. On a 'valley' split both the cut
// and the VAD re-acknowledgment land inside the quiet dip (lossless); a
// 'hard' split costs ~1-2 characters at the seam.
function forceSplit(reason) {
  const buf = new Float32Array(openLen);
  let off = 0;
  for (const c of openChunks) {
    buf.set(c, off);
    off += c.length;
  }
  const startSample = Math.max(0, vadFedSamples - openLen);
  resetOpenSegment();
  resetStreamDraft();
  try {
    vad.reset();
    vadBaseSamples = vadFedSamples; // sherpa's segment clock restarts here
  } catch {
    // reset failure is survivable — the next natural close still works
  }
  logLine(eventRecord('force-split', `${reason} ${(buf.length / SAMPLE_RATE).toFixed(1)}s`));
  // Same shape as a VAD-closed segment; the final replaces the gray line
  // on screen exactly like a natural close.
  enqueueDecode({ samples: buf, start: startSample });
}

function maybeDecodePartial() {
  if (!sessionLive || !recognizer) return;
  // Streaming drafts come word-by-word from feedStream; the pseudo re-decode
  // below only serves sessions the draft engine cannot (ja/ko/yue, no model).
  if (partialEngine === 'stream') return;
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
      const result = await recognizer.decodeAsync(stream);
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
    enqueueDecode({ samples: seg.samples, start: vadBaseSamples + seg.start });
  }
}

function enqueueDecode(seg) {
  decodeChain = decodeChain
    .then(() => decodeSegment(seg))
    .catch((err) => fatal(`decode failed: ${err.message}`));
}

async function decodeSegment(seg) {
  if (!recognizer) return;
  const stream = recognizer.createStream();
  stream.acceptWaveform({ samples: seg.samples, sampleRate: SAMPLE_RATE });
  const t0 = Date.now();
  const result = await recognizer.decodeAsync(stream);
  const decodeMs = Date.now() - t0;
  const text = (result.text || '').trim();
  if (!text) return;
  segmentCount += 1;
  watchdog.onSegment(Date.now());
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
  logLine(logText ? rec : { ...rec, text: undefined });
  post({ type: 'segment', rec });

  const nextThreshold = vadPolicy.onFinal(result.event);
  if (nextThreshold !== null) vadRebuildTo = nextThreshold;

  // Auto-language sessions: the first final's language tag decides the draft
  // engine once and for all. zh/en -> switch to streaming drafts (catching up
  // on the audio already mirrored); anything else -> free the draft engine.
  if (!autoEngineDecided && online) {
    autoEngineDecided = true;
    const lang = result.lang || '';
    if (lang === '<|zh|>' || lang === '<|en|>') {
      partialEngine = 'stream';
      logLine(eventRecord('partial-engine', `stream (auto ${lang})`));
      for (const c of openChunks) feedStream(c);
    } else {
      online = null;
      onlineStream = null;
      logLine(eventRecord('partial-engine', `pseudo (auto ${lang})`));
    }
  }
}

function handleAsrStop() {
  if (!sessionLive) return;
  // Capture first: no new audio may arrive while the VAD is flushing.
  stopCapture();
  sessionLive = false;
  if (partialTimer) clearInterval(partialTimer);
  if (hintTimer) clearInterval(hintTimer);
  if (metricsTimer) clearInterval(metricsTimer);
  partialTimer = hintTimer = metricsTimer = null;
  resetOpenSegment();
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

function handleUnload(what) {
  if (what === 'asr' && !sessionLive) {
    vad = null;
    vadThreshold = VAD_THRESHOLD_SPEECH;
    recognizer = null;
    online = null;
    onlineStream = null;
    logLine(eventRecord('unload', 'asr'));
  }
  // 'tts' becomes meaningful in v0.4.x
}

function handleShutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  decodeChain.then(() => teardown(() => process.exit(0)));
}

function teardown(done) {
  stopCapture();
  if (partialTimer) clearInterval(partialTimer);
  if (hintTimer) clearInterval(hintTimer);
  if (metricsTimer) clearInterval(metricsTimer);
  if (logStream) {
    const s = logStream;
    logStream = null;
    s.end(done);
    return;
  }
  done();
}

process.parentPort.on('message', (e) => {
  const msg = e.data;
  if (!msg || !msg.type) return;
  switch (msg.type) {
    case 'init': return handleInit(msg);
    case 'asr-start': return handleAsrStart(msg);
    case 'capture-start': return handleCaptureStart(msg);
    case 'pcm': return handlePcm(msg.samples);
    case 'capture-stop': return stopCapture();
    case 'asr-stop': return handleAsrStop();
    case 'unload': return handleUnload(msg.what);
    case 'shutdown': return handleShutdown();
    case 'tts-generate':
      // Protocol slot only — engine lands in v0.4.x.
      return post({ type: 'tts-error', id: msg.id, message: 'tts-not-implemented' });
    case 'tts-cancel': return;
    default: return;
  }
});
