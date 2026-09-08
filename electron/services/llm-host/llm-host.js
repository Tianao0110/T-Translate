// LLM host: the llama.cpp runtime in its own utilityProcess. This process
// keeps one worker_thread (tengine/runtime/worker.js) where every FFI call
// runs synchronously; this thread only relays messages, hands the worker
// one request at a time, owns the shared abort flag, and runs the stall
// watchdog. A native fault takes this process, not the app; the host
// manager rejects in-flight requests and respawns on demand.
//
// Protocol (main -> host):
//   {type:'init', runtimeDir, firstTokenMs?, stallMs?}
//   {type:'load-model', id, reqId, file, options}      progress events, then result {info}
//   {type:'generate', id, reqId, system?, user?, prompt?, maxTokens?, sampler?}
//                                                     token events, then result {text, stop, ...numbers}
//   {type:'cancel', reqId}                            aborts that request (running or queued)
//   {type:'unload-model', id}                         result {}
//   {type:'probe', id, reqId, file, options}          result {report}
//   {type:'health', id, reqId, file, options}         result {ok, provider, device, fallback, loadMs, firstMs, tokPerSec}
//   {type:'metrics', id}                              result {rss, model, devices}
//   {type:'shutdown'}
// (host -> main):
//   {type:'ready', info}                              runtime loaded: build, version, devices
//   {type:'result', id, ok, value?, error?:{message, code}}
//   {type:'progress', id, reqId, value}   {type:'token', id, reqId, text}   {type:'stall', id, reqId, phase}
//   {type:'log', level, message}

const path = require('path');
const { Worker } = require('worker_threads');

const port = process.parentPort;
const post = (m) => port.postMessage(m);
const log = (level, message) => post({ type: 'log', level, message });

const WORKER_REQUEST_TYPES = new Set(['load-model', 'generate', 'unload-model', 'probe', 'health', 'metrics']);
// Worker reply type -> request type it answers.
const REPLY_OF = { model: 'load-model', done: 'generate', unloaded: 'unload-model', probed: 'probe', health: 'health', metrics: 'metrics' };

let worker = null;
const abortFlag = new SharedArrayBuffer(4);
const flag = new Int32Array(abortFlag);
let firstTokenMs = 60000;
let stallMs = 15000;

// One request in the worker at a time; the rest wait here so a cancel can
// still reach them and the watchdog knows what it is watching.
const queue = [];
let running = null; // { id, reqId, type, startedAt, lastTokenAt, tokens, stalled }
let watchdog = null;

function fail(id, code, message) {
  post({ type: 'result', id, ok: false, error: { message, code } });
}

function startWorker() {
  worker = new Worker(path.join(__dirname, '..', '..', 'tengine', 'runtime', 'worker.js'), { workerData: { abortFlag } });
  worker.on('message', onWorkerMessage);
  worker.on('error', (e) => {
    log('error', `runtime thread failed: ${e.message}`);
    process.exit(3);
  });
  worker.on('exit', (code) => {
    if (code !== 0) {
      log('error', `runtime thread exited with ${code}`);
      process.exit(3);
    }
  });
}

function pump() {
  if (running || queue.length === 0) return;
  const next = queue.shift();
  running = { ...next, startedAt: Date.now(), lastTokenAt: Date.now(), tokens: 0, stalled: false };
  Atomics.store(flag, 0, 0);
  const { id, ...msg } = next.msg;
  worker.postMessage({ ...msg, reqId: next.reqId });
}

function finish(reply) {
  const r = running;
  running = null;
  if (r && reply) {
    if (reply.ok === false || (reply.type === 'probed' && !reply.report)) {
      fail(r.id, reply.error?.code || 'LLM_FAILED', reply.error?.message || `${r.type} failed`);
    } else {
      let value = reply.value !== undefined ? reply.value : reply.result !== undefined ? reply.result : reply.info !== undefined ? reply.info : reply.report !== undefined ? { report: reply.report } : reply;
      if (reply.type === 'metrics') {
        const { type, reqId, ...rest } = reply;
        value = rest;
      }
      if (r.type === 'generate' && r.stalled && value && value.stop === 'cancel') value = { ...value, stop: 'stall' };
      post({ type: 'result', id: r.id, ok: true, value });
    }
  }
  pump();
}

