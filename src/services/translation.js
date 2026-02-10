// src/services/translation.js
// 翻译服务 - Service 层核心（重构版）
//
// 职责：
// - 翻译统一入口（门面模式）
// - 预处理（免译名单/正则保护）
// - 两级缓存（L1 内存 + L2 持久化）
// - 模板系统
// - Provider 调度与 Fallback
// - 后处理（恢复保护内容）
// - 隐私模式检查
//
// 调用关系：
// UI Components → Store → MainTranslation → TranslationService → Providers
//                         Pipeline ────────────↗

import createLogger from '../utils/logger.js';

import {
  getProvider,
  createProvider,
  isProviderConfigured,
  getMissingConfig,
  getAllProviderIds,
  getAllProvidersStatus,
  initConfigs,
  updateProviderConfig,
  DEFAULT_PRIORITY,
} from '../providers/registry.js';

import { isProviderAllowed, PRIVACY_MODE_IDS } from '../config/privacy-modes.js';
import { getEnabledFilters, DEFAULT_FILTERS } from '../config/filters.js';
import { getSystemPrompt, LANGUAGE_NAMES } from '../config/templates.js';
import translationCache from './cache.js';

// 日志实例
const logger = createLogger('Translation');

// ========== 安全存储访问 ==========

const secureStorage = {
  async get(key) {
    if (window.electron?.secureStorage) {
      return await window.electron.secureStorage.decrypt(key);
    }
    const encoded = localStorage.getItem(`__secure_${key}`);
    if (encoded) {
      try {
        return decodeURIComponent(atob(encoded));
      } catch {
        return null;
      }
    }
    return null;
  },
};

// ========== 翻译服务类 ==========

class TranslationService {
  constructor() {
    this._initialized = false;
    this._mode = 'normal';
    this._userPriority = null;  // 用户自定义优先级
    this._failureCount = {};    // 翻译源连续失败计数 { providerId: count }
    this._skipThreshold = 3;    // 连续失败多少次后跳过
    
    // ========== 新增：预处理过滤器 ==========
    this._filters = [];
    this._filtersInitialized = false;
    
    // ========== 新增：L1 内存缓存 ==========
    this._l1Cache = new Map();
    this._l1MaxSize = 100;  // 内存缓存最大条数
    
    // ========== 新增：缓存统计 ==========
    this._cacheStats = {
      l1Hits: 0,
      l2Hits: 0,
      misses: 0,
    };
  }

  // ========== 初始化 ==========

  /**
   * 初始化服务
   * @param {object} settings - 从设置面板加载的配置
   */
  async init(settings = null) {
    if (this._initialized) return;
    
    logger.debug('Initializing...');
    
    try {
      let providerList = null;   // 启用状态列表
      let providerConfigs = null; // 配置对象
      
      // 优先使用传入的 settings
      if (settings?.providers) {
        providerList = settings.providers.list;
        providerConfigs = settings.providers.configs;
        logger.debug('Loaded from passed settings');
      }
      
      // 尝试从玻璃窗 API 获取（已解密）
      if (!providerConfigs && window.electron?.glass?.getProviderConfigs) {
        const glassConfigs = await window.electron.glass.getProviderConfigs();
        if (glassConfigs) {
          providerList = glassConfigs.list;
          providerConfigs = glassConfigs.configs;
          logger.debug('Loaded configs from glass API');
        }
      }
      
      // 如果还没有，尝试从主窗口存储加载
      if (!providerConfigs && window.electron?.store) {
        const saved = await window.electron.store.get('settings');
        
        if (saved?.translation?.providers) {
          providerList = saved.translation.providers;
          providerConfigs = await this._decryptConfigs(saved.translation.providerConfigs || {});
          logger.debug('Loaded from store (new format)');
        } else if (saved?.providers?.list) {
          providerList = saved.providers.list;
          providerConfigs = await this._decryptConfigs(saved.providers.configs || {});
          logger.debug('Loaded from store (old format)');
        }
      }
      
      // 即使没有存储的配置，也尝试从 secure storage 恢复加密字段
      if (!providerConfigs) {
        providerConfigs = await this._decryptConfigs({});
        logger.debug('Recovered configs from secure storage');
      }
      
      if (providerConfigs) {
        initConfigs(providerConfigs);
      }
      
      if (providerList) {
        this._userPriority = this._extractPriority(providerList);
        logger.debug('User priority:', this._userPriority);
      }
      
      // 初始化过滤器
      this._initFilters();
      
      this._initialized = true;
      logger.debug('Initialized successfully');
    } catch (error) {
      logger.error('Init failed:', error);
      this._initialized = true;
    }
  }

