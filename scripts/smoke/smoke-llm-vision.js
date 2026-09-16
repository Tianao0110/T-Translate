// Vision runtime smoke: drives electron/tengine/runtime/worker.js the way
// the LLM host will, with a text model plus its mmproj. Prints load and
// per-image numbers, checks the fixed self-test image reads back with a
// box, that cancellation reaches an image request, and that unloading
// frees both halves.
//   node scripts/smoke/smoke-llm-vision.js --model <path.gguf> --mmproj <path.gguf> [--provider cpu|gpu] [--image <png>]
/* eslint-disable no-console */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { RUNTIME_DIR, HEALTH_IMAGE, arg, startWorker } = require('../lib/worker-driver');

const MODEL = arg('--model', process.env.TT_VISION_MODEL);
const MMPROJ = arg('--mmproj', process.env.TT_VISION_MMPROJ);
const PROVIDER = arg('--provider', 'cpu');
const IMAGE = arg('--image', null);
if (!MODEL || !MMPROJ || !fs.existsSync(MODEL) || !fs.existsSync(MMPROJ)) {
  console.error('usage: node scripts/smoke/smoke-llm-vision.js --model <path.gguf> --mmproj <path.gguf> [--provider cpu|gpu] [--image <png>]');
  process.exit(2);
}

const { ask, generate: gen, nextReqId, cancel, check, finish } = startWorker({ logLevel: 'error' });
const describe = (r) => `${r.imageTokens} image tok, prefill ${r.promptMs} ms, first ${r.firstMs} ms, ${r.genTokens} tok in ${r.totalMs - r.promptMs} ms (${r.tokPerSec} tok/s), total ${r.totalMs} ms, stop ${r.stop}, ${r.lines.length} lines`;

(async () => {
  console.log(`runtime ${RUNTIME_DIR}\nmodel ${MODEL}\nmmproj ${MMPROJ}\nprovider ${PROVIDER}, ${os.cpus().length} logical cpus`);
  const rt = await ask({ type: 'load-runtime', dir: RUNTIME_DIR });
  if (!rt.ok) {
    console.error('runtime failed:', rt.error);
    process.exit(1);
  }
  console.log(`runtime ${rt.info.build} (${rt.info.version})`);

  const m = await ask({ type: 'load-model', reqId: 'm1', file: MODEL, options: { provider: PROVIDER, nCtx: 4096, nBatch: 2048, mmproj: MMPROJ } });
  if (!m.ok) {
    console.error('model failed:', m.error);
    process.exit(1);
  }
  console.log(`model ${m.info.name} (${m.info.arch}) load ${m.info.loadMs} ms + mmproj ${m.info.vision.loadMs} ms (warm-up included), on ${m.info.provider}${m.info.device ? ' ' + m.info.device.name : ''}, family ${m.info.vision.family}, mrope ${m.info.vision.mrope}`);
  check(m.info.vision && m.info.vision.family === 'paddleocr', 'vision attached with the PaddleOCR prompt family');

  console.log('\n1. fixed self-test image, Spotting');
  const health = fs.readFileSync(HEALTH_IMAGE);
  const r1 = await gen({ image: health });
  console.log(`   ${describe(r1.result)}`);
  for (const l of r1.result.lines) console.log(`   | ${l.text}  ${JSON.stringify(l.box)}`);
  check(r1.ok && r1.result.stop === 'eog', 'ends at EOG');
  check(r1.result.lines.some((l) => l.text.includes('OK') && l.box), 'reads the OK line with a box');
  check(r1.result.lines.every((l) => !l.box || (l.box[0] >= 0 && l.box[2] <= r1.result.width && l.box[3] <= r1.result.height)), 'boxes stay inside the image');
  check(r1.streamed === r1.result.text, 'streamed text equals the result');

  console.log('\n2. same image again (steady state)');
  const r2 = await gen({ image: health });
  console.log(`   ${describe(r2.result)}`);
  check(r2.result.text === r1.result.text, 'deterministic output');

  console.log('\n3. plain OCR task');
  const r3 = await gen({ image: health, task: 'OCR' });
  console.log(`   → ${r3.result.text.trim()}`);
  check(r3.ok && /OK/.test(r3.result.text) && r3.result.lines.length === 0, 'OCR task returns text only');

  console.log('\n4. health through the worker (vision branch)');
  const h = await ask({ type: 'health', reqId: 'h1', file: MODEL, options: { provider: PROVIDER, nCtx: 4096, nBatch: 2048, mmproj: MMPROJ } });
  console.log(`   ${JSON.stringify(h.value)}`);
  check(h.ok && h.value.ok && h.value.lines > 0, 'health passes on the loaded pair without a reload');

  if (IMAGE && fs.existsSync(IMAGE)) {
    console.log(`\n5. ${path.basename(IMAGE)}`);
    const r5 = await gen({ image: fs.readFileSync(IMAGE) });
    console.log(`   ${describe(r5.result)}`);
    for (const l of r5.result.lines.slice(0, 12)) console.log(`   | ${l.text}  ${JSON.stringify(l.box)}`);
    check(r5.ok && r5.result.lines.length > 0, 'custom image yields lines');
  }

  console.log('\n6. cancel during an image request');
  const reqId = nextReqId();
  const p = ask({ type: 'generate', reqId, image: IMAGE && fs.existsSync(IMAGE) ? fs.readFileSync(IMAGE) : health });
  setTimeout(cancel, 5);
  const r6 = await p;
  console.log(`   stop ${r6.ok ? r6.result.stop : r6.error.code} after ${r6.ok ? r6.result.totalMs : '?'} ms`);
  check(r6.ok && (r6.result.stop === 'cancel' || r6.result.stop === 'eog'), 'cancel is honoured or the request was already done');

  console.log('\n7. text request on a vision model still works');
  const r7 = await gen({ prompt: '<|begin_of_sentence|>User: Say OK.\nAssistant:\n', maxTokens: 8 });
  console.log(`   → ${JSON.stringify(r7.ok ? r7.result.text : r7.error)}`);
  check(r7.ok, 'text path unaffected');

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
