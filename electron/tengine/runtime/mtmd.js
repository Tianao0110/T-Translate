// Images and audio on top of a text session. An image goes
// mtmd_helper_bitmap_init_from_buf (PNG / JPEG bytes, decoded inside mtmd),
// audio goes mtmd_bitmap_init_from_audio (mono float PCM at the model's
// rate); both then mtmd_tokenize (the prompt with the media marker) ->
// mtmd_helper_eval_chunks (encoder + prefill into the session's context)
// -> the session's own sampling loop. The media exists only in this
// thread's memory for the duration of the call; nothing here logs or keeps
// it, and the result carries text plus numbers.
//
// PaddleOCR-VL's "Spotting:" task answers one line per text line, each
// followed by eight <|LOC_n|> tokens: a quadrilateral on a 0..999 grid over
// the whole image. parseSpotting turns that into text + pixel boxes.
// Qwen3-ASR answers "language <Name><asr_text><transcript>"; parseAsrReply
// splits that.

const ABI = require('./llama-abi');

const { MTMD_CHUNK } = ABI.ENUMS;
const now = () => Number(process.hrtime.bigint()) / 1e6;
const LOC_GRID = 1000;
// Room the media prefill must leave in the context for the answer.
const MIN_GENERATION_ROOM = 16;
// Answer budget when the caller gives none: every text line costs its
// characters plus eight box tokens, and lines scale with image tokens.
const EXTRA_ANSWER_TOKENS = 256;
// A transcript stays under its audio tokens; the rest is the language frame.
const EXTRA_TRANSCRIPT_TOKENS = 32;
const MAX_AUDIO_SECONDS = 60;
const WARMUP_SECONDS = 2;

function fail(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

// chat_template.jinja of PaddleOCR-VL: cls, "User: " + image + text + "\n",
// then "Assistant:\n". mtmd wraps the marker with the model's own image
// begin / end tokens.
const VISION_FAMILIES = {
  paddleocr: (marker, task) => `<|begin_of_sentence|>User: ${marker}${task}:\nAssistant:\n`,
};

function renderVisionPrompt(family, marker, task) {
  const render = VISION_FAMILIES[family];
  if (!render) throw fail('LLM_VISION_UNSUPPORTED', `no vision prompt for ${family || 'unknown'} models`);
  return render(marker, task);
}

// Qwen3-ASR with an empty context: ChatML, the audio as the user turn. mtmd
// wraps the marker with <|audio_start|> / <|audio_end|> itself.
const AUDIO_FAMILIES = {
  'qwen3-asr': (marker) => `<|im_start|>system\n<|im_end|>\n<|im_start|>user\n${marker}<|im_end|>\n<|im_start|>assistant\n`,
};

function renderAudioPrompt(family, marker) {
  const render = AUDIO_FAMILIES[family];
  if (!render) throw fail('LLM_AUDIO_UNSUPPORTED', `no audio prompt for ${family || 'unknown'} models`);
  return render(marker);
}

const LOC_LINE = /^(.*?)((?:<\|LOC_\d+\|>){8})\s*$/;
const LOC_TOKEN = /<\|LOC_(\d+)\|>/g;

// [{ text, box: [x1, y1, x2, y2] | null }] in pixels of a width x height
// image. A line without a well-formed box keeps its text and gets no box.
function parseSpotting(output, width, height) {
  const lines = [];
  const sx = width / LOC_GRID;
  const sy = height / LOC_GRID;
  for (const raw of String(output || '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = LOC_LINE.exec(line);
    if (!m) {
      const text = line.replace(LOC_TOKEN, '').trim();
      if (text) lines.push({ text, box: null });
      continue;
    }
    const text = m[1].trim();
    if (!text) continue;
    const n = [...m[2].matchAll(LOC_TOKEN)].map((x) => Number(x[1]));
    const xs = [n[0], n[2], n[4], n[6]];
    const ys = [n[1], n[3], n[5], n[7]];
    lines.push({
      text,
      box: [
        Math.round(Math.min(...xs) * sx),
        Math.round(Math.min(...ys) * sy),
        Math.round(Math.max(...xs) * sx),
        Math.round(Math.max(...ys) * sy),
      ],
    });
  }
  return lines;
}

const ASR_MARK = '<asr_text>';
const ASR_LANGUAGE = /^\s*language\s+([A-Za-z]+)\s*<asr_text>/;

// { language: 'Chinese' | 'English' | ... | null, transcript }. "None" is
// the model's answer for no speech.
function parseAsrReply(output) {
  const s = String(output || '');
  const m = ASR_LANGUAGE.exec(s);
  const at = s.lastIndexOf(ASR_MARK);
  return {
    language: m && m[1] !== 'None' ? m[1] : null,
    transcript: (at === -1 ? s : s.slice(at + ASR_MARK.length)).trim(),
  };
}

// A mono WAV at `rate`, 16-bit PCM or 32-bit float, as samples in [-1, 1].
function readWav(buf, rate) {
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw fail('LLM_BAD_AUDIO', 'not a WAV file');
  }
  let fmt = null;
  let off = 12;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === 'fmt ') {
      fmt = { format: buf.readUInt16LE(body), channels: buf.readUInt16LE(body + 2), rate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) };
    } else if (id === 'data') {
      if (!fmt || fmt.channels !== 1 || fmt.rate !== rate) throw fail('LLM_BAD_AUDIO', `expected mono ${rate} Hz`);
      const end = Math.min(buf.length, body + size);
      if (fmt.format === 1 && fmt.bits === 16) {
        const out = new Float32Array((end - body) >> 1);
        for (let i = 0; i < out.length; i++) out[i] = buf.readInt16LE(body + 2 * i) / 32768;
        return out;
      }
      if (fmt.format === 3 && fmt.bits === 32) {
        const out = new Float32Array((end - body) >> 2);
        for (let i = 0; i < out.length; i++) out[i] = buf.readFloatLE(body + 4 * i);
        return out;
      }
      throw fail('LLM_BAD_AUDIO', `unsupported WAV format ${fmt.format} / ${fmt.bits} bit`);
    }
    off = body + size + (size % 2);
  }
  throw fail('LLM_BAD_AUDIO', 'no data chunk');
}