  /**
   * 初始化免译过滤器
   */
  _initFilters() {
    if (this._filtersInitialized) return;
    
    // 加载用户自定义过滤器
    let userFilters = [];
    try {
      const saved = localStorage.getItem('translation.customFilters');
      if (saved) {
        const parsed = JSON.parse(saved);
        // 重新编译正则表达式
        userFilters = parsed.map(f => ({
          ...f,
          pattern: new RegExp(f.patternStr || f.pattern.source, 'g'),
        }));
      }
    } catch (e) {
      logger.warn('Failed to load custom filters:', e);
    }
    
    // 合并默认和用户过滤器
    this._filters = getEnabledFilters(userFilters);
    this._filtersInitialized = true;
    
    logger.debug('Filters initialized:', this._filters.map(f => f.name));
  }

  /**
   * 解密配置中的敏感字段
   */
  async _decryptConfigs(configs) {
    const { getAllProviderMetadata } = await import('../providers/registry.js');
    const allMeta = getAllProviderMetadata();
    const decrypted = {};
    
    for (const meta of allMeta) {
      const providerId = meta.id;
      decrypted[providerId] = { ...(configs[providerId] || {}) };
      
      if (meta.configSchema) {
        for (const [key, field] of Object.entries(meta.configSchema)) {
          if (field.encrypted) {
            const currentValue = decrypted[providerId][key];
            if (!currentValue || currentValue === '***encrypted***') {
              const stored = await secureStorage.get(`provider_${providerId}_${key}`);
              if (stored) {
                decrypted[providerId][key] = stored;
              }
            }
          }
        }
      }
    }
    
    return decrypted;
  }

  /**
   * 从 providers list 提取启用的优先级顺序
   */
  _extractPriority(list) {
    if (!list) return null;
    return list
      .filter(p => p.enabled)
      .sort((a, b) => a.priority - b.priority)
      .map(p => p.id);
  }

  /**
   * 重新加载配置
   */
  async reload(settings) {
    this._initialized = false;
    this._failureCount = {};
    this._filtersInitialized = false;
    await this.init(settings);
  }

  // ========== 预处理/后处理（免译名单）==========

  /**
   * 预处理：提取需要保护的内容
   * @param {string} text - 原始文本
   * @returns {{ processed: string, protectedMap: Map }}
   */
  _preProcess(text) {
    if (!this._filters || this._filters.length === 0) {
      return { processed: text, protectedMap: new Map() };
    }
    
    const protectedMap = new Map();
    let processed = text;
    let index = 0;
    
    for (const filter of this._filters) {
      if (!filter.enabled || !filter.pattern) continue;
      
      // 重置正则状态（因为有 g 标志）
      filter.pattern.lastIndex = 0;
      
      processed = processed.replace(filter.pattern, (match) => {
        // 生成唯一占位符
        const placeholder = `⟦${filter.name}_${index++}⟧`;
        protectedMap.set(placeholder, match);
        return placeholder;
      });
    }
    
    if (protectedMap.size > 0) {
      logger.debug(`[PreProcess] Protected ${protectedMap.size} items:`, 
        Array.from(protectedMap.entries()).slice(0, 3));
    }
    
    return { processed, protectedMap };
  }

  /**
   * 后处理：恢复保护的内容
   * @param {string} text - 翻译后的文本
   * @param {Map} protectedMap - 保护映射
   * @returns {string}
   */
  _postProcess(text, protectedMap) {
    if (!protectedMap || protectedMap.size === 0) {
      return text;
    }
    
    let result = text;
    for (const [placeholder, original] of protectedMap) {
      // 使用 split/join 而不是 replaceAll，处理特殊字符
      result = result.split(placeholder).join(original);
    }
    
    return result;
  }

  // ========== 两级缓存 ==========

