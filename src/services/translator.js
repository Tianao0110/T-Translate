// src/services/translator.js
// 翻译器 - 为 translation-store 提供模板和缓存支持
//
// 职责：
// - 翻译模板管理
// - 缓存支持
// - 流式翻译封装
// - 语言检测
//
// 核心翻译委托给: translation.js

import translationService from './translation.js';
import translationCache from './cache.js';
import config from '../config/default.js';
import { v4 as uuidv4 } from 'uuid';

// 支持的语言列表
const SUPPORTED_LANGUAGES = {
  'auto': 'Auto Detect',
  'zh': 'Chinese',
  'en': 'English',
  'ja': 'Japanese',
  'ko': 'Korean',
  'es': 'Spanish',
  'fr': 'French',
  'de': 'German',
  'ru': 'Russian',
  'pt': 'Portuguese',
  'it': 'Italian',
  'ar': 'Arabic',
  'hi': 'Hindi',
  'th': 'Thai',
  'vi': 'Vietnamese'
};

/**
 * 翻译器服务
 * 封装模板、缓存和翻译调用
 */
class Translator {
  constructor() {
    this.isTranslating = false;
  }

  /**
   * 获取语言名称（英文）
   */
  getLanguageName(code) {
    return SUPPORTED_LANGUAGES[code] || code;
  }

  /**
   * 获取翻译模板
   */
  getTemplate(templateName, targetLanguage) {
    const templates = config.translation?.templates || {
      natural: 'Translate the following text into {targetLanguage}. Maintain a natural, conversational tone. Output only the translation without explanations.',
      precise: 'Translate the following text into {targetLanguage}. Maintain technical accuracy and professional terminology. Output only the translation.',
      formal: 'Translate the following text into {targetLanguage} using formal, professional language. Output only the translation.',
    };
    const template = templates[templateName] || templates.natural;
    const langName = this.getLanguageName(targetLanguage);
    return template.replace(/{targetLanguage}/g, langName);
  }

  /**
   * 语言检测
   */
  detectLanguage(text) {
    const patterns = {
      zh: /[\u4e00-\u9fa5]/,
      ja: /[\u3040-\u309f\u30a0-\u30ff]/,
      ko: /[\uac00-\ud7af\u1100-\u11ff]/,
      ar: /[\u0600-\u06ff]/,
      ru: /[\u0400-\u04ff]/,
      th: /[\u0e00-\u0e7f]/
    };

    const counts = {};
    for (const [lang, pattern] of Object.entries(patterns)) {
      const matches = text.match(new RegExp(pattern, 'g'));
      counts[lang] = matches ? matches.length : 0;
    }

    let maxCount = 0;
    let detectedLang = 'en';

    for (const [lang, count] of Object.entries(counts)) {
      if (count > maxCount) {
        maxCount = count;
        detectedLang = lang;
      }
    }

    if (maxCount === 0 && /[a-zA-Z]/.test(text)) {
      detectedLang = 'en';
    }

    return detectedLang;
  }

  /**
   * 主翻译方法
   */
  async translate(text, options = {}) {
    const {
      from = 'auto',
      to = 'zh',
      template = 'natural',
      useCache = true,
    } = options;

    // 检查缓存
    const cacheKey = translationCache.generateKey(text, from, to, template);
    if (useCache) {
      const cached = translationCache.get(cacheKey);
      if (cached) {
        console.log('[Translator] Using cached translation');
        return cached;
      }
    }

    this.isTranslating = true;
    const startTime = Date.now();

    try {
      // 检测源语言
      let detectedLang = from;
      if (from === 'auto') {
        detectedLang = this.detectLanguage(text);
      }

      // 如果源语言和目标语言相同，直接返回
      if (detectedLang === to) {
        const result = {
          id: uuidv4(),
          success: true,
          original: text,
          translated: text,
          from: detectedLang,
          to,
          sameLanguage: true,
          duration: Date.now() - startTime
        };
        return result;
      }

      // 调用翻译服务
      const tsResult = await translationService.translate(text, {
        sourceLang: detectedLang,
        targetLang: to,
      });

      if (!tsResult.success) {
        throw new Error(tsResult.error || '翻译失败');
      }

      const result = {
        id: uuidv4(),
        success: true,
        original: text,
        translated: tsResult.text,
        from: detectedLang,
        to,
        template,
        model: tsResult.provider,
        duration: Date.now() - startTime,
        timestamp: Date.now()
      };

      // 保存到缓存
      if (useCache) {
        translationCache.set(cacheKey, result);
      }

      return result;
    } catch (error) {
      console.error('[Translator] Translation error:', error);
      return {
        success: false,
        error: error.message,
        original: text,
      };
    } finally {
      this.isTranslating = false;
    }
  }

  /**
   * 流式翻译
   */
  async *streamTranslate(text, options = {}) {
    const {
      from = 'auto',
      to = 'zh',
      template = 'natural',
      useCache = true,
    } = options;

    // 检查缓存
    const cacheKey = translationCache.generateKey(text, from, to, template);
    if (useCache) {
      const cached = translationCache.get(cacheKey);
      if (cached) {
        console.log('[Translator] Using cached translation (stream mode)');
        yield {
          chunk: cached.translated,
          fullText: cached.translated,
          done: true,
          fromCache: true
        };
        return;
      }
    }

    try {
      // 检测源语言
      let detectedLang = from;
      if (from === 'auto') {
        detectedLang = this.detectLanguage(text);
      }

      // 如果源语言和目标语言相同
      if (detectedLang === to) {
        yield {
          chunk: text,
          fullText: text,
          done: true,
          sameLanguage: true
        };
        return;
      }

      // 调用翻译服务
      const result = await translationService.translate(text, {
        sourceLang: detectedLang,
        targetLang: to,
      });

      if (!result.success) {
        yield { error: result.error || '翻译失败', done: true };
        return;
      }

      const fullText = result.text;

      // 模拟流式输出
      const chunkSize = 10;
      for (let i = 0; i < fullText.length; i += chunkSize) {
        const chunk = fullText.slice(i, i + chunkSize);
        yield {
          chunk,
          fullText: fullText.slice(0, i + chunkSize),
          done: false
        };
        await new Promise(r => setTimeout(r, 15));
      }

      // 保存到缓存
      if (useCache) {
        translationCache.set(cacheKey, {
          id: uuidv4(),
          success: true,
          original: text,
          translated: fullText,
          from: detectedLang,
          to,
          template,
          timestamp: Date.now()
        });
      }

      yield {
        chunk: '',
        fullText,
        done: true
      };
    } catch (error) {
      yield {
        error: error.message,
        done: true
      };
    }
  }

  /**
   * 清空缓存
   */
  clearCache() {
    translationCache.clear();
  }

  /**
   * 获取缓存统计
   */
  getCacheStats() {
    return translationCache.getStats();
  }
}

// 单例导出
const translator = new Translator();

export default translator;
export { Translator, SUPPORTED_LANGUAGES };
