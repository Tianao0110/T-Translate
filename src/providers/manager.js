// src/providers/manager.js
// 翻译源管理器 - 负责智能调度、实例管理和 fallback

import { 
  getAllProviders, 
  getProviderClass, 
  createProvider,
  getAllProviderMetadata,
  DEFAULT_PRIORITY 
} from './registry.js';

/**
 * 翻译源管理器
 * 单例模式，管理所有翻译源实例
 */
class ProviderManager {
  constructor() {
    this.instances = {};      // 翻译源实例缓存
    this.configs = {};        // 各翻译源的配置
    this.userPriority = null; // 用户自定义优先级
    this.currentMode = 'normal'; // 当前模式: 'normal' | 'subtitle'
    this._initialized = false;
  }

  /**
   * 初始化管理器
   * @param {object} savedConfigs - 从存储加载的配置
   */
  async init(savedConfigs = {}) {
    if (this._initialized) return;
    
    console.log('[ProviderManager] Initializing...');
    
    this.configs = savedConfigs.providers || {};
    this.userPriority = savedConfigs.priority || null;
    
    // 预创建已配置的翻译源实例
    for (const [id, config] of Object.entries(this.configs)) {
      if (config && Object.keys(config).length > 0) {
        this.getOrCreateInstance(id);
      }
    }
    
    this._initialized = true;
    console.log('[ProviderManager] Initialized with providers:', Object.keys(this.instances));
  }

  /**
   * 获取或创建翻译源实例
   * @param {string} id - 翻译源 ID
   * @returns {BaseProvider|null}
   */
  getOrCreateInstance(id) {
    if (this.instances[id]) {
      return this.instances[id];
    }
    
    const config = this.configs[id] || {};
    const instance = createProvider(id, config);
    
    if (instance) {
      this.instances[id] = instance;
    }
    
    return instance;
  }

  /**
   * 更新翻译源配置
   * @param {string} id - 翻译源 ID
   * @param {object} config - 新配置
   */
  updateConfig(id, config) {
    this.configs[id] = { ...this.configs[id], ...config };
    
    // 更新已存在的实例
    if (this.instances[id]) {
      this.instances[id].updateConfig(this.configs[id]);
    }
    
    console.log(`[ProviderManager] Updated config for ${id}`);
  }

  /**
   * 设置用户优先级
   * @param {string[]} priority - 翻译源 ID 数组，按优先级排序
   */
  setPriority(priority) {
    this.userPriority = priority;
    console.log('[ProviderManager] Priority set to:', priority);
  }

  /**
   * 设置当前模式
   * @param {'normal'|'subtitle'} mode
   */
  setMode(mode) {
    this.currentMode = mode;
    console.log('[ProviderManager] Mode set to:', mode);
  }

  /**
   * 获取当前优先级列表
   * @returns {string[]}
   */
  getPriority() {
    if (this.userPriority && this.userPriority.length > 0) {
      return this.userPriority;
    }
    return DEFAULT_PRIORITY[this.currentMode] || DEFAULT_PRIORITY.normal;
  }

  /**
   * 检查翻译源是否可用
   * @param {string} id - 翻译源 ID
   * @returns {boolean}
   */
  isAvailable(id) {
    const instance = this.getOrCreateInstance(id);
    if (!instance) return false;
    return instance.isConfigured();
  }

  /**
   * 获取最佳可用翻译源
   * @param {string} mode - 模式 ('normal' | 'subtitle')
   * @returns {BaseProvider|null}
   */
  getBestProvider(mode = this.currentMode) {
    const priority = mode === 'subtitle' 
      ? (this.userPriority || DEFAULT_PRIORITY.subtitle)
      : (this.userPriority || DEFAULT_PRIORITY.normal);
    
    for (const id of priority) {
      if (this.isAvailable(id)) {
        console.log(`[ProviderManager] Selected provider: ${id}`);
        return this.getOrCreateInstance(id);
      }
    }
    
    // 没有按优先级找到，尝试任何可用的
    for (const id of Object.keys(getAllProviders())) {
      if (this.isAvailable(id)) {
        console.log(`[ProviderManager] Fallback to provider: ${id}`);
        return this.getOrCreateInstance(id);
      }
    }
    
    console.error('[ProviderManager] No available provider!');
    return null;
  }

