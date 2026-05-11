// Encrypted storage for API keys. Electron: uses safeStorage IPC.
// Browser: falls back to Base64 (NOT secure — dev/demo only).

import createLogger from './logger.js';
const logger = createLogger('SecureStorage');

class SecureStorage {
  constructor() {
    this._cache = new Map();
  }

  get isElectron() {
    return !!(window.electron?.secureStorage);
  }

  async set(key, value) {
    if (!value) {
      await this.delete(key);
      return true;
    }

    try {
      if (this.isElectron) {
        await window.electron.secureStorage.encrypt(key, value);
      } else {
        const encoded = btoa(encodeURIComponent(value));
        localStorage.setItem(`__secure_${key}`, encoded);
      }

      this._cache.set(key, value);
      return true;
    } catch (error) {
      logger.error('Failed to set:', error);
      return false;
    }
  }

  async get(key) {
    if (this._cache.has(key)) {
      return this._cache.get(key);
    }

    try {
      let value = null;

      if (this.isElectron) {
        value = await window.electron.secureStorage.decrypt(key);
      } else {
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
      logger.error('Failed to get:', error);
      return null;
    }
  }

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
      logger.error('Failed to delete:', error);
      return false;
    }
  }

  async has(key) {
    const value = await this.get(key);
    return value !== null;
  }

  clearCache() {
    this._cache.clear();
  }

  async setMany(data) {
    const results = await Promise.all(
      Object.entries(data).map(([key, value]) => this.set(key, value))
    );
    return results.every(Boolean);
  }

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

const secureStorage = new SecureStorage();

export default secureStorage;
export { SecureStorage };
