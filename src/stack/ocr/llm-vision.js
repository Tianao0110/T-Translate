// LLM Vision OCR — uses a vision-capable LLM (Qwen-VL, LLaVA, etc.) via the
// local OpenAI-compatible chat endpoint. Best for complex layout/handwriting/blur.
// Stack port of src/providers/ocr/llm-vision.js — network via rtFetch.

import { BaseOCREngine } from './base.js';
import { rtFetch } from '../runtime.js';
import createLogger from '../logger.js';
const logger = createLogger('LLMVision');

// A vision request always carries the encoded image in the prompt, so its
// prompt_tokens run into the hundreds+ regardless of how much TEXT the image
// holds (image tokens scale with pixels, not characters — a few-word capture
// is unaffected). A text-only server that silently drops the image and answers
// from the instruction alone leaves prompt_tokens at just the ~100-token OCR
// prompt. Below this floor + a 200 "success" = the image never reached a model
// → degrade instead of surfacing the model's chatter as OCR output.
// Only applied when the server reports usage; many don't, and then we can't
// tell (documented edge). Compact-tokenizer vision models sit well above 150.
const VISION_PROMPT_TOKEN_FLOOR = 150;

// Servers that cannot see images answer from the instruction alone. Both the
// 400-body sniff and the token floor produce this same string because
// ocrManager._isVisionUnsupportedError pattern-matches it to trigger fallback.
const VISION_UNSUPPORTED = 'Model does not support vision / 当前模型不支持图片识别，请加载视觉模型 (Qwen-VL, LLaVA)';

function isVisionRejection(status, errorText) {
  const lower = errorText.toLowerCase();
  return status === 400 && (
    lower.includes('image') || lower.includes('vision') ||
    lower.includes('multimodal') || lower.includes('content type') ||
    lower.includes('does not support')
  );
}

// A 200 whose prompt_tokens sit below the floor means the image was dropped on
// the way in — the reply is the model talking about the instruction, not the
// picture. Only decidable when the server reports usage.
function imageWasDropped(usage) {
  const promptTokens = usage?.prompt_tokens;
  return typeof promptTokens === 'number' && promptTokens > 0 && promptTokens < VISION_PROMPT_TOKEN_FLOOR;
}

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

  async isAvailable() {
    try {
      const response = await rtFetch(`${this.config.endpoint}/models`, {
        method: 'GET',
        signal: AbortSignal.timeout(3000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async recognize(input, options = {}) {
    try {
      const imageData = this.ensureBase64(input);
      const { sourceLanguage = 'auto' } = options;

      const systemPrompt = this.buildSystemPrompt(sourceLanguage);

      const response = await rtFetch(`${this.config.endpoint}/chat/completions`, {
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
          temperature: 0.1, // OCR wants near-deterministic output, not creative
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        const errorText = await response.text();
        // ocrManager pattern-matches this error string to trigger auto-fallback
        // to local OCR. Keep the keywords in sync with _isVisionUnsupportedError there.
        if (isVisionRejection(response.status, errorText)) {
          return { success: false, error: VISION_UNSUPPORTED };
        }
        return { success: false, error: `API 错误: ${response.status} - ${errorText.slice(0, 200)}` };
      }

      const data = await response.json();
      const text = data.choices?.[0]?.message?.content;

      if (!text) {
        return { success: false, error: 'No text recognized / 未识别到文字' };
      }

      // Detect a stripped-image "fake success" (e.g. a translation model given
      // an image): the error string matches _isVisionUnsupportedError, so the
      // manager degrades to local OCR and counts it toward the vision lock.
      if (imageWasDropped(data.usage)) {
        logger.warn(`LLM Vision 200 but prompt_tokens=${data.usage.prompt_tokens} < ${VISION_PROMPT_TOKEN_FLOOR}: image not processed, treating as vision-unsupported`);
        return { success: false, error: 'Model does not support vision / 图片未被模型处理（当前模型可能不支持视觉）' };
      }

      const cleanedText = this.cleanLLMOutput(text);

      return {
        success: true,
        text: cleanedText,
        raw: text,
        engine: 'llm-vision',
      };
    } catch (error) {
      logger.error('Error:', error);
      if (error.name === 'AbortError' || error.name === 'TimeoutError') {
        return { success: false, error: 'OCR timeout - check if model supports vision / OCR 超时，请检查模型是否支持视觉' };
      }
      return { success: false, error: error.message };
    }
  }

  // Path B for AI actions: the model reads the capture directly instead of
  // summarizing OCR output, so layout and interleaved graphics stay intact and
  // no recognition errors compound. Same endpoint, model and image-dropped
  // detection as recognize() — only the prompt differs, and it comes from the
  // action config rather than this file.
  async chat(messages, imageData, options = {}) {
    const { timeout = 60000 } = options;
    try {
      const image = this.ensureBase64(imageData);
      const system = messages.find(m => m.role === 'system');
      const user = messages.find(m => m.role === 'user');
      if (!user) return { success: false, error: 'No user message / 缺少提示词' };

      const payload = [];
      if (system?.content) payload.push({ role: 'system', content: system.content });
      payload.push({
        role: 'user',
        content: [
          { type: 'text', text: user.content },
          { type: 'image_url', image_url: { url: image } },
        ],
      });

      const response = await rtFetch(`${this.config.endpoint}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.config.model || undefined,
          messages: payload,
          max_tokens: 2048,
        }),
        signal: AbortSignal.timeout(timeout),
      });

      if (!response.ok) {
        const errorText = await response.text();
        if (isVisionRejection(response.status, errorText)) {
          return { success: false, error: VISION_UNSUPPORTED, visionUnsupported: true };
        }
        return { success: false, error: `API 错误: ${response.status} - ${errorText.slice(0, 200)}` };
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;

      if (imageWasDropped(data.usage)) {
        logger.warn(`Vision chat 200 but prompt_tokens=${data.usage.prompt_tokens}: image not processed`);
        return { success: false, error: VISION_UNSUPPORTED, visionUnsupported: true };
      }
      if (!content) {
        return { success: false, error: 'Empty reply / 模型未返回内容' };
      }

      return { success: true, content, provider: 'llm-vision', model: this.config.model || '' };
    } catch (error) {
      logger.error('Vision chat error:', error);
      if (error.name === 'AbortError' || error.name === 'TimeoutError') {
        return { success: false, error: 'Vision timeout / 视觉模型响应超时' };
      }
      return { success: false, error: error.message };
    }
  }

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

  // LLMs often prefix output with "Here is..." or wrap in ```code fences``` even
  // when told not to. Strip those and detect the "no text" sentinel.
  cleanLLMOutput(text) {
    if (!text) return '';

    let cleaned = text
      .replace(/^(Here is the extracted text:|The text in the image is:|OCR Result:)/i, '')
      .replace(/^\s*```[\s\S]*?```\s*$/g, match => {
        return match.replace(/```\w*\n?/g, '').trim();
      })
      .trim();

    if (cleaned.includes('[NO TEXT DETECTED]') ||
        cleaned.toLowerCase().includes('no text') ||
        cleaned.toLowerCase().includes('cannot detect')) {
      return '';
    }

    return this.cleanText(cleaned);
  }
}

export default LLMVisionEngine;
