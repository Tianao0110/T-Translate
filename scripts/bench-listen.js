// Listen-chain accuracy bench on FLEURS (google/fleurs dev, CC-BY-4.0): N
// distinct sentences per language joined with a gap, replayed in real time
// through the real chain (VAD, AGC, splits, both engines, the watchdog), then
// scored: coverage, CER (zh) / CER + WER (en), finals per sentence, final
// latency. This is the harness the 2026-09-02 baseline was measured with,
// rebuilt as a script so it stops disappearing with a scratchpad.
//
//   npx electron scripts/bench-listen.js --lang zh|en [--tier standard|high] [--n 40] [--gap 0.8]
//
// Data lives in bench-data/fleurs/<lang>/ (gitignored): dev.tsv and the
// extracted dev/ wavs, fetched with
//   curl -L -o dev.tsv    https://huggingface.co/datasets/google/fleurs/resolve/main/data/<cmn_hans_cn|en_us>/dev.tsv
//   curl -L -o dev.tar.gz https://huggingface.co/datasets/google/fleurs/resolve/main/data/<cmn_hans_cn|en_us>/audio/dev.tar.gz
//   tar -xzf dev.tar.gz
// Packs come from release-audio-models/ (run `npm run audio:release` first);
// the user's own models are never touched — everything runs in a temp userData.
//
// Scoring conventions match the baseline doc: references are FLEURS'
// normalised column; zh strips spaces and punctuation before CER; en lowers
// case and strips punctuation and apostrophes before CER and WER. Finals are
// assigned to the sentence they overlap most; a sentence with no final is
// uncovered and its whole reference counts as deleted.
/* eslint-disable no-console */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { app } = require('electron');

const REPO = path.resolve(__dirname, '..').replace(/\\/g, '/');
const RELEASE_DIR = `${REPO}/release-audio-models`;
const DATA_DIR = path.join(REPO, 'bench-data');
const RATE = 16000;

const arg = (name, def = null) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : def;
};
const LANG = arg('--lang', 'zh');
const TIER = arg('--tier', 'standard');
// One sandbox per run so two languages can bench side by side.
const SANDBOX = path.join(os.tmpdir(), `tt-listen-bench-${LANG}-${TIER}${process.argv.includes('--normalize') ? '-norm' : ''}`);
const N = Number(arg('--n', 40));
const GAP_S = Number(arg('--gap', 0.8));
// --normalize scales every clip to a common rms (0.05, the AGC's own target)
// before joining: FLEURS readings sit anywhere between -22 and -65 dB, and
// the difference between this run and the raw one is what the level jumps
// alone cost the chain.
const NORMALIZE = process.argv.includes('--normalize');
const TARGET_RMS = 0.05;
const LEAD_S = 1.0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ----- data ---------------------------------------------------------------

function readFleursWav(file) {
  const buf = fs.readFileSync(file);
  let offset = 12;
  let format = 1;
  let rate = RATE;
  let channels = 1;
  let dataStart = -1;
  let dataLen = 0;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === 'fmt ') {
      format = buf.readUInt16LE(offset + 8);
      channels = buf.readUInt16LE(offset + 10);
      rate = buf.readUInt32LE(offset + 12);
    }
    if (id === 'data') {
      dataStart = offset + 8;
      dataLen = size;
      break;
    }
    offset += 8 + size + (size % 2);
  }
  if (dataStart < 0) throw new Error(`no data chunk: ${file}`);
  if (rate !== RATE || channels !== 1) throw new Error(`${file}: expected 16 kHz mono, got ${rate} Hz x${channels}`);
  if (format === 3) {
    const n = Math.floor(dataLen / 4);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = buf.readFloatLE(dataStart + i * 4);
    return out;
  }
  const n = Math.floor(dataLen / 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = buf.readInt16LE(dataStart + i * 2) / 32768;
  return out;
}

