// Web Speech API TTS engine — uses the browser's built-in SpeechSynthesis.

import { BaseTTSEngine, TTS_STATUS } from './base.js';
import createLogger from '../../utils/logger.js';
const logger = createLogger('WebSpeech');

export class WebSpeechEngine extends BaseTTSEngine {
  static metadata = {
    id: 'web-speech',
    name: 'Web Speech API',
    description: '浏览器原生语音合成，免费无需配置',
    type: 'local',
    isOnline: false,
    supportedLanguages: ['*'], // depends on installed OS voice packs
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

    if (this._synth) {
      this._voicesPromise = this._loadVoicesAsync();
    }
  }

  // Voice list loads asynchronously on first SpeechSynthesis use. Some platforms
  // populate immediately, others fire 'voiceschanged' later. Electron is the
  // worst case and needs a few retries.
  async _loadVoicesAsync() {
    if (!this._synth) return [];

    let voices = this._synth.getVoices();
    if (voices.length) {
      this._voices = voices;
      this._voicesLoaded = true;
      logger.info('[TTS] Loaded', voices.length, 'voices (immediate)');
      return voices;
    }

    // Wait up to 3s for the voiceschanged event
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

    // Electron sometimes returns [] right after voiceschanged; poll briefly
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

  async isAvailable() {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  async getVoices() {
    if (this._voicesPromise) {
      await this._voicesPromise;
    }

    // One more attempt for the edge case where the initial load returned empty
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

  getInstalledLanguages() {
    const langs = new Set();
    for (const voice of this._voices) {
      langs.add(voice.lang.split('-')[0].toLowerCase());
    }
    return [...langs];
  }

  hasVoiceForLanguage(lang) {
    if (!lang || lang === 'auto') return this._voices.length > 0;
    const langLower = lang.toLowerCase();
    return this._voices.some(v => {
      const vLang = v.lang.toLowerCase();
      return vLang === langLower || vLang.startsWith(langLower + '-');
    });
  }

  _detectLanguage(text) {
    if (!text) return null;

    if (/[一-龥]/.test(text)) return 'zh';
    if (/[぀-ゟ゠-ヿ]/.test(text)) return 'ja';
    if (/[가-힯]/.test(text)) return 'ko';
    if (/[Ѐ-ӿ]/.test(text)) return 'ru';
    if (/[؀-ۿ]/.test(text)) return 'ar';
    return 'en';
  }

  // Voice picking: explicit voiceId > exact lang match > prefix > region variants.
  // Returns null voice when nothing matches so caller can surface the right error.
  _findVoice(lang, voiceId, text = '') {
    if (!this._voices.length) {
      return { voice: null, lang: lang || 'en' };
    }

    if (voiceId) {
      const voice = this._voices.find(v => v.voiceURI === voiceId || v.name === voiceId);
      if (voice) return { voice, lang: voice.lang.split('-')[0] };
    }

    let actualLang = lang;
    if (!lang || lang === 'auto') {
      actualLang = this._detectLanguage(text);
    }

    if (actualLang) {
      const langLower = actualLang.toLowerCase();

      let voice = this._voices.find(v => v.lang.toLowerCase() === langLower);
      if (voice) return { voice, lang: actualLang };

      voice = this._voices.find(v => v.lang.toLowerCase().startsWith(langLower + '-'));
      if (voice) return { voice, lang: actualLang };

      voice = this._voices.find(v => v.lang.toLowerCase().startsWith(langLower));
      if (voice) return { voice, lang: actualLang };

      // Maps bare lang codes to common BCP-47 region variants the OS may ship
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

    return { voice: null, lang: actualLang || 'en' };
  }

  async speak(text, options = {}) {
    if (!this._synth) {
      throw new Error('SpeechSynthesis not available');
    }

    if (!text?.trim()) {
      return;
    }

    if (this._voicesPromise) {
      await this._voicesPromise;
    }

    // Cancel + tiny delay; speaking on top of an active utterance is racy on Chrome/Edge
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
      const { voice, lang: detectedLang } = this._findVoice(lang, voiceId, text);

      if (!voice) {
        // NO_VOICES vs NO_VOICE_FOR_LANG so caller can show distinct UI hints
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

      // Clamp to spec ranges (out-of-range values fail silently on some engines)
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
        // canceled/interrupted = user stopped us, not a real failure
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

      // Tiny delay after cancel — some engines drop utterances queued too quickly
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
