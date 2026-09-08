// The runtime thread. Every FFI call happens here, synchronously; the LLM
// host's main thread (services/llm-host) only relays messages and flips the
// shared abort flag, which is the one thing that can reach a decode loop
// in progress. Messages queue behind a running generation, so a cancel is
// never a message.
//
// workerData: { abortFlag: SharedArrayBuffer(4) }
//
// in  {type:'load-runtime', dir}                 -> {type:'runtime', ok, info|error}
//     {type:'load-model', reqId, file, options}  -> {type:'progress', reqId, value}* then {type:'model', reqId, ok, info|error}
//     {type:'generate', reqId, system?, user?, prompt?, maxTokens?, sampler?}
//                                                -> {type:'token', reqId, text}* then {type:'done', reqId, ok, result|error}
//     {type:'unload-model'}                      -> {type:'unloaded'}
//     {type:'probe', reqId, file, options}       -> {type:'probed', reqId, report}
//     {type:'metrics'}                           -> {type:'metrics', rss, ctxUsed, devices}
//     {type:'shutdown'}
// out {type:'log', level, message} at any time

const fs = require('fs');
const { parentPort, workerData } = require('worker_threads');
const { loadRuntime } = require('./llama-binding');
const session = require('./llama-session');
const ABI = require('./llama-abi');

const abortFlag = workerData && workerData.abortFlag ? new Int32Array(workerData.abortFlag) : null;
const now = () => Number(process.hrtime.bigint()) / 1e6;
const post = (m) => parentPort.postMessage(m);
const log = (level, message) => post({ type: 'log', level, message });
const errInfo = (e) => ({ message: e.message, code: e.code || 'LLM_FAILED' });

let binding = null;
let current = null; // { session, file }

function runtimeInfo() {
  return {
    build: binding.build,
    version: binding.version(),
    systemInfo: binding.systemInfo(),
    gpuOffload: binding.supportsGpuOffload(),
    devices: binding.devices().map(({ handle, ...d }) => d),
  };
}

function requireRuntime() {
  if (!binding) throw Object.assign(new Error('runtime not loaded'), { code: 'LLM_RUNTIME_NOT_LOADED' });
  return binding;
}

function unloadModel() {
  if (!current) return;
  current.session.close();
  current = null;
}

function loadModel(msg) {
  requireRuntime();
  unloadModel();
  if (abortFlag) Atomics.store(abortFlag, 0, 0);
  const s = session.openSession(binding, {
    ...(msg.options || {}),
    file: msg.file,
    abortFlag,
    onProgress: (value) => post({ type: 'progress', reqId: msg.reqId, value }),
  });
  current = { session: s, file: msg.file };
  return {
    ...s.info(),
    file: msg.file,
    provider: s.provider,
    device: s.device,
    fallback: s.fallback,
    loadMs: s.loadMs,
    ctxMs: s.ctxMs,
    threads: s.threads,
  };
}

function generate(msg) {
  if (!current) throw Object.assign(new Error('no model loaded'), { code: 'LLM_NO_MODEL' });
  if (abortFlag) Atomics.store(abortFlag, 0, 0);
  const prompt = msg.prompt !== undefined ? msg.prompt : current.session.buildPrompt({ system: msg.system || '', user: msg.user || '' });
  return current.session.generate({
    prompt,
    maxTokens: msg.maxTokens || 256,
    sampler: msg.sampler || {},
    onToken: (text) => post({ type: 'token', reqId: msg.reqId, text }),
  });
}

