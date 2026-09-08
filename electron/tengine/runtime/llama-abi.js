// llama.cpp b10853 ABI as T-Engine uses it: struct layouts, function
// prototypes, enums and the default-parameter fingerprint, transcribed from
// the pinned headers (include/llama.h, ggml.h, ggml-backend.h, gguf.h at tag
// b10853). The annual re-pin re-checks this file field by field against the
// new headers (docs/T-ENGINE.md §4); tests/unit/llama-abi.test.js holds the
// struct sizes (always) and the fingerprint the pinned DLLs must reproduce
// (when they are fetched).
//
// Transcription rules:
// - every field of a by-value struct, in header order, trailing pointers
//   included. The spike binding had dropped `ctx_other` from the end of
//   llama_context_params; the DLL still wrote it, 8 bytes past the buffer,
//   on every llama_context_default_params() call.
// - enums are int32; size_t stays 'size_t'; pointers are 'void *'.
// - callbacks are prototypes registered with koffi.register on the runtime
//   thread, and no callback may fire during an .async call (0xC0000005).

const BUILD = 'b10853';

const STRUCTS = {
  llama_model_params: {
    devices: 'void *',
    tensor_buft_overrides: 'void *',
    n_gpu_layers: 'int32',
    split_mode: 'int32',
    load_mode: 'int32',
    lazy_mode: 'int32',
    main_gpu: 'int32',
    tensor_split: 'void *',
    progress_callback: 'void *',
    progress_callback_user_data: 'void *',
    kv_overrides: 'void *',
    vocab_only: 'bool',
    check_tensors: 'bool',
    use_extra_bufts: 'bool',
    no_host: 'bool',
    no_alloc: 'bool',
    load_mtp: 'bool',
  },
  llama_context_params: {
    n_ctx: 'uint32',
    n_batch: 'uint32',
    n_ubatch: 'uint32',
    n_seq_max: 'uint32',
    n_rs_seq: 'uint32',
    n_outputs_max: 'uint32',
    n_outputs_max_per_seq: 'uint32',
    n_threads: 'int32',
    n_threads_batch: 'int32',
    ctx_type: 'int32',
    rope_scaling_type: 'int32',
    pooling_type: 'int32',
    attention_type: 'int32',
    flash_attn_type: 'int32',
    rope_freq_base: 'float',
    rope_freq_scale: 'float',
    yarn_ext_factor: 'float',
    yarn_attn_factor: 'float',
    yarn_beta_fast: 'float',
    yarn_beta_slow: 'float',
    yarn_orig_ctx: 'uint32',
    defrag_thold: 'float',
    cb_eval: 'void *',
    cb_eval_user_data: 'void *',
    type_k: 'int32',
    type_v: 'int32',
    abort_callback: 'void *',
    abort_callback_data: 'void *',
    embeddings: 'bool',
    offload_kqv: 'bool',
    no_perf: 'bool',
    op_offload: 'bool',
    swa_full: 'bool',
    kv_unified: 'bool',
    samplers: 'void *',
    n_samplers: 'size_t',
    ctx_other: 'void *',
  },
  llama_batch: {
    n_tokens: 'int32',
    token: 'void *',
    embd: 'void *',
    pos: 'void *',
    n_seq_id: 'void *',
    seq_id: 'void *',
    logits: 'void *',
  },
  llama_sampler_chain_params: { no_perf: 'bool' },
  llama_logit_bias: { token: 'int32', bias: 'float' },
  llama_chat_message: { role: 'const char *', content: 'const char *' },
  gguf_init_params: { no_alloc: 'bool', ctx: 'void *' },
};

// koffi.sizeof of the layouts above on x64. A transcription that drifts
// changes these before it changes anything else.
const SIZES = {
  llama_model_params: 80,
  llama_context_params: 160,
  llama_batch: 56,
  llama_sampler_chain_params: 1,
  llama_logit_bias: 8,
  llama_chat_message: 16,
  gguf_init_params: 16,
};

const CALLBACKS = {
  ProgressCb: 'bool ProgressCb(float progress, void *user)',
  AbortCb: 'bool AbortCb(void *data)',
  LogCb: 'void LogCb(int level, const char *text, void *user)',
};

