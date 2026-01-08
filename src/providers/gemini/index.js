// src/providers/gemini/index.js
// Google Gemini AI 翻译源

import { BaseProvider, LANGUAGE_CODES } from '../base.js';
import icon from './icon.svg';

/**
 * Google Gemini 翻译源
 * 使用 Google AI Studio API
 */
class GeminiProvider extends BaseProvider {
  
  static metadata = {
    id: 'gemini',
    name: 'Google Gemini',
    description: 'Google AI 大模型，免费额度，翻译质量高',
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
        label: '模型',
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

  /**
   * 测试连接
   */
  async testConnection() {
    if (!this.config.apiKey) {
      return { success: false, error: '请配置 API Key' };
    }

    try {
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

  /**
   * 翻译文本
   */
  async translate(text, sourceLang = 'auto', targetLang = 'zh') {
    if (!text?.trim()) {
      return { success: false, error: '文本为空' };
    }

    if (!this.config.apiKey) {
      return { success: false, error: '请配置 Gemini API Key' };
    }

    try {
      const sourceName = this._getLanguageName(sourceLang);
      const targetName = this._getLanguageName(targetLang);

      // 构建提示词
      const prompt = sourceLang === 'auto'
        ? `Translate the following text to ${targetName}. Output only the translated text, no explanations.\n\n${text}`
        : `Translate from ${sourceName} to ${targetName}. Output only the translated text, no explanations.\n\n${text}`;

      const requestBody = {
        contents: [{ parts: [{ text: prompt }] }],
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

      // 解析响应
      const translatedText = data.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!translatedText) {
        // 检查是否被阻止
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
      console.error('[Gemini] Translation error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 获取语言名称
   */
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
    };
    return names[code] || LANGUAGE_CODES[code]?.name || code;
  }
}

export default GeminiProvider;
