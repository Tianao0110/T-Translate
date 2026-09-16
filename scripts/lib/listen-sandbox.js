// Shared setup for the listen-mode smoke and bench: the audio packs come
// from release-audio-models/ through a file:// manifest into the sandbox,
// the floating window is a stand-in that routes audio-engine:* sends to
// handlers, and audio is fed in real time against the audio clock.
/* eslint-disable no-console */

const path = require('path');
const fs = require('fs');
const { REPO, sandbox, sleep } = require('./electron-smoke');

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

function percentile(xs, p) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}
const median = (xs) => percentile(xs, 0.5);

module.exports = { RELEASE_DIR, RELEASE_MANIFEST, listenSandbox, installPacks, fakeWindow, feedRealtime, percentile, median };
