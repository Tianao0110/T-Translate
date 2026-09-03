// TTS service manager — single entrypoint over multiple engines.

import { TTS_STATUS } from './base.js';
import WebSpeechEngine from './web-speech.js';
import NeuralTTSEngine from './neural.js';
import createLogger from '../../utils/logger.js';
const logger = createLogger('TTSManager');

export { BaseTTSEngine, TTS_STATUS } from './base.js';
export { WebSpeechEngine } from './web-speech.js';
export { NeuralTTSEngine } from './neural.js';

const engines = {
  'web-speech': WebSpeechEngine,
  // Neural is offered only while its bridge exists and a voice pack is
  // installed (isAvailable); the settings page hides the engine picker
  // otherwise, so nothing in the UI claims it prematurely.
  'neural': NeuralTTSEngine,
};

// web-speech is the zero-download floor: always present, so a configured
// engine that lost its voice pack degrades honestly instead of erroring.
const FALLBACK_ENGINE_ID = 'web-speech';

export const DEFAULT_TTS_CONFIG = {
  enabled: true,
  engine: 'web-speech',
  rate: 1.0,
  pitch: 1.0,
  volume: 0.8,
  voiceId: '', // empty = auto-pick by language (system voices)
  voiceByLang: {}, // neural voices: { zh: 'pack:sid', en: 'pack:sid' }, missing = featured voice
};

class TTSManager {
  constructor() {
    this._engines = new Map();
    this._currentEngine = null;
    this._currentEngineId = null;
    this._config = { ...DEFAULT_TTS_CONFIG };
    // Fan-out sets so main panel + settings page can both observe without
    // stealing each other's single callback slot.
    this._statusListeners = new Set();
    this._configListeners = new Set();
    this._engineUnsub = null;
    this._fallbackEngine = null; // web-speech while it covers one utterance
    this._initialized = false;
  }

  async init(config = null) {
    if (this._initialized) return this;

    if (!config) {
      try {
        const stored = await window.electron?.store?.get('settings.tts');
        if (stored) {
          config = stored;
        }
      } catch (e) {}
    }

    this._config = { ...DEFAULT_TTS_CONFIG, ...config };

    if (this._config.enabled) {
      try {
        await this._setEngineWithFallback(this._config.engine || FALLBACK_ENGINE_ID);
      } catch (e) {
        logger.error('[TTS] Failed to init engine:', e);
      }
    }

    this._initialized = true;
    return this;
  }

  get config() {
    return { ...this._config };
  }

  get enabled() {
    return this._config.enabled;
  }

  async getEngine(engineId) {
    if (this._engines.has(engineId)) {
      return this._engines.get(engineId);
    }

    const EngineClass = engines[engineId];
    if (!EngineClass) {
      throw new Error(`Unknown TTS engine: ${engineId}`);
    }

    const engine = new EngineClass({
      defaultRate: this._config.rate,
      defaultPitch: this._config.pitch,
      defaultVolume: this._config.volume,
    });

    const available = await engine.isAvailable();
    if (!available) {
      throw new Error(`TTS engine not available: ${engineId}`);
    }

    this._engines.set(engineId, engine);
    return engine;
  }

  async setEngine(engineId) {
    // Stop any active playback on the old engine before swapping
    if (this._currentEngine) {
      this._currentEngine.stop();
    }
    if (this._engineUnsub) {
      this._engineUnsub();
      this._engineUnsub = null;
    }

    this._currentEngine = await this.getEngine(engineId);
    this._currentEngineId = engineId;

    // One internal forwarder from the engine to all manager-level listeners.
    this._engineUnsub = this._currentEngine.onStatusChange((status) => {
      for (const cb of this._statusListeners) {
        try { cb(status); } catch { /* isolate listeners */ }
      }
    });

    return this._currentEngine;
  }

  // The configured engine may be unavailable (neural without its voice pack).
  // Fall back to the floor engine WITHOUT touching _config.engine: the user's
  // choice survives, and _refreshConfig retries it on every speak, so the
  // engine comes back the moment its pack does.
  async _setEngineWithFallback(engineId) {
    try {
      return await this.setEngine(engineId);
    } catch (e) {
      if (engineId !== FALLBACK_ENGINE_ID) {
        logger.warn(`[TTS] Engine ${engineId} unavailable, falling back:`, e.message);
        return this.setEngine(FALLBACK_ENGINE_ID);
      }
      throw e;
    }
  }

  // Availability probe for the settings UI. Cached live instances answer for
  // their id; others get a throwaway probe instance.
  async listEngines() {
    const out = [];
    for (const [id, EngineClass] of Object.entries(engines)) {
      let available = false;
      try {
        const probe = this._engines.get(id) || new EngineClass({});
        available = await probe.isAvailable();
        if (!this._engines.has(id)) probe.dispose();
      } catch {
        available = false;
      }
      out.push({ id, available });
    }
    return out;
  }

  get currentEngine() {
    return this._currentEngine;
  }

  get currentEngineId() {
    return this._currentEngineId;
  }

  get status() {
    return this._currentEngine?.status || TTS_STATUS.IDLE;
  }

