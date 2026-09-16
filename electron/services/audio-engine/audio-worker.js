// Audio engine worker — ASR and neural TTS. Runs inside an Electron
// utilityProcess so a native/model crash never takes the main process down.
// One process for both capabilities on purpose: they share a single
// sherpa/onnxruntime copy. Synthesis runs on the addon's own thread, so a
// listen session and a spoken subtitle line only compete for CPU.
//
// Capture lives here too since v0.4.1: the native WASAPI layer
// (listen/win-audio-capture) hands 16 kHz mono float32 straight to the VAD, so
// audio never crosses a process boundary before it is recognized — no renderer
// round trip, no resampler, and no screen-capture request.
//
// Protocol (process.parentPort):
//   in : {type:'init', models:{asr?:{modelPath,tokensPath,vadPath,language?}},
//         logPath?, logText, meta}       declare paths + open log; loads
//                                        nothing. No logPath = no log file (a
//                                        TTS-only process has no session)
//        {type:'asr-start', language?}   load ASR if needed, begin a session
//        {type:'capture-start', mode, pid}  'system' | 'include' | 'exclude'
//        {type:'capture-stop'}           release the audio client
//        {type:'pcm', samples}           inject 16 kHz mono float32 instead of
//                                        capturing (smoke harness replaying a
//                                        wav). Main-process only — no renderer
//                                        channel reaches this since v0.4.1
//        {type:'asr-stop'}               flush session, keep models warm
//        {type:'unload', what}           'asr'|'tts' — release that engine's
//                                        model files (idle eviction, pack swap)
//        {type:'log-close'}              stop the session log (secure mode
//                                        entered mid-session); session goes on
//        {type:'shutdown'}               graceful process exit
//        {type:'tts-load', pack}         load a voice pack (see TTS below)
//        {type:'tts-generate', id, text, sid, speed, pack?}
//        {type:'tts-cancel', id}
//        {type:'tts-gate', on}           a window is playing TTS: drop captured
//                                        audio until off (+300ms tail)
//   out: {type:'ready'}                  init done (nothing loaded yet)
//        {type:'asr-ready', loadMs}      ASR loaded + session live
//        {type:'partial', text}          open-segment provisional text; ''
//                                        clears it (segment closed)
//        {type:'segment', rec} | {type:'hint', kind} | {type:'metrics', rec}
//        {type:'capture-started', mode} | {type:'capture-error', message}
//        {type:'capture-event', kind, detail}  device lost / reacquired
//        {type:'level', value}            0..1-ish capture RMS, ~12/s
//        {type:'asr-stopped'} | {type:'fatal', message}
//        {type:'tts-ready', packId, loadMs, numSpeakers, sampleRate}
//        {type:'tts-chunk', id, samples, sampleRate, progress}  one sentence
//                                        of audio at a time — the renderer
//                                        starts playing at the first chunk
//        {type:'tts-done', id, cancelled, audioS, genMs}
//        {type:'tts-error', id?, packId?, message} | {type:'tts-unloaded'}
//
// TTS: `pack` is {id, engine:'kokoro'|'vits', paths:{model, tokens, voices?,
// dataDir?, dictDir?, lexicon[], ruleFsts[]}} resolved by the host from an
// installed pack.json (tts/tts-models). One pack loaded at a time; a
// generate naming another pack swaps it first. Synthesis is serialized, and a
// cancel makes the progress callback return 0, which stops sherpa mid-text.
// ⚠ TtsRequest.enableExternalBuffer MUST be false — same Electron V8-cage
// landmine as Vad.front(false) below, and it only explodes on the first real
// synthesis.
//
// Audio frames are transcribed and dropped — nothing here ever writes audio to
// disk. The JSONL session log (local only) carries timing metrics; the
// recognized WORDS stay out of it unless the host passes logText (env
// TT_LISTEN_LOG_TEXT=1), so watching a video leaves no transcript behind.

const io = require('./io');
const asr = require('./asr-session');
const capture = require('./capture');
const tts = require('./tts');

let shuttingDown = false;

function handleInit(msg) {
  let sherpa;
  let sherpaAddon;
  try {
    sherpa = require('sherpa-onnx-node');
    sherpaAddon = require('sherpa-onnx-node/addon.js');
  } catch (err) {
    return io.fatal(`sherpa-onnx-node load failed: ${err.message}`);
  }
  if (msg.logPath) {
    try {
      io.openLog(msg.logPath);
    } catch (err) {
      return io.fatal(`log open failed: ${err.message}`);
    }
  }
  asr.attach({ sherpa, sherpaAddon, models: msg.models });
  tts.attach({ sherpa, provider: msg.gpu === true ? 'webgpu' : 'cpu' });
  io.setLogText(msg.logText === true);
  io.logLine({ ts: Date.now(), type: 'session_start', logText: msg.logText === true, ...(msg.meta || {}) });
  io.post({ type: 'ready' });
}

function handleUnload(what) {
  if (what === 'asr') asr.unload();
  if (what === 'tts') tts.unload();
}

function handleShutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  Promise.all([asr.drain(), tts.drain()]).then(() => teardown(() => process.exit(0)));
}

function teardown(done) {
  capture.stop();
  asr.stopTimers();
  io.closeLog(done);
}

io.setOnFatal((code) => teardown(() => process.exit(code)));

process.parentPort.on('message', (e) => {
  const msg = e.data;
  if (!msg || !msg.type) return;
  switch (msg.type) {
    case 'init': return handleInit(msg);
    case 'asr-start': return asr.start(msg);
    case 'capture-start': return capture.start(msg, asr.handlePcm);
    case 'pcm': return asr.handlePcm(msg.samples);
    case 'capture-stop': return capture.stop();
    case 'asr-stop': return asr.stop();
    case 'unload': return handleUnload(msg.what);
    case 'log-close': return io.closeLog();
    case 'shutdown': return handleShutdown();
    case 'tts-load': return tts.load(msg);
    case 'tts-set-provider': return tts.setProvider(msg);
    case 'tts-generate': return tts.generate(msg);
    case 'tts-cancel': return tts.cancel(msg);
    case 'tts-gate': return tts.gate(msg);
    default: return;
  }
});