  /**
   * 生成缓存 Key
   */
  _getCacheKey(text, options) {
    const { targetLang = 'zh', template = 'natural' } = options;
    // 使用文本前100字符 + 长度 + 目标语言 + 模板
    const textKey = text.length > 100 
      ? text.substring(0, 100) + '_' + text.length 
      : text;
    return `${targetLang}-${template}-${textKey}`;
  }

  /**
   * 检查缓存 (L1 → L2)
   * @returns {{ value: any, source: string } | null}
   */
  _checkCache(key, options = {}) {
    const { useCache = true, privacyMode = PRIVACY_MODE_IDS.STANDARD } = options;
    
    if (!useCache) return null;
    
    // L1: 内存缓存（最快）
    if (this._l1Cache.has(key)) {
      this._cacheStats.l1Hits++;
      logger.debug('[Cache] L1 HIT (memory)');
      
      // LRU: 移到末尾
      const value = this._l1Cache.get(key);
      this._l1Cache.delete(key);
      this._l1Cache.set(key, value);
      
      return { value, source: 'l1' };
    }
    
    // L2: 持久化缓存（非无痕模式）
    if (privacyMode !== PRIVACY_MODE_IDS.SECURE) {
      const l2Result = translationCache.get(key);
      if (l2Result) {
        this._cacheStats.l2Hits++;
        logger.debug('[Cache] L2 HIT (disk)');
        
        // 回填 L1（热点数据预热）
        this._setL1Cache(key, l2Result);
        
        return { value: l2Result, source: 'l2' };
      }
    }
    
    this._cacheStats.misses++;
    return null;
  }

  /**
   * 写入缓存 (L1 + L2)
   */
  _saveCache(key, result, options = {}) {
    const { useCache = true, privacyMode = PRIVACY_MODE_IDS.STANDARD } = options;
    
    if (!useCache) return;
    
    // L1: 总是写入（保证当前会话快）
    this._setL1Cache(key, result);
    
    // L2: 非无痕模式写入持久化
    if (privacyMode !== PRIVACY_MODE_IDS.SECURE) {
      // 构造 L2 需要的结构
      const cacheEntry = {
        success: true,
        translated: result.text || result,
        from: result.from,
        to: result.to,
        timestamp: Date.now(),
      };
      translationCache.set(key, cacheEntry);
    }
  }

  /**
   * 设置 L1 缓存（带 LRU 淘汰）
   */
  _setL1Cache(key, value) {
    // LRU: 超出限制时删除最早的
    if (this._l1Cache.size >= this._l1MaxSize) {
      const firstKey = this._l1Cache.keys().next().value;
      this._l1Cache.delete(firstKey);
    }
    this._l1Cache.set(key, value);
  }

  /**
   * 清空缓存
   */
  clearCache(level = 'all') {
    if (level === 'l1' || level === 'all') {
      this._l1Cache.clear();
      logger.debug('[Cache] L1 cleared');
    }
    if (level === 'l2' || level === 'all') {
      translationCache.clear();
      logger.debug('[Cache] L2 cleared');
    }
    // 重置统计
    this._cacheStats = { l1Hits: 0, l2Hits: 0, misses: 0 };
  }

  /**
   * 获取缓存统计
   */
  getCacheStats() {
    const total = this._cacheStats.l1Hits + this._cacheStats.l2Hits + this._cacheStats.misses;
    return {
      ...this._cacheStats,
      l1Size: this._l1Cache.size,
      l2Stats: translationCache.getStats(),
      hitRate: total > 0 
        ? ((this._cacheStats.l1Hits + this._cacheStats.l2Hits) / total * 100).toFixed(1) + '%'
        : '0%',
    };
  }

  // ========== 模式管理 ==========

  setMode(mode) {
    this._mode = mode;
    logger.debug(`Mode set to: ${mode}`);
  }

  getMode() {
    return this._mode;
  }

  setPriority(priority) {
    this._userPriority = priority;
    logger.debug('Priority set to:', priority);
  }

  getPriority() {
    if (this._userPriority && this._userPriority.length > 0) {
      return this._userPriority;
    }
    return DEFAULT_PRIORITY[this._mode] || DEFAULT_PRIORITY.normal;
  }

