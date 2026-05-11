// Local LLM via LM Studio or Ollama's OpenAI-compatible endpoint. No API key.

import OpenAICompatibleProvider from '../openai-compatible.js';
import icon from './icon.svg';

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

  // _checkApiKey inherits the no-op default (local LLMs don't need a key)
}

export default LocalLLMProvider;
