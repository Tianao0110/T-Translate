// src/services/tts/web-speech.js
// Web Speech API TTS 引擎 - 浏览器原生支持

import { BaseTTSEngine, TTS_STATUS } from './base.js';
import createLogger from '../../utils/logger.js';
const logger = createLogger('WebSpeech');

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
   * 异步加载语音列表（带重试）
   * @private
   */
  async _loadVoicesAsync() {
    if (!this._synth) return [];
    
    // 先尝试直接获取
    let voices = this._synth.getVoices();
    if (voices.length) {
      this._voices = voices;
      this._voicesLoaded = true;
      logger.info('[TTS] Loaded', voices.length, 'voices (immediate)');
      return voices;
    }
    
    // 等待 voiceschanged 事件，最多 3 秒
    voices = await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this._synth.removeEventListener('voiceschanged', handler);
        resolve(this._synth.getVoices());
      }, 3000);
      
      const handler = () => {
        clearTimeout(timeout);
        this._synth.removeEventListener('voiceschanged', handler);
        resolve(this._synth.getVoices());
      };
      
      this._synth.addEventListener('voiceschanged', handler);
    });
    
    // 如果还是空，再重试几次（Electron 有时需要更久）
    if (!voices.length) {
      for (let i = 0; i < 3; i++) {
        await new Promise(r => setTimeout(r, 500));
        voices = this._synth.getVoices();
        if (voices.length) break;
      }
    }
    
    this._voices = voices;
    this._voicesLoaded = true;
    logger.info('[TTS] Loaded', voices.length, 'voices');
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
    
    // 如果之前加载为空，再尝试一次
    if (!this._voices.length && this._synth) {
      const retry = this._synth.getVoices();
      if (retry.length) {
        this._voices = retry;
        logger.info('[TTS] Late-loaded', retry.length, 'voices');
      }
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
   * 获取系统已安装的语言列表
   */
  getInstalledLanguages() {
    const langs = new Set();
    for (const voice of this._voices) {
      langs.add(voice.lang.split('-')[0].toLowerCase());
    }
    return [...langs];
  }

  /**
   * 检查某语言是否有可用语音
   * @param {string} lang - 语言代码
   * @returns {boolean}
   */
  hasVoiceForLanguage(lang) {
    if (!lang || lang === 'auto') return this._voices.length > 0;
    const langLower = lang.toLowerCase();
    return this._voices.some(v => {
      const vLang = v.lang.toLowerCase();
      return vLang === langLower || vLang.startsWith(langLower + '-');
    });
  }

  /**
   * 简单的文本语言检测
   * @private
   */
  _detectLanguage(text) {
    if (!text) return null;
    
    if (/[\u4e00-\u9fa5]/.test(text)) return 'zh';
    if (/[\u3040-\u309f\u30a0-\u30ff]/.test(text)) return 'ja';
    if (/[\uac00-\ud7af]/.test(text)) return 'ko';
    if (/[\u0400-\u04ff]/.test(text)) return 'ru';
    if (/[\u0600-\u06ff]/.test(text)) return 'ar';
    return 'en';
  }

  /**
   * 根据语言代码查找最佳语音
   * @private
   * @returns {{ voice: SpeechSynthesisVoice|null, lang: string }}
   */
  _findVoice(lang, voiceId, text = '') {
    if (!this._voices.length) {
      return { voice: null, lang: lang || 'en' };
    }
    
    // 如果指定了 voiceId，优先使用
    if (voiceId) {
      const voice = this._voices.find(v => v.voiceURI === voiceId || v.name === voiceId);
      if (voice) return { voice, lang: voice.lang.split('-')[0] };
    }
    
    // 处理 'auto' 语言 - 通过文本检测
    let actualLang = lang;
    if (!lang || lang === 'auto') {
      actualLang = this._detectLanguage(text);
    }
    
    if (actualLang) {
      const langLower = actualLang.toLowerCase();
      
      // 精确匹配
      let voice = this._voices.find(v => v.lang.toLowerCase() === langLower);
      if (voice) return { voice, lang: actualLang };
      
      // 前缀匹配
      voice = this._voices.find(v => v.lang.toLowerCase().startsWith(langLower + '-'));
      if (voice) return { voice, lang: actualLang };
      
      // 包含匹配
      voice = this._voices.find(v => v.lang.toLowerCase().startsWith(langLower));
      if (voice) return { voice, lang: actualLang };
      
      // 语言代码映射
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
          if (voice) return { voice, lang: actualLang };
        }
      }
    }
    
    // 未找到匹配，返回 null
    return { voice: null, lang: actualLang || 'en' };
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
    
    // 停止当前朗读
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
      // 查找语音
      const { voice, lang: detectedLang } = this._findVoice(lang, voiceId, text);
      
      if (!voice) {
        if (this._voices.length === 0) {
          reject(new Error('NO_VOICES'));
        } else {
          reject(new Error(`NO_VOICE_FOR_LANG:${detectedLang}`));
        }
        return;
      }

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.voice = voice;
      utterance.lang = voice.lang;
      
      // 设置参数
      utterance.rate = Math.max(0.1, Math.min(10, rate));
      utterance.pitch = Math.max(0, Math.min(2, pitch));
      utterance.volume = Math.max(0, Math.min(1, volume));
      
      utterance.onstart = () => {
        this._setStatus(TTS_STATUS.SPEAKING);
      };
      
      utterance.onend = () => {
        this._setStatus(TTS_STATUS.IDLE);
        this._currentUtterance = null;
        resolve();
      };
      
      utterance.onerror = (event) => {
        logger.error('[TTS] Error:', event.error);
        this._setStatus(TTS_STATUS.ERROR);
        this._currentUtterance = null;
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
      this._synth.cancel();
      
      setTimeout(() => {
        this._synth.speak(utterance);
      }, 10);
    });
  }

  pause() {
    if (this._synth && this._status === TTS_STATUS.SPEAKING) {
      this._synth.pause();
    }
  }

  resume() {
    if (this._synth && this._status === TTS_STATUS.PAUSED) {
      this._synth.resume();
    }
  }

  stop() {
    if (this._synth) {
      this._synth.cancel();
      this._setStatus(TTS_STATUS.IDLE);
      this._currentUtterance = null;
    }
  }

  dispose() {
    this.stop();
    super.dispose();
  }
}

export default WebSpeechEngine;