  resetFailureCount(providerId = null) {
    if (providerId) {
      this._failureCount[providerId] = 0;
      logger.debug(`Reset failure count for: ${providerId}`);
    } else {
      this._failureCount = {};
      logger.debug('Reset all failure counts');
    }
  }

  getFailureStatus() {
    return { ...this._failureCount };
  }

  // ========== 核心翻译（门面入口）==========

  /**
   * 翻译文本（统一入口）
   * @param {string} text - 要翻译的文本
   * @param {object} options - 选项
   * @returns {Promise<{success: boolean, text?: string, error?: string, provider?: string, fromCache?: boolean}>}
   */
  async translate(text, options = {}) {
    if (!this._initialized) {
      await this.init();
    }
    
    const {
      sourceLang = 'auto',
      targetLang = 'zh',
      template = 'natural',
      mode = this._mode,
      enableFallback = true,
      privacyMode = PRIVACY_MODE_IDS.STANDARD,
      useCache = true,
    } = options;
    
    // ========== Phase 1: 预处理（免译名单）==========
    const { processed, protectedMap } = this._preProcess(text);
    
    // ========== Phase 2: 检查缓存 ==========
    const cacheKey = this._getCacheKey(processed, { targetLang, template });
    const cached = this._checkCache(cacheKey, { useCache, privacyMode });
    
    if (cached) {
      // 从缓存获取，需要后处理恢复保护内容
      const cachedText = cached.value?.translated || cached.value?.text || cached.value;
      return {
        success: true,
        text: this._postProcess(cachedText, protectedMap),
        fromCache: true,
        cacheSource: cached.source,
      };
    }
    
    // ========== Phase 3: 调用 Provider ==========
    const priority = this.getPriority();
    const tried = [];
    let allSkipped = true;
    
    for (const id of priority) {
      // 检查隐私模式限制
      if (!isProviderAllowed(privacyMode, id)) {
        logger.debug(`Provider ${id} not allowed in ${privacyMode} mode`);
        continue;
      }
      
      if (!isProviderConfigured(id)) continue;
      
      // 检查是否因连续失败而临时跳过
      if (this._failureCount[id] >= this._skipThreshold) {
        logger.debug(`Skipping ${id} (failed ${this._failureCount[id]} times)`);
        continue;
      }
      
      allSkipped = false;
      
      const provider = getProvider(id);
      if (!provider) continue;
      
      tried.push(id);
      
      try {
        logger.debug(`Trying provider: ${id}`);
        
        // 获取模板 system prompt
        const systemPrompt = getSystemPrompt(template, targetLang);
        
        // 调用 Provider
        const result = await provider.translate(processed, sourceLang, targetLang, {
          systemPrompt,
          template,
        });
        
        if (result.success) {
          // 成功：重置失败计数
          this._failureCount[id] = 0;
          
          // ========== Phase 4: 后处理 ==========
          const finalText = this._postProcess(result.text, protectedMap);
          
          // ========== Phase 5: 写入缓存 ==========
          this._saveCache(cacheKey, { 
            text: result.text,  // 存原始结果（不含后处理）
            from: sourceLang, 
            to: targetLang 
          }, { useCache, privacyMode });
          
          return {
            success: true,
            text: finalText,
            provider: id,
            fromCache: false,
          };
        }
        
        // 失败：增加计数
        this._failureCount[id] = (this._failureCount[id] || 0) + 1;
        logger.warn(`Provider ${id} failed (${this._failureCount[id]}/${this._skipThreshold})`);
        
        if (!enableFallback) {
          return { success: false, error: result.error, provider: id };
        }
        
      } catch (error) {
        this._failureCount[id] = (this._failureCount[id] || 0) + 1;
        logger.error(`Provider ${id} error:`, error);
        
        if (!enableFallback) {
          return { success: false, error: error.message, provider: id };
        }
      }
    }
    
    // 如果所有翻译源都被跳过，重置计数并重试一次
    if (allSkipped && Object.keys(this._failureCount).length > 0) {
      logger.debug('All providers skipped, resetting failure counts...');
      this._failureCount = {};
      return this.translate(text, options);
    }
    
    return {
      success: false,
      error: tried.length > 0 
        ? `所有翻译源均失败 (尝试了: ${tried.join(', ')})`
        : '没有可用的翻译源',
    };
  }