  /**
   * 翻译文本（带自动 fallback）
   * @param {string} text - 要翻译的文本
   * @param {string} sourceLang - 源语言
   * @param {string} targetLang - 目标语言
   * @param {object} options - 选项
   * @returns {Promise<{success: boolean, text?: string, error?: string, provider?: string}>}
   */
  async translate(text, sourceLang = 'auto', targetLang = 'zh', options = {}) {
    const { mode = this.currentMode, enableFallback = true } = options;
    const priority = this.getPriority();
    const tried = [];
    
    for (const id of priority) {
      if (!this.isAvailable(id)) continue;
      
      const provider = this.getOrCreateInstance(id);
      tried.push(id);
      
      try {
        console.log(`[ProviderManager] Trying provider: ${id}`);
        const result = await provider.translate(text, sourceLang, targetLang);
        
        if (result.success) {
          return { ...result, provider: id };
        }
        
        console.warn(`[ProviderManager] Provider ${id} failed:`, result.error);
        
        if (!enableFallback) {
          return { ...result, provider: id };
        }
      } catch (error) {
        console.error(`[ProviderManager] Provider ${id} threw error:`, error);
        
        if (!enableFallback) {
          return { success: false, error: error.message, provider: id };
        }
      }
    }
    
    return {
      success: false,
      error: `所有翻译源均失败 (尝试了: ${tried.join(', ')})`,
      provider: null,
    };
  }

  /**
   * 流式翻译（带自动 fallback）
   */
  async translateStream(text, sourceLang, targetLang, onChunk, options = {}) {
    const { mode = this.currentMode, enableFallback = true } = options;
    const priority = this.getPriority();
    
    for (const id of priority) {
      if (!this.isAvailable(id)) continue;
      
      const provider = this.getOrCreateInstance(id);
      
      try {
        console.log(`[ProviderManager] Trying stream provider: ${id}`);
        const result = await provider.translateStream(text, sourceLang, targetLang, onChunk);
        
        if (result.success) {
          return { ...result, provider: id };
        }
        
        if (!enableFallback) {
          return { ...result, provider: id };
        }
      } catch (error) {
        console.error(`[ProviderManager] Stream provider ${id} error:`, error);
        
        if (!enableFallback) {
          return { success: false, error: error.message, provider: id };
        }
      }
    }
    
    return { success: false, error: '所有翻译源均失败' };
  }

  /**
   * 测试指定翻译源连接
   * @param {string} id - 翻译源 ID
   * @returns {Promise<{success: boolean, message?: string}>}
   */
  async testProvider(id) {
    const provider = this.getOrCreateInstance(id);
    if (!provider) {
      return { success: false, message: '翻译源不存在' };
    }
    
    if (!provider.isConfigured()) {
      const missing = provider.getMissingConfig();
      return { success: false, message: `缺少配置: ${missing.join(', ')}` };
    }
    
    return provider.testConnection();
  }

  /**
   * 获取所有翻译源状态
   * @returns {Array<{id, name, icon, configured, available}>}
   */
  getProvidersStatus() {
    const metadata = getAllProviderMetadata();
    
    return metadata.map(meta => {
      const instance = this.instances[meta.id];
      const configured = instance ? instance.isConfigured() : false;
      
      return {
        ...meta,
        configured,
        available: configured,
        config: this.configs[meta.id] || {},
      };
    });
  }

  /**
   * 导出配置（用于保存）
   */
  exportConfig() {
    return {
      providers: this.configs,
      priority: this.userPriority,
    };
  }

  /**
   * 导入配置（用于加载）
   */
  importConfig(config) {
    this.configs = config.providers || {};
    this.userPriority = config.priority || null;
    
    // 更新所有实例
    for (const [id, instance] of Object.entries(this.instances)) {
      if (this.configs[id]) {
        instance.updateConfig(this.configs[id]);
      }
    }
  }
}

// 单例导出
const providerManager = new ProviderManager();

export default providerManager;
export { ProviderManager };