// The five probe steps for a file outside the whitelist (docs/T-ENGINE.md
// §5): header, vocab, budget, a short generation, verdict. Each step's time
// and raw error go into the report; the caller decides what to show.
function probe(msg) {
  requireRuntime();
  const options = msg.options || {};
  const nCtx = options.nCtx || 4096;
  const steps = [];
  const report = { file: msg.file, steps, meta: null, budget: null, generate: null, verdict: 'unusable' };
  const step = (name, fn) => {
    const t = now();
    try {
      const value = fn();
      steps.push({ name, ok: true, ms: Math.round(now() - t) });
      return value;
    } catch (e) {
      steps.push({ name, ok: false, ms: Math.round(now() - t), error: e.message, code: e.code || null });
      throw e;
    }
  };
  try {
    report.meta = step('metadata', () => {
      const m = session.readMetadata(binding, msg.file);
      if (!m) throw Object.assign(new Error('not a readable GGUF'), { code: 'LLM_BAD_FILE' });
      if (!m.arch) throw Object.assign(new Error('no general.architecture'), { code: 'LLM_BAD_FILE' });
      return m;
    });
    step('vocab', () => session.vocabOnlyLoad(binding, msg.file));
    report.budget = step('budget', () => {
      const size = fs.statSync(msg.file).size;
      const need = size + session.estimateKvBytes(report.meta, nCtx) + 256 * 1024 * 1024;
      const picked = session.pickDevice(binding.devices(), options.provider || 'cpu', options.deviceIndex ?? null);
      const free = picked.device ? picked.device.memory.free : 0;
      if (free && need > free) {
        throw Object.assign(new Error(`needs ${Math.round(need / 1048576)} MB, ${picked.device.name} has ${Math.round(free / 1048576)} MB free`), { code: 'LLM_NO_MEMORY' });
      }
      return { needBytes: need, freeBytes: free, device: picked.device ? picked.device.name : null };
    });
    unloadModel();
    report.generate = step('generate', () => {
      const s = session.openSession(binding, { ...options, file: msg.file, nCtx: Math.min(nCtx, 1024), abortFlag });
      try {
        const r = s.generate({ prompt: s.buildPrompt({ user: 'Reply with the single word OK.' }), maxTokens: 8 });
        return { ...r, text: undefined, loadMs: s.loadMs, provider: s.provider, family: s.family, hasThinking: s.info().hasThinking };
      } finally {
        s.close();
      }
    });
    report.verdict = report.generate.genTokens > 0 && report.generate.stop !== 'error' ? 'usable' : 'unusable';
  } catch {
    // the failing step is already in the report
  }
  return report;
}

function metrics() {
  return {
    rss: process.memoryUsage().rss,
    model: current ? { file: current.file, ctxUsed: current.session.ctxUsed(), nCtx: current.session.nCtx } : null,
    devices: binding ? binding.devices().map((d) => ({ index: d.index, name: d.name, typeName: d.typeName, memory: d.memory })) : [],
  };
}

function handle(msg) {
  switch (msg.type) {
    case 'load-runtime':
      try {
        binding = loadRuntime(msg.dir);
        // A cancel makes llama report the aborted decode as an error; that
        // is the mechanism working, not a fault.
        binding.onLog((level, text) => {
          const cancelling = abortFlag && Atomics.load(abortFlag, 0) === 1;
          log(cancelling ? 'debug' : level >= ABI.ENUMS.LOG_LEVEL.ERROR ? 'error' : 'warn', text.trim());
        });
        binding.loadBackends();
        post({ type: 'runtime', ok: true, info: runtimeInfo() });
      } catch (e) {
        binding = null;
        post({ type: 'runtime', ok: false, error: errInfo(e) });
      }
      return;
    case 'load-model':
      try {
        post({ type: 'model', reqId: msg.reqId, ok: true, info: loadModel(msg) });
      } catch (e) {
        post({ type: 'model', reqId: msg.reqId, ok: false, error: errInfo(e) });
      }
      return;
    case 'generate':
      try {
        post({ type: 'done', reqId: msg.reqId, ok: true, result: generate(msg) });
      } catch (e) {
        post({ type: 'done', reqId: msg.reqId, ok: false, error: errInfo(e) });
      }
      return;
    case 'unload-model':
      unloadModel();
      post({ type: 'unloaded' });
      return;
    case 'probe':
      post({ type: 'probed', reqId: msg.reqId, report: probe(msg) });
      return;
    case 'metrics':
      post({ type: 'metrics', ...metrics() });
      return;
    case 'shutdown':
      unloadModel();
      post({ type: 'shutdown-ack' });
      return;
    default:
      log('warn', `unknown message ${msg.type}`);
  }
}

parentPort.on('message', (msg) => {
  try {
    handle(msg);
  } catch (e) {
    log('error', `worker handler failed: ${e.message}`);
  }
});