  /**
   * 流式翻译
   * @param {string} text - 要翻译的文本
   * @param {object} options - 选项
   * @param {function} onChunk - 流式回调 (chunk) => void
   */
  async translateStream(text, options = {}, onChunk) {
    if (!this._initialized) {
      await this.init();
    }
    
    const {
      sourceLang = 'auto',
      targetLang = 'zh',
      template = 'natural',
      mode = this._mode,
      enableFallback = true,
      privacyMode = PRIVACY_MODE_IDS.STANDARD,
      useCache = true,
    } = options;
    
    // 预处理
    const { processed, protectedMap } = this._preProcess(text);
    
    // 检查缓存（流式也可以用缓存，直接返回完整结果）
    const cacheKey = this._getCacheKey(processed, { targetLang, template });
    const cached = this._checkCache(cacheKey, { useCache, privacyMode });
    
    if (cached) {
      const cachedText = cached.value?.translated || cached.value?.text || cached.value;
      const finalText = this._postProcess(cachedText, protectedMap);
      
      // 模拟流式输出缓存结果
      if (onChunk) {
        onChunk(finalText);
      }
      
      return {
        success: true,
        text: finalText,
        fromCache: true,
      };
    }
    
    // 找支持流式的 Provider
    const priority = this.getPriority();
    let allSkipped = true;
    
    for (const id of priority) {
      if (!isProviderAllowed(privacyMode, id)) continue;
      if (!isProviderConfigured(id)) continue;
      
      if (this._failureCount[id] >= this._skipThreshold) {
        logger.debug(`Skipping stream ${id}`);
        continue;
      }
      
      allSkipped = false;
      
      const provider = getProvider(id);
      if (!provider) continue;
      
      try {
        logger.debug(`Trying stream provider: ${id}`);
        
        const systemPrompt = getSystemPrompt(template, targetLang);
        
        // 检查 Provider 是否支持真流式
        if (provider.supportsStreaming && typeof provider.translateStream === 'function') {
          // 真流式
          let fullText = '';
          
          const result = await provider.translateStream(
            processed,
            sourceLang,
            targetLang,
            (chunk) => {
              fullText += chunk;
              if (onChunk) {
                // 实时后处理（可能有部分占位符）
                onChunk(this._postProcess(fullText, protectedMap));
              }
            },
            { systemPrompt, template }
          );
          
          if (result.success) {
            this._failureCount[id] = 0;
            
            const finalText = this._postProcess(result.text || fullText, protectedMap);
            
            // 写入缓存
            this._saveCache(cacheKey, { 
              text: result.text || fullText, 
              from: sourceLang, 
              to: targetLang 
            }, { useCache, privacyMode });
            
            return {
              success: true,
              text: finalText,
              provider: id,
              fromCache: false,
            };
          }
        } else {
          // 不支持真流式，回退到普通翻译
          const result = await provider.translate(processed, sourceLang, targetLang, {
            systemPrompt,
            template,
          });
          
          if (result.success) {
            this._failureCount[id] = 0;
            
            const finalText = this._postProcess(result.text, protectedMap);
            
            // 一次性返回
            if (onChunk) {
              onChunk(finalText);
            }
            
            this._saveCache(cacheKey, { 
              text: result.text, 
              from: sourceLang, 
              to: targetLang 
            }, { useCache, privacyMode });
            
            return {
              success: true,
              text: finalText,
              provider: id,
              fromCache: false,
            };
          }
        }
        
        // 失败
        this._failureCount[id] = (this._failureCount[id] || 0) + 1;
        
        if (!enableFallback) {
          return { success: false, error: 'Translation failed', provider: id };
        }
        
      } catch (error) {
        this._failureCount[id] = (this._failureCount[id] || 0) + 1;
        logger.error(`Stream provider ${id} error:`, error);
        
        if (!enableFallback) {
          return { success: false, error: error.message, provider: id };
        }
      }
    }
    
    // 重置并重试
    if (allSkipped && Object.keys(this._failureCount).length > 0) {
      logger.debug('All stream providers skipped, resetting...');
      this._failureCount = {};
      return this.translateStream(text, options, onChunk);
    }
    
    return { success: false, error: '没有可用的翻译源' };
  }

