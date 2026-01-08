// src/services/cache.js
// 翻译缓存服务 - 独立模块
//
// 职责：
// - 缓存翻译结果
// - 支持 TTL 过期
// - 容量管理
// - 持久化到 localStorage

/**
 * 翻译缓存管理器
 */
class TranslationCache {
  constructor(options = {}) {
    this.storageKey = options.storageKey || 'translation-cache';
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
   * 生成缓存键
   */
  generateKey(text, from, to, template = 'natural') {
    // 使用文本的前100个字符 + 长度 作为 key
    const textKey = text.length > 100 
      ? text.substring(0, 100) + '_' + text.length 
      : text;
    return `${from}-${to}-${template}-${textKey}`;
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

// 单例导出
const translationCache = new TranslationCache();

export default translationCache;
export { TranslationCache };
