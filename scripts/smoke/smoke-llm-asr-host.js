// The speech slot end to end in a real Electron: the model folder scanner
// accepting the two-file speech packs, llm-manager loading the pack the
// provider picks into its own host, transcribe() on the GPU and on the CPU,
// the GPU self-test, the host running apart from the text host, and
// unloading. userData and the model folder are sandboxes; the files are
// hard-linked in under their pinned names.
//
//   npx electron scripts/smoke/smoke-llm-asr-host.js --dir <folder with the Qwen3-ASR files> [--text <Qwen3 gguf>]
/* eslint-disable no-console */

const path = require('path');
const fs = require('fs');
const { REPO, arg, sleep, checklist, sandbox, place, fakeStore, run } = require('../lib/electron-smoke');
const { packsForRole, packFiles, LLM_ROLE_ASR } = require('../../electron/shared/llm-packs');
const { readWav } = require('../../electron/tengine/runtime/mtmd');

const DIR = arg('--dir', process.env.TT_ASR_DIR);
const TEXT = arg('--text', process.env.TT_LLM_MODEL);
const HEALTH_AUDIO = path.join(REPO, 'electron', 'tengine', 'runtime', 'assets', 'asr-health.wav');
const HEALTH_TEXT = '今天天气很好我们去公园散步吧';
const FLEURS = path.join(REPO, 'bench-data', 'fleurs');
const RATE = 16000;
const { step, summary } = checklist();

const plain = (s) => String(s || '').replace(/[\s\p{P}\p{S}]+/gu, '');

// The first n FLEURS dev clips of a language, when the bench data is there.
function fleurs(lang, n) {
  const dir = path.join(FLEURS, lang);
  if (!fs.existsSync(path.join(dir, 'dev.tsv'))) return [];
  const out = [];
  const seen = new Set();
  for (const line of fs.readFileSync(path.join(dir, 'dev.tsv'), 'utf8').split('\n')) {
    const cols = line.split('\t');
    if (cols.length < 4 || seen.has(cols[0]) || !fs.existsSync(path.join(dir, 'dev', cols[1]))) continue;
    seen.add(cols[0]);
    out.push({ pcm: readWav(fs.readFileSync(path.join(dir, 'dev', cols[1])), RATE), ref: cols[3] });
    if (out.length >= n) break;
  }
  return out;
}

