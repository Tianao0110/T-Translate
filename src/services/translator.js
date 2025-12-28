// src/services/translator.js
import llmClient from '../utils/llm-client.js';
import config from '../config/default.js';
import { v4 as uuidv4 } from 'uuid';
import dayjs from 'dayjs';

/**
 * 翻译服务
 * 处理所有翻译相关的业务逻辑
 */
class TranslationService {
  constructor() {
    this.translationCache = new Map();
    this.translationHistory = [];
    this.maxHistorySize = 1000;
    this.isTranslating = false;
    this.currentJob = null;
    
    // 支持的语言列表
    this.supportedLanguages = {
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
  }

  /**
   * 获取翻译模板
   * @param {string} templateName - 模板名称 (precise/natural/formal)
   * @param {string} targetLanguage - 目标语言代码
   * @returns {string} 完整的系统提示词
   */
  getTemplate(templateName, targetLanguage) {
    const templates = config.translation.templates;
    const template = templates[templateName] || templates.natural;
    const langName = this.getLanguageName(targetLanguage);
    return template.replace(/{targetLanguage}/g, langName);
  }

  /**
   * 获取语言名称（英文）
   */
  getLanguageName(code) {
    return this.supportedLanguages[code] || code;
  }

  /**
   * 主翻译方法 - 使用模板直接调用 chatCompletion
   */
  async translate(text, options = {}) {
    const {
      from = 'auto',
      to = 'zh',
      template = config.translation.defaultTemplate || 'natural',
      useCache = true,
      saveHistory = true,
      model = null
    } = options;

    // 检查缓存
    const cacheKey = this.getCacheKey(text, from, to, template);
    if (useCache && this.translationCache.has(cacheKey)) {
      console.log('[Translator] Using cached translation');
      return this.translationCache.get(cacheKey);
    }

    // 创建翻译任务
    const job = {
      id: uuidv4(),
      text,
      from,
      to,
      template,
      status: 'translating',
      startTime: Date.now(),
      model
    };

    this.currentJob = job;
    this.isTranslating = true;

    try {
      // 检测源语言（如果需要）
      let detectedLang = from;
      if (from === 'auto') {
        detectedLang = await this.detectLanguage(text);
        job.detectedLang = detectedLang;
      }

      // 如果源语言和目标语言相同，直接返回
      if (detectedLang === to) {
        const result = {
          id: job.id,
          success: true,
          original: text,
          translated: text,
          from: detectedLang,
          to,
          sameLanguage: true,
          duration: Date.now() - job.startTime
        };
        
        this.finishJob(result, useCache, saveHistory, cacheKey);
        return result;
      }

      // 🔴 核心修改：使用模板构建 messages，直接调用 chatCompletion
      const systemPrompt = this.getTemplate(template, to);
      
      const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text }  // 直接发送原文，不需要额外包装
      ];

      console.log(`[Translator] Using template: ${template}, target: ${this.getLanguageName(to)}`);

      // 调用 LLM
      const response = await llmClient.chatCompletion(messages, { model });

      if (!response.success) {
        throw new Error(response.error || 'Translation failed');
      }

      // 构建结果
      const result = {
        id: job.id,
        success: true,
        original: text,
        translated: response.content,
        from: detectedLang,
        to,
        template,
        model: response.model,
        usage: response.usage,
        duration: Date.now() - job.startTime,
        timestamp: Date.now()
      };

      this.finishJob(result, useCache, saveHistory, cacheKey);
      return result;

    } catch (error) {
      console.error('[Translator] Translation error:', error);
      
      const result = {
        id: job.id,
        success: false,
        original: text,
        translated: null,
        error: error.message,
        from,
        to,
        duration: Date.now() - job.startTime,
        timestamp: Date.now()
      };

      this.isTranslating = false;
      this.currentJob = null;
      
      return result;
    }
  }

  /**
   * 批量翻译
   */
  async batchTranslate(texts, options = {}) {
    if (!Array.isArray(texts)) {
      texts = [texts];
    }

    const results = [];
    const { 
      concurrent = false,
      maxConcurrent = 3,
      onProgress = null 
    } = options;

    if (concurrent) {
      // 并发翻译
      const chunks = this.chunkArray(texts, maxConcurrent);
      let completed = 0;

      for (const chunk of chunks) {
        const promises = chunk.map(text => 
          this.translate(text, options).then(result => {
            completed++;
            if (onProgress) {
              onProgress(completed, texts.length);
            }
            return result;
          })
        );
        
        const chunkResults = await Promise.all(promises);
        results.push(...chunkResults);
      }
    } else {
      // 串行翻译
      for (let i = 0; i < texts.length; i++) {
        const result = await this.translate(texts[i], options);
        results.push(result);
        
        if (onProgress) {
          onProgress(i + 1, texts.length);
        }
      }
    }

    return results;
  }

  /**
   * 流式翻译
   */
  async *streamTranslate(text, options = {}) {
    const {
      from = 'auto',
      to = 'zh',
      template = config.translation.defaultTemplate || 'natural',
      model = null
    } = options;

    // 获取翻译模板
    const systemPrompt = this.getTemplate(template, to);
    
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: text }
    ];

    try {
      const stream = llmClient.streamChat(messages, { model });
      
      let fullText = '';
      for await (const chunk of stream) {
        fullText += chunk;
        yield {
          chunk,
          fullText,
          done: false
        };
      }
      
      // 保存到历史
      if (options.saveHistory !== false) {
        this.addToHistory({
          id: uuidv4(),
          original: text,
          translated: fullText,
          from,
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
   * 语言检测
   */
  async detectLanguage(text) {
    // 简单的语言检测逻辑
    const patterns = {
      zh: /[\u4e00-\u9fa5]/,
      ja: /[\u3040-\u309f\u30a0-\u30ff]/,
      ko: /[\uac00-\ud7af\u1100-\u11ff]/,
      ar: /[\u0600-\u06ff]/,
      ru: /[\u0400-\u04ff]/,
      th: /[\u0e00-\u0e7f]/
    };

    // 统计各语言字符数
    const counts = {};
    for (const [lang, pattern] of Object.entries(patterns)) {
      const matches = text.match(new RegExp(pattern, 'g'));
      counts[lang] = matches ? matches.length : 0;
    }

    // 找出最多的语言
    let maxCount = 0;
    let detectedLang = 'en'; // 默认英语

    for (const [lang, count] of Object.entries(counts)) {
      if (count > maxCount) {
        maxCount = count;
        detectedLang = lang;
      }
    }

    // 如果没有检测到特殊字符，检查是否是英语
    if (maxCount === 0 && /[a-zA-Z]/.test(text)) {
      detectedLang = 'en';
    }

    console.log(`[Translator] Detected language: ${detectedLang}`);
    return detectedLang;
  }

  /**
   * 完成翻译任务
   */
  finishJob(result, useCache, saveHistory, cacheKey) {
    // 更新缓存
    if (useCache && result.success) {
      this.translationCache.set(cacheKey, result);
      
      // 限制缓存大小
      if (this.translationCache.size > 500) {
        const firstKey = this.translationCache.keys().next().value;
        this.translationCache.delete(firstKey);
      }
    }

    // 保存到历史
    if (saveHistory && result.success) {
      this.addToHistory(result);
    }

    this.isTranslating = false;
    this.currentJob = null;
  }

  /**
   * 添加到历史记录
   */
  addToHistory(record) {
    this.translationHistory.unshift({
      ...record,
      timestamp: record.timestamp || Date.now()
    });

    // 限制历史记录大小
    if (this.translationHistory.length > this.maxHistorySize) {
      this.translationHistory = this.translationHistory.slice(0, this.maxHistorySize);
    }
  }

  /**
   * 获取历史记录
   */
  getHistory(options = {}) {
    const { 
      limit = 50, 
      offset = 0,
      from = null,
      to = null,
      searchText = ''
    } = options;

    let filtered = this.translationHistory;

    if (from) {
      filtered = filtered.filter(item => item.from === from);
    }
    if (to) {
      filtered = filtered.filter(item => item.to === to);
    }
    if (searchText) {
      const search = searchText.toLowerCase();
      filtered = filtered.filter(item => 
        item.original.toLowerCase().includes(search) ||
        item.translated.toLowerCase().includes(search)
      );
    }

    return {
      items: filtered.slice(offset, offset + limit),
      total: filtered.length,
      hasMore: offset + limit < filtered.length
    };
  }

  /**
   * 清空历史记录
   */
  clearHistory() {
    this.translationHistory = [];
    console.log('[Translator] History cleared');
  }

  /**
   * 清空缓存
   */
  clearCache() {
    this.translationCache.clear();
    console.log('[Translator] Cache cleared');
  }

  /**
   * 获取缓存键
   */
  getCacheKey(text, from, to, template) {
    return `${from}-${to}-${template}-${text.substring(0, 100)}`;
  }

  /**
   * 工具函数：数组分块
   */
  chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * 导出历史记录
   */
  exportHistory(format = 'json') {
    const data = this.translationHistory;
    
    if (format === 'json') {
      return JSON.stringify(data, null, 2);
    } else if (format === 'csv') {
      const headers = ['Time', 'From', 'To', 'Template', 'Original', 'Translated'];
      const rows = data.map(item => [
        dayjs(item.timestamp).format('YYYY-MM-DD HH:mm:ss'),
        item.from,
        item.to,
        item.template || 'natural',
        `"${(item.original || '').replace(/"/g, '""')}"`,
        `"${(item.translated || '').replace(/"/g, '""')}"`
      ]);
      
      return [headers, ...rows].map(row => row.join(',')).join('\n');
    }
    
    return data;
  }

  /**
   * 获取统计信息
   */
  getStatistics() {
    const stats = {
      totalTranslations: this.translationHistory.length,
      cacheSize: this.translationCache.size,
      languagePairs: {},
      templates: {},
      todayCount: 0,
      weekCount: 0
    };

    const now = Date.now();
    const today = new Date().setHours(0, 0, 0, 0);
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

    for (const item of this.translationHistory) {
      // 语言对统计
      const pair = `${item.from}-${item.to}`;
      stats.languagePairs[pair] = (stats.languagePairs[pair] || 0) + 1;
      
      // 模板统计
      if (item.template) {
        stats.templates[item.template] = (stats.templates[item.template] || 0) + 1;
      }
      
      // 时间统计
      if (item.timestamp >= today) {
        stats.todayCount++;
      }
      if (item.timestamp >= weekAgo) {
        stats.weekCount++;
      }
    }

    return stats;
  }
}

// 创建单例实例
const translator = new TranslationService();

export default translator;
export { TranslationService };
