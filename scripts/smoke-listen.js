// Listen-module smoke test: the whole chain with real weights, in a throwaway
// sandbox, no network.
//
//   npx electron scripts/smoke-listen.js [--wav <file>] [--keep] [--soak <minutes>]
//
// --soak replays the audio for N minutes in one session and reports the worker
// RSS trend — the answer to "does hours of listening grow anything".
//
// Covers manifest fetch -> sha256 verify -> zip extract -> pack.json write ->
// staging swap -> pack-based model discovery -> worker load -> VAD ->
// SenseVoice finals -> streaming drafts -> unload/shutdown -> pack removal,
// plus the offline-mode refusal. GitHub is swapped for file:// URLs against
// release-audio-models/, so run `npm run audio:release` first.
//
// Run this after swapping a model, touching the pack pipeline, or before a
// release that claims listen mode works. The user's own models are never
// touched: everything happens under a temp userData.
/* eslint-disable no-console */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const { app, BrowserWindow } = require('electron');

const REPO = path.resolve(__dirname, '..').replace(/\\/g, '/');
const RELEASE_DIR = `${REPO}/release-audio-models`;
const SANDBOX = path.join(os.tmpdir(), 'tt-listen-smoke');
const KEEP = process.argv.includes('--keep');

const results = [];
function step(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

// SAPI speech is real speech as far as VAD and SenseVoice are concerned.
// Two traps burned in here: PowerShell gets the script as -EncodedCommand
// (UTF-16LE base64) because Chinese through a normal argv is mangled, and the
// synthesizer renders at its native 22050 Hz — asking SAPI itself for 16 kHz
// writes a silent file with these Desktop voices (verified: maxAbs 0.000).
function synthesizeWav(dest) {
  const ps = `
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.SelectVoice('Microsoft Huihui Desktop')
$s.SetOutputToWaveFile('${dest.replace(/\\/g, '\\\\')}')
$s.Speak('美债的终极干预手段就是美军。如果有需要，将会出动美军。')
$s.SetOutputToNull()
$s.Dispose()
`;
  execFileSync('powershell', ['-NoProfile', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')]);
  return dest;
}

// Reads any PCM wav and resamples to 16 kHz mono float — what the worker wants.
function readWavPcm(file, targetRate = 16000) {
  const buf = fs.readFileSync(file);
  let offset = 12;
  let dataStart = 44;
  let dataLen = buf.length - 44;
  let rate = targetRate;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === 'fmt ') rate = buf.readUInt32LE(offset + 12);
    if (id === 'data') {
      dataStart = offset + 8;
      dataLen = size;
      break;
    }
    offset += 8 + size + (size % 2);
  }
  const src = new Float32Array(Math.floor(dataLen / 2));
  for (let i = 0; i < src.length; i++) src[i] = buf.readInt16LE(dataStart + i * 2) / 32768;
  if (rate === targetRate) return src;

  const ratio = rate / targetRate;
  const out = new Float32Array(Math.floor(src.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const p = i * ratio;
    const i0 = Math.floor(p);
    const frac = p - i0;
    out[i] = src[i0] * (1 - frac) + (src[i0 + 1] ?? src[i0]) * frac;
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// First sample where speech actually starts, in seconds. Latency has to be
// measured from the sound, not from the start of the file (SAPI opens with
// ~100 ms of digital silence).
function speechOnsetSeconds(pcm, rate = 16000, threshold = 0.02) {
  for (let i = 0; i < pcm.length; i++) {
    if (Math.abs(pcm[i]) > threshold) return i / rate;
  }
  return 0;
}

function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

async function main() {
  if (!fs.existsSync(`${RELEASE_DIR}/manifest.json`)) {
    console.error(`missing ${RELEASE_DIR}/manifest.json — run: npm run audio:release`);
    app.exit(2);
    return;
  }

  fs.rmSync(SANDBOX, { recursive: true, force: true });
  fs.mkdirSync(SANDBOX, { recursive: true });
  app.setPath('userData', SANDBOX);

  // Local manifest: same file, baseUrl pointed at the local zips.
  const manifest = JSON.parse(fs.readFileSync(`${RELEASE_DIR}/manifest.json`, 'utf8'));
  manifest.baseUrl = `file:///${RELEASE_DIR}`;
  const manifestPath = path.join(SANDBOX, 'local-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  process.env.TT_AUDIO_MANIFEST_URL = `file:///${manifestPath.replace(/\\/g, '/')}`;

  const wavArg = process.argv.indexOf('--wav');
  const wav = wavArg !== -1 ? process.argv[wavArg + 1] : synthesizeWav(path.join(SANDBOX, 'speech.wav'));

  const packMgr = require('../electron/utils/audio-pack-manager');
  const { createPackManager } = require('../electron/utils/model-pack-core');
  const engineManager = require('../electron/managers/audio-engine-manager');
  const { locateAsrModels } = require('../electron/utils/asr-models');
  const { store } = require('../electron/state');

  console.log(`sandbox: ${SANDBOX}\npacks root: ${packMgr.packsRoot()}\n`);

  const before = await packMgr.listPacks({ refresh: true });
  step(
    'manifest reads, both packs listed as not-installed',
    !before.manifestError && before.packs.length === 2 && before.packs.every((p) => p.status === 'not-installed'),
    before.packs.map((p) => `${p.id}:${p.status}`).join(', ')
  );

  // The offline gate refuses NETWORK access, and this whole harness runs on
  // file:// URLs (a local read is not the network), so the refusal has to be
  // checked against the URL shape a real user gets: a second manager, same
  // gate, https manifest. Both of its network paths must refuse before any
  // fetch happens — the injected fetch throws if it is ever reached.
  store.set('privacyMode', 'offline');
  const netMgr = createPackManager({
    manifestUrl: 'https://github.com/Tianao0110/T-Translate/releases/download/audio-models/manifest.json',
    packsRoot: packMgr.packsRoot,
    listInstalled: () => [],
    evictSessions: () => {},
    computePackList: (installed) => installed,
    packJsonFields: (e) => e,
    offlineGate: () => store.get('privacyMode') === 'offline',
    logLabel: 'Smoke-Offline',
    deps: {
      fetch: () => { throw new Error('offline gate leaked: fetch was called'); },
      logger: { info() {}, warn() {}, error() {}, debug() {} },
    },
  });
  const offlineCodes = [];
  for (const call of [() => netMgr.downloadPack('asr-base-sense-voice'), () => netMgr.fetchManifest(true)]) {
    try {
      await call();
      offlineCodes.push('NOT-BLOCKED');
    } catch (e) {
      offlineCodes.push(e.code || e.message);
    }
  }
  const offlineList = await netMgr.listPacks({ refresh: true });
  store.set('privacyMode', 'standard');
  step(
    'offline mode refuses download and manifest fetch',
    offlineCodes.every((c) => c === 'OFFLINE_BLOCKED') && offlineList.manifestError === 'OFFLINE_BLOCKED',
    `download=${offlineCodes[0]}, manifest=${offlineCodes[1]}, list=${offlineList.manifestError}`
  );

  // Native capture (v0.4.1). A loopback client only receives packets while
  // some render stream is active on the endpoint — a fully silent machine
  // delivers nothing at all (0.00s measured 2026-09-02; earlier green runs had
  // a browser or the app playing). So the check renders its own near-silent
  // tone from a hidden window for the duration: the frame count then proves
  // koffi loaded, the client activated, the format was accepted, the pump runs
  // and stop() stops it. Signal itself is not assertable without making noise.
  const winAudio = require('../electron/utils/win-audio-capture');
  const caps = winAudio.getCapabilities();
  step(
    'native capture capability probe',
    caps.supported,
    `build=${caps.build}, processLoopback=${caps.processLoopback}${caps.reason ? ` (${caps.reason})` : ''}`
  );
  if (caps.supported) {
    // Destroying the only window would otherwise quit the app (Electron's
    // default window-all-closed handling) halfway through the smoke.
    app.on('window-all-closed', () => {});
    const keepAlive = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
    await keepAlive.loadURL(
      'data:text/html,<script>const c=new AudioContext();const o=c.createOscillator();const g=c.createGain();' +
        'g.gain.value=0.0005;o.connect(g);g.connect(c.destination);o.start();</script>'
    );
    await new Promise((r) => setTimeout(r, 300));
    let captured = 0;
    const handle = await winAudio.startCapture({ mode: 'system', onPcm: (pcm) => { captured += pcm.length; } });
    await new Promise((r) => setTimeout(r, 1500));
    const duringStop = captured;
    handle.stop();
    await new Promise((r) => setTimeout(r, 300));
    keepAlive.destroy();
    const seconds = duringStop / 16000;
    step(
      'native capture delivers a steady 16k mono stream and stops clean',
      seconds > 1.2 && seconds < 1.9 && captured === duringStop,
      `${seconds.toFixed(2)}s of audio in 1.5s, ${captured - duringStop} samples after stop`
    );
  }

  for (const id of ['asr-base-sense-voice', 'asr-draft-zipformer-zh-en']) {
    const phases = new Set();
    const t0 = Date.now();
    const res = await packMgr.downloadPack(id, (_p, phase) => phases.add(phase));
    step(`install ${id}`, res.success === true, `${Date.now() - t0}ms, ${[...phases].join('→')}`);
  }

  const after = await packMgr.listPacks({ refresh: false });
  step('both packs report installed', after.packs.every((p) => p.status === 'installed'));

  const models = locateAsrModels(packMgr.packsRoot());
  step(
    'pack.json resolves final model + VAD + draft engine',
    !!models && !!models.streaming && fs.existsSync(models.vadPath),
    models ? `${path.basename(models.modelDir)} / draft=${models.streaming?.dirName}` : 'null'
  );

  const pcm = readWavPcm(wav);
  const onsetS = speechOnsetSeconds(pcm);

  // One session: feed the audio in real time and time everything against the
  // audio clock. The feed is scheduled against a fixed start so sleep drift
  // does not get counted as engine latency.
  async function runSession(label, soakMinutes = 0) {
    const ev = { status: [], segments: [], partials: [], rss: [] };
    const stamp = { partials: [], segments: [] };
    let t0 = 0;
    const fakeWin = {
      isDestroyed: () => false,
      once: () => {},
      webContents: {
        send: (channel, payload) => {
          const now = Date.now();
          if (channel.endsWith(':status')) {
            ev.status.push(payload.state);
            if (payload.state === 'metrics' && payload.detail) ev.rss.push(payload.detail.rssMb);
          } else if (channel.endsWith(':segment')) {
            ev.segments.push(payload);
            stamp.segments.push(now);
          } else if (channel.endsWith(':partial') && payload) {
            ev.partials.push(payload);
            stamp.partials.push(now);
          }
        },
      },
    };
    engineManager.init({ store, getWindow: () => fakeWin });

    const loadStart = Date.now();
    // source 'off': no audio client is opened, this harness feeds the wav in
    // itself. Every other session captures natively inside the worker.
    engineManager.startSession({ language: 'zh', source: { mode: 'off' } });
    for (let i = 0; i < 200 && !ev.status.includes('listening'); i++) await sleep(100);
    const loadMs = Date.now() - loadStart;

    const CHUNK = 1600; // 100 ms
    t0 = Date.now();
    // Pace by AUDIO FED, not by chunk count: the last slice of the buffer is a
    // short one (7.52s is not a whole number of 100ms chunks), and giving it a
    // full slot drifts the clock 80ms per lap — over a 12-minute soak that
    // showed up as 7.7s of fake, linearly-growing "engine latency".
    let fedSamples = 0;
    const pace = async () => {
      const wait = t0 + fedSamples / 16 - Date.now();
      if (wait > 0) await sleep(wait);
    };
    // Soak: replay the same audio until the clock runs out. Nothing about the
    // engine treats a loop differently — what is under test is whether hours
    // of continuous use grow anything without bound.
    const until = soakMinutes > 0 ? t0 + soakMinutes * 60000 : 0;
    do {
      for (let i = 0; i < pcm.length; i += CHUNK) {
        await pace();
        const chunk = pcm.slice(i, i + CHUNK);
        engineManager.feedPcm(chunk);
        fedSamples += chunk.length;
      }
    } while (until && Date.now() < until);
    const silence = new Float32Array(CHUNK);
    for (let i = 0; i < 25; i++) {
      await pace();
      engineManager.feedPcm(silence);
      fedSamples += CHUNK;
    }

    // Wall clock at which a given point on the audio timeline was fed.
    const audioClock = (seconds) => t0 + seconds * 1000;

    const firstDraftMs = stamp.partials.length ? stamp.partials[0] - audioClock(onsetS) : null;
    const draftGaps = stamp.partials.slice(1).map((t, i) => t - stamp.partials[i]);
    const finalLatencies = ev.segments.map(
      (s, i) => stamp.segments[i] - audioClock(s.segStartS + s.segDurS)
    );

    await engineManager.stopSessionAndWait('smoke');
    return { label, ev, loadMs, firstDraftMs, draftGaps, finalLatencies };
  }

  const soakArg = process.argv.indexOf('--soak');
  const soakMinutes = soakArg !== -1 ? Number(process.argv[soakArg + 1]) || 10 : 0;
  if (soakMinutes > 0) console.log(`soak: ${soakMinutes} 分钟连续会话
`);

  const withDraft = await runSession('two-pass（装了草稿引擎）', soakMinutes);

  // Segment starts must only move forward. They did not: forced splits call
  // vad.reset(), sherpa's own segment clock restarts at zero with it, and every
  // naturally-closed segment after a split reported a start from the new
  // origin — so a long session's SRT timeline walked backwards.
  const starts = withDraft.ev.segments.map((x) => x.segStartS);
  const backwards = starts.filter((v, i) => i > 0 && v < starts[i - 1]);
  step(
    'segment timeline only moves forward',
    backwards.length === 0,
    starts.map((v) => v.toFixed(2)).join(' → ')
  );

  step(
    'finals recognized',
    withDraft.ev.segments.length > 0,
    withDraft.ev.segments.map((s) => JSON.stringify(s.text)).join(' | ') || '(none)'
  );
  step('streaming drafts emitted', withDraft.ev.partials.length > 0, `${withDraft.ev.partials.length} partials`);
  step('stopSessionAndWait returns after the worker is gone', !engineManager.getInfo().running);

  const logsDir = require('../electron/utils/data-root').dataDir('logs');
  const logFile = fs.existsSync(logsDir)
    ? fs.readdirSync(logsDir).filter((f) => f.endsWith('.jsonl')).sort().pop()
    : null;
  const logText = logFile ? fs.readFileSync(path.join(logsDir, logFile), 'utf8') : '';
  step('unload reached the worker (hook is wired)', /"unload"/.test(logText), logFile || '(no log)');

  const rm = await packMgr.removePack('asr-draft-zipformer-zh-en');
  step(
    'draft pack removal leaves no residue',
    rm.success === true && !fs.existsSync(path.join(packMgr.packsRoot(), 'asr-draft-zipformer-zh-en'))
  );

  const models2 = locateAsrModels(packMgr.packsRoot());
  step('listen still works without the draft pack', !!models2 && models2.streaming === null);

  // Same audio again with the draft engine gone: this is what a user who only
  // installed the base pack actually sees.
  const pseudo = await runSession('伪流式（只装基座包）');
  step(
    'pseudo-streaming still recognizes and still draws drafts',
    pseudo.ev.segments.length > 0 && pseudo.ev.partials.length > 0,
    `${pseudo.ev.segments.length} finals / ${pseudo.ev.partials.length} partials`
  );

  // ===== Neural TTS (v0.4.2) =====
  // Same manifest, own manager and root; the worker comes up TTS-only (no
  // listen session), streams one sentence at a time, swaps packs on demand,
  // stops mid-text on cancel, and releases the pack before a swap/removal.
  const ttsPackMgr = require('../electron/utils/tts-pack-manager');
  const { listVoicePacks } = require('../electron/utils/tts-models');

  const ttsList = await ttsPackMgr.listPacks({ refresh: false });
  step(
    'voice packs listed by their own manager, none under the ASR list',
    ttsList.packs.length === 2 &&
      ttsList.packs.every((p) => p.type === 'tts-voice' && p.status === 'not-installed') &&
      after.packs.every((p) => p.type !== 'tts-voice'),
    ttsList.packs.map((p) => `${p.id}:${p.status}`).join(', ')
  );

  const crossDomain = await packMgr.downloadPack('tts-melo-zh-en').then(() => 'INSTALLED', (e) => e.code);
  step('ASR manager refuses a voice pack id', crossDomain === 'PACK_UNKNOWN', crossDomain);

  for (const id of ['tts-melo-zh-en', 'tts-kokoro-zh-en']) {
    const phases = new Set();
    const t0 = Date.now();
    const res = await ttsPackMgr.downloadPack(id, (_p, phase) => phases.add(phase));
    step(`install ${id}`, res.success === true, `${Date.now() - t0}ms, ${[...phases].join('→')}`);
  }

  const voicePacks = listVoicePacks([ttsPackMgr.packsRoot()]);
  const kokoroPack = voicePacks.find((p) => p.id === 'tts-kokoro-zh-en');
  step(
    'voice pack.json resolves models and the extracted data trees',
    voicePacks.length === 2 &&
      voicePacks.every((p) => fs.existsSync(p.paths.model) && fs.existsSync(p.paths.tokens)) &&
      !!kokoroPack &&
      fs.existsSync(path.join(kokoroPack.paths.dataDir, 'phontab')) &&
      fs.existsSync(path.join(kokoroPack.paths.dictDir, 'jieba.dict.utf8')),
    voicePacks.map((p) => `${p.id} (${p.engine}, ${p.voiceGroups.length} groups)`).join(', ')
  );

  engineManager.init({ store, getWindow: () => null });
  const voices = engineManager.getTtsVoices();
  step(
    'voice list: 103 kokoro speakers + 1 MeloTTS, featured subset flagged',
    voices.length === 104 &&
      voices.filter((v) => v.featured).length === 10 &&
      voices.filter((v) => v.packId === 'tts-kokoro-zh-en' && v.lang === 'zh' && v.gender === 'm').length === 45,
    `${voices.length} voices, ${voices.filter((v) => v.featured).length} featured`
  );

  let ttsSeq = 0;
  async function speak(packId, sid, text, { cancelAfterChunks = 0 } = {}) {
    const id = `smoke-${++ttsSeq}`;
    const out = { chunks: 0, samples: 0, sampleRate: 0, firstChunkMs: null, totalMs: 0, error: null, cancelled: false };
    const t0 = Date.now();
    const done = new Promise((resolve) => {
      out.resolve = resolve;
    });
    const sender = {
      isDestroyed: () => false,
      send: (channel, payload) => {
        if (!channel.endsWith(':tts-chunk') || payload.id !== id) return;
        if (payload.error) {
          out.error = payload.error;
          out.resolve();
        } else if (payload.done) {
          out.cancelled = payload.cancelled;
          out.totalMs = Date.now() - t0;
          out.resolve();
        } else {
          out.chunks += 1;
          out.samples += payload.samples.length;
          out.sampleRate = payload.sampleRate;
          if (out.firstChunkMs === null) out.firstChunkMs = Date.now() - t0;
          if (cancelAfterChunks && out.chunks >= cancelAfterChunks) engineManager.ttsCancel(id);
        }
      },
    };
    const res = await engineManager.ttsGenerate({ id, text, packId, sid, speed: 1 }, sender);
    if (!res.success) {
      out.error = res.error;
      return out;
    }
    await Promise.race([done, sleep(60000)]);
    out.audioS = out.sampleRate ? out.samples / out.sampleRate : 0;
    return out;
  }

  const melo = await speak('tts-melo-zh-en', 0, '这是语音朗读测试。This is a TTS test. 一共三句话。');
  step(
    'TTS-only worker: MeloTTS reads mixed zh/en, streamed per sentence',
    !melo.error && melo.chunks >= 2 && melo.audioS > 2 && melo.sampleRate === 44100,
    melo.error || `${melo.chunks} chunks, ${melo.audioS.toFixed(2)}s @${melo.sampleRate}, first chunk ${melo.firstChunkMs}ms, total ${melo.totalMs}ms`
  );

  const kokoroZh = await speak('tts-kokoro-zh-en', 3, '你好，这是语音朗读功能测试。');
  step(
    'pack swap inside the worker: kokoro Chinese voice',
    !kokoroZh.error && kokoroZh.chunks >= 1 && kokoroZh.audioS > 1 && kokoroZh.sampleRate === 24000,
    kokoroZh.error || `${kokoroZh.chunks} chunks, ${kokoroZh.audioS.toFixed(2)}s, first chunk ${kokoroZh.firstChunkMs}ms`
  );

  const kokoroEn = await speak('tts-kokoro-zh-en', 0, 'The quick brown fox jumps over the lazy dog.');
  step(
    'kokoro English voice (espeak-ng data in the pack)',
    !kokoroEn.error && kokoroEn.audioS > 1,
    kokoroEn.error || `${kokoroEn.audioS.toFixed(2)}s, first chunk ${kokoroEn.firstChunkMs}ms`
  );

  const longText = Array.from({ length: 12 }, (_, i) => `这是第${i + 1}句，用来测试取消。`).join('');
  const cancelled = await speak('tts-kokoro-zh-en', 3, longText, { cancelAfterChunks: 2 });
  step(
    'cancel stops synthesis mid-text',
    cancelled.cancelled === true && cancelled.chunks < 8,
    `${cancelled.chunks} chunks before stop, cancelled=${cancelled.cancelled}`
  );

  step('worker stays TTS-only (no listen session reported running)', !engineManager.getInfo().running);
  step('loaded voice reported', engineManager.getTtsStatus().loaded === 'tts-kokoro-zh-en');

  const rmVoice = await ttsPackMgr.removePack('tts-kokoro-zh-en');
  step(
    'voice pack removal evicts the loaded voice and leaves no residue',
    rmVoice.success === true &&
      !fs.existsSync(path.join(ttsPackMgr.packsRoot(), 'tts-kokoro-zh-en')) &&
      engineManager.getTtsStatus().loaded === '',
    `loaded=${JSON.stringify(engineManager.getTtsStatus().loaded)}`
  );

  const meloAgain = await speak('tts-melo-zh-en', 0, '卸载之后另一个语音包还能用。');
  step('the other voice pack still speaks after the removal', !meloAgain.error && meloAgain.audioS > 1, meloAgain.error || `${meloAgain.audioS.toFixed(2)}s`);
  await engineManager.unloadTtsAndWait('smoke-end');

  console.log('\n==== TTS ====');
  console.log(`  MeloTTS 混说    首块 ${melo.firstChunkMs} ms，${melo.audioS.toFixed(2)}s 音频合成 ${melo.totalMs} ms（RTF ${(melo.totalMs / 1000 / (melo.audioS || 1)).toFixed(2)}）`);
  console.log(`  kokoro 中文     首块 ${kokoroZh.firstChunkMs} ms（含换包载入），${kokoroZh.audioS.toFixed(2)}s 音频合成 ${kokoroZh.totalMs} ms`);
  console.log(`  kokoro 英文     首块 ${kokoroEn.firstChunkMs} ms，${kokoroEn.audioS.toFixed(2)}s 音频合成 ${kokoroEn.totalMs} ms`);

  console.log('\n==== 延迟 ====');
  console.log(`语音起点 ${onsetS.toFixed(2)}s，音频总长 ${(pcm.length / 16000).toFixed(2)}s\n`);
  for (const r of [withDraft, pseudo]) {
    const gaps = r.draftGaps;
    console.log(`${r.label}`);
    console.log(`  引擎加载        ${r.loadMs} ms`);
    console.log(`  首字（草稿）    ${r.firstDraftMs === null ? '—' : r.firstDraftMs + ' ms'}`);
    console.log(`  草稿刷新间隔    ${gaps.length ? `中位 ${median(gaps)} ms（${gaps.length} 次）` : '—'}`);
    console.log(
      `  定稿延迟        ${
        r.finalLatencies.length
          ? r.finalLatencies.map((m) => m + ' ms').join(' / ') + `  中位 ${median(r.finalLatencies)} ms`
          : '—'
      }`
    );
    console.log(`  解码 RTF        ${r.ev.segments.slice(0, 5).map((s) => s.rtf ?? '?').join(' / ')}`);
    if (r.ev.rss.length > 1) {
      const first = r.ev.rss[0];
      const last = r.ev.rss[r.ev.rss.length - 1];
      console.log(
        `  worker RSS      起 ${first}MB → 终 ${last}MB（峰 ${Math.max(...r.ev.rss)}MB，` +
          `${r.ev.rss.length} 次采样 / ${r.ev.segments.length} 段）`
      );
    }
    console.log('');
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n==== ${results.length - failed}/${results.length} passed ====`);
  if (logText) {
    console.log('\n--- session log ---');
    console.log(logText.trim());
  }
  if (failed === 0 && !KEEP) {
    // The keep-alive window leaves Chromium session files open under the
    // sandbox userData until the process exits; the next run's rmSync at
    // startup gets them. Not a test failure.
    try {
      fs.rmSync(SANDBOX, { recursive: true, force: true });
    } catch (e) {
      console.log(`\nsandbox cleanup deferred to next run (${e.code || e.message})`);
    }
  } else console.log(`\nsandbox kept: ${SANDBOX}`);
  app.exit(failed === 0 ? 0 : 1);
}

app.whenReady().then(() =>
  main().catch((e) => {
    console.error('SMOKE CRASHED:', e && e.stack);
    app.exit(2);
  })
);