  // ========== 辅助方法 ==========

  /**
   * 通用聊天完成（用于 AI 分析、风格改写等）
   */
  async chatCompletion(messages, options = {}) {
    if (!this._initialized) {
      await this.init();
    }
    
    // 获取 local-llm provider
    const provider = getProvider('local-llm');
    
    if (provider && typeof provider.chat === 'function') {
      return provider.chat(messages, options);
    }
    
    // 回退：从 messages 提取文本进行翻译
    const userMessage = messages.find(m => m.role === 'user');
    const systemMessage = messages.find(m => m.role === 'system');
    
    if (!userMessage) {
      return { success: false, error: '没有用户消息' };
    }
    
    // 检测目标语言
    let targetLang = 'zh';
    if (systemMessage?.content) {
      if (/English|英文/i.test(systemMessage.content)) targetLang = 'en';
      else if (/日本語|日文/i.test(systemMessage.content)) targetLang = 'ja';
      else if (/한국어|韩文/i.test(systemMessage.content)) targetLang = 'ko';
    }
    
    const result = await this.translate(userMessage.content, {
      targetLang,
      ...options,
    });
    
    if (result.success) {
      return {
        success: true,
        content: result.text,
        provider: result.provider,
      };
    }
    
    return { success: false, error: result.error || '翻译失败' };
  }

  /**
   * 测试指定翻译源连接
   */
  async testProvider(providerId) {
    const provider = getProvider(providerId);
    if (!provider) {
      return { success: false, message: '翻译源不存在' };
    }
    
    if (!provider.isConfigured()) {
      const missing = getMissingConfig(providerId);
      return { success: false, message: `缺少配置: ${missing.join(', ')}` };
    }
    
    return provider.testConnection();
  }

  /**
   * 使用指定配置测试翻译源连接（用于设置页面测试未保存的配置）
   * @param {string} providerId - 翻译源 ID
   * @param {object} config - 临时配置（可能尚未保存）
   * @returns {Promise<{success: boolean, message?: string}>}
   */
  async testProviderWithConfig(providerId, config) {
    try {
      // 创建临时实例，使用传入的配置
      const tempProvider = createProvider(providerId, config);
      if (!tempProvider) {
        return { success: false, message: '翻译源不存在' };
      }

      // 如果 provider 有 testConnection 方法，使用它
      if (typeof tempProvider.testConnection === 'function') {
        return await tempProvider.testConnection();
      }

      // 否则尝试做一次简短翻译来测试
      const result = await tempProvider.translate('test', 'en', 'zh');
      if (result.success) {
        return { success: true, message: '连接成功' };
      }
      return { success: false, message: result.error || '测试失败' };
    } catch (error) {
      return { success: false, message: error.message || '连接失败' };
    }
  }

  /**
   * 测试当前最佳翻译源
   */
  async testConnection() {
    if (!this._initialized) {
      await this.init();
    }
    
    const priority = this.getPriority();
    
    for (const id of priority) {
      if (isProviderConfigured(id)) {
        return this.testProvider(id);
      }
    }
    
    return { success: false, error: '没有可用的翻译源' };
  }

  /**
   * 获取当前使用的翻译源信息
   */
  getCurrentProvider() {
    const priority = this.getPriority();
    
    for (const id of priority) {
      if (isProviderConfigured(id)) {
        const provider = getProvider(id);
        return {
          id,
          name: provider?.constructor?.metadata?.name,
        };
      }
    }
    
    return null;
  }

  getProvidersStatus() {
    return getAllProvidersStatus();
  }

  updateProviderConfig(providerId, config) {
    updateProviderConfig(providerId, config);
  }

  get initialized() {
    return this._initialized;
  }

  /**
   * 注册自定义过滤器
   */
  registerFilter(filter) {
    if (filter && filter.name && filter.pattern) {
      this._filters.push(filter);
      logger.debug(`Filter registered: ${filter.name}`);
    }
  }

  /**
   * 获取当前过滤器列表
   */
  getFilters() {
    return [...this._filters];
  }
}

// ========== 单例导出 ==========

const translationService = new TranslationService();

export default translationService;
export { TranslationService };
