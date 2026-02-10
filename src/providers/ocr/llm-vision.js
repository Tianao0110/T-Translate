// src/providers/ocr/llm-vision.js
// LLM Vision OCR 引擎 - 视觉大模型，处理复杂场景

import { BaseOCREngine } from './base.js';
import createLogger from '../../utils/logger.js';
const logger = createLogger('LLMVision');

/**
 * LLM Vision OCR 引擎
 * 使用视觉大模型进行 OCR，适合复杂排版/手写/模糊
 */
class LLMVisionEngine extends BaseOCREngine {
  
  static metadata = {
    id: 'llm-vision',
    name: 'LLM Vision',
    description: '视觉大模型，处理复杂排版/手写/模糊',
    type: 'local-llm',
    tier: 2,
    priority: 2,
    isOnline: false,
  };

  constructor(config = {}) {
    super({
      endpoint: 'http://localhost:1234/v1',
      model: '',
      ...config,
    });
  }

  /**
   * 检查是否可用
   */
  async isAvailable() {
    try {
      const response = await fetch(`${this.config.endpoint}/models`, {
        method: 'GET',
        signal: AbortSignal.timeout(3000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * 识别图片
   */
  async recognize(input, options = {}) {
    try {
      const imageData = this.ensureBase64(input);
      const { sourceLanguage = 'auto' } = options;

      // 构建提示词
      const systemPrompt = this.buildSystemPrompt(sourceLanguage);

      const response = await fetch(`${this.config.endpoint}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.config.model || undefined,
          messages: [
            { role: 'system', content: systemPrompt },
            {
              role: 'user',
              content: [
                { type: 'text', text: 'Please extract and output all text from this image.' },
                { type: 'image_url', image_url: { url: imageData } }
              ]
            }
          ],
          max_tokens: 4096,
          temperature: 0.1,
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, error: `API 错误: ${response.status} - ${errorText}` };
      }

      const data = await response.json();
      const text = data.choices?.[0]?.message?.content;

      if (!text) {
        return { success: false, error: '未识别到文字' };
      }

      // 清理输出
      const cleanedText = this.cleanLLMOutput(text);

      return {
        success: true,
        text: cleanedText,
        raw: text,
        engine: 'llm-vision',
      };
    } catch (error) {
      logger.error('Error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 构建系统提示词
   */
  buildSystemPrompt(sourceLanguage) {
    const langHint = sourceLanguage === 'zh' ? '中文' :
                     sourceLanguage === 'en' ? 'English' :
                     sourceLanguage === 'ja' ? '日本語' :
                     sourceLanguage === 'ko' ? '한국어' : '';

    return `You are an OCR engine. Extract ALL text from the image exactly as it appears.
Rules:
1. Output ONLY the extracted text, nothing else
2. Preserve the original layout and line breaks
3. Do not translate or interpret the text
4. If no text is found, output: [NO TEXT DETECTED]
${langHint ? `5. The text is likely in ${langHint}` : ''}`;
  }

  /**
   * 清理 LLM 输出
   */
  cleanLLMOutput(text) {
    if (!text) return '';

    // 移除常见的 LLM 前缀/后缀
    let cleaned = text
      .replace(/^(Here is the extracted text:|The text in the image is:|OCR Result:)/i, '')
      .replace(/^\s*```[\s\S]*?```\s*$/g, match => {
        // 提取代码块内容
        return match.replace(/```\w*\n?/g, '').trim();
      })
      .trim();

    // 检查是否未识别到文字
    if (cleaned.includes('[NO TEXT DETECTED]') || 
        cleaned.toLowerCase().includes('no text') ||
        cleaned.toLowerCase().includes('cannot detect')) {
      return '';
    }

    return this.cleanText(cleaned);
  }
}

export default LLMVisionEngine;