// First N distinct sentence ids in tsv order, one reading each.
function pickSentences(lang, n) {
  const dir = path.join(DATA_DIR, 'fleurs', lang);
  const tsv = fs.readFileSync(path.join(dir, 'dev.tsv'), 'utf8').split('\n');
  const seen = new Set();
  const out = [];
  for (const line of tsv) {
    const cols = line.split('\t');
    if (cols.length < 4 || seen.has(cols[0])) continue;
    const wav = path.join(dir, 'dev', cols[1]);
    if (!fs.existsSync(wav)) continue;
    seen.add(cols[0]);
    out.push({ id: cols[0], wav, raw: cols[2], ref: cols[3] });
    if (out.length >= n) break;
  }
  if (out.length < n) throw new Error(`only ${out.length} sentences available for ${lang}`);
  return out;
}

function normalizeClip(clip) {
  let sum = 0;
  let peak = 0;
  for (const v of clip) {
    sum += v * v;
    if (Math.abs(v) > peak) peak = Math.abs(v);
  }
  const rms = Math.sqrt(sum / clip.length) || 1;
  const gain = Math.min(TARGET_RMS / rms, peak ? 0.9 / peak : 1);
  const out = new Float32Array(clip.length);
  for (let i = 0; i < clip.length; i++) out[i] = clip[i] * gain;
  return out;
}

function buildTrack(sentences) {
  const clips = sentences.map((s) => (NORMALIZE ? normalizeClip(readFleursWav(s.wav)) : readFleursWav(s.wav)));
  const total = Math.round(LEAD_S * RATE) + clips.reduce((n, c) => n + c.length + Math.round(GAP_S * RATE), 0);
  const pcm = new Float32Array(total);
  const timeline = [];
  let pos = Math.round(LEAD_S * RATE);
  clips.forEach((clip, i) => {
    pcm.set(clip, pos);
    timeline.push({ ...sentences[i], start: pos / RATE, end: (pos + clip.length) / RATE });
    pos += clip.length + Math.round(GAP_S * RATE);
  });
  return { pcm, timeline };
}

// ----- scoring --------------------------------------------------------------