async function main() {
  if (!DIR || !fs.existsSync(DIR)) {
    console.error('usage: npx electron scripts/smoke/smoke-llm-asr-host.js --dir <folder with the Qwen3-ASR files> [--text <gguf>]');
    return 2;
  }
  const speech = packsForRole(LLM_ROLE_ASR);
  const present = speech.filter((p) => packFiles(p).every((f) => fs.existsSync(path.join(DIR, f.file))));
  if (!present.length) {
    console.error(`no complete speech pack in ${DIR}: expected ${speech.map((p) => packFiles(p).map((f) => f.file).join(' + ')).join(' or ')}`);
    return 2;
  }
  const box = sandbox('t-translate-smoke-llm-asr-host');
  const modelsDir = path.join(box.dir, 'llm-models');
  fs.mkdirSync(modelsDir, { recursive: true });
  for (const p of present) for (const f of packFiles(p)) place(modelsDir, path.join(DIR, f.file));
  if (TEXT && fs.existsSync(TEXT)) place(modelsDir, TEXT);

  const store = fakeStore({ privacyMode: 'standard' });
  const tengine = require('../../electron/tengine').get();
  const llmManager = require('../../electron/llm/llm-manager');
  const makeLogger = require('../../electron/platform/logger');
  llmManager.init({ store, tengine, adapter: tengine.get('llm'), asrAdapter: tengine.get('llm-asr'), logsDir: path.join(box.dir, 'logs'), modelsDir, logger: makeLogger('LLM') });
  const asr = tengine.get('llm-asr');

  const scan = await llmManager.rescan();
  const rows = scan.packs.filter((p) => p.role === LLM_ROLE_ASR);
  step('speech packs verified by both hashes', present.every((p) => rows.find((r) => r.id === p.id)?.status === 'ready'), rows.map((r) => `${r.id}: ${r.status}`).join(', '));

  const bigFirst = [...present].sort((a, b) => b.size - a.size);
  const onGpu = bigFirst[0];
  const onCpu = bigFirst[bigFirst.length - 1];
  const health = readWav(fs.readFileSync(HEALTH_AUDIO), RATE);

  asr.setProvider('gpu');
  const t0 = Date.now();
  const st = await llmManager.asrSelfTest();
  step('GPU self-test on the pack the GPU picks', st.ok && st.provider === 'webgpu', `${onGpu.id}, ${Date.now() - t0} ms incl. load and warm-up, prefill ${st.promptMs} ms, ${st.tokPerSec} tok/s`);
  const a1 = llmManager.status().asr;
  step('status shows it resident on its own host', a1.available && a1.usable && a1.selected === onGpu.id && a1.resident?.file === onGpu.file && a1.resident?.provider === 'gpu', `${a1.resident?.file} on ${a1.resident?.provider}`);

  const t1 = Date.now();
  const r1 = await (await llmManager.transcribe({ pcm: health })).promise;
  step('transcribe on the GPU reads the fixed sentence back', plain(r1.transcript) === HEALTH_TEXT && r1.language === 'Chinese', `${Date.now() - t1} ms: ${r1.language}: ${r1.transcript}`);

  for (const lang of ['zh', 'en']) {
    const set = fleurs(lang, 3);
    if (!set.length) continue;
    const times = [];
    const texts = [];
    for (const s of set) {
      const t = Date.now();
      const r = await (await llmManager.transcribe({ pcm: s.pcm })).promise;
      times.push(Date.now() - t);
      texts.push(r.transcript);
    }
    step(`FLEURS ${lang}: three sentences through the host`, texts.every((x) => x.length > 0), `${times.join(' / ')} ms; ${texts[0].slice(0, 40)}`);
  }

  const engines = tengine.status().engines;
  step('the speech host runs apart from the text host', engines.find((e) => e.id === 'llm-asr')?.host?.running === true && engines.find((e) => e.id === 'llm')?.host?.running !== true, engines.filter((e) => e.id.startsWith('llm')).map((e) => `${e.id}:${e.host?.running ? 'running' : 'idle'}`).join(' '));

  if (TEXT && fs.existsSync(TEXT)) {
    tengine.get('llm').setProvider('gpu');
    const g = await llmManager.generate({ system: 'Translate the following text into Chinese (Simplified). Output ONLY the translation.', user: 'The weather is nice today.', maxTokens: 40 });
    const [text, speechResult] = await Promise.all([g.promise, (await llmManager.transcribe({ pcm: health })).promise]);
    step('text and speech requests run side by side on two hosts', /[一-鿿]/.test(text.text) && plain(speechResult.transcript) === HEALTH_TEXT, `${text.text.trim()} | ${speechResult.transcript}`);
    await llmManager.unload('smoke');
  }

  asr.setProvider('cpu');
  const t2 = Date.now();
  const r2 = await (await llmManager.transcribe({ pcm: health })).promise;
  const a2 = llmManager.status().asr;
  step('with the GPU off it reloads the pack the CPU picks and still reads it', plain(r2.transcript) === HEALTH_TEXT && a2.selected === onCpu.id && a2.resident?.file === onCpu.file && a2.resident?.provider === 'cpu', `${onCpu.id} on the CPU, ${Date.now() - t2} ms incl. reload: ${r2.transcript}`);

  step('manual unload clears the speech slot', (await llmManager.unloadAsr('smoke')) === true && llmManager.status().asr.resident === null);
  tengine.shutdownAll();
  await sleep(300);
  box.cleanup();
  return summary();
}

run(main);
