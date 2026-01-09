// src/services/translation.js
// 翻译服务 - Service 层核心
//
// 职责：
// - 翻译调度（选择 Provider、Fallback）
// - 流式翻译封装
// - 模式管理（normal / subtitle）
// - 初始化配置加载
//
// 不负责：
// - 缓存管理（独立模块）
// - 历史记录（Store 层）
// - UI 状态（Store 层）

import {
  getProvider,
  isProviderConfigured,
  getMissingConfig,
  getAllProviderIds,
  getAllProvidersStatus,
  initConfigs,
  updateProviderConfig,
  DEFAULT_PRIORITY,
} from '../providers/registry.js';

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
    this._mode = 'normal';  // 'normal' | 'subtitle'
    this._userPriority = null;  // 用户自定义优先级
  }

  // ========== 初始化 ==========

  /**
   * 初始化服务
   * @param {object} settings - 从设置面板加载的配置
   */
  async init(settings = null) {
    if (this._initialized) return;
    
    console.log('[TranslationService] Initializing...');
    
    try {
      let providerList = null;   // 启用状态列表
      let providerConfigs = null; // 配置对象
      
      // 优先使用传入的 settings
      if (settings?.providers) {
        // 新格式：{ providers: { list, configs } }
        providerList = settings.providers.list;
        providerConfigs = settings.providers.configs;
        console.log('[TranslationService] Loaded from passed settings');
      }
      
      // 尝试从玻璃窗 API 获取（已解密）
      if (!providerConfigs && window.electron?.glass?.getProviderConfigs) {
        const glassConfigs = await window.electron.glass.getProviderConfigs();
        if (glassConfigs) {
          providerList = glassConfigs.list;
          providerConfigs = glassConfigs.configs;
          console.log('[TranslationService] Loaded configs from glass API');
        }
      }
      
      // 如果还没有，尝试从主窗口存储加载
      if (!providerConfigs && window.electron?.store) {
        const saved = await window.electron.store.get('settings');
        
        // 兼容两种格式
        if (saved?.translation?.providers) {
          // 新格式：settings.translation.providers (数组)
          providerList = saved.translation.providers;
          providerConfigs = await this._decryptConfigs(saved.translation.providerConfigs || {});
          console.log('[TranslationService] Loaded from store (new format)');
        } else if (saved?.providers?.list) {
          // 旧格式：settings.providers.list
          providerList = saved.providers.list;
          providerConfigs = await this._decryptConfigs(saved.providers.configs || {});
          console.log('[TranslationService] Loaded from store (old format)');
        }
      }
      
      // 即使没有存储的配置，也尝试从 secure storage 恢复加密字段
      if (!providerConfigs) {
        providerConfigs = await this._decryptConfigs({});
        console.log('[TranslationService] Recovered configs from secure storage');
      }
      
      if (providerConfigs) {
        // 初始化 Registry 的配置
        initConfigs(providerConfigs);
      }
      
      if (providerList) {
        // 提取用户优先级（只包含启用的）
        this._userPriority = this._extractPriority(providerList);
        console.log('[TranslationService] User priority:', this._userPriority);
      }
      
      this._initialized = true;
      console.log('[TranslationService] Initialized successfully');
    } catch (error) {
      console.error('[TranslationService] Init failed:', error);
      this._initialized = true; // 避免重复尝试
    }
  }

  /**
   * 解密配置中的敏感字段
   * 对于所有 provider，尝试从 secure storage 恢复加密字段
   */
  async _decryptConfigs(configs) {
    const { getAllProviderMetadata } = await import('../providers/registry.js');
    const allMeta = getAllProviderMetadata();
    const decrypted = {};
    
    for (const meta of allMeta) {
      const providerId = meta.id;
      decrypted[providerId] = { ...(configs[providerId] || {}) };
      
      // 检查每个加密字段
      if (meta.configSchema) {
        for (const [key, field] of Object.entries(meta.configSchema)) {
          if (field.encrypted) {
            // 如果值是占位符或者为空，尝试从 secure storage 读取
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
    await this.init(settings);
  }

  // ========== 模式管理 ==========

  /**
   * 设置翻译模式
   * @param {'normal'|'subtitle'} mode
   */
  setMode(mode) {
    this._mode = mode;
    console.log(`[TranslationService] Mode set to: ${mode}`);
  }

  /**
   * 获取当前模式
   */
  getMode() {
    return this._mode;
  }

  /**
   * 设置用户优先级
   * @param {string[]} priority - Provider ID 数组
   */
  setPriority(priority) {
    this._userPriority = priority;
    console.log('[TranslationService] Priority set to:', priority);
  }

  /**
   * 获取当前优先级列表
   */
  getPriority() {
    if (this._userPriority && this._userPriority.length > 0) {
      return this._userPriority;
    }
    return DEFAULT_PRIORITY[this._mode] || DEFAULT_PRIORITY.normal;
  }

  // ========== 核心翻译 ==========

  /**
   * 翻译文本（带自动 Fallback）
   * @param {string} text - 要翻译的文本
   * @param {object} options - 选项
   * @returns {Promise<{success: boolean, text?: string, error?: string, provider?: string}>}
   */
  async translate(text, options = {}) {
    if (!this._initialized) {
      await this.init();
    }
    
    const {
      sourceLang = 'auto',
      targetLang = 'zh',
      mode = this._mode,
      enableFallback = true,
    } = options;
    
    const priority = this.getPriority();
    const tried = [];
    
    for (const id of priority) {
      if (!isProviderConfigured(id)) continue;
      
      const provider = getProvider(id);
      if (!provider) continue;
      
      tried.push(id);
      
      try {
        console.log(`[TranslationService] Trying provider: ${id}`);
        const result = await provider.translate(text, sourceLang, targetLang);
        
        if (result.success) {
          return { ...result, provider: id };
        }
        
        console.warn(`[TranslationService] Provider ${id} failed:`, result.error);
        
        if (!enableFallback) {
          return { ...result, provider: id };
        }
      } catch (error) {
        console.error(`[TranslationService] Provider ${id} threw error:`, error);
        
        if (!enableFallback) {
          return { success: false, error: error.message, provider: id };
        }
      }
    }
    
    return {
      success: false,
      error: tried.length > 0 
        ? `所有翻译源均失败 (尝试了: ${tried.join(', ')})`
        : '没有可用的翻译源，请先配置',
      provider: null,
    };
  }

  /**
   * 流式翻译（带自动 Fallback）
   * @param {string} text - 要翻译的文本
   * @param {object} options - 选项
   * @param {function} onChunk - 流式回调
   */
  async translateStream(text, options = {}, onChunk) {
    if (!this._initialized) {
      await this.init();
    }
    
    const {
      sourceLang = 'auto',
      targetLang = 'zh',
      mode = this._mode,
      enableFallback = true,
    } = options;
    
    const priority = this.getPriority();
    
    for (const id of priority) {
      if (!isProviderConfigured(id)) continue;
      
      const provider = getProvider(id);
      if (!provider) continue;
      
      try {
        console.log(`[TranslationService] Trying stream provider: ${id}`);
        const result = await provider.translateStream(text, sourceLang, targetLang, onChunk);
        
        if (result.success) {
          return { ...result, provider: id };
        }
        
        if (!enableFallback) {
          return { ...result, provider: id };
        }
      } catch (error) {
        console.error(`[TranslationService] Stream provider ${id} error:`, error);
        
        if (!enableFallback) {
          return { success: false, error: error.message, provider: id };
        }
      }
    }
    
    return { success: false, error: '所有翻译源均失败' };
  }

  // ========== 辅助方法 ==========

  /**
   * 通用聊天完成（用于非翻译场景，如 AI 分析、风格改写）
   * @param {Array} messages - OpenAI 格式的消息数组
   * @param {object} options - 选项
   */
  async chatCompletion(messages, options = {}) {
    if (!this._initialized) {
      await this.init();
    }
    
    // 获取 local-llm provider（优先用于 chat）
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
      if (/English|英文/i.test(systemMessage.content)) {
        targetLang = 'en';
      } else if (/日本語|日文/i.test(systemMessage.content)) {
        targetLang = 'ja';
      } else if (/한국어|韩文/i.test(systemMessage.content)) {
        targetLang = 'ko';
      }
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
    } else {
      return { success: false, error: result.error || '翻译失败' };
    }
  }

  /**
   * 测试指定翻译源连接
   * @param {string} providerId - Provider ID
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
   * 使用自定义配置测试翻译源连接
   * 用于设置面板中测试未保存的配置
   * @param {string} providerId - Provider ID
   * @param {object} config - 自定义配置
   */
  async testProviderWithConfig(providerId, config) {
    const { createProvider } = await import('../providers/registry.js');
    
    try {
      const provider = createProvider(providerId, config);
      if (!provider) {
        return { success: false, message: '翻译源不存在' };
      }
      
      if (typeof provider.testConnection !== 'function') {
        return { success: false, message: '该翻译源不支持连接测试' };
      }
      
      return await provider.testConnection();
    } catch (error) {
      return { success: false, message: error.message || '测试失败' };
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

  /**
   * 获取所有翻译源状态
   */
  getProvidersStatus() {
    return getAllProvidersStatus();
  }

  /**
   * 更新翻译源配置
   */
  updateProviderConfig(providerId, config) {
    updateProviderConfig(providerId, config);
  }

  /**
   * 检查是否已初始化
   */
  get initialized() {
    return this._initialized;
  }
}

// ========== 单例导出 ==========

const translationService = new TranslationService();

export default translationService;
export { TranslationService };
