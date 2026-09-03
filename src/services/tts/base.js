export const TTS_STATUS = {
  IDLE: 'idle',
  SPEAKING: 'speaking',
  PAUSED: 'paused',
  ERROR: 'error',
};

export class BaseTTSEngine {
  static metadata = {
    id: 'base',
    name: 'Base TTS',
    description: '',
    type: 'local',
    isOnline: false,
    supportedLanguages: [],
    configSchema: {},
  };

  constructor(config = {}) {
    this.config = config;
    this._status = TTS_STATUS.IDLE;
    this._currentUtterance = null;
    // Multi-listener: a single slot let whichever component subscribed last
    // silently evict the others (main panel status died once Settings opened).
    this._statusListeners = new Set();
    this._onProgress = null;
  }

  get status() {
    return this._status;
  }

  // Returns an unsubscribe function so callers can clean up on unmount.
  onStatusChange(callback) {
    this._statusListeners.add(callback);
    return () => this._statusListeners.delete(callback);
  }

  onProgress(callback) {
    this._onProgress = callback;
  }

  // TTSManager pushes rate/pitch/volume changes here; engines read them on
  // the next speak. No engine defined this, so the first settings change with
  // a live engine threw "updateConfig is not a function".
  updateConfig(config = {}) {
    this.config = { ...this.config, ...config };
  }

  _setStatus(status) {
    this._status = status;
    for (const cb of this._statusListeners) {
      try { cb(status); } catch { /* one bad listener shouldn't break the rest */ }
    }
  }

  async isAvailable() {
    throw new Error('Not implemented: isAvailable');
  }

  async getVoices() {
    throw new Error('Not implemented: getVoices');
  }

  async speak(text, options = {}) {
    throw new Error('Not implemented: speak');
  }

  pause() {
    throw new Error('Not implemented: pause');
  }

  resume() {
    throw new Error('Not implemented: resume');
  }

  stop() {
    throw new Error('Not implemented: stop');
  }

  dispose() {
    this.stop();
    this._statusListeners.clear();
    this._onProgress = null;
  }
}

export default BaseTTSEngine;
