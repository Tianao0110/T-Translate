// Listen-module smoke test: the whole chain with real weights, in a throwaway
// sandbox, no network.
//
//   npx electron scripts/smoke-listen.js [--wav <file>] [--keep]
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
const { app } = require('electron');

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

  store.set('privacyMode', 'offline');
  let offlineErr = null;
  try {
    await packMgr.downloadPack('asr-base-sense-voice');
  } catch (e) {
    offlineErr = e.code;
  }
  store.set('privacyMode', 'standard');
  step('offline mode refuses to download', offlineErr === 'OFFLINE_BLOCKED', `errorCode=${offlineErr}`);

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

  const events = { status: [], segments: [], partials: [] };
  const fakeWin = {
    isDestroyed: () => false,
    once: () => {},
    webContents: {
      send: (channel, payload) => {
        if (channel.endsWith(':status')) events.status.push(payload.state);
        else if (channel.endsWith(':segment')) events.segments.push(payload);
        else if (channel.endsWith(':partial')) events.partials.push(payload);
      },
    },
  };
  engineManager.init({ store, getWindow: () => fakeWin });

  const loadStart = Date.now();
  engineManager.startSession({ language: 'zh' });
  for (let i = 0; i < 200 && !events.status.includes('listening'); i++) await sleep(100);
  step('engine reaches listening', events.status.includes('listening'), `${Date.now() - loadStart}ms`);

  // Real-time feed: a one-shot dump never exercises the partial timer.
  const pcm = readWavPcm(wav);
  const CHUNK = 1600; // 100 ms
  for (let i = 0; i < pcm.length; i += CHUNK) {
    engineManager.feedPcm(pcm.slice(i, i + CHUNK));
    await sleep(100);
  }
  const silence = new Float32Array(CHUNK);
  for (let i = 0; i < 25; i++) {
    engineManager.feedPcm(silence);
    await sleep(100);
  }

  step(
    'finals recognized',
    events.segments.length > 0,
    events.segments.map((s) => JSON.stringify(s.text)).join(' | ') || '(none)'
  );
  step('streaming drafts emitted', events.partials.length > 0, `${events.partials.length} partials`);

  await engineManager.stopSessionAndWait('smoke');
  step('stopSessionAndWait returns after the worker is gone', !engineManager.getInfo().running);

  const logsDir = path.join(SANDBOX, 'logs');
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

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n==== ${results.length - failed}/${results.length} passed ====`);
  if (logText) {
    console.log('\n--- session log ---');
    console.log(logText.trim());
  }
  if (failed === 0 && !KEEP) fs.rmSync(SANDBOX, { recursive: true, force: true });
  else console.log(`\nsandbox kept: ${SANDBOX}`);
  app.exit(failed === 0 ? 0 : 1);
}

app.whenReady().then(() =>
  main().catch((e) => {
    console.error('SMOKE CRASHED:', e && e.stack);
    app.exit(2);
  })
);
