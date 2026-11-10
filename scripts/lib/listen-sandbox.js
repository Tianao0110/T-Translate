// Shared setup for the listen-mode smokes and bench: the audio packs come
// from release-audio-models/ through a file:// manifest into the sandbox,
// the high-accuracy tier's speech packs are linked in from a folder, the
// floating window is a stand-in that routes audio-engine:* sends to
// handlers, wavs are read as 16 kHz float, and audio is fed in real time
// against the audio clock.
/* eslint-disable no-console */

const path = require('path');
const fs = require('fs');
const { REPO, sandbox, sleep, place } = require('./electron-smoke');

// Where the speech packs sit on the developer machine unless --asr-dir says otherwise.
const DEFAULT_ASR_DIR = path.join(REPO, 'models', 'asr-gguf');

const RELEASE_DIR = `${REPO.replace(/\\/g, '/')}/release-audio-models`;
const RELEASE_MANIFEST = `${RELEASE_DIR}/manifest.json`;

// Sandbox plus a copy of the release manifest pointed at the local zips.
function listenSandbox(name) {
  const box = sandbox(name);
  const manifest = JSON.parse(fs.readFileSync(RELEASE_MANIFEST, 'utf8'));
  manifest.baseUrl = `file:///${RELEASE_DIR}`;
  const manifestPath = path.join(box.dir, 'local-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  process.env.TT_AUDIO_MANIFEST_URL = `file:///${manifestPath.replace(/\\/g, '/')}`;
  return { ...box, manifest };
}

// Installs packs one after another; each row carries the phases seen.
async function installPacks(packMgr, ids) {
  const rows = [];
  for (const id of ids) {
    const phases = new Set();
    const t0 = Date.now();
    const res = await packMgr.downloadPack(id, (_p, phase) => phases.add(phase));
    rows.push({ id, success: res.success === true, ms: Date.now() - t0, phases: [...phases] });
  }
  return rows;
}

// The high-accuracy tier inside the sandbox: every complete speech pack in
// asrDir is linked into the sandbox's model folder under its pinned names,
// and llm-manager runs on T-Engine's hosts with the speech host on the GPU or
// the CPU. null when asrDir holds no complete pack. Call after the sandbox
// exists (TT_MODELS_ROOT points into it).
async function speechHost({ asrDir = DEFAULT_ASR_DIR, gpu = false } = {}) {
  const { packsForRole, packFiles, LLM_ROLE_ASR, LLM_MODELS_DIR } = require('../../electron/shared/llm-packs');
  const present = packsForRole(LLM_ROLE_ASR).filter((p) => packFiles(p).every((f) => fs.existsSync(path.join(asrDir, f.file))));
  if (!present.length) return null;
  const { modelDir } = require('../../electron/packs/model-root');
  const { dataDir } = require('../../electron/platform/data-root');
  const { store } = require('../../electron/state');
  const dir = modelDir(LLM_MODELS_DIR);
  fs.mkdirSync(dir, { recursive: true });
  for (const p of present) for (const f of packFiles(p)) place(dir, path.join(asrDir, f.file));
  const tengine = require('../../electron/tengine').get();
  const llmManager = require('../../electron/llm/llm-manager');
  llmManager.init({ store, tengine, adapter: tengine.get('llm'), asrAdapter: tengine.get('llm-asr'), logsDir: dataDir('logs'), modelsDir: dir, logger: require('../../electron/platform/logger')('LLM') });
  tengine.get('llm-asr').setProvider(gpu ? 'gpu' : 'cpu');
  await llmManager.rescan();
  return { llmManager, tengine, dir, packs: present.map((p) => p.id) };
}

// hq-fallback events in the sandbox's newest session log: finals the speech
// host did not answer.
function hqFallbacks() {
  const { dataDir } = require('../../electron/platform/data-root');
  const logs = dataDir('logs');
  const file = fs.existsSync(logs) ? fs.readdirSync(logs).filter((f) => f.startsWith('audio-probe-') && f.endsWith('.jsonl')).sort().pop() : null;
  if (!file) return 0;
  return fs.readFileSync(path.join(logs, file), 'utf8').split('\n').filter((l) => l.includes('"hq-fallback"')).length;
}

function fakeWindow({ status, segment, partial } = {}) {
  return {
    isDestroyed: () => false,
    once: () => {},
    webContents: {
      send: (channel, payload) => {
        if (channel.endsWith(':status')) status?.(payload);
        else if (channel.endsWith(':segment')) segment?.(payload);
        else if (channel.endsWith(':partial') && payload) partial?.(payload);
      },
    },
  };
}

// Feeds pcm in 100 ms chunks paced by samples fed (not by chunk count, so a
// short last slice does not drift the clock), then trailing silence; a
// soakMs > 0 replays the audio until that much wall time has passed.
// Returns the wall clock the audio timeline started at.
async function feedRealtime(engineManager, pcm, { chunk = 1600, silenceChunks = 25, soakMs = 0, rate = 16000 } = {}) {
  const t0 = Date.now();
  let fed = 0;
  const pace = async () => {
    const wait = t0 + (fed / rate) * 1000 - Date.now();
    if (wait > 0) await sleep(wait);
  };
  const until = soakMs > 0 ? t0 + soakMs : 0;
  do {
    for (let i = 0; i < pcm.length; i += chunk) {
      await pace();
      const c = pcm.slice(i, i + chunk);
      engineManager.feedPcm(c);
      fed += c.length;
    }
  } while (until && Date.now() < until);
  const silence = new Float32Array(chunk);
  for (let i = 0; i < silenceChunks; i++) {
    await pace();
    engineManager.feedPcm(silence);
    fed += chunk;
  }
  return t0;
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

function percentile(xs, p) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}
const median = (xs) => percentile(xs, 0.5);

module.exports = { RELEASE_DIR, RELEASE_MANIFEST, DEFAULT_ASR_DIR, listenSandbox, installPacks, speechHost, hqFallbacks, fakeWindow, feedRealtime, readWavPcm, percentile, median };
