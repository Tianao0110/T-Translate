// src/providers/local-llm/index.js
// 本地 LLM 翻译源 - 通过 LM Studio / Ollama 等本地服务
// 继承 OpenAICompatibleProvider，无需 API Key

import OpenAICompatibleProvider from '../openai-compatible.js';
import icon from './icon.svg';

/**
 * 本地 LLM 翻译源
 * 支持 LM Studio、Ollama 等 OpenAI 兼容 API
 */
class LocalLLMProvider extends OpenAICompatibleProvider {
  
  static metadata = {
    id: 'local-llm',
    name: 'LM Studio (Local)',
    description: 'Local LLM translation, private and free',
    icon: icon,
    color: '#10b981',
    type: 'llm',
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
        default: 60000,
        required: false,
        placeholder: '60000',
      },
    },
  };

  constructor(config = {}) {
    super({
      endpoint: 'http://localhost:1234/v1',
      model: '',
      timeout: 60000,
      ...config,
    });
  }

  get latencyLevel() {
    return 'slow';
  }

  get requiresNetwork() {
    return false;
  }

  // 不需要 API Key，继承基类默认的 _checkApiKey() 返回 null
}

export default LocalLLMProvider;
