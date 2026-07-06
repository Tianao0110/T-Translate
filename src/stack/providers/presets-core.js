// Environment-free core of the OpenAI-compatible presets: defaults, latency
// class, and the pure hook parts (flags, adapters, filters). Shared by the
// stack presets (main process) and the renderer presets during the dual-track
// migration window — the only per-environment piece left in each end is the
// localized testConnectionMessage (it needs that end's _t).

export const PRESET_CORE = [
  {
    id: 'openai',
    defaults: {
      apiKey: '',
      model: 'gpt-4o-mini',
      endpoint: 'https://api.openai.com/v1',
      timeout: 15000,
    },
    latencyLevel: 'fast',
    requiresNetwork: true,
    hooks: {
      requireApiKey: true,
      // OpenAI configSchema uses 'baseUrl', base class uses 'endpoint' — keep them in sync
      fieldAdapter: (cfg) => (cfg.baseUrl ? { ...cfg, endpoint: cfg.baseUrl } : cfg),
      filterModels: (models) => models.filter(m => m.includes('gpt')),
    },
  },
  {
    id: 'deepseek',
    defaults: {
      apiKey: '',
      model: 'deepseek-chat',
      endpoint: 'https://api.deepseek.com/v1',
      timeout: 30000,
    },
    latencyLevel: 'medium',
    requiresNetwork: true,
    hooks: {
      requireApiKey: true,
      apiKeyErrorMessage: 'providerError.notConfigured',
    },
  },
  {
    id: 'ollama',
    defaults: {
      endpoint: 'http://localhost:11434/v1',
      model: '',
      // Local generation is hardware-bound: cold model load + reasoning models'
      // thinking phase can take minutes. User-tunable in settings.
      timeout: 180000,
    },
    latencyLevel: 'slow',
    requiresNetwork: false,
    hooks: {
      requireApiKey: false,
      // Ollama may return {models:[{name}]} via /api/tags when /v1/models is empty
      modelsFallbackEndpoint: '/api/tags',
      // Ollama requires an explicit model (unlike LM Studio, which uses its
      // loaded one). With the field left blank, auto-detect the first model.
      autoDetectModel: true,
    },
  },
  {
    id: 'local-llm',
    defaults: {
      endpoint: 'http://localhost:1234/v1',
      model: '',
      // LM Studio JIT-loads models — first request after idle pays the full
      // load, plus reasoning models' thinking phase. User-tunable in settings.
      timeout: 180000,
    },
    latencyLevel: 'slow',
    requiresNetwork: false,
    hooks: {
      requireApiKey: false,
    },
  },
];