  onStatusChange(callback) {
    this._statusListeners.add(callback);
    return () => this._statusListeners.delete(callback);
  }

  // Notifies subscribers when the config (enabled/rate/voice/...) changes, so
  // e.g. the main panel's speak button appears/disappears the moment TTS is
  // toggled in settings instead of only after a restart.
  onConfigChange(callback) {
    this._configListeners.add(callback);
    return () => this._configListeners.delete(callback);
  }

  _emitConfigChange() {
    for (const cb of this._configListeners) {
      try { cb(this.config); } catch { /* isolate listeners */ }
    }
  }

  // Re-read persisted config before speaking. This window (especially the
  // persistent selection window) may hold a stale snapshot from its first
  // init; the store is the source of truth and a settings save writes it.
  async _refreshConfig() {
    try {
      const stored = await window.electron?.store?.get('settings.tts');
      if (!stored) return;
      const before = JSON.stringify(this._config);
      this._config = { ...DEFAULT_TTS_CONFIG, ...stored };
      if (before === JSON.stringify(this._config)) return;

      if (this._currentEngine) {
        this._currentEngine.updateConfig({
          defaultRate: this._config.rate,
          defaultPitch: this._config.pitch,
          defaultVolume: this._config.volume,
        });
      }
      if (this._currentEngineId && this._config.engine !== this._currentEngineId) {
        try { await this.setEngine(this._config.engine); } catch { /* keep old engine */ }
      }
      this._emitConfigChange();
    } catch { /* keep current config */ }
  }

  async getVoices() {
    if (!this._currentEngine) {
      await this._setEngineWithFallback(this._config.engine || FALLBACK_ENGINE_ID);
    }
    return this._currentEngine.getVoices();
  }

  async speak(text, options = {}) {
    // Lazy refresh so a settings change (enabled toggle, rate, voice) takes
    // effect on the next utterance without restarting this window.
    await this._refreshConfig();

    if (!this._config.enabled) {
      return;
    }

    if (!this._currentEngine) {
      await this._setEngineWithFallback(this._config.engine || FALLBACK_ENGINE_ID);
    }

    const mergedOptions = {
      rate: this._config.rate,
      pitch: this._config.pitch,
      volume: this._config.volume,
      voiceId: this._config.voiceId,
      voiceByLang: this._config.voiceByLang,
      ...options,
    };

    try {
      return await this._currentEngine.speak(text, mergedOptions);
    } catch (e) {
      // Per-utterance fallback: a neural pack that cannot read this language
      // (or lost its files) hands the sentence to the system voices instead
      // of failing it. The configured engine stays; the next utterance in a
      // covered language goes neural again.
      const msg = e?.message || '';
      const coverable = msg.startsWith('NO_VOICE_FOR_LANG:') || msg === 'NO_VOICES' || msg === 'NEURAL_UNAVAILABLE';
      if (!coverable || this._currentEngineId === FALLBACK_ENGINE_ID) throw e;
      logger.warn(`[TTS] ${this._currentEngineId} cannot read this text (${msg}); falling back to system voices`);
      return this._speakWithFallback(text, { ...mergedOptions, voiceId: '' });
    }
  }

  async _speakWithFallback(text, options) {
    const fallback = await this.getEngine(FALLBACK_ENGINE_ID);
    // Forward its status for the duration of the utterance so the speak
    // button tracks the voice that is actually talking.
    const unsub = fallback.onStatusChange((status) => {
      for (const cb of this._statusListeners) {
        try { cb(status); } catch { /* isolate listeners */ }
      }
    });
    this._fallbackEngine = fallback;
    try {
      return await fallback.speak(text, options);
    } finally {
      unsub();
      this._fallbackEngine = null;
    }
  }

  stop() {
    this._currentEngine?.stop();
    this._fallbackEngine?.stop();
  }

  async updateConfig(config, persist = true) {
    this._config = { ...this._config, ...config };

    if (this._currentEngine) {
      this._currentEngine.updateConfig({
        defaultRate: this._config.rate,
        defaultPitch: this._config.pitch,
        defaultVolume: this._config.volume,
      });
    }

    // Engine switch applies immediately when one is already live (settings
    // page test button); windows without a live engine keep lazy-switching
    // via _refreshConfig on their next speak.
    if (config.engine && this._currentEngine && config.engine !== this._currentEngineId) {
      try {
        await this._setEngineWithFallback(config.engine);
      } catch (e) {
        logger.error('[TTS] Engine switch failed:', e);
      }
    }

    if (persist) {
      try {
        await window.electron?.store?.set('settings.tts', this._config);
      } catch (e) {
        logger.error('[TTS] Failed to save config:', e);
      }
    }

    this._emitConfigChange();
  }

  dispose() {
    if (this._engineUnsub) {
      this._engineUnsub();
      this._engineUnsub = null;
    }
    for (const engine of this._engines.values()) {
      engine.dispose();
    }
    this._engines.clear();
    this._currentEngine = null;
    this._initialized = false;
  }
}

const ttsManager = new TTSManager();

export default ttsManager;