const normZh = (s) => String(s || '').replace(/[\s\p{P}\p{S}]+/gu, '');
const normEn = (s) => String(s || '').toLowerCase().replace(/['’]/g, '').replace(/[\p{P}\p{S}]+/gu, ' ').replace(/\s+/g, ' ').trim();

function editDistance(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = new Array(n + 1);
  let cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

function score(lang, timeline, finals) {
  // Each final goes to the sentence it overlaps most (by time).
  const buckets = timeline.map(() => []);
  for (const f of finals) {
    const fs0 = f.segStartS;
    const fe = f.segStartS + f.segDurS;
    let best = -1;
    let bestOverlap = 0;
    timeline.forEach((s, i) => {
      const ov = Math.min(fe, s.end + GAP_S / 2) - Math.max(fs0, s.start - GAP_S / 2);
      if (ov > bestOverlap) {
        bestOverlap = ov;
        best = i;
      }
    });
    if (best >= 0) buckets[best].push(f);
  }
  const rows = timeline.map((s, i) => {
    const hypRaw = buckets[i].map((f) => f.text).join(lang === 'zh' ? '' : ' ');
    const ref = lang === 'zh' ? normZh(s.ref) : normEn(s.ref);
    const hyp = lang === 'zh' ? normZh(hypRaw) : normEn(hypRaw);
    const refChars = lang === 'zh' ? [...ref] : [...ref.replace(/ /g, '')];
    const hypChars = lang === 'zh' ? [...hyp] : [...hyp.replace(/ /g, '')];
    const cerEdits = editDistance(refChars, hypChars);
    const row = {
      id: s.id,
      start: Math.round(s.start * 100) / 100,
      end: Math.round(s.end * 100) / 100,
      ref,
      hyp,
      finals: buckets[i].length,
      // The finals themselves, with their times, so a miss can be told from a
      // merge with the neighbour or a late VAD open.
      segments: buckets[i].map((f) => ({ start: Math.round(f.segStartS * 100) / 100, end: Math.round((f.segStartS + f.segDurS) * 100) / 100, text: f.text })),
      covered: buckets[i].length > 0,
      refLen: refChars.length,
      cerEdits,
      cer: refChars.length ? cerEdits / refChars.length : 0,
    };
    if (lang === 'en') {
      const rw = ref.split(' ').filter(Boolean);
      const hw = hyp.split(' ').filter(Boolean);
      row.werEdits = editDistance(rw, hw);
      row.words = rw.length;
      row.wer = rw.length ? row.werEdits / rw.length : 0;
    }
    return row;
  });
  const sum = (k) => rows.reduce((n, r) => n + (r[k] || 0), 0);
  const agg = {
    sentences: rows.length,
    covered: rows.filter((r) => r.covered).length,
    finals: finals.length,
    cer: sum('refLen') ? sum('cerEdits') / sum('refLen') : null,
    wer: lang === 'en' && sum('words') ? sum('werEdits') / sum('words') : null,
    refChars: sum('refLen'),
    hypChars: rows.reduce((n, r) => n + [...r.hyp.replace(/ /g, '')].length, 0),
    cerMedian: median(rows.map((r) => r.cer)),
    cerP90: percentile(rows.map((r) => r.cer), 0.9),
    worst: rows.filter((r) => r.cer > 0.5).length,
    split: rows.filter((r) => r.finals > 1).length,
  };
  return { rows, agg };
}

function median(xs) {
  return percentile(xs, 0.5);
}
function percentile(xs, p) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

// ----- run --------------------------------------------------------------------

async function main() {
  if (!['zh', 'en'].includes(LANG)) throw new Error('--lang zh|en');
  if (!fs.existsSync(`${RELEASE_DIR}/manifest.json`)) throw new Error(`missing ${RELEASE_DIR}/manifest.json — run: npm run audio:release`);

  const sentences = pickSentences(LANG, N);
  const { pcm, timeline } = buildTrack(sentences);
  console.log(`${LANG} ${TIER}: ${sentences.length} sentences, ${(pcm.length / RATE).toFixed(1)} s of audio (gap ${GAP_S}s)`);

  fs.rmSync(SANDBOX, { recursive: true, force: true });
  fs.mkdirSync(SANDBOX, { recursive: true });
  app.setPath('userData', SANDBOX);
  // Packs go to the sandbox too, not the dev models folder (model-root.js).
  process.env.TT_MODELS_ROOT = path.join(SANDBOX, 'models');
  const manifest = JSON.parse(fs.readFileSync(`${RELEASE_DIR}/manifest.json`, 'utf8'));
  manifest.baseUrl = `file:///${RELEASE_DIR}`;
  const manifestPath = path.join(SANDBOX, 'local-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  process.env.TT_AUDIO_MANIFEST_URL = `file:///${manifestPath.replace(/\\/g, '/')}`;

  const packMgr = require('../electron/utils/audio-pack-manager');
  const engineManager = require('../electron/managers/audio-engine-manager');
  const { locateAsrModels } = require('../electron/utils/asr-models');
  const { store } = require('../electron/state');

  const wanted = ['asr-base-sense-voice', 'asr-draft-zipformer-zh-en', ...(TIER === 'high' ? ['asr-hq-qwen3-0.6b'] : [])];
  for (const id of wanted) {
    const r = await packMgr.downloadPack(id, () => {});
    if (!r.success) throw new Error(`install ${id} failed`);
  }
  const models = locateAsrModels(packMgr.packsRoot());
  if (!models || (TIER === 'high' && !models.hq)) throw new Error('models did not resolve');
  store.set('settings.listen.tier', TIER);
  store.set('settings.listen.autosave', false);

  const ev = { status: [], segments: [], stamps: [] };
  const fakeWin = {
    isDestroyed: () => false,
    once: () => {},
    webContents: {
      send: (channel, payload) => {
        if (channel.endsWith(':status')) ev.status.push(payload.state);
        else if (channel.endsWith(':segment')) {
          ev.segments.push(payload);
          ev.stamps.push(Date.now());
        }
      },
    },
  };
  engineManager.init({ store, getWindow: () => fakeWin });
  const loadStart = Date.now();
  engineManager.startSession({ language: LANG, source: { mode: 'off' } });
  for (let i = 0; i < 300 && !ev.status.includes('listening'); i++) await sleep(100);
  if (!ev.status.includes('listening')) throw new Error(`session never reached listening: ${ev.status.join(',')}`);
  const loadMs = Date.now() - loadStart;

  const CHUNK = 1600;
  const t0 = Date.now();
  let fed = 0;
  const pace = async () => {
    const wait = t0 + fed / 16 - Date.now();
    if (wait > 0) await sleep(wait);
  };
  for (let i = 0; i < pcm.length; i += CHUNK) {
    await pace();
    const chunk = pcm.slice(i, i + CHUNK);
    engineManager.feedPcm(chunk);
    fed += chunk.length;
  }
  const silence = new Float32Array(CHUNK);
  for (let i = 0; i < 40; i++) {
    await pace();
    engineManager.feedPcm(silence);
    fed += CHUNK;
  }
  await sleep(1500);
  await engineManager.stopSessionAndWait('bench');

  const finals = ev.segments.map((s) => ({ text: s.text, segStartS: s.segStartS, segDurS: s.segDurS, event: s.event || null }));
  const latencies = ev.segments.map((s, i) => ev.stamps[i] - (t0 + (s.segStartS + s.segDurS) * 1000));
  const { rows, agg } = score(LANG, timeline, finals);
  const events = finals.reduce((acc, f) => ({ ...acc, [f.event || 'natural']: (acc[f.event || 'natural'] || 0) + 1 }), {});

  const result = {
    lang: LANG,
    tier: TIER,
    normalized: NORMALIZE,
    n: N,
    gapS: GAP_S,
    at: new Date().toISOString(),
    engine: TIER === 'high' ? models.hq?.dirName : path.basename(models.modelDir),
    loadMs,
    // Anything beyond starting > listening > stopped means the host died and
    // came back mid-run; its clock restarts, so later finals land on the
    // wrong sentences and their latency is meaningless.
    statusTrail: ev.status,
    ...agg,
    events,
    finalLatencyMedianMs: Math.round(median(latencies) || 0),
    finalLatencyP90Ms: Math.round(percentile(latencies, 0.9) || 0),
    rows,
    allFinals: finals.map((f) => ({ start: Math.round(f.segStartS * 100) / 100, end: Math.round((f.segStartS + f.segDurS) * 100) / 100, text: f.text })),
  };
  const outDir = path.join(DATA_DIR, 'results');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${LANG}-${TIER}${NORMALIZE ? '-norm' : ''}-${result.at.replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2));

  console.log(`\nengine ${result.engine}, load ${loadMs} ms, status ${ev.status.join(' > ')}`);
  console.log(`coverage ${agg.covered}/${agg.sentences}, finals ${agg.finals} (${JSON.stringify(events)}), split sentences ${agg.split}`);
  console.log(`CER ${(agg.cer * 100).toFixed(2)}%${agg.wer !== null ? `, WER ${(agg.wer * 100).toFixed(2)}%` : ''}  (hyp ${agg.hypChars} vs ref ${agg.refChars} chars, median ${(agg.cerMedian * 100).toFixed(1)}%, p90 ${(agg.cerP90 * 100).toFixed(1)}%, >50%: ${agg.worst})`);
  console.log(`final latency median ${result.finalLatencyMedianMs} ms, p90 ${result.finalLatencyP90Ms} ms`);
  const worst = [...rows].sort((a, b) => b.cer - a.cer).slice(0, 5);
  console.log('\nworst 5:');
  for (const r of worst) console.log(`  [${(r.cer * 100).toFixed(0)}%] ref: ${r.ref}\n         hyp: ${r.hyp || '(none)'}`);
  console.log(`\nsaved ${outFile}`);
  app.exit(0);
}

app.whenReady().then(() => main().catch((e) => {
  console.error('bench failed:', e);
  app.exit(1);
}));