// Which DLL exports what: device accessors and gguf live in ggml-base, the
// backend registry in ggml, everything else in llama.
const FUNCS = {
  ggml: {
    loadAll: 'void ggml_backend_load_all_from_path(const char *dir)',
    devCount: 'size_t ggml_backend_dev_count()',
    devGet: 'void *ggml_backend_dev_get(size_t i)',
  },
  ggmlBase: {
    devName: 'const char *ggml_backend_dev_name(void *dev)',
    devDesc: 'const char *ggml_backend_dev_description(void *dev)',
    devType: 'int ggml_backend_dev_type(void *dev)',
    devMemory: 'void ggml_backend_dev_memory(void *dev, _Out_ size_t *free, _Out_ size_t *total)',
    ggufInit: 'void *gguf_init_from_file(const char *fname, gguf_init_params p)',
    ggufFree: 'void gguf_free(void *ctx)',
    ggufNKv: 'int64 gguf_get_n_kv(void *ctx)',
    ggufFindKey: 'int64 gguf_find_key(void *ctx, const char *key)',
    ggufGetKey: 'const char *gguf_get_key(void *ctx, int64 id)',
    ggufKvType: 'int gguf_get_kv_type(void *ctx, int64 id)',
    ggufValStr: 'const char *gguf_get_val_str(void *ctx, int64 id)',
    ggufValU32: 'uint32 gguf_get_val_u32(void *ctx, int64 id)',
    ggufValI32: 'int32 gguf_get_val_i32(void *ctx, int64 id)',
    ggufValU64: 'uint64 gguf_get_val_u64(void *ctx, int64 id)',
    ggufValF32: 'float gguf_get_val_f32(void *ctx, int64 id)',
    ggufNTensors: 'int64 gguf_get_n_tensors(void *ctx)',
  },
  llama: {
    backendInit: 'void llama_backend_init()',
    backendFree: 'void llama_backend_free()',
    logSet: 'void llama_log_set(void *cb, void *user)',
    version: 'const char *llama_version()',
    systemInfo: 'const char *llama_print_system_info()',
    supportsGpuOffload: 'bool llama_supports_gpu_offload()',
    maxDevices: 'size_t llama_max_devices()',
    modelDefault: 'llama_model_params llama_model_default_params()',
    ctxDefault: 'llama_context_params llama_context_default_params()',
    chainDefault: 'llama_sampler_chain_params llama_sampler_chain_default_params()',
    modelLoad: 'void *llama_model_load_from_file(const char *path, llama_model_params params)',
    modelFree: 'void llama_model_free(void *model)',
    modelDesc: 'int32 llama_model_desc(void *model, _Out_ uint8 *buf, size_t n)',
    modelSize: 'uint64 llama_model_size(void *model)',
    modelNParams: 'uint64 llama_model_n_params(void *model)',
    modelNCtxTrain: 'int32 llama_model_n_ctx_train(void *model)',
    modelMetaValStr: 'int32 llama_model_meta_val_str(void *model, const char *key, _Out_ uint8 *buf, size_t n)',
    modelChatTemplate: 'const char *llama_model_chat_template(void *model, const char *name)',
    ctxInit: 'void *llama_init_from_model(void *model, llama_context_params params)',
    ctxFree: 'void llama_free(void *ctx)',
    nCtx: 'uint32 llama_n_ctx(void *ctx)',
    setNThreads: 'void llama_set_n_threads(void *ctx, int32 n, int32 nBatch)',
    getMem: 'void *llama_get_memory(void *ctx)',
    memClear: 'void llama_memory_clear(void *mem, bool data)',
    memSeqRm: 'bool llama_memory_seq_rm(void *mem, int32 seq, int32 p0, int32 p1)',
    memSeqPosMax: 'int32 llama_memory_seq_pos_max(void *mem, int32 seq)',
    getVocab: 'void *llama_model_get_vocab(void *model)',
    vocabNTokens: 'int32 llama_vocab_n_tokens(void *vocab)',
    vocabGetText: 'const char *llama_vocab_get_text(void *vocab, int32 token)',
    vocabIsControl: 'bool llama_vocab_is_control(void *vocab, int32 token)',
    vocabBos: 'int32 llama_vocab_bos(void *vocab)',
    vocabEos: 'int32 llama_vocab_eos(void *vocab)',
    vocabAddBos: 'bool llama_vocab_get_add_bos(void *vocab)',
    isEog: 'bool llama_vocab_is_eog(void *vocab, int32 token)',
    tokenize: 'int32 llama_tokenize(void *vocab, const char *text, int32 len, void *tokens, int32 nMax, bool addSpecial, bool parseSpecial)',
    toPiece: 'int32 llama_token_to_piece(void *vocab, int32 token, _Out_ uint8 *buf, int32 length, int32 lstrip, bool special)',
    chatApplyTemplate: 'int32 llama_chat_apply_template(const char *tmpl, const llama_chat_message *chat, size_t n, bool addAss, _Out_ uint8 *buf, int32 length)',
    batchGetOne: 'llama_batch llama_batch_get_one(void *tokens, int32 n)',
    decode: 'int32 llama_decode(void *ctx, llama_batch batch)',
    chainInit: 'void *llama_sampler_chain_init(llama_sampler_chain_params p)',
    chainAdd: 'void llama_sampler_chain_add(void *chain, void *smpl)',
    samplerGreedy: 'void *llama_sampler_init_greedy()',
    samplerLogitBias: 'void *llama_sampler_init_logit_bias(int32 nVocab, int32 n, const llama_logit_bias *biases)',
    samplerTopK: 'void *llama_sampler_init_top_k(int32 k)',
    samplerTopP: 'void *llama_sampler_init_top_p(float p, size_t minKeep)',
    samplerMinP: 'void *llama_sampler_init_min_p(float p, size_t minKeep)',
    samplerTemp: 'void *llama_sampler_init_temp(float t)',
    samplerDist: 'void *llama_sampler_init_dist(uint32 seed)',
    samplerPenalties: 'void *llama_sampler_init_penalties(int32 nVocab, int32 lastN, float repeat, float freq, float present)',
    sample: 'int32 llama_sampler_sample(void *smpl, void *ctx, int32 idx)',
    samplerFree: 'void llama_sampler_free(void *s)',
  },
};

