// LLM host smoke: brings the real utilityProcess up through T-Engine,
// loads a model, streams a generation, cancels one, runs the self-test and
// the probe, then kills the host and checks it comes back. userData is a
// sandbox; nothing of the user's is touched.
//
//   npm run smoke:llm-host -- --model <path.gguf> [--gpu]
/* eslint-disable no-console */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { app } = require('electron');

const SANDBOX = path.join(os.tmpdir(), 't-translate-smoke-llm-host');
const arg = (name, def = null) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : def;
};
const MODEL = arg('--model', process.env.TT_LLM_MODEL);
const GPU = process.argv.includes('--gpu');

let failures = 0;
function step(label, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures++;
}

const SYSTEM = 'You are a professional translator. Translate the following text into Chinese (Simplified).\n\nRequirements:\n- Use natural, conversational tone\n- Output ONLY the translation, no explanations or notes\n- Do NOT translate content inside special markers like ⟦...⟧';

async function main() {
  if (!MODEL || !fs.existsSync(MODEL)) {
    console.error('usage: npm run smoke:llm-host -- --model <path.gguf> [--gpu]');
    app.exit(2);
    return;
  }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  fs.mkdirSync(SANDBOX, { recursive: true });
  app.setPath('userData', SANDBOX);
  process.env.TT_MODELS_ROOT = path.join(SANDBOX, 'models');

  const tengine = require('../electron/tengine').get();
  const llm = tengine.get('llm');
  const events = [];
  tengine.on((e) => events.push(e));
  llm.setProvider(GPU ? 'gpu' : 'cpu');

  const t0 = Date.now();
  await llm.host.spawn();
  await new Promise((r) => setTimeout(r, 50));
  const rt = llm.runtime();
  step('host up with the pinned runtime', !!rt && rt.build === 'b10853', `${Date.now() - t0} ms, ${rt ? rt.devices.map((d) => `${d.name}[${d.typeName}]`).join(' ') : 'no info'}`);

  const progress = [];
  const info = await llm.load(MODEL, { nCtx: 4096 }, { onProgress: (v) => progress.push(v) });
  step('model loaded on the requested provider', info.provider === (GPU ? 'gpu' : 'cpu'), `${info.name} ${info.arch} load ${info.loadMs} ms on ${info.device ? info.device.name : '?'}${info.fallback ? ' fallback ' + info.fallback : ''}, ${progress.length} progress events`);
  step('progress reached 1', progress.at(-1) === 1, progress.slice(-3).join(','));

  const chunks = [];
  const g1 = llm.generate({ kind: 'translate', system: SYSTEM, user: 'It works offline too; nothing leaves your machine.', maxTokens: 60 }, (t) => chunks.push(t));
  const r1 = await g1.promise;
  step('streamed translation ends at EOG', r1.stop === 'eog' && /[一-鿿]/.test(r1.text), `${r1.text.trim()} (${r1.genTokens} tok, ${r1.tokPerSec} tok/s, first ${r1.firstMs} ms)`);
  step('stream matches result', chunks.join('') === r1.text);

  const r1b = await llm.generate({ kind: 'translate', system: SYSTEM, user: 'Subtitles auto-save as SRT.', maxTokens: 40 }).promise;
  step('second request reuses the system prompt', r1b.stop === 'eog' && r1b.reusedTokens > 20, `${r1b.text.trim()} reused ${r1b.reusedTokens}, prompt ${r1b.promptMs} ms`);

  const g2 = llm.generate({ kind: 'test', system: SYSTEM, user: 'Write a 500 word essay about the ocean.', maxTokens: 400 });
  setTimeout(() => g2.cancel(), 300);
  const r2 = await g2.promise;
  step('cancel stops the stream', r2.stop === 'cancel' && r2.genTokens < 200, `${r2.genTokens} tok, stop ${r2.stop}`);

  const r3 = await llm.generate({ kind: 'translate', system: SYSTEM, user: 'Nothing leaves your machine.', maxTokens: 40 }).promise;
  step('generation after cancel still reuses the prefix', r3.stop === 'eog' && r3.reusedTokens > 20, `${r3.text.trim()} reused ${r3.reusedTokens}`);

  const h = await llm.health({ file: MODEL, options: { nCtx: 4096 } });
  step('self-test on the loaded model', h.ok === true && h.loadMs === 0 && h.tokPerSec > 0, `${h.tokPerSec} tok/s, first ${h.firstMs} ms`);

  const m = await llm.metrics();
  step('metrics from the runtime', m.rss > 0 && m.model && m.model.ctxUsed > 0, `rss ${Math.round(m.rss / 1048576)} MB, ctx ${m.model && m.model.ctxUsed}`);

  const exitsBefore = events.filter((e) => e.kind === 'exit').length;
  llm.host.kill();
  await new Promise((r) => setTimeout(r, 300));
  step('kill reports an expected exit', events.filter((e) => e.kind === 'exit').length === exitsBefore + 1 && llm.loaded() === null);
  const t1 = Date.now();
  await llm.load(MODEL, { nCtx: 4096 });
  const r4 = await llm.generate({ kind: 'translate', system: SYSTEM, user: 'Hello again.', maxTokens: 20 }).promise;
  step('respawn + reload + generate', r4.stop === 'eog' && r4.genTokens > 0, `${Date.now() - t1} ms total, ${r4.text.trim()}`);

  const report = await llm.probe(MODEL, { nCtx: 4096 });
  step('probe verdict usable', report.verdict === 'usable', report.steps.map((s) => `${s.name}:${s.ok ? s.ms + 'ms' : 'FAIL'}`).join(' '));

  const kinds = events.reduce((acc, e) => ({ ...acc, [e.kind]: (acc[e.kind] || 0) + 1 }), {});
  console.log('events:', JSON.stringify(kinds));
  const leak = events.some((e) => JSON.stringify(e).includes('翻译') || JSON.stringify(e).includes('ocean'));
  step('no prompt or output text in the event stream', !leak);

  llm.shutdown();
  await new Promise((r) => setTimeout(r, 200));
  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  app.exit(failures ? 1 : 0);
}

app.whenReady().then(() => main().catch((e) => {
  console.error('smoke failed:', e);
  app.exit(1);
}));
