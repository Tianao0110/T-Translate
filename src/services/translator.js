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
      'auto': '自动检测',
      'zh': '中文',
      'en': '英语',
      'ja': '日语',
      'ko': '韩语',
      'es': '西班牙语',
      'fr': '法语',
      'de': '德语',
      'ru': '俄语',
      'pt': '葡萄牙语',
      'it': '意大利语',
      'ar': '阿拉伯语',
      'hi': '印地语',
      'th': '泰语',
      'vi': '越南语'
    };

    // 翻译模板
    this.templates = {
      general: config.translation.systemPrompt,
      technical: `你是一个专业的技术文档翻译助手。请将以下技术内容翻译成{targetLanguage}。
要求：
1. 保留所有技术术语的准确性
2. 代码、命令、变量名保持原样
3. 保持文档的格式和结构
4. 技术缩写首次出现时提供全称`,
      
      academic: `你是一个学术翻译专家。请将以下学术内容翻译成{targetLanguage}。
要求：
1. 保持学术用语的严谨性
2. 引用格式保持不变
3. 专业术语使用标准译法
4. 保留原文的逻辑结构`,
      
      casual: `你是一个翻译助手。请将以下内容翻译成{targetLanguage}。
要求：
1. 使用口语化的表达
2. 保持原文的语气和情感
3. 适当使用当地俚语或习语
4. 让译文自然流畅`,
      
      business: `你是一个商务翻译专家。请将以下商务内容翻译成{targetLanguage}。
要求：
1. 使用正式的商务用语
2. 保持专业术语的准确性
3. 符合商务礼仪规范
4. 确保信息传达准确无误`
    };
  }

  /**
   * 主翻译方法
   */
  async translate(text, options = {}) {
    // 参数处理
    const {
      from = 'auto',
      to = 'zh',
      template = 'general',
      useCache = true,
      saveHistory = true,
      model = null
    } = options;

    // 检查缓存
    const cacheKey = this.getCacheKey(text, from, to, template);
    if (useCache && this.translationCache.has(cacheKey)) {
      console.log('[Translator] 使用缓存的翻译结果');
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

      // 获取翻译模板
      const systemPrompt = this.getTemplate(template, to);

      // 调用 LLM 进行翻译
      const response = await llmClient.translate(text, 
        this.getLanguageName(to), 
        this.getLanguageName(detectedLang),
        { model }
      );

      if (!response.success) {
        throw new Error(response.error || '翻译失败');
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
      console.error('[Translator] 翻译错误:', error);
      
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
      template = 'general',
      model = null
    } = options;

    // 获取翻译模板
    const systemPrompt = this.getTemplate(template, to);
    
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `请翻译以下内容:\n\n${text}` }
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
    // 实际项目中可以使用更复杂的检测方法或调用 LLM
    
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
      const matches = text.match(pattern);
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

    console.log(`[Translator] 检测到语言: ${detectedLang}`);
    return detectedLang;
  }

  /**
   * 获取翻译模板
   */
  getTemplate(templateName, targetLanguage) {
    const template = this.templates[templateName] || this.templates.general;
    const langName = this.getLanguageName(targetLanguage);
    return template.replace('{targetLanguage}', langName);
  }

  /**
   * 获取语言名称
   */
  getLanguageName(code) {
    if (this.supportedLanguages[code]) {
      return this.supportedLanguages[code];
    }
    // 尝试映射常见的语言代码
    const langMap = {
      'zh': '中文',
      'zh-CN': '中文简体',
      'zh-TW': '中文繁体',
      'en': '英语',
      'en-US': '美式英语',
      'en-GB': '英式英语'
    };
    return langMap[code] || code;
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

    // 过滤条件
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

    // 分页
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
    console.log('[Translator] 历史记录已清空');
  }

  /**
   * 清空缓存
   */
  clearCache() {
    this.translationCache.clear();
    console.log('[Translator] 翻译缓存已清空');
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
      const headers = ['时间', '源语言', '目标语言', '原文', '译文'];
      const rows = data.map(item => [
        dayjs(item.timestamp).format('YYYY-MM-DD HH:mm:ss'),
        item.from,
        item.to,
        `"${item.original.replace(/"/g, '""')}"`,
        `"${item.translated.replace(/"/g, '""')}"`
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