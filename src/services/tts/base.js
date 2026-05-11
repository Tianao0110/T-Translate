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
    this._onStatusChange = null;
    this._onProgress = null;
  }

  get status() {
    return this._status;
  }

  onStatusChange(callback) {
    this._onStatusChange = callback;
  }

  onProgress(callback) {
    this._onProgress = callback;
  }

  _setStatus(status) {
    this._status = status;
    if (this._onStatusChange) {
      this._onStatusChange(status);
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
    this._onStatusChange = null;
    this._onProgress = null;
  }
}

export default BaseTTSEngine;
