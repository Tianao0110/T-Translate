// src/services/tts/web-speech.js
// Web Speech API TTS 引擎 - 浏览器原生支持

import { BaseTTSEngine, TTS_STATUS } from './base.js';

/**
 * Web Speech API TTS 引擎
 * 使用浏览器原生的 SpeechSynthesis API
 */
export class WebSpeechEngine extends BaseTTSEngine {
  static metadata = {
    id: 'web-speech',
    name: 'Web Speech API',
    description: '浏览器原生语音合成，免费无需配置',
    type: 'local',
    isOnline: false,
    supportedLanguages: ['*'],  // 取决于系统安装的语音包
    configSchema: {},
  };

  constructor(config = {}) {
    super({
      defaultRate: 1,
      defaultPitch: 1,
      defaultVolume: 1,
      ...config,
    });
    
    this._synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
    this._voices = [];
    this._voicesLoaded = false;
    this._voicesPromise = null;
    
    // 加载语音列表
    if (this._synth) {
      this._voicesPromise = this._loadVoicesAsync();
    }
  }

  /**
   * 异步加载语音列表
   * @private
   */
  async _loadVoicesAsync() {
    if (!this._synth) return [];
    
    // 先尝试直接获取
    let voices = this._synth.getVoices();
    
    // 如果为空，等待 voiceschanged 事件
    if (!voices.length) {
      voices = await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          resolve(this._synth.getVoices());
        }, 1000);
        
        const handler = () => {
          clearTimeout(timeout);
          this._synth.removeEventListener('voiceschanged', handler);
          resolve(this._synth.getVoices());
        };
        
        this._synth.addEventListener('voiceschanged', handler);
        
