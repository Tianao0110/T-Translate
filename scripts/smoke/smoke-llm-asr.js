// Speech runtime smoke: drives electron/tengine/runtime/worker.js the way
// the LLM host will, with a Qwen3-ASR model plus its audio mmproj. Prints
// load, warm-up and per-segment numbers; checks the self-test sentence
// reads back, noise stays empty, bad input is refused, a cancel reaches a
// request, and unloading frees both halves. With bench-data/fleurs present
// it also scores ten sentences per language.
//   node scripts/smoke/smoke-llm-asr.js --model <path.gguf> --mmproj <path.gguf> [--provider cpu|gpu] [--threads N]
/* eslint-disable no-console */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { REPO, RUNTIME_DIR, arg, startWorker } = require('../lib/worker-driver');
const { readWav } = require('../../electron/tengine/runtime/mtmd');

const MODEL = arg('--model', process.env.TT_ASR_MODEL);
const MMPROJ = arg('--mmproj', process.env.TT_ASR_MMPROJ);
const PROVIDER = arg('--provider', 'cpu');
const THREADS = Number(arg('--threads', 0)) || null;
if (!MODEL || !MMPROJ || !fs.existsSync(MODEL) || !fs.existsSync(MMPROJ)) {
  console.error('usage: node scripts/smoke/smoke-llm-asr.js --model <path.gguf> --mmproj <path.gguf> [--provider cpu|gpu] [--threads N]');
  process.exit(2);
}

const HEALTH_AUDIO = path.join(REPO, 'electron', 'tengine', 'runtime', 'assets', 'asr-health.wav');
const HEALTH_TEXT = '今天天气很好我们去公园散步吧';
const FLEURS = path.join(REPO, 'bench-data', 'fleurs');
const RATE = 16000;

