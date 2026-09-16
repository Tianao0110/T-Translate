// Drives electron/tengine/runtime/worker.js from plain Node the way the LLM
// host does: one worker, request / response pairing, per-request token
// accumulation, the shared abort flag, and an indented check list that ends
// in the exit code. Used by smoke-llm and smoke-llm-vision.
/* eslint-disable no-console */

const path = require('path');
const { Worker } = require('worker_threads');
const { REPO, LLAMA_RUNTIME_DIR: RUNTIME_DIR, VISION_HEALTH_IMAGE: HEALTH_IMAGE, arg } = require('./electron-smoke');

// logLevel 'all' echoes every worker log line, 'error' only errors.
function startWorker({ logLevel = 'all' } = {}) {
  const abortFlag = new SharedArrayBuffer(4);
  const flag = new Int32Array(abortFlag);
  const worker = new Worker(path.join(REPO, 'electron', 'tengine', 'runtime', 'worker.js'), { workerData: { abortFlag } });
  worker.on('error', (e) => {
    console.error('worker error', e);
    process.exit(1);
  });
  const waiters = [];
  const tokens = new Map();
  worker.on('message', (m) => {
    if (m.type === 'log') {
      if (logLevel === 'all' || m.level === 'error') console.log(`   [${m.level}] ${m.message}`);
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
  const nextReqId = () => `g${++reqSeq}`;
  // One generate request; the reply carries the streamed text for comparison.
  const generate = async (fields) => {
    const reqId = nextReqId();
    const r = await ask({ type: 'generate', reqId, ...fields });
    return { ...r, reqId, streamed: tokens.get(reqId) || '' };
  };
  const cancel = () => Atomics.store(flag, 0, 1);

  const failures = [];
  const check = (ok, label) => {
    console.log(`   ${ok ? 'PASS' : 'FAIL'}  ${label}`);
    if (!ok) failures.push(label);
  };
  async function finish() {
    await ask({ type: 'shutdown' });
    await worker.terminate();
    console.log(failures.length ? `\n${failures.length} check(s) failed: ${failures.join('; ')}` : '\nall checks passed');
    process.exit(failures.length ? 1 : 0);
  }

  return { worker, ask, generate, nextReqId, tokens, cancel, check, failures, finish };
}

module.exports = { REPO, RUNTIME_DIR, HEALTH_IMAGE, arg, startWorker };