// The mmproj next to an open text session, on the session's device;
// mtmd's own warm-up runs inside the init.
function openMtmd(binding, session, mmproj, provider) {
  const { f } = binding;
  const h = session.handles();
  const params = f.mtmdParamsDefault();
  params.use_gpu = provider === 'gpu';
  params.device = provider === 'gpu' ? h.deviceHandle : null;
  params.n_threads = h.threads;
  params.print_timings = false;
  params.warmup = true;
  const t0 = now();
  const mctx = f.mtmdInit(mmproj, h.model, params);
  if (!mctx) throw fail('LLM_MMPROJ_LOAD_FAILED', `mtmd could not load ${mmproj}`);
  return { mctx, h, loadMs: Math.round(now() - t0) };
}

function countChunkTokens(f, chunks, type) {
  let n = 0;
  const size = Number(f.mtmdChunksSize(chunks));
  for (let i = 0; i < size; i++) {
    const c = f.mtmdChunksGet(chunks, i);
    if (f.mtmdChunkType(c) === type) n += Number(f.mtmdChunkNTokens(c));
  }
  return n;
}

// Loads the mmproj next to an open text session; warmup runs the encoder
// once on a dummy image. Whether an image comes here at all is decided
// upstream (src/stack/ocr/vision-routing.js); this reads what it is given.
function attachVision(binding, session, { mmproj, provider = 'cpu', family = null, abortFlag = null } = {}) {
  const { koffi, f } = binding;
  const marker = f.mtmdDefaultMarker();
  const visionFamily = family || session.info().arch;
  renderVisionPrompt(visionFamily, marker, 'OCR');
  const { mctx, h, loadMs } = openMtmd(binding, session, mmproj, provider);
  if (!f.mtmdSupportVision(mctx)) {
    f.mtmdFree(mctx);
    throw fail('LLM_VISION_UNSUPPORTED', 'the mmproj has no vision encoder');
  }
  const bitmaps = koffi.alloc('void *', 1);
  let closed = false;
  const cancelled = () => !!abortFlag && Atomics.load(abortFlag, 0) === 1;

  function generate({ image, task = 'Spotting', maxTokens = null, onToken = null, sampler = {} } = {}) {
    if (closed) throw fail('LLM_SESSION_CLOSED', 'vision closed');
    if (!image || !image.length) throw fail('LLM_BAD_IMAGE', 'empty image');
    const t = now();
    session.clear();
    const wrap = f.mtmdBitmapFromBuf(mctx, image, image.length, false, f.mtmdHelperOptDefault());
    if (!wrap.bitmap) throw fail('LLM_BAD_IMAGE', 'the image could not be decoded');
    const width = f.mtmdBitmapNx(wrap.bitmap);
    const height = f.mtmdBitmapNy(wrap.bitmap);
    const chunks = f.mtmdChunksInit();
    try {
      const prompt = renderVisionPrompt(visionFamily, marker, task);
      koffi.encode(bitmaps, koffi.array('void *', 1), [wrap.bitmap]);
      const text = { text: prompt, text_len: Buffer.byteLength(prompt), add_special: false, parse_special: true };
      const trc = f.mtmdTokenize(mctx, chunks, text, bitmaps, 1);
      if (trc !== 0) throw fail('LLM_BAD_IMAGE', `mtmd_tokenize returned ${trc}`);
      const imageTokens = countChunkTokens(f, chunks, MTMD_CHUNK.IMAGE);
      const nPos = f.mtmdNPos(chunks);
      if (nPos + MIN_GENERATION_ROOM > h.nCtx) throw fail('LLM_PROMPT_TOO_LONG', `${nPos} positions for the image, context ${h.nCtx}`);
      const newPast = [0];
      const erc = f.mtmdEvalChunks(mctx, h.ctx, chunks, 0, 0, h.nBatch, true, newPast);
      const promptMs = now() - t;
      if (erc !== 0) {
        if (cancelled()) {
          return { promptTokens: nPos, reusedTokens: 0, promptMs: Math.round(promptMs), genTokens: 0, firstMs: null, text: '', thinkLeak: 0, stop: 'cancel', totalMs: Math.round(now() - t), tokPerSec: null, imageTokens, width, height, lines: [] };
        }
        throw fail('LLM_DECODE_FAILED', `mtmd_helper_eval_chunks returned ${erc}`);
      }
      const limit = maxTokens || Math.min(h.nCtx - newPast[0] - MIN_GENERATION_ROOM, imageTokens + EXTRA_ANSWER_TOKENS);
      const r = session.generateContinue({ nPast: newPast[0], promptMs, t0: t, maxTokens: limit, onToken, sampler });
      return { ...r, imageTokens, width, height, lines: task === 'Spotting' ? parseSpotting(r.text, width, height) : [] };
    } finally {
      f.mtmdChunksFree(chunks);
      f.mtmdBitmapFree(wrap.bitmap);
    }
  }

  return {
    loadMs,
    marker,
    family: visionFamily,
    mrope: !!f.mtmdUseMrope(mctx),
    generate,
    close() {
      if (closed) return;
      closed = true;
      f.mtmdFree(mctx);
    },
  };
}

