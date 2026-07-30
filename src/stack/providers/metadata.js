// Single source for provider metadata (UI-facing pure data, no icons).
// Consumed by BOTH ends: the renderer merges an svg icon per id for the
// settings UI; the main-process stack walks configSchema for encrypted/required
// fields. Keeping one table prevents the two ends from drifting — configSchema
// drives key management AND form rendering, so a fork here corrupts either
// saved secrets or the settings form.
//
// Everything in this file must stay JSON-serializable (it crosses IPC as-is).

// `supportsChat` is the AI-action gate: it must match whether the provider
// class actually implements chat(). Traditional/API-only sources answer a
// prompt with a translation OF that prompt, which reads like a working
// feature — tests/unit/provider-chat.test.js keeps this column honest.
export const PROVIDER_METADATA = {
  'openai': {
    id: 'openai',
    name: 'OpenAI',
    description: 'GPT models, high quality and fast',
    color: '#10a37f',
    type: 'llm',
    supportsChat: true,
    helpUrl: 'https://platform.openai.com/api-keys',
    configSchema: {
      apiKey: {
        type: 'password',
        label: 'API Key',
        required: true,
        placeholder: 'sk-...',
        encrypted: true,
      },
      baseUrl: {
        type: 'text',
        label: 'API Endpoint',
        default: 'https://api.openai.com/v1',
        required: false,
        placeholder: 'https://api.openai.com/v1',
      },
      model: {
        type: 'text',
        label: 'Model Name',
        default: 'gpt-4o-mini',
        required: false,
        placeholder: 'gpt-4o-mini',
      },
      timeout: {
        type: 'number',
        label: 'Timeout (ms)',
        default: 15000,
        required: false,
        placeholder: '15000',
      },
    },
  },

  'deepseek': {
    id: 'deepseek',
    name: 'DeepSeek',
    description: 'DeepSeek AI, affordable, excellent for Chinese',
    color: '#5b6ef8',
    type: 'llm',
    supportsChat: true,
    helpUrl: 'https://platform.deepseek.com',
    configSchema: {
      apiKey: {
        type: 'password',
        label: 'API Key',
        default: '',
        required: true,
        placeholder: 'sk-...',
        encrypted: true,
      },
      model: {
        type: 'text',
        label: 'Model',
        default: 'deepseek-chat',
        required: false,
        placeholder: 'deepseek-chat',
      },
      endpoint: {
        type: 'text',
        label: 'API Endpoint',
        default: 'https://api.deepseek.com/v1',
        required: false,
        placeholder: 'https://api.deepseek.com/v1',
      },
      timeout: {
        type: 'number',
        label: 'Timeout (ms)',
        default: 30000,
        required: false,
        placeholder: '30000',
      },
    },
  },

  'ollama': {
    id: 'ollama',
    name: 'Ollama (Local)',
    description: 'Local LLM via Ollama, private and free',
    color: '#ffffff',
    type: 'llm',
    supportsChat: true,
    helpUrl: 'https://ollama.com/',
    configSchema: {
      endpoint: {
        type: 'text',
        label: 'API Endpoint',
        default: 'http://localhost:11434/v1',
        required: true,
        placeholder: 'http://localhost:11434/v1',
      },
      model: {
        type: 'text',
        label: 'Model Name',
        default: '',
        required: false,
        placeholder: 'Leave empty to auto-detect (e.g. llama3, qwen2)',
      },
      timeout: {
        type: 'number',
        label: 'Timeout (ms)',
        default: 180000,
        required: false,
        placeholder: '180000',
      },
    },
  },

  'local-llm': {
    id: 'local-llm',
    name: 'LM Studio (Local)',
    description: 'Local LLM translation, private and free',
    color: '#10b981',
    type: 'llm',
    supportsChat: true,
    helpUrl: 'https://lmstudio.ai/',
    configSchema: {
      endpoint: {
        type: 'text',
        label: 'API Endpoint',
        default: 'http://localhost:1234/v1',
        required: true,
        placeholder: 'http://localhost:1234/v1',
      },
      model: {
        type: 'text',
        label: 'Model Name',
        default: '',
        required: false,
        placeholder: 'Leave empty to auto-detect',
      },
      timeout: {
        type: 'number',
        label: 'Timeout (ms)',
        default: 180000,
        required: false,
        placeholder: '180000',
      },
    },
  },

  'anthropic': {
    id: 'anthropic',
    name: 'Anthropic Claude',
    description: 'Claude AI, extremely high translation quality',
    color: '#d4a27f',
    type: 'llm',
    supportsChat: true,
    helpUrl: 'https://console.anthropic.com/settings/keys',
    configSchema: {
      apiKey: {
        type: 'password',
        label: 'API Key',
        default: '',
        required: true,
        placeholder: 'sk-ant-...',
        encrypted: true,
      },
      model: {
        type: 'text',
        label: 'Model',
        default: 'claude-sonnet-4-20250514',
        required: false,
        placeholder: 'claude-sonnet-4-20250514',
      },
      baseUrl: {
        type: 'text',
        label: 'API Endpoint',
        default: 'https://api.anthropic.com',
        required: false,
        placeholder: 'https://api.anthropic.com',
      },
    },
  },

  'deepl': {
    id: 'deepl',
    name: 'DeepL',
    description: 'Professional translation API, excellent quality',
    color: '#0f2b46',
    type: 'api',
    supportsChat: false,
    helpUrl: 'https://www.deepl.com/pro-api',
    configSchema: {
      apiKey: {
        type: 'password',
        label: 'API Key',
        required: true,
        placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx:fx',
        encrypted: true,
      },
      useFreeApi: {
        type: 'checkbox',
        label: 'Use Free API (Key ending with :fx)',
        default: true,
        required: false,
      },
    },
  },

  'gemini': {
    id: 'gemini',
    name: 'Google Gemini',
    description: 'Google AI model, free tier available, high quality',
    color: '#4285f4',
    type: 'llm',
    supportsChat: true,
    helpUrl: 'https://aistudio.google.com/apikey',
    configSchema: {
      apiKey: {
        type: 'password',
        label: 'API Key',
        default: '',
        required: true,
        placeholder: 'AIzaSy...',
        encrypted: true,
      },
      model: {
        type: 'text',
        label: 'Model',
        default: 'gemini-2.0-flash',
        required: false,
        placeholder: 'gemini-2.0-flash',
      },
    },
  },

  'google-translate': {
    id: 'google-translate',
    name: 'Google Translate',
    description: 'Free to use, many languages, fast',
    color: '#4285f4',
    type: 'traditional',
    supportsChat: false,
    helpUrl: 'https://translate.google.com',
    configSchema: {
      domain: {
        type: 'select',
        label: 'Server',
        default: 'com',
        // translate.google.cn was retired in Oct 2022 — its translate_a
        // endpoint 404s now, so that option only ever produced failures.
        options: [
          { value: 'com', label: 'google.com (International)' },
          { value: 'com.hk', label: 'google.com.hk (Hong Kong)' },
        ],
      },
    },
  },

  'microsoft-translator': {
    id: 'microsoft-translator',
    name: 'Microsoft Translator',
    description: 'Microsoft Translator API, 2M chars/month free',
    color: '#0078d4',
    type: 'api',
    supportsChat: false,
    helpUrl: 'https://learn.microsoft.com/azure/cognitive-services/translator/',
    configSchema: {
      apiKey: {
        type: 'password',
        label: 'API Key',
        default: '',
        required: true,
        placeholder: 'Azure Translator API Key',
        encrypted: true,
      },
      region: {
        type: 'text',
        label: 'Region',
        default: 'global',
        required: false,
        placeholder: 'global (or eastasia, westus2, etc.)',
      },
    },
  },

  'baidu-translate': {
    id: 'baidu-translate',
    name: 'Baidu Translate',
    description: 'Baidu Translate API, direct access in China, free tier',
    color: '#3385ff',
    type: 'api',
    supportsChat: false,
    helpUrl: 'https://fanyi-api.baidu.com/',
    configSchema: {
      appId: {
        type: 'text',
        label: 'APP ID',
        default: '',
        required: true,
        placeholder: 'Baidu Translate APP ID',
      },
      secretKey: {
        type: 'password',
        label: 'Secret Key',
        default: '',
        required: true,
        placeholder: 'Baidu Translate Secret Key',
        encrypted: true,
      },
    },
  },
};