        // 再次尝试获取（某些浏览器需要）
        const retry = this._synth.getVoices();
        if (retry.length) {
          clearTimeout(timeout);
          this._synth.removeEventListener('voiceschanged', handler);
          resolve(retry);
        }
      });
    }
    
    this._voices = voices;
    this._voicesLoaded = true;
    console.log('[TTS] Loaded', voices.length, 'voices');
    return voices;
  }

  /**
   * 检查引擎是否可用
   */
  async isAvailable() {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  /**
   * 获取可用的语音列表
   */
  async getVoices() {
    // 等待语音加载完成
    if (this._voicesPromise) {
      await this._voicesPromise;
    }
    
    return this._voices.map(voice => ({
      id: voice.voiceURI,
      name: voice.name,
      lang: voice.lang,
      localService: voice.localService,
      default: voice.default,
    }));
  }

  /**
   * 简单的文本语言检测
   * @private
   */
  _detectLanguage(text) {
    if (!text) return null;
    
    // 检测中文
    if (/[\u4e00-\u9fa5]/.test(text)) {
      return 'zh';
    }
    // 检测日文（平假名、片假名）
    if (/[\u3040-\u309f\u30a0-\u30ff]/.test(text)) {
      return 'ja';
    }
    // 检测韩文
    if (/[\uac00-\ud7af]/.test(text)) {
      return 'ko';
    }
    // 检测俄文
    if (/[\u0400-\u04ff]/.test(text)) {
      return 'ru';
    }
    // 检测阿拉伯文
    if (/[\u0600-\u06ff]/.test(text)) {
      return 'ar';
    }
    // 默认英文
    return 'en';
  }

  /**
   * 根据语言代码查找最佳语音
   * @private
   */
  _findVoice(lang, voiceId, text = '') {
    if (!this._voices.length) {
      return null;
    }
    
    // 如果指定了 voiceId，优先使用
    if (voiceId) {
      const voice = this._voices.find(v => v.voiceURI === voiceId || v.name === voiceId);
      if (voice) return voice;
    }
    
    // 处理 'auto' 语言 - 通过文本检测
    let actualLang = lang;
    if (!lang || lang === 'auto') {
      actualLang = this._detectLanguage(text);
    }
    
    // 根据语言查找
    if (actualLang) {
      const langLower = actualLang.toLowerCase();
      
      // 精确匹配
      let voice = this._voices.find(v => v.lang.toLowerCase() === langLower);
      if (voice) return voice;
      
      // 前缀匹配（如 'zh' 匹配 'zh-CN'）
      voice = this._voices.find(v => v.lang.toLowerCase().startsWith(langLower + '-'));
      if (voice) return voice;
      
      // 包含匹配
      voice = this._voices.find(v => v.lang.toLowerCase().startsWith(langLower));
      if (voice) return voice;
      
      // 语言代码映射（扩展版）
      const langMap = {
        'zh': ['zh-CN', 'zh-TW', 'zh-HK', 'cmn', 'yue'],
        'zh-hans': ['zh-CN'],
        'zh-hant': ['zh-TW', 'zh-HK'],
        'en': ['en-US', 'en-GB', 'en-AU', 'en-IN'],
        'ja': ['ja-JP', 'ja'],
        'ko': ['ko-KR', 'ko'],
        'fr': ['fr-FR', 'fr-CA', 'fr'],
        'de': ['de-DE', 'de-AT', 'de'],
        'es': ['es-ES', 'es-MX', 'es'],
        'ru': ['ru-RU', 'ru'],
        'pt': ['pt-BR', 'pt-PT', 'pt'],
        'it': ['it-IT', 'it'],
        'ar': ['ar-SA', 'ar'],
      };
      
      const variants = langMap[langLower];
      if (variants) {
        for (const variant of variants) {
          voice = this._voices.find(v => 
            v.lang.toLowerCase() === variant.toLowerCase() ||
            v.lang.toLowerCase().startsWith(variant.toLowerCase())
          );
          if (voice) return voice;
        }
      }
    }
    
    // 返回默认语音
    return this._voices.find(v => v.default) || this._voices[0];
  }

  /**
   * 朗读文本
   */
  async speak(text, options = {}) {
    if (!this._synth) {
      throw new Error('SpeechSynthesis not available');
    }
    
    if (!text?.trim()) {
      return;
    }
    
    // 确保语音已加载
    if (this._voicesPromise) {
      await this._voicesPromise;
    }
    
    // 停止当前朗读，并等待一小段时间确保完全停止
    if (this._synth.speaking || this._synth.pending) {
      this.stop();
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    const {
      lang,
      voiceId,
      rate = this.config.defaultRate,
      pitch = this.config.defaultPitch,
      volume = this.config.defaultVolume,
    } = options;
    
    return new Promise((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance(text);
      
      // 设置语音（传入text用于自动检测语言）
      const voice = this._findVoice(lang, voiceId, text);
      if (voice) {
        utterance.voice = voice;
        utterance.lang = voice.lang;
      } else if (lang && lang !== 'auto') {
        utterance.lang = lang;
      }
      
      // 设置参数
      utterance.rate = Math.max(0.1, Math.min(10, rate));
      utterance.pitch = Math.max(0, Math.min(2, pitch));
      utterance.volume = Math.max(0, Math.min(1, volume));
      
      // 事件处理
      utterance.onstart = () => {
        this._setStatus(TTS_STATUS.SPEAKING);
      };
      
      utterance.onend = () => {
        this._setStatus(TTS_STATUS.IDLE);
        this._currentUtterance = null;
        resolve();
      };
      
      utterance.onerror = (event) => {
        console.error('[TTS] Error:', event.error);
        this._setStatus(TTS_STATUS.ERROR);
        this._currentUtterance = null;
        // 某些错误不需要 reject（如 canceled）
        if (event.error === 'canceled' || event.error === 'interrupted') {
          resolve();
        } else {
          reject(new Error(event.error || 'Speech synthesis error'));
        }
      };
      
      utterance.onpause = () => {
        this._setStatus(TTS_STATUS.PAUSED);
      };
      
      utterance.onresume = () => {
        this._setStatus(TTS_STATUS.SPEAKING);
      };
      
      this._currentUtterance = utterance;
      
      // Chrome 有时会卡住，需要先 cancel
      this._synth.cancel();
      
      // 延迟一帧再播放（解决某些浏览器的问题）
      setTimeout(() => {
        this._synth.speak(utterance);
      }, 10);
    });
  }

  /**
   * 暂停朗读
   */
  pause() {
    if (this._synth && this._status === TTS_STATUS.SPEAKING) {
      this._synth.pause();
    }
  }

  /**
   * 恢复朗读
   */
  resume() {
    if (this._synth && this._status === TTS_STATUS.PAUSED) {
      this._synth.resume();
    }
  }

  /**
   * 停止朗读
   */
  stop() {
    if (this._synth) {
      this._synth.cancel();
      this._setStatus(TTS_STATUS.IDLE);
      this._currentUtterance = null;
    }
  }

  /**
   * 释放资源
   */
  dispose() {
    this.stop();
    super.dispose();
  }
}

export default WebSpeechEngine;