// Deterministic faint noise for the warm-up pass.
function warmupNoise(n) {
  const out = new Float32Array(n);
  let x = 1;
  for (let i = 0; i < n; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    out[i] = (x / 4294967296 - 0.5) * 0.002;
  }
  return out;
}

// Loads an audio mmproj next to an open text session. On the GPU a pass
// over faint noise builds the pipelines before the first real request. The
// segments come from the listen chain's VAD; this transcribes what it is
// given, one segment per call.
function attachAudio(binding, session, { mmproj, provider = 'cpu', family = null, abortFlag = null } = {}) {
  const { koffi, f } = binding;
  const marker = f.mtmdDefaultMarker();
  const prompt = renderAudioPrompt(family, marker);
  const { mctx, h, loadMs } = openMtmd(binding, session, mmproj, provider);
  if (!f.mtmdSupportAudio(mctx)) {
    f.mtmdFree(mctx);
    throw fail('LLM_AUDIO_UNSUPPORTED', 'the mmproj has no audio encoder');
  }
  const sampleRate = f.mtmdAudioSampleRate(mctx);
  const bitmaps = koffi.alloc('void *', 1);
  let closed = false;
  const cancelled = () => !!abortFlag && Atomics.load(abortFlag, 0) === 1;

  // pcm: Float32Array, mono, sampleRate. Returns the session's numbers plus
  // audioTokens, language and transcript.
  function transcribe({ pcm, maxTokens = null } = {}) {
    if (closed) throw fail('LLM_SESSION_CLOSED', 'audio closed');
    if (!(pcm instanceof Float32Array) || !pcm.length) throw fail('LLM_BAD_AUDIO', 'empty audio');
    if (pcm.length > MAX_AUDIO_SECONDS * sampleRate) {
      throw fail('LLM_BAD_AUDIO', `${(pcm.length / sampleRate).toFixed(1)} s of audio, the limit is ${MAX_AUDIO_SECONDS} s`);
    }
    const t = now();
    session.clear();
    const bitmap = f.mtmdBitmapFromAudio(pcm.length, pcm);
    if (!bitmap) throw fail('LLM_BAD_AUDIO', 'the audio could not be wrapped');
    const chunks = f.mtmdChunksInit();
    try {
      koffi.encode(bitmaps, koffi.array('void *', 1), [bitmap]);
      const text = { text: prompt, text_len: Buffer.byteLength(prompt), add_special: false, parse_special: true };
      const trc = f.mtmdTokenize(mctx, chunks, text, bitmaps, 1);
      if (trc !== 0) throw fail('LLM_BAD_AUDIO', `mtmd_tokenize returned ${trc}`);
      const audioTokens = countChunkTokens(f, chunks, MTMD_CHUNK.AUDIO);
      const nPos = f.mtmdNPos(chunks);
      if (nPos + MIN_GENERATION_ROOM > h.nCtx) throw fail('LLM_PROMPT_TOO_LONG', `${nPos} positions for the audio, context ${h.nCtx}`);
      const newPast = [0];
      const erc = f.mtmdEvalChunks(mctx, h.ctx, chunks, 0, 0, h.nBatch, true, newPast);
      const promptMs = now() - t;
      if (erc !== 0) {
        if (cancelled()) {
          return { promptTokens: nPos, reusedTokens: 0, promptMs: Math.round(promptMs), genTokens: 0, firstMs: null, text: '', thinkLeak: 0, stop: 'cancel', totalMs: Math.round(now() - t), tokPerSec: null, audioTokens, language: null, transcript: '' };
        }
        throw fail('LLM_DECODE_FAILED', `mtmd_helper_eval_chunks returned ${erc}`);
      }
      const limit = maxTokens || Math.min(h.nCtx - newPast[0] - MIN_GENERATION_ROOM, audioTokens + EXTRA_TRANSCRIPT_TOKENS);
      const r = session.generateContinue({ nPast: newPast[0], promptMs, t0: t, maxTokens: limit });
      return { ...r, audioTokens, ...parseAsrReply(r.text) };
    } finally {
      f.mtmdChunksFree(chunks);
      f.mtmdBitmapFree(bitmap);
    }
  }

  let warmupMs = null;
  if (provider === 'gpu') {
    try {
      const tw = now();
      transcribe({ pcm: warmupNoise(WARMUP_SECONDS * sampleRate), maxTokens: 8 });
      warmupMs = Math.round(now() - tw);
    } catch (e) {
      closed = true;
      f.mtmdFree(mctx);
      throw e;
    }
  }

  return {
    loadMs,
    warmupMs,
    sampleRate,
    marker,
    family,
    mrope: !!f.mtmdUseMrope(mctx),
    transcribe,
    close() {
      if (closed) return;
      closed = true;
      f.mtmdFree(mctx);
    },
  };
}

module.exports = { attachVision, attachAudio, renderVisionPrompt, renderAudioPrompt, parseSpotting, parseAsrReply, readWav, };
