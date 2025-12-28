// src/services/translator.js
import llmClient from '../utils/llm-client.js';
import config from '../config/default.js';
import { v4 as uuidv4 } from 'uuid';
import dayjs from 'dayjs';

/**
 * 翻译缓存管理器
 * 持久化到 localStorage，支持 TTL 和容量限制
 */
class TranslationCache {
  constructor(options = {}) {
    this.storageKey = 'translation-cache';
    this.maxSize = options.maxSize || 200;  // 最大缓存条数
    this.ttl = options.ttl || 7 * 24 * 60 * 60 * 1000;  // 7天过期
    this.cache = new Map();
    
    // 启动时加载缓存
    this.load();
    // 清理过期缓存
    this.cleanup();
  }

  /**
   * 从 localStorage 加载缓存
   */
  load() {
    try {
      const data = localStorage.getItem(this.storageKey);
      if (data) {
        const parsed = JSON.parse(data);
        // 转换为 Map
        Object.entries(parsed).forEach(([key, value]) => {
          this.cache.set(key, value);
        });
        console.log(`[Cache] Loaded ${this.cache.size} cached translations`);
      }
    } catch (error) {
      console.error('[Cache] Failed to load cache:', error);
      this.cache = new Map();
    }
  }

  /**
   * 保存缓存到 localStorage
   */
  save() {
    try {
      const obj = {};
      this.cache.forEach((value, key) => {
        obj[key] = value;
      });
      localStorage.setItem(this.storageKey, JSON.stringify(obj));
    } catch (error) {
      console.error('[Cache] Failed to save cache:', error);
      // 如果存储失败（可能超出配额），清理一半的缓存
      if (error.name === 'QuotaExceededError') {
        this.evict(Math.floor(this.cache.size / 2));
        this.save();
      }
    }
  }

  /**
   * 获取缓存
   */
  get(key) {
    const item = this.cache.get(key);
    if (!item) return null;

    // 检查是否过期
    if (Date.now() - item.timestamp > this.ttl) {
      this.cache.delete(key);
      this.save();
      return null;
    }

    return item.result;
  }

  /**
   * 设置缓存
   */
  set(key, result) {
    // 如果达到容量限制，先删除最旧的
    if (this.cache.size >= this.maxSize) {
      this.evict(Math.floor(this.maxSize * 0.2));  // 删除20%
    }

    this.cache.set(key, {
      result,
      timestamp: Date.now()
    });

    this.save();
  }

  /**
   * 检查缓存是否存在
   */
  has(key) {
    return this.get(key) !== null;
  }

  /**
   * 删除指定数量的最旧缓存
   */
  evict(count) {
    // Map 保持插入顺序，所以最早的在前面
    const keysToDelete = Array.from(this.cache.keys()).slice(0, count);
    keysToDelete.forEach(key => this.cache.delete(key));
    console.log(`[Cache] Evicted ${keysToDelete.length} old entries`);
  }

  /**
   * 清理过期缓存
   */
  cleanup() {
    const now = Date.now();
    let cleaned = 0;

    this.cache.forEach((value, key) => {
      if (now - value.timestamp > this.ttl) {
        this.cache.delete(key);
        cleaned++;
      }
    });

    if (cleaned > 0) {
      this.save();
      console.log(`[Cache] Cleaned ${cleaned} expired entries`);
    }
  }

  /**
   * 清空所有缓存
   */
  clear() {
    this.cache.clear();
    localStorage.removeItem(this.storageKey);
    console.log('[Cache] All cache cleared');
  }

  /**
   * 获取缓存统计信息
   */
  getStats() {
    let validCount = 0;
    let expiredCount = 0;
    const now = Date.now();

    this.cache.forEach((value) => {
      if (now - value.timestamp > this.ttl) {
        expiredCount++;
      } else {
        validCount++;
      }
    });

    return {
      total: this.cache.size,
      valid: validCount,
      expired: expiredCount,
      maxSize: this.maxSize,
      ttlDays: this.ttl / (24 * 60 * 60 * 1000)
    };
  }
}

/**
 * 翻译服务
 * 处理所有翻译相关的业务逻辑
 */
class TranslationService {
  constructor() {
    // 使用持久化缓存
    this.translationCache = new TranslationCache({
      maxSize: 200,
      ttl: 7 * 24 * 60 * 60 * 1000  // 7天
    });
    
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
   * 主翻译方法
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
    if (useCache) {
      const cachedResult = this.translationCache.get(cacheKey);
      if (cachedResult) {
        console.log('[Translator] Using cached translation');
        return cachedResult;
      }
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
      // 检测源语言
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

      // 使用模板构建 messages
      const systemPrompt = this.getTemplate(template, to);
      
      const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text }
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
      useCache = true,
      model = null
    } = options;

    // 检查缓存
    const cacheKey = this.getCacheKey(text, from, to, template);
    if (useCache) {
      const cachedResult = this.translationCache.get(cacheKey);
      if (cachedResult) {
        console.log('[Translator] Using cached translation (stream mode)');
        // 模拟流式输出缓存结果
        yield {
          chunk: cachedResult.translated,
          fullText: cachedResult.translated,
          done: true,
          fromCache: true
        };
        return;
      }
    }

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
      
      // 保存到缓存
      if (useCache && fullText) {
        const result = {
          id: uuidv4(),
          success: true,
          original: text,
          translated: fullText,
          from,
          to,
          template,
          timestamp: Date.now()
        };
        this.translationCache.set(cacheKey, result);
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
  }

  /**
   * 获取缓存统计
   */
  getCacheStats() {
    return this.translationCache.getStats();
  }

  /**
   * 获取缓存键
   */
  getCacheKey(text, from, to, template) {
    // 使用文本的前100个字符 + hash 作为 key，避免 key 过长
    const textKey = text.length > 100 ? text.substring(0, 100) + '_' + text.length : text;
    return `${from}-${to}-${template}-${textKey}`;
  }

  /**
   * 数组分块
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
    const cacheStats = this.translationCache.getStats();
    
    const stats = {
      totalTranslations: this.translationHistory.length,
      cacheSize: cacheStats.valid,
      cacheMaxSize: cacheStats.maxSize,
      cacheTTLDays: cacheStats.ttlDays,
      languagePairs: {},
      templates: {},
      todayCount: 0,
      weekCount: 0
    };

    const now = Date.now();
    const today = new Date().setHours(0, 0, 0, 0);
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

    for (const item of this.translationHistory) {
      const pair = `${item.from}-${item.to}`;
      stats.languagePairs[pair] = (stats.languagePairs[pair] || 0) + 1;
      
      if (item.template) {
        stats.templates[item.template] = (stats.templates[item.template] || 0) + 1;
      }
      
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