const norm = (lang, s) => (lang === 'zh'
  ? String(s || '').replace(/[\s\p{P}\p{S}]+/gu, '')
  : String(s || '').toLowerCase().replace(/['’]/g, '').replace(/[\p{P}\p{S}\s]+/gu, ''));
function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

// The first n distinct sentences of a FLEURS dev split, the pick bench-listen uses.
function fleurs(lang, n) {
  const dir = path.join(FLEURS, lang);
  if (!fs.existsSync(path.join(dir, 'dev.tsv'))) return [];
  const seen = new Set();
  const out = [];
  for (const line of fs.readFileSync(path.join(dir, 'dev.tsv'), 'utf8').split('\n')) {
    const cols = line.split('\t');
    if (cols.length < 4 || seen.has(cols[0])) continue;
    const wav = path.join(dir, 'dev', cols[1]);
    if (!fs.existsSync(wav)) continue;
    seen.add(cols[0]);
    out.push({ pcm: readWav(fs.readFileSync(wav), RATE), ref: cols[3] });
    if (out.length >= n) break;
  }
  return out;
}

const { ask, generate: gen, nextReqId, cancel, check, finish } = startWorker({ logLevel: 'error' });
const describe = (r) => `${r.audioTokens} audio tok, prefill ${r.promptMs} ms, ${r.genTokens} tok, total ${r.totalMs} ms, stop ${r.stop}`;

(async () => {
  console.log(`runtime ${RUNTIME_DIR}\nmodel ${MODEL}\nmmproj ${MMPROJ}\nprovider ${PROVIDER}, ${os.cpus().length} logical cpus`);
  const rt = await ask({ type: 'load-runtime', dir: RUNTIME_DIR });
  if (!rt.ok) {
    console.error('runtime failed:', rt.error);
    process.exit(1);
  }
  console.log(`runtime ${rt.info.build} (${rt.info.version})`);

  const options = { provider: PROVIDER, threads: THREADS, nCtx: 2048, nBatch: 512, mmproj: MMPROJ, media: 'audio', audioFamily: 'qwen3-asr' };
  const m = await ask({ type: 'load-model', reqId: 'm1', file: MODEL, options });
  if (!m.ok) {
    console.error('model failed:', m.error);
    process.exit(1);
  }
  const a = m.info.audio;
  console.log(`model ${m.info.arch} load ${m.info.loadMs} ms + mmproj ${a.loadMs} ms, warm-up ${a.warmupMs ?? '-'} ms, on ${m.info.provider}${m.info.device ? ' ' + m.info.device.name : ''}, ${a.sampleRate} Hz, threads ${m.info.threads}`);
  check(a && a.family === 'qwen3-asr' && a.sampleRate === RATE, 'audio encoder attached at 16 kHz');
  check(!m.info.vision, 'no vision side on a speech model');
  if (m.info.provider === 'gpu') check(a.warmupMs !== null, 'warm-up ran on the GPU');
  else check(a.warmupMs === null, 'no warm-up on the CPU');

  console.log('\n1. self-test through the worker');
  const h = await ask({ type: 'health', reqId: 'h1', file: MODEL, options });
  console.log(`   ${JSON.stringify(h.value || h.error)}`);
  check(h.ok && h.value.ok && h.value.loadMs === 0, 'health passes on the loaded pair without a reload');

  console.log('\n2. the self-test sentence, twice');
  const health = readWav(fs.readFileSync(HEALTH_AUDIO), RATE);
  const r1 = await gen({ audio: health });
  const r2 = await gen({ audio: health });
  console.log(`   ${describe(r2.result)}\n   → ${r2.result.language}: ${r2.result.transcript}`);
  check(r1.ok && norm('zh', r1.result.transcript) === HEALTH_TEXT, 'reads the sentence back');
  check(r1.result.language === 'Chinese', 'names the language');
  check(r2.result.text === r1.result.text, 'deterministic output');
  check(r1.streamed === '', 'no token stream for audio');

  console.log('\n3. faint noise');
  const noise = new Float32Array(3 * RATE);
  for (let i = 0; i < noise.length; i++) noise[i] = (Math.random() - 0.5) * 0.002;
  const r3 = await gen({ audio: noise });
  console.log(`   ${describe(r3.result)} → ${JSON.stringify(r3.result.text)}`);
  check(r3.ok && r3.result.transcript === '' && r3.result.language === null, 'no speech, no transcript');

  for (const lang of ['zh', 'en']) {
    const set = fleurs(lang, 10);
    if (!set.length) {
      console.log(`\n4. FLEURS ${lang}: no data under bench-data/fleurs, skipped`);
      continue;
    }
    let edits = 0;
    let chars = 0;
    const times = [];
    for (const s of set) {
      const r = await gen({ audio: s.pcm });
      const ref = [...norm(lang, s.ref)];
      edits += editDistance([...norm(lang, r.result.transcript)], ref);
      chars += ref.length;
      times.push(r.result.totalMs);
    }
    times.sort((x, y) => x - y);
    console.log(`\n4. FLEURS ${lang}, ${set.length} sentences: CER ${((100 * edits) / chars).toFixed(1)}%, median ${times[times.length >> 1]} ms, max ${times[times.length - 1]} ms`);
    check(edits / chars < 0.2, `FLEURS ${lang} CER under 20%`);
  }

  console.log('\n5. input the runtime refuses');
  const empty = await gen({ audio: new Float32Array(0) });
  const tooLong = await gen({ audio: new Float32Array(61 * RATE) });
  const wrongType = await gen({ audio: new Int16Array(RATE) });
  console.log(`   ${[empty, tooLong, wrongType].map((r) => (r.ok ? 'ok' : r.error.code)).join(', ')}`);
  check([empty, tooLong, wrongType].every((r) => !r.ok && r.error.code === 'LLM_BAD_AUDIO'), 'empty, over-long and non-float input are refused');

  console.log('\n6. cancel during a request');
  const reqId = nextReqId();
  const p = ask({ type: 'generate', reqId, audio: health });
  setTimeout(cancel, 5);
  const r6 = await p;
  console.log(`   stop ${r6.ok ? r6.result.stop : r6.error.code} after ${r6.ok ? r6.result.totalMs : '?'} ms`);
  check(r6.ok && (r6.result.stop === 'cancel' || r6.result.stop === 'eog'), 'cancel is honoured or the request was already done');

  const before = (await ask({ type: 'metrics', reqId: 'x1' })).rss;
  await ask({ type: 'unload-model', reqId: 'u1' });
  const after = (await ask({ type: 'metrics', reqId: 'x2' })).rss;
  console.log(`\nrss ${Math.round(before / 1048576)} MB → ${Math.round(after / 1048576)} MB after unload`);
  check(after <= before, 'unload releases memory');

  await finish();
})().catch((e) => {
  console.error('smoke failed:', e);
  process.exit(1);
});
