// Model + context lifecycle and the decode loop on top of llama-binding.
// One session = one model, one context, one sequence. Every call is a
// synchronous FFI call and belongs on the runtime thread.
//
// What lives here that the C API does not give for free:
// - prompt templates for the whitelisted families, llama's own template
//   detection for anything else
// - the no-thinking rule (docs/T-ENGINE.md §5): think-opener tokens found by
//   a vocab scan are banned in the sampler, the template pre-fills an empty
//   thought block where the family has one, and whatever still looks like a
//   thought is stripped from the stream and counted as a leak
// - KV prefix reuse between consecutive prompts (fixed system prompts)
// - cancellation through a shared abort flag, a loop detector, and a stop
//   reason on every result

const os = require('os');
const { StringDecoder } = require('string_decoder');
const ABI = require('./llama-abi');

const { DEV_TYPE, GGUF_TYPE, DECODE, LLAMA_DEFAULT_SEED } = ABI.ENUMS;
const now = () => Number(process.hrtime.bigint()) / 1e6;
const MIN_REUSE_TOKENS = 8;
// Room the prompt must leave in the context for the answer.
const MIN_GENERATION_ROOM = 16;

// llama_ftype names for probe reports (llama.h enum llama_ftype).
const FTYPE_NAMES = {
  0: 'F32', 1: 'F16', 2: 'Q4_0', 3: 'Q4_1', 7: 'Q8_0', 8: 'Q5_0', 9: 'Q5_1', 10: 'Q2_K', 11: 'Q3_K_S', 12: 'Q3_K_M', 13: 'Q3_K_L',
  14: 'Q4_K_S', 15: 'Q4_K_M', 16: 'Q5_K_S', 17: 'Q5_K_M', 18: 'Q6_K', 19: 'IQ2_XXS', 20: 'IQ2_XS', 21: 'Q2_K_S', 22: 'IQ3_XS',
  23: 'IQ3_XXS', 24: 'IQ1_S', 25: 'IQ4_NL', 26: 'IQ3_S', 27: 'IQ3_M', 28: 'IQ2_S', 29: 'IQ2_M', 30: 'IQ4_XS', 31: 'IQ1_M', 32: 'BF16',
};