const ENUMS = {
  // ggml_backend_dev_type
  DEV_TYPE: { CPU: 0, GPU: 1, IGPU: 2, ACCEL: 3, META: 4 },
  // ggml_log_level; CONT continues the previous line
  LOG_LEVEL: { NONE: 0, DEBUG: 1, INFO: 2, WARN: 3, ERROR: 4, CONT: 5 },
  // gguf_type
  GGUF_TYPE: { UINT8: 0, INT8: 1, UINT16: 2, INT16: 3, UINT32: 4, INT32: 5, FLOAT32: 6, BOOL: 7, STRING: 8, ARRAY: 9, UINT64: 10, INT64: 11, FLOAT64: 12 },
  // llama_decode return values (negative = fatal)
  DECODE: { OK: 0, NO_KV_SLOT: 1, ABORTED: 2 },
  LLAMA_DEFAULT_SEED: 0xffffffff,
};

// What the pinned DLLs answer through the layouts above. A drifted layout
// shows up here as values landing in the wrong fields; a new build with
// different defaults shows up as an honest diff to read, not to paste over.
const GOLDEN = {
  version: '0.4.0-dev',
  modelParams: {
    devices: null, tensor_buft_overrides: null, n_gpu_layers: -1, split_mode: 1, load_mode: -1, lazy_mode: 1, main_gpu: 0,
    tensor_split: null, progress_callback: null, progress_callback_user_data: null, kv_overrides: null,
    vocab_only: false, check_tensors: false, use_extra_bufts: true, no_host: false, no_alloc: false, load_mtp: false,
  },
  contextParams: {
    n_ctx: 512, n_batch: 2048, n_ubatch: 512, n_seq_max: 1, n_rs_seq: 0, n_outputs_max: 0, n_outputs_max_per_seq: 1,
    n_threads: 4, n_threads_batch: 4,
    ctx_type: 0, rope_scaling_type: -1, pooling_type: -1, attention_type: -1, flash_attn_type: -1,
    rope_freq_base: 0, rope_freq_scale: 0, yarn_ext_factor: -1, yarn_attn_factor: -1, yarn_beta_fast: -1, yarn_beta_slow: -1, yarn_orig_ctx: 0, defrag_thold: -1,
    cb_eval: null, cb_eval_user_data: null, type_k: 1, type_v: 1, abort_callback: null, abort_callback_data: null,
    embeddings: false, offload_kqv: true, no_perf: true, op_offload: true, swa_full: true, kv_unified: false,
    samplers: null, n_samplers: 0, ctx_other: null,
  },
  chainParams: { no_perf: true },
};

module.exports = { BUILD, STRUCTS, SIZES, CALLBACKS, FUNCS, ENUMS, GOLDEN };
