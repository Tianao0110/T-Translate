// ASR probe worker — runs inside an Electron utilityProcess so a native/model
// crash never takes the main process down. Speaks to the manager over
// process.parentPort:
//   in : {type:'init', modelPath, tokensPath, vadPath, logPath, meta}
//        {type:'pcm', samples: Float32Array}   16 kHz mono, [-1, 1]
//        {type:'stop'}
//   out: {type:'ready', loadMs} | {type:'segment', rec} | {type:'hint', kind}
//        {type:'metrics', rec} | {type:'stopped'} | {type:'fatal', message}
//
// Audio frames are transcribed and dropped — nothing here ever writes audio to
// disk. The JSONL probe log (local only) carries text and timing metrics.

const fs = require('fs');
const {
  makeRepeatTracker,
  segmentRecord,
  eventRecord,
  metricsRecord,
  makeSignalWatchdog,
} = require('./probe-metrics');

const SAMPLE_RATE = 16000;
const VAD_WINDOW = 512;

let vad = null;
let recognizer = null;
let logStream = null;
let stopping = false;

// Rolling input buffer feeding fixed-size VAD windows.
let pending = new Float32Array(0);
let audioInSamples = 0;
let segmentCount = 0;

const isRepeat = makeRepeatTracker();
const watchdog = makeSignalWatchdog();
let lastHint = null;
let decodeChain = Promise.resolve();
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
  const t0 = Date.now();
  let sherpa;
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

  try {
    vad = new sherpa.Vad(
      {
        sileroVad: {
          model: msg.vadPath,
          threshold: 0.5,
          minSpeechDuration: 0.25,
          minSilenceDuration: 0.5,
          // 12s (spike used 8s) — the spike showed 8s hard-cuts splitting
          // sentences mid-word; the probe log will tell us the right value.
          maxSpeechDuration: 12,
          windowSize: VAD_WINDOW,
        },
        sampleRate: SAMPLE_RATE,
        numThreads: 1,
        debug: 0,
      },
      120
    );
    recognizer = new sherpa.OfflineRecognizer({
      featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
      modelConfig: {
        senseVoice: { model: msg.modelPath, language: '', useInverseTextNormalization: 1 },
        tokens: msg.tokensPath,
        numThreads: 2,
        provider: 'cpu',
        debug: 0,
      },
    });
  } catch (err) {
    return fatal(`model load failed: ${err.message}`);
  }

  const loadMs = Date.now() - t0;
  logLine({ ts: Date.now(), type: 'session_start', loadMs, ...(msg.meta || {}) });
  watchdog.start(Date.now());
  lastCpu = process.cpuUsage();
  lastMetricsMs = Date.now();

  hintTimer = setInterval(checkHint, 2000);
  metricsTimer = setInterval(emitMetrics, 30000);
  post({ type: 'ready', loadMs });
}

function checkHint() {
  const hint = watchdog.hint(Date.now());
  if (hint !== lastHint) {
    lastHint = hint;
    if (hint) logLine(eventRecord(hint));
    post({ type: 'hint', kind: hint });
  }
}

function emitMetrics() {
  const now = Date.now();
  const cpu = process.cpuUsage(lastCpu);
  const wallMs = now - lastMetricsMs;
  lastCpu = process.cpuUsage();
  lastMetricsMs = now;
  const rec = metricsRecord({
    rssMb: process.memoryUsage().rss / 1024 / 1024,
    cpuPct: wallMs > 0 ? ((cpu.user + cpu.system) / 1000 / wallMs) * 100 : 0,
    audioInS: audioInSamples / SAMPLE_RATE,
    segments: segmentCount,
  });
  logLine(rec);
  post({ type: 'metrics', rec });
}

function handlePcm(samples) {
  if (!vad || stopping) return;
  audioInSamples += samples.length;

  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) sumSq += samples[i] * samples[i];
  watchdog.onChunk(Math.sqrt(sumSq / (samples.length || 1)), Date.now());

  const merged = new Float32Array(pending.length + samples.length);
  merged.set(pending, 0);
  merged.set(samples, pending.length);

  let offset = 0;
  try {
    while (offset + VAD_WINDOW <= merged.length) {
      vad.acceptWaveform(merged.subarray(offset, offset + VAD_WINDOW));
      offset += VAD_WINDOW;
      drainVadQueue();
    }
  } catch (err) {
    return fatal(`vad failed: ${err.message}`);
  }
  pending = merged.subarray(offset);
}

function drainVadQueue() {
  while (!vad.isEmpty()) {
    // enableExternalBuffer=false is mandatory under Electron: the V8 memory
    // cage rejects napi external ArrayBuffers ("External buffers are not
    // allowed"), and it only triggers on the FIRST detected speech segment —
    // silence-only runs never reach this call.
    const seg = vad.front(false);
    vad.pop();
    enqueueDecode(seg);
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
  logLine(rec);
  post({ type: 'segment', rec });
}

function handleStop() {
  if (stopping) return;
  stopping = true;
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
    post({ type: 'stopped' });
    teardown(() => process.exit(0));
  });
}

function teardown(done) {
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
  if (msg.type === 'init') return handleInit(msg);
  if (msg.type === 'pcm') return handlePcm(msg.samples);
  if (msg.type === 'event') return logLine(eventRecord(msg.kind, msg.detail));
  if (msg.type === 'stop') return handleStop();
});