function fail(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

// --- thinking --------------------------------------------------------------

const THINK_OPENER = /^(<\|?(think|thinking|thought|reasoning|reason|begin_of_thought|start_of_reasoning|start_think|start_of_thinking|inner_monologue)\|?>|\[THINK\])$/i;
const THINK_CLOSER = /^(<\|?\/(think|thinking|thought|reasoning|reason)\|?>|<\|end_of_thought\|>|<\|end_of_thinking\|>|\[\/THINK\])$/i;

// Scans every token's text. The control attribute is not enough: Qwen3 and
// Hy-MT2 both carry <think> as an ordinary token.
function findThinkTokens(textOf, n) {
  const openers = [];
  const closers = [];
  for (let i = 0; i < n; i++) {
    const t = textOf(i);
    if (!t || t.length > 24 || (t[0] !== '<' && t[0] !== '[')) continue;
    if (THINK_OPENER.test(t)) openers.push({ id: i, text: t });
    else if (THINK_CLOSER.test(t)) closers.push({ id: i, text: t });
  }
  return { openers, closers };
}

// Streaming text filter: drops <opener>…<closer> blocks and stray closers,
// holds back a tail that could be the start of a tag (tags arrive split
// across token pieces), and counts every drop as a leak. Thought text never
// leaves this function.
function createThinkStripper({ openers = ['<think>'], closers = ['</think>'] } = {}) {
  const tags = [...openers, ...closers];
  const maxTag = Math.max(1, ...tags.map((t) => t.length));
  let buf = '';
  let inside = false;
  let leaks = 0;

  const partialTail = (s) => {
    for (let len = Math.min(maxTag - 1, s.length); len > 0; len--) {
      const suffix = s.slice(-len);
      if (tags.some((t) => t.startsWith(suffix))) return len;
    }
    return 0;
  };
  const first = (s, list) => {
    let index = -1;
    let tag = null;
    for (const t of list) {
      const i = s.indexOf(t);
      if (i !== -1 && (index === -1 || i < index)) {
        index = i;
        tag = t;
      }
    }
    return { index, tag };
  };

  function push(text) {
    buf += text;
    let out = '';
    for (;;) {
      if (inside) {
        const c = first(buf, closers);
        if (c.index === -1) {
          buf = buf.slice(-maxTag);
          return out;
        }
        buf = buf.slice(c.index + c.tag.length);
        inside = false;
        leaks++;
        continue;
      }
      const o = first(buf, openers);
      const c = first(buf, closers);
      if (c.index !== -1 && (o.index === -1 || c.index < o.index)) {
        out += buf.slice(0, c.index);
        buf = buf.slice(c.index + c.tag.length);
        leaks++;
        continue;
      }
      if (o.index !== -1) {
        out += buf.slice(0, o.index);
        buf = buf.slice(o.index + o.tag.length);
        inside = true;
        continue;
      }
      const keep = partialTail(buf);
      out += buf.slice(0, buf.length - keep);
      buf = buf.slice(buf.length - keep);
      return out;
    }
  }

  function flush() {
    let out = '';
    if (inside) {
      leaks++;
      inside = false;
    } else {
      out = buf;
    }
    buf = '';
    return out;
  }

  return { push, flush, leaks: () => leaks, inside: () => inside };
}

// Token-level repetition guard: a period-p pattern repeated until it spans
// 24 tokens (or 3 repeats for long periods) ends the generation. Checked
// every 4 tokens.
function createLoopDetector({ maxPeriod = 32, minSpan = 24, minRepeats = 3 } = {}) {
  const ids = [];
  return {
    push(id) {
      ids.push(id);
      const n = ids.length;
      if (n < minSpan || n % 4 !== 0) return false;
      for (let p = 1; p <= maxPeriod; p++) {
        const repeats = Math.max(minRepeats, Math.ceil(minSpan / p));
        const span = p * repeats;
        if (span > n) continue;
        let ok = true;
        for (let i = n - span; i < n - p && ok; i++) {
          if (ids[i] !== ids[i + p]) ok = false;
        }
        if (ok) return true;
      }
      return false;
    },
  };
}

function commonPrefixLength(a, b) {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}

// --- prompts ---------------------------------------------------------------

function detectFamily(templateText) {
  if (!templateText) return 'unknown';
  if (/hy_User/.test(templateText)) return 'hunyuan';
  if (/<\|im_start\|>/.test(templateText)) return 'qwen3';
  return 'model';
}

// ChatML (Qwen3 family). With a thinking-capable vocab the assistant turn
// starts with an empty thought block, which is what enable_thinking=false
// renders.
function renderChatml({ system, user, opener = null, closer = null }) {
  const prefill = opener && closer ? `${opener}\n\n${closer}\n\n` : '';
  return `${system ? `<|im_start|>system\n${system}<|im_end|>\n` : ''}<|im_start|>user\n${user}<|im_end|>\n<|im_start|>assistant\n${prefill}`;
}

// Hy-MT2: no system role, the instruction goes ahead of the text.
function renderHunyuan({ system, user }) {
  return `<｜hy_begin▁of▁sentence｜><｜hy_User｜>${system ? `${system}\n\n` : ''}${user}<｜hy_Assistant｜>`;
}

// --- metadata --------------------------------------------------------------

// Header-only read (27 ms on a 2 GB file). null when llama cannot parse the
// file at all — garbage, truncated header, not a GGUF.
function readMetadata(binding, file) {
  const { f } = binding;
  const g = f.ggufInit(file, { no_alloc: true, ctx: null });
  if (!g) return null;
  try {
    const find = (key) => Number(f.ggufFindKey(g, key));
    const str = (key) => {
      const id = find(key);
      return id >= 0 && f.ggufKvType(g, id) === GGUF_TYPE.STRING ? f.ggufValStr(g, id) : null;
    };
    const num = (key) => {
      const id = find(key);
      if (id < 0) return null;
      const t = f.ggufKvType(g, id);
      if (t === GGUF_TYPE.UINT32) return f.ggufValU32(g, id);
      if (t === GGUF_TYPE.INT32) return f.ggufValI32(g, id);
      if (t === GGUF_TYPE.UINT64) return Number(f.ggufValU64(g, id));
      if (t === GGUF_TYPE.FLOAT32) return f.ggufValF32(g, id);
      return null;
    };
    const arch = str('general.architecture');
    const fileType = num('general.file_type');
    return {
      arch,
      name: str('general.name'),
      sizeLabel: str('general.size_label'),
      fileType,
      quant: fileType === null ? null : FTYPE_NAMES[fileType] || `ftype${fileType}`,
      tokenizerModel: str('tokenizer.ggml.model'),
      hasChatTemplate: find('tokenizer.chat_template') >= 0,
      ctxTrain: arch ? num(`${arch}.context_length`) : null,
      blockCount: arch ? num(`${arch}.block_count`) : null,
      embeddingLength: arch ? num(`${arch}.embedding_length`) : null,
      headCount: arch ? num(`${arch}.attention.head_count`) : null,
      headCountKv: arch ? num(`${arch}.attention.head_count_kv`) : null,
      nTensors: Number(f.ggufNTensors(g)),
      nKv: Number(f.ggufNKv(g)),
    };
  } finally {
    f.ggufFree(g);
  }
}

// f16 K and V for every layer at the given context; 0.25 GB when the
// header lacks the shape.
function estimateKvBytes(meta, nCtx) {
  const { blockCount, embeddingLength, headCount, headCountKv } = meta || {};
  if (!blockCount || !embeddingLength || !headCount) return 256 * 1024 * 1024;
  const headDim = embeddingLength / headCount;
  const kvHeads = headCountKv || headCount;
  return 2 * blockCount * nCtx * kvHeads * headDim * 2;
}

// Architecture known to this llama.cpp and vocab parseable — the step that
// rejects an mmproj picked as a text model.
function vocabOnlyLoad(binding, file) {
  const { f } = binding;
  const mp = f.modelDefault();
  mp.vocab_only = true;
  const model = f.modelLoad(file, mp);
  if (!model) throw fail('LLM_MODEL_LOAD_FAILED', 'vocab-only load rejected the file');
  try {
    return { nVocab: f.vocabNTokens(f.getVocab(model)) };
  } finally {
    f.modelFree(model);
  }
}

// --- devices ---------------------------------------------------------------

// 'gpu' means one GPU: the discrete card with the most memory, else an
// integrated one. Never llama's default of spreading layers over every
// device (a dual-GPU laptop would put half the model on the iGPU).
function pickDevice(devices, provider, deviceIndex = null) {
  const cpu = devices.find((d) => d.type === DEV_TYPE.CPU) || null;
  if (provider !== 'gpu') return { device: cpu, provider: 'cpu', fallback: null };
  if (deviceIndex !== null) {
    const d = devices.find((x) => x.index === deviceIndex && x.type !== DEV_TYPE.CPU);
    if (d) return { device: d, provider: 'gpu', fallback: null };
  }
  const byMemory = (a, b) => b.memory.total - a.memory.total;
  const discrete = devices.filter((d) => d.type === DEV_TYPE.GPU).sort(byMemory)[0];
  const integrated = devices.filter((d) => d.type === DEV_TYPE.IGPU).sort(byMemory)[0];
  const device = discrete || integrated || null;
  if (!device) return { device: cpu, provider: 'cpu', fallback: 'no GPU device' };
  return { device, provider: 'gpu', fallback: null };
}

function defaultThreads() {
  const n = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
  return Math.max(2, Math.min(8, Math.floor(n / 2)));
}

// --- session ---------------------------------------------------------------

function openSession(binding, {
  file,
  provider = 'cpu',
  deviceIndex = null,
  threads = null,
  nCtx = 4096,
  nBatch = 512,
  template = 'auto',
  abortFlag = null,
  onProgress = null,
} = {}) {
  const { koffi, f } = binding;
  binding.loadBackends();
  const picked = pickDevice(binding.devices(), provider, deviceIndex);
  const nThreads = threads || defaultThreads();

  const mp = f.modelDefault();
  mp.n_gpu_layers = picked.provider === 'gpu' ? -1 : 0;
  let deviceList = null;
  if (picked.device) {
    deviceList = koffi.alloc('void *', 2);
    koffi.encode(deviceList, koffi.array('void *', 2), [picked.device.handle, null]);
    mp.devices = deviceList;
  }
  if (onProgress) {
    mp.progress_callback = binding.register(binding.types.ProgressCb, (p) => {
      onProgress(p);
      return !(abortFlag && Atomics.load(abortFlag, 0) === 1);
    });
  }
  const t0 = now();
  const model = f.modelLoad(file, mp);
  if (!model) {
    if (abortFlag && Atomics.load(abortFlag, 0) === 1) throw fail('LLM_CANCELLED', 'model load cancelled');
    throw fail('LLM_MODEL_LOAD_FAILED', `llama could not load ${file}`);
  }
  const loadMs = now() - t0;

  const cp = f.ctxDefault();
  cp.n_ctx = nCtx;
  cp.n_batch = nBatch;
  cp.n_ubatch = Math.min(nBatch, 512);
  cp.n_threads = nThreads;
  cp.n_threads_batch = nThreads;
  if (abortFlag) {
    cp.abort_callback = binding.register(binding.types.AbortCb, () => Atomics.load(abortFlag, 0) === 1);
  }
  const t1 = now();
  const ctx = f.ctxInit(model, cp);
  if (!ctx) {
    f.modelFree(model);
    throw fail('LLM_CONTEXT_FAILED', `context of ${nCtx} tokens could not be created`);
  }
  const ctxMs = now() - t1;
  const vocab = f.getVocab(model);
  const mem = f.getMem(ctx);
  const nVocab = f.vocabNTokens(vocab);
  // One token buffer per session, reused by tokenize and decode: a
  // koffi.alloc per request was the suspected slow RSS creep in the soak
  // spike. Prompts longer than the context fail in tokenize, not in decode.
  const tokBufSize = nCtx + 64;
  const tokBuf = koffi.alloc('int32', tokBufSize);
  const one = koffi.alloc('int32', 1);
  const think = findThinkTokens((i) => f.vocabGetText(vocab, i), nVocab);
  const thinkOpener = think.openers[0]?.text || null;
  const thinkCloser = think.closers[0]?.text || null;

  const metaStr = (key) => {
    const buf = Buffer.alloc(512);
    const n = f.modelMetaValStr(model, key, buf, buf.length);
    return n > 0 ? buf.subarray(0, Math.min(n, buf.length)).toString('utf8') : null;
  };
  const descBuf = Buffer.alloc(256);
  const descLen = f.modelDesc(model, descBuf, descBuf.length);
  const modelTemplate = f.modelChatTemplate(model, null);
  const family = template === 'auto' ? detectFamily(modelTemplate) : template;

  let last = null; // tokens whose KV state the context currently holds
  let closed = false;

  function tokenize(text) {
    const bytes = Buffer.byteLength(text);
    const n = f.tokenize(vocab, text, bytes, tokBuf, tokBufSize, false, true);
    if (n < 0) throw fail('LLM_PROMPT_TOO_LONG', `prompt needs ${-n} tokens, context ${nCtx}`);
    return Array.from(koffi.decode(tokBuf, koffi.array('int32', n)));
  }

  function applyModelTemplate(messages) {
    if (!modelTemplate) return null;
    let size = messages.reduce((n, m) => n + Buffer.byteLength(m.content) + 64, 256) * 2;
    for (let attempt = 0; attempt < 2; attempt++) {
      const buf = Buffer.alloc(size);
      const n = f.chatApplyTemplate(modelTemplate, messages, messages.length, true, buf, size);
      if (n < 0) return null;
      if (n <= size) return buf.subarray(0, n).toString('utf8');
      size = n + 16;
    }
    return null;
  }

  function buildPrompt({ system = '', user = '' }) {
    if (family === 'hunyuan') return renderHunyuan({ system, user });
    if (family === 'qwen3') return renderChatml({ system, user, opener: thinkOpener, closer: thinkCloser });
    const messages = [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: user }];
    const viaModel = family === 'model' ? applyModelTemplate(messages) : null;
    if (viaModel) return viaModel;
    return renderChatml({ system, user, opener: thinkOpener, closer: thinkCloser });
  }

  function decodeTokens(arr) {
    for (let off = 0; off < arr.length; off += nBatch) {
      const chunk = arr.slice(off, off + nBatch);
      koffi.encode(tokBuf, koffi.array('int32', chunk.length), chunk);
      const rc = f.decode(ctx, f.batchGetOne(tokBuf, chunk.length));
      if (rc !== DECODE.OK) return rc;
    }
    return DECODE.OK;
  }

  function buildChain(sampler, banIds) {
    const chain = f.chainInit(f.chainDefault());
    if (banIds.length) {
      f.chainAdd(chain, f.samplerLogitBias(nVocab, banIds.length, banIds.map((id) => ({ token: id, bias: -Infinity }))));
    }
    if (sampler.repeatPenalty && sampler.repeatPenalty !== 1) {
      f.chainAdd(chain, f.samplerPenalties(nVocab, sampler.repeatLastN || 64, sampler.repeatPenalty, 0, 0));
    }
    const temperature = sampler.temperature || 0;
    if (temperature > 0) {
      f.chainAdd(chain, f.samplerTopK(sampler.topK || 40));
      f.chainAdd(chain, f.samplerTopP(sampler.topP || 0.95, 1));
      f.chainAdd(chain, f.samplerMinP(sampler.minP || 0.05, 1));
      f.chainAdd(chain, f.samplerTemp(temperature));
      f.chainAdd(chain, f.samplerDist(sampler.seed === undefined ? LLAMA_DEFAULT_SEED : sampler.seed >>> 0));
    } else {
      f.chainAdd(chain, f.samplerGreedy());
    }
    return chain;
  }

  const cancelled = () => !!abortFlag && Atomics.load(abortFlag, 0) === 1;

  // Decodes the prompt (reusing whatever prefix the context already holds),
  // then samples until EOG, the token limit, a cancel, or a loop. Tokens
  // reach onToken as visible text only; thought blocks never do.
  function generate({ prompt, tokens = null, maxTokens = 256, onToken = null, sampler = {}, banThink = true, reuse = true } = {}) {
    if (closed) throw fail('LLM_SESSION_CLOSED', 'session closed');
    const promptTokens = tokens || tokenize(prompt);
    if (promptTokens.length + MIN_GENERATION_ROOM > nCtx) {
      throw fail('LLM_PROMPT_TOO_LONG', `${promptTokens.length} prompt tokens, context ${nCtx}`);
    }
    const limit = Math.min(maxTokens, nCtx - promptTokens.length);
    const t0 = now();

    let start = 0;
    if (reuse && last) {
      const usable = Math.min(commonPrefixLength(last, promptTokens), promptTokens.length - 1);
      if (usable >= MIN_REUSE_TOKENS && f.memSeqRm(mem, 0, usable, -1)) start = usable;
    }
    if (start === 0) f.memClear(mem, true);
    last = null;

    const rc = decodeTokens(promptTokens.slice(start));
    const promptMs = now() - t0;
    const base = { promptTokens: promptTokens.length, reusedTokens: start, promptMs: Math.round(promptMs), genTokens: 0, firstMs: null, text: '', thinkLeak: 0 };
    if (rc !== DECODE.OK) {
      if (cancelled() || rc === DECODE.ABORTED) return { ...base, stop: 'cancel', totalMs: Math.round(now() - t0) };
      throw fail('LLM_DECODE_FAILED', `llama_decode returned ${rc} on the prompt`);
    }

    const chain = buildChain(sampler, banThink ? think.openers.map((t) => t.id) : []);
    const decoder = new StringDecoder('utf8');
    const stripper = createThinkStripper({ openers: think.openers.map((t) => t.text), closers: think.closers.map((t) => t.text) });
    const loop = createLoopDetector();
    const decoded = promptTokens.slice();
    const piece = Buffer.alloc(256);
    let text = '';
    let firstMs = null;
    let count = 0;
    let stop = 'limit';
    const emit = (s) => {
      if (!s) return;
      text += s;
      if (onToken) onToken(s);
    };
    try {
      for (let i = 0; i < limit; i++) {
        if (cancelled()) {
          stop = 'cancel';
          break;
        }
        const tok = f.sample(chain, ctx, -1);
        if (firstMs === null) firstMs = now() - t0;
        if (f.isEog(vocab, tok)) {
          stop = 'eog';
          break;
        }
        count++;
        const len = f.toPiece(vocab, tok, piece, piece.length, 0, true);
        if (len > 0) emit(stripper.push(decoder.write(piece.subarray(0, len))));
        if (loop.push(tok)) {
          stop = 'loop';
          break;
        }
        if (i === limit - 1) break;
        koffi.encode(one, 'int32', tok);
        const drc = f.decode(ctx, f.batchGetOne(one, 1));
        if (drc !== DECODE.OK) {
          stop = cancelled() || drc === DECODE.ABORTED ? 'cancel' : 'error';
          break;
        }
        decoded.push(tok);
      }
    } finally {
      f.samplerFree(chain);
    }
    emit(stripper.push(decoder.end()));
    emit(stripper.flush());
    if (stop !== 'cancel' && stop !== 'error') last = decoded;
    const totalMs = now() - t0;
    return {
      ...base,
      text,
      stop,
      genTokens: count,
      firstMs: firstMs === null ? null : Math.round(firstMs),
      totalMs: Math.round(totalMs),
      tokPerSec: count > 1 && totalMs > promptMs ? Math.round((count / ((totalMs - promptMs) / 1000)) * 10) / 10 : null,
      thinkLeak: stripper.leaks(),
    };
  }

  return {
    file,
    provider: picked.provider,
    device: picked.device ? { index: picked.device.index, name: picked.device.name, description: picked.device.description, typeName: picked.device.typeName } : null,
    fallback: picked.fallback,
    loadMs: Math.round(loadMs),
    ctxMs: Math.round(ctxMs),
    threads: nThreads,
    nCtx,
    family,
    info: () => ({
      desc: descLen > 0 ? descBuf.subarray(0, Math.min(descLen, descBuf.length)).toString('utf8') : null,
      sizeBytes: Number(f.modelSize(model)),
      nParams: Number(f.modelNParams(model)),
      ctxTrain: f.modelNCtxTrain(model),
      nCtx,
      nVocab,
      arch: metaStr('general.architecture'),
      name: metaStr('general.name'),
      family,
      hasTemplate: !!modelTemplate,
      hasThinking: think.openers.length > 0,
      thinkTokens: think.openers.map((t) => t.text),
      addBos: !!f.vocabAddBos(vocab),
    }),
    tokenize,
    buildPrompt,
    generate,
    ctxUsed: () => f.memSeqPosMax(mem, 0) + 1,
    clear() {
      f.memClear(mem, true);
      last = null;
    },
    close() {
      if (closed) return;
      closed = true;
      f.ctxFree(ctx);
      f.modelFree(model);
    },
  };
}

module.exports = {
  openSession,
  readMetadata,
  vocabOnlyLoad,
  estimateKvBytes,
  pickDevice,
  defaultThreads,
  findThinkTokens,
  createThinkStripper,
  createLoopDetector,
  commonPrefixLength,
  detectFamily,
  renderChatml,
  renderHunyuan,
  FTYPE_NAMES,
  THINK_OPENER,
  THINK_CLOSER,
};
