// src/utils/secure-storage.js
// 安全存储模块 - 用于加密存储 API Key 等敏感信息

/**
 * 安全存储类
 * 在 Electron 环境中使用 safeStorage 加密
 * 在浏览器环境中使用 Base64 混淆（不安全，仅用于开发）
 */
class SecureStorage {
  constructor() {
    this._cache = new Map();  // 解密后的缓存
  }

  /**
   * 检查是否在 Electron 环境
   */
  get isElectron() {
    return !!(window.electron?.secureStorage);
  }

  /**
   * 加密并存储
   * @param {string} key - 存储键名
   * @param {string} value - 要存储的值
   * @returns {Promise<boolean>}
   */
  async set(key, value) {
    if (!value) {
      await this.delete(key);
      return true;
    }

    try {
      if (this.isElectron) {
        await window.electron.secureStorage.encrypt(key, value);
      } else {
        // 浏览器环境：使用 Base64 混淆（不安全）
        const encoded = btoa(encodeURIComponent(value));
        localStorage.setItem(`__secure_${key}`, encoded);
      }
      
      // 更新缓存
      this._cache.set(key, value);
      return true;
    } catch (error) {
      console.error('[SecureStorage] Failed to set:', error);
      return false;
    }
  }

  /**
   * 获取并解密
   * @param {string} key - 存储键名
   * @returns {Promise<string|null>}
   */
  async get(key) {
    // 先检查缓存
    if (this._cache.has(key)) {
      return this._cache.get(key);
    }

    try {
      let value = null;

      if (this.isElectron) {
        value = await window.electron.secureStorage.decrypt(key);
      } else {
        // 浏览器环境
        const encoded = localStorage.getItem(`__secure_${key}`);
        if (encoded) {
          value = decodeURIComponent(atob(encoded));
        }
      }

      if (value) {
        this._cache.set(key, value);
      }
      
      return value;
    } catch (error) {
      console.error('[SecureStorage] Failed to get:', error);
      return null;
    }
  }

  /**
   * 删除
   * @param {string} key - 存储键名
   * @returns {Promise<boolean>}
   */
  async delete(key) {
    try {
      if (this.isElectron) {
        await window.electron.secureStorage.delete(key);
      } else {
        localStorage.removeItem(`__secure_${key}`);
      }
      
      this._cache.delete(key);
      return true;
    } catch (error) {
      console.error('[SecureStorage] Failed to delete:', error);
      return false;
    }
  }

  /**
   * 检查是否存在
   * @param {string} key - 存储键名
   * @returns {Promise<boolean>}
   */
  async has(key) {
    const value = await this.get(key);
    return value !== null;
  }

  /**
   * 清除缓存
   */
  clearCache() {
    this._cache.clear();
  }

  /**
   * 批量设置
   * @param {Object} data - { key: value } 对象
   */
  async setMany(data) {
    const results = await Promise.all(
      Object.entries(data).map(([key, value]) => this.set(key, value))
    );
    return results.every(Boolean);
  }

  /**
   * 批量获取
   * @param {string[]} keys - 键名数组
   * @returns {Promise<Object>}
   */
  async getMany(keys) {
    const results = {};
    await Promise.all(
      keys.map(async (key) => {
        results[key] = await this.get(key);
      })
    );
    return results;
  }
}

// 单例导出
const secureStorage = new SecureStorage();

export default secureStorage;
export { SecureStorage };
