// Base class for all OCR engines.

export { _t } from '../base.js';

export class BaseOCREngine {
  constructor(config = {}) {
    this.config = config;
    this._initialized = false;
  }

  static metadata = {
    id: 'base',
    name: 'Base OCR',
    description: '',
    type: 'local',
    // tier: 1=preferred local, 2=vision LLM, 3=online API
    tier: 1,
    priority: 0,
    isOnline: false,
  };

  async init() {
    this._initialized = true;
    return { success: true };
  }

  async recognize(input, options = {}) {
    throw new Error('recognize() must be implemented by subclass');
  }

  async isAvailable() {
    return true;
  }

  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
  }

  // Accepts: data: URL (passthrough), bare base64 (wrap), or binary (encode)
  ensureBase64(input) {
    if (typeof input === 'string') {
      if (input.startsWith('data:')) {
        return input;
      }
      return `data:image/png;base64,${input}`;
    }

    if (input instanceof Uint8Array || input instanceof ArrayBuffer) {
      const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : input;
      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return `data:image/png;base64,${btoa(binary)}`;
    }

    return input;
  }

  cleanText(text) {
    if (!text) return '';

    return text
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
}

export default BaseOCREngine;
