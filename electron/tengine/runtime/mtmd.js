// Vision on top of a text session. An image goes
// mtmd_helper_bitmap_init_from_buf (PNG / JPEG bytes, decoded inside mtmd)
// -> mtmd_tokenize (the prompt with the media marker) ->
// mtmd_helper_eval_chunks (encoder + prefill into the session's context)
// -> the session's own sampling loop. The image bytes exist only in this
// thread's memory for the duration of the call; nothing here logs or keeps
// them, and the result carries text plus numbers.
//
// PaddleOCR-VL's "Spotting:" task answers one line per text line, each
// followed by eight <|LOC_n|> tokens: a quadrilateral on a 0..999 grid over
// the whole image. parseSpotting turns that into text + pixel boxes.

const ABI = require('./llama-abi');

const { MTMD_CHUNK } = ABI.ENUMS;
const now = () => Number(process.hrtime.bigint()) / 1e6;
const LOC_GRID = 1000;
// Room the image prefill must leave in the context for the answer.
const MIN_GENERATION_ROOM = 16;
// Answer budget when the caller gives none: every text line costs its
// characters plus eight box tokens, and lines scale with image tokens.
const EXTRA_ANSWER_TOKENS = 256;

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

// Loads the mmproj next to an open text session. warmup runs the encoder
// once on a dummy image, which is where a GPU pays its shader compile.
// Whether an image should come here at all (backend, size, layout) is the
// program's decision, made before the request; this reads what it is given.
function attachVision(binding, session, { mmproj, provider = 'cpu', family = null, abortFlag = null } = {}) {
  const { koffi, f } = binding;
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
  if (!f.mtmdSupportVision(mctx)) {
    f.mtmdFree(mctx);
    throw fail('LLM_VISION_UNSUPPORTED', 'the mmproj has no vision encoder');
  }
  const loadMs = Math.round(now() - t0);
  const marker = f.mtmdDefaultMarker();
  const visionFamily = family || session.info().arch;
  renderVisionPrompt(visionFamily, marker, 'OCR');
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
      let imageTokens = 0;
      const n = Number(f.mtmdChunksSize(chunks));
      for (let i = 0; i < n; i++) {
        const c = f.mtmdChunksGet(chunks, i);
        if (f.mtmdChunkType(c) === MTMD_CHUNK.IMAGE) imageTokens += Number(f.mtmdChunkNTokens(c));
      }
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

module.exports = { attachVision, renderVisionPrompt, parseSpotting, };