function onWorkerMessage(m) {
  if (m.type === 'log') {
    log(m.level, m.message);
    return;
  }
  // Answered by the init listener.
  if (m.type === 'runtime') return;
  if (m.type === 'token') {
    if (running && running.reqId === m.reqId) {
      running.tokens++;
      running.lastTokenAt = Date.now();
      post({ type: 'token', id: running.id, reqId: m.reqId, text: m.text });
    }
    return;
  }
  if (m.type === 'progress') {
    if (running && running.reqId === m.reqId) {
      running.lastTokenAt = Date.now();
      post({ type: 'progress', id: running.id, reqId: m.reqId, value: m.value });
    }
    return;
  }
  if (m.type === 'shutdown-ack') {
    process.exit(0);
    return;
  }
  const answers = REPLY_OF[m.type];
  if (!answers) {
    log('warn', `unexpected runtime message ${m.type}`);
    return;
  }
  if (!running || running.type !== answers) {
    log('warn', `stray ${m.type} reply`);
    return;
  }
  finish(m);
}

// Generation: no first token within firstTokenMs (prompt processing on a
// slow CPU included), or no token for stallMs after that, aborts the
// request; the result then says 'stall'. Loads are covered by the ready
// and request timeouts on the main side.
function checkStall() {
  if (!running || running.type !== 'generate' || running.stalled) return;
  const idle = Date.now() - running.lastTokenAt;
  const limit = running.tokens === 0 ? firstTokenMs : stallMs;
  if (idle <= limit) return;
  running.stalled = true;
  Atomics.store(flag, 0, 1);
  post({ type: 'stall', id: running.id, reqId: running.reqId, phase: running.tokens === 0 ? 'first-token' : 'stream' });
}

function cancel(reqId) {
  if (running && running.reqId === reqId) {
    Atomics.store(flag, 0, 1);
    return;
  }
  const i = queue.findIndex((q) => q.reqId === reqId);
  if (i >= 0) {
    const [q] = queue.splice(i, 1);
    fail(q.id, 'LLM_CANCELLED', 'cancelled before it started');
  }
}

function handle(msg) {
  if (!msg || !msg.type) return;
  switch (msg.type) {
    case 'init': {
      if (msg.firstTokenMs) firstTokenMs = msg.firstTokenMs;
      if (msg.stallMs) stallMs = msg.stallMs;
      startWorker();
      const onRuntime = (m) => {
        if (m.type !== 'runtime') return;
        worker.off('message', onRuntime);
        if (!m.ok) {
          log('error', `runtime failed: ${m.error.message}`);
          process.exit(2);
          return;
        }
        watchdog = setInterval(checkStall, 1000);
        post({ type: 'ready', info: m.info });
      };
      worker.on('message', onRuntime);
      worker.postMessage({ type: 'load-runtime', dir: msg.runtimeDir });
      return;
    }
    case 'cancel':
      cancel(msg.reqId);
      return;
    case 'shutdown':
      if (watchdog) clearInterval(watchdog);
      if (worker) {
        worker.postMessage({ type: 'shutdown' });
        setTimeout(() => process.exit(0), 2000).unref();
      } else {
        process.exit(0);
      }
      return;
    default:
      if (!WORKER_REQUEST_TYPES.has(msg.type)) {
        log('warn', `unknown message ${msg.type}`);
        return;
      }
      if (!worker) {
        fail(msg.id, 'LLM_RUNTIME_NOT_LOADED', 'host not initialised');
        return;
      }
      queue.push({ id: msg.id, reqId: msg.reqId || `r${msg.id}`, type: msg.type, msg });
      pump();
  }
}

port.on('message', (e) => {
  try {
    handle(e.data);
  } catch (err) {
    log('error', `handler failed: ${err.message}`);
  }
});
