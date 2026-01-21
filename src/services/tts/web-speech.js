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
    configSchema: {
      defaultRate: {
        type: 'number',
        label: '默认语速',
        default: 1,
        min: 0.5,
        max: 2,
        step: 0.1,
      },
      defaultPitch: {
        type: 'number',
        label: '默认音调',
        default: 1,
        min: 0.5,
        max: 2,
        step: 0.1,
      },
      defaultVolume: {
        type: 'number',
        label: '默认音量',
        default: 1,
        min: 0,
        max: 1,
        step: 0.1,
      },
    },
  };

  constructor(config = {}) {
    super({
      defaultRate: 1,
      defaultPitch: 1,
      defaultVolume: 1,
      ...config,
    });
    
    this._synth = window.speechSynthesis;
    this._voices = [];
    this._voicesLoaded = false;
    
    // 加载语音列表
    this._loadVoices();
    
    // 某些浏览器需要监听 voiceschanged 事件
    if (this._synth) {
      this._synth.onvoiceschanged = () => this._loadVoices();
    }
  }

  /**
   * 加载可用语音列表
   * @private
   */
  _loadVoices() {
    if (!this._synth) return;
    
    this._voices = this._synth.getVoices();
    this._voicesLoaded = this._voices.length > 0;
  }

  /**
   * 检查引擎是否可用
   */
  async isAvailable() {
    return 'speechSynthesis' in window;
  }

  /**
   * 获取可用的语音列表
   */
  async getVoices() {
    // 等待语音加载
    if (!this._voicesLoaded) {
      await new Promise(resolve => {
        const checkVoices = () => {
          this._loadVoices();
          if (this._voicesLoaded) {
            resolve();
          } else {
            setTimeout(checkVoices, 100);
          }
        };
        checkVoices();
      });
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
   * 根据语言代码查找最佳语音
   * @private
   */
  _findVoice(lang, voiceId) {
    if (!this._voices.length) {
      this._loadVoices();
    }
    
    // 如果指定了 voiceId，优先使用
    if (voiceId) {
      const voice = this._voices.find(v => v.voiceURI === voiceId);
      if (voice) return voice;
    }
    
    // 根据语言查找
    if (lang) {
      // 精确匹配
      let voice = this._voices.find(v => v.lang.toLowerCase() === lang.toLowerCase());
      if (voice) return voice;
      
      // 前缀匹配（如 'zh' 匹配 'zh-CN'）
      voice = this._voices.find(v => v.lang.toLowerCase().startsWith(lang.toLowerCase()));
      if (voice) return voice;
      
      // 语言代码映射
      const langMap = {
        'zh': ['zh-CN', 'zh-TW', 'zh-HK'],
        'en': ['en-US', 'en-GB', 'en-AU'],
        'ja': ['ja-JP'],
        'ko': ['ko-KR'],
        'fr': ['fr-FR'],
        'de': ['de-DE'],
        'es': ['es-ES'],
        'ru': ['ru-RU'],
      };
      
      const variants = langMap[lang.toLowerCase()];
      if (variants) {
        for (const variant of variants) {
          voice = this._voices.find(v => v.lang.toLowerCase() === variant.toLowerCase());
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
    
    // 停止当前朗读
    this.stop();
    
    const {
      lang,
      voiceId,
      rate = this.config.defaultRate,
      pitch = this.config.defaultPitch,
      volume = this.config.defaultVolume,
    } = options;
    
    return new Promise((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance(text);
      
      // 设置语音
      const voice = this._findVoice(lang, voiceId);
      if (voice) {
        utterance.voice = voice;
        utterance.lang = voice.lang;
      } else if (lang) {
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
        this._setStatus(TTS_STATUS.ERROR);
        this._currentUtterance = null;
        reject(new Error(event.error || 'Speech synthesis error'));
      };
      
      utterance.onpause = () => {
        this._setStatus(TTS_STATUS.PAUSED);
      };
      
      utterance.onresume = () => {
        this._setStatus(TTS_STATUS.SPEAKING);
      };
      
      utterance.onboundary = (event) => {
        if (this._onProgress) {
          this._onProgress({
            charIndex: event.charIndex,
            charLength: event.charLength,
            word: text.substring(event.charIndex, event.charIndex + event.charLength),
          });
        }
      };
      
      this._currentUtterance = utterance;
      this._synth.speak(utterance);
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
    super.dispose();
    if (this._synth) {
      this._synth.onvoiceschanged = null;
    }
  }
}

export default WebSpeechEngine;
