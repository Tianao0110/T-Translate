// Runtime smoke: drives electron/tengine/runtime/worker.js the way the LLM
// host will, against the pinned DLLs in resources/llama and one whitelisted
// model on disk. Prints load and decode numbers, checks prefix reuse, the
// no-thinking rule, cancellation and the probe steps.
//   node scripts/smoke-llm.js --model <path.gguf> [--provider cpu|gpu] [--threads N]
/* eslint-disable no-console */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { Worker } = require('worker_threads');

const arg = (name, def = null) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : def;
};
const MODEL = arg('--model', process.env.TT_LLM_MODEL);
const PROVIDER = arg('--provider', 'cpu');
const THREADS = Number(arg('--threads', 0)) || null;
const RUNTIME = path.join(__dirname, '..', 'resources', 'llama');
if (!MODEL || !fs.existsSync(MODEL)) {
  console.error('usage: node scripts/smoke-llm.js --model <path.gguf> [--provider cpu|gpu]');
  process.exit(2);
}

const abortFlag = new SharedArrayBuffer(4);
const flag = new Int32Array(abortFlag);
const worker = new Worker(path.join(__dirname, '..', 'electron', 'tengine', 'runtime', 'worker.js'), { workerData: { abortFlag } });
worker.on('error', (e) => {
  console.error('worker error', e);
  process.exit(1);
});
const waiters = [];
const tokens = new Map();
worker.on('message', (m) => {
  if (m.type === 'log') {
    console.log(`   [${m.level}] ${m.message}`);
    return;
  }
  if (m.type === 'token') {
    tokens.set(m.reqId, (tokens.get(m.reqId) || '') + m.text);
    return;
  }
  if (m.type === 'progress') return;
  const w = waiters.shift();
  if (w) w(m);
});
const ask = (msg) => new Promise((resolve) => {
  waiters.push(resolve);
  worker.postMessage(msg);
});
let reqSeq = 0;
const gen = async (fields) => {
  const reqId = `g${++reqSeq}`;
  const r = await ask({ type: 'generate', reqId, ...fields });
  return { ...r, streamed: tokens.get(reqId) || '' };
};
const failures = [];
const check = (ok, label) => {
  console.log(`   ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures.push(label);
};

// The general model gets the app's translation template; a translation-only
// model (Hy-MT2) gets the short instruction the stack's MT path sends, since
// it translates a long system prompt instead of obeying it.
const SYSTEM_GENERAL = 'You are a professional translator. Translate the following text into Chinese (Simplified).\n\nRequirements:\n- Use natural, conversational tone\n- Output ONLY the translation, no explanations or notes\n- Do NOT translate content inside special markers like ⟦...⟧';
const SYSTEM_MT = 'Translate the following text into Chinese (Simplified) in a natural and conversational tone. ONLY output the translated result without any explanation:';

(async () => {
  console.log(`runtime ${RUNTIME}\nmodel ${MODEL}\nprovider ${PROVIDER}, ${os.cpus().length} logical cpus`);
  const rt = await ask({ type: 'load-runtime', dir: RUNTIME });
  if (!rt.ok) {
    console.error('runtime failed:', rt.error);
    process.exit(1);
  }
  console.log(`runtime ${rt.info.build} (${rt.info.version}), gpu offload ${rt.info.gpuOffload}`);
  for (const d of rt.info.devices) console.log(`   dev ${d.index} ${d.name} [${d.typeName}] ${d.description} ${Math.round(d.memory.free / 1048576)}/${Math.round(d.memory.total / 1048576)} MB`);

  const m = await ask({ type: 'load-model', reqId: 'm1', file: MODEL, options: { provider: PROVIDER, threads: THREADS, nCtx: 4096, nBatch: 512 } });
  if (!m.ok) {
    console.error('model failed:', m.error);
    process.exit(1);
  }
  console.log(`model ${m.info.name} (${m.info.arch}, ${m.info.desc}) load ${m.info.loadMs} ms, ctx ${m.info.ctxMs} ms, on ${m.info.provider}${m.info.device ? ' ' + m.info.device.name : ''}${m.info.fallback ? ' (fallback: ' + m.info.fallback + ')' : ''}, family ${m.info.family}, thinking tokens ${JSON.stringify(m.info.thinkTokens)}`);
  const mtOnly = m.info.family === 'hunyuan';
  const SYSTEM = mtOnly ? SYSTEM_MT : SYSTEM_GENERAL;

  console.log('\n1. translation with a fixed system prompt');
  const r1 = await gen({ system: SYSTEM, user: 'Open ⟦url_0⟧ and paste the key from ⟦code_0⟧ into the box.', maxTokens: 80 });
  console.log(`   → ${r1.result.text.trim()}\n   ${r1.result.promptTokens} prompt tok (${r1.result.promptMs} ms), ${r1.result.genTokens} gen tok, first ${r1.result.firstMs} ms, ${r1.result.tokPerSec} tok/s, stop ${r1.result.stop}`);
  check(r1.ok && r1.result.stop === 'eog', 'ends at EOG');
  check(r1.result.text.includes('⟦url_0⟧') && r1.result.text.includes('⟦code_0⟧'), 'placeholders preserved');
  check(r1.streamed === r1.result.text, 'streamed text equals the result');
  check(r1.result.thinkLeak === 0, 'no thought leaked');

  console.log('\n2. second request, same system prompt (prefix reuse)');
  const r2 = await gen({ system: SYSTEM, user: 'Subtitles auto-save as SRT when you stop or switch sources.', maxTokens: 80 });
  console.log(`   → ${r2.result.text.trim()}\n   reused ${r2.result.reusedTokens} of ${r2.result.promptTokens} prompt tok, prompt ${r2.result.promptMs} ms (was ${r1.result.promptMs} ms)`);
  check(r2.result.reusedTokens > 20, 'reused the system prompt prefix');
  check(/[一-鿿]/.test(r2.result.text), 'answered in Chinese');

  if (mtOnly) {
    console.log('\n3. summary skipped: translation-only model');
  } else {
    console.log('\n3. summary with a bullet format line');
    const r3 = await gen({
      system: '你是一个阅读助手。用户会给你一段内容，请基于原文理解它，然后用中文写总结。只输出总结正文，不要复述原文，不要说明你在做什么。',
      user: '请阅读下面的内容，并用中文总结要点。\n\n内容：\nThe floating window captures a region of the screen and recognizes the text in it. Recognition runs on this machine; nothing is uploaded. With GPU acceleration on, a full-screen capture takes about 0.15 seconds instead of two.\n\n要求：\n- 3-5 条要点，每条一行\n- 输出格式：每行以「- 」开头，一行一个要点，不要段落',
      maxTokens: 200,
    });
    console.log(`   → ${r3.result.text.trim().split('\n').join('\n     ')}\n   ${r3.result.genTokens} tok, ${r3.result.tokPerSec} tok/s, think leak ${r3.result.thinkLeak}`);
    check(r3.result.text.trim().split('\n').filter(Boolean).length >= 2, 'multi-line answer');
  }

  console.log('\n4. cancel mid-generation');
  const reqId = `g${++reqSeq}`;
  const p = ask({ type: 'generate', reqId, system: '', user: 'Write a 500 word essay about the ocean.', maxTokens: 400 });
  setTimeout(() => Atomics.store(flag, 0, 1), 400);
  const t0 = Date.now();
  const r4 = await p;
  console.log(`   stop ${r4.result?.stop}, ${r4.result?.genTokens} tok, returned ${Date.now() - t0} ms after start`);
  check(r4.ok && r4.result.stop === 'cancel', 'stopped with reason cancel');
  check(r4.result.genTokens < 200, 'stopped early');

  console.log('\n5. generation still works after a cancel');
  const r5 = await gen({ system: SYSTEM, user: 'It works offline too.', maxTokens: 40 });
  console.log(`   → ${r5.result.text.trim()} (stop ${r5.result.stop})`);
  check(r5.ok && r5.result.genTokens > 0 && r5.result.stop === 'eog', 'clean generation after cancel');

  console.log('\n6. metrics');
  const mt = await ask({ type: 'metrics' });
  console.log(`   rss ${Math.round(mt.rss / 1048576)} MB, ctx used ${mt.model.ctxUsed}/${mt.model.nCtx}`);
  check(mt.model.ctxUsed > 0, 'context usage reported');

  console.log('\n7. probe: the same file, then junk');
  await ask({ type: 'unload-model' });
  const pr = await ask({ type: 'probe', reqId: 'p1', file: MODEL, options: { provider: PROVIDER, threads: THREADS } });
  for (const st of pr.report.steps) console.log(`   ${st.ok ? 'ok  ' : 'FAIL'} ${st.name} ${st.ms} ms${st.error ? ' — ' + st.error : ''}`);
  console.log(`   meta ${pr.report.meta?.arch} ${pr.report.meta?.quant} ctxTrain ${pr.report.meta?.ctxTrain} → verdict ${pr.report.verdict}`);
  check(pr.report.verdict === 'usable', 'whitelisted model probes usable');
  const junk = path.join(os.tmpdir(), 'tt-junk.gguf');
  const jb = Buffer.alloc(1048576, 0x5a);
  jb.write('GGUF', 0);
  jb.writeUInt32LE(3, 4);
  fs.writeFileSync(junk, jb);
  const pj = await ask({ type: 'probe', reqId: 'p2', file: junk, options: { provider: 'cpu' } });
  fs.unlinkSync(junk);
  console.log(`   junk: ${pj.report.steps.map((st) => `${st.name}:${st.ok ? 'ok' : 'fail'}`).join(' ')} → ${pj.report.verdict}`);
  check(pj.report.verdict === 'unusable' && pj.report.steps[0].ok === false, 'junk rejected at the header');

  await ask({ type: 'shutdown' });
  await worker.terminate();
  console.log(failures.length ? `\n${failures.length} check(s) failed: ${failures.join('; ')}` : '\nall checks passed');
  process.exit(failures.length ? 1 : 0);
})().catch((e) => {
  console.error('smoke failed:', e);
  process.exit(1);
});
