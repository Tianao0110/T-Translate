// Google Gemini provider via Google AI Studio API.

import { BaseProvider, LANGUAGE_CODES } from '../base.js';
import icon from './icon.svg';
import createLogger from '../../utils/logger.js';
const logger = createLogger('Gemini');

class GeminiProvider extends BaseProvider {

  static metadata = {
    id: 'gemini',
    name: 'Google Gemini',
    description: 'Google AI model, free tier available, high quality',
    icon: icon,
    color: '#4285f4',
    type: 'llm',
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
  };

  constructor(config = {}) {
    super({
      apiKey: '',
      model: 'gemini-2.0-flash',
      temperature: 0.2,
      timeout: 30000,
      ...config,
    });
  }

  get latencyLevel() {
    return 'medium';
  }

  get requiresNetwork() {
    return true;
  }

  async testConnection() {
    if (!this.config.apiKey) {
      return { success: false, error: '请配置 API Key' };
    }

    try {
      // Model-info endpoint is the cheapest way to validate the key
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1/models/${this.config.model}?key=${this.config.apiKey}`,
        {
          method: 'GET',
          signal: AbortSignal.timeout(10000),
        }
      );

      if (response.ok) {
        return { success: true, message: 'Gemini 连接成功' };
      } else {
        const error = await response.json();
        return { success: false, error: error.error?.message || `HTTP ${response.status}` };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async translate(text, sourceLang = 'auto', targetLang = 'zh', options = {}) {
    if (!text?.trim()) {
      return { success: false, error: '文本为空' };
    }

    if (!this.config.apiKey) {
      return { success: false, error: '请配置 Gemini API Key' };
    }

    try {
      let prompt;
      // Support both legacy string and `{ content, mode }` from services/translation.js
      const promptOpt = options.systemPrompt;
      const promptStr = promptOpt && typeof promptOpt === 'object' ? promptOpt.content : promptOpt;
      if (promptStr) {
        prompt = promptStr.replace('{targetLang}', this._getLanguageName(targetLang)) + `\n\n${text}`;
      } else {
        const sourceName = this._getLanguageName(sourceLang);
        const targetName = this._getLanguageName(targetLang);
        prompt = sourceLang === 'auto'
          ? `Translate the following text to ${targetName}. Output only the translated text, no explanations.\n\n${text}`
          : `Translate from ${sourceName} to ${targetName}. Output only the translated text, no explanations.\n\n${text}`;
      }

      const requestBody = {
        contents: [{ parts: [{ text: prompt }] }],
        // Translation tasks legitimately need to handle text in any of these
        // categories (e.g. translating news articles, fiction). Default thresholds
        // would block too many legitimate inputs.
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
        ],
        generationConfig: {
          temperature: this.config.temperature,
          maxOutputTokens: 2048,
        },
      };

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1/models/${this.config.model}:generateContent?key=${this.config.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(this.config.timeout),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        return { success: false, error: error.error?.message || `HTTP ${response.status}` };
      }

      const data = await response.json();

      const translatedText = data.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!translatedText) {
        // Distinguish safety-block from generic empty response
        if (data.promptFeedback?.blockReason) {
          return { success: false, error: `内容被阻止: ${data.promptFeedback.blockReason}` };
        }
        return { success: false, error: '无翻译结果' };
      }

      return {
        success: true,
        text: translatedText.trim(),
        provider: 'gemini',
        model: this.config.model,
      };
    } catch (error) {
      logger.error('Translation error:', error);
      return { success: false, error: error.message };
    }
  }

  _getLanguageName(code) {
    const names = {
      'auto': 'auto-detected language',
      'zh': 'Simplified Chinese',
      'zh-TW': 'Traditional Chinese',
      'en': 'English',
      'ja': 'Japanese',
      'ko': 'Korean',
      'es': 'Spanish',
      'fr': 'French',
      'de': 'German',
      'ru': 'Russian',
      'ar': 'Arabic',
      'pt': 'Portuguese',
      'it': 'Italian',
      'vi': 'Vietnamese',
      'th': 'Thai',
      'pa': 'Punjabi',
    };
    return names[code] || LANGUAGE_CODES[code]?.name || code;
  }
}

export default GeminiProvider;
