// Neural TTS engine shell — plays PCM synthesized by the audio-engine
// utilityProcess (sherpa-onnx voice packs). The full path lands in v0.4.x;
// until the preload exposes the bridge and a voice pack is installed,
// isAvailable() is false and the manager falls back to web-speech.
//
// Bridge contract (implemented v0.4.x, preload `window.electron.audioEngine`):
//   ttsStatus():   Promise<{available: boolean}>        voice pack present?
//   ttsVoices():   Promise<Array<{id, name, lang}>>     installed voices
//   ttsGenerate({id, text, sid, speed}):
//                  Promise<{samples: Float32Array, sampleRate: number}>
//   ttsCancel({id}): void   drop an in-flight generation's result
// Worker side already speaks this protocol (audio-worker.js tts-* slot).
// ⚠ Worker implementation note: TtsRequest.enableExternalBuffer MUST be false
// (Electron V8 cage — same landmine as Vad.front).

import { BaseTTSEngine, TTS_STATUS } from './base.js';
import createLogger from '../../utils/logger.js';
const logger = createLogger('NeuralTTS');

let _requestSeq = 0;

export class NeuralTTSEngine extends BaseTTSEngine {
  static metadata = {
    id: 'neural',
    name: 'Neural TTS',
    description: 'Local neural voices (downloadable packs)',
    type: 'local',
    isOnline: false,
    supportedLanguages: [], // reported per installed pack via getVoices()
    configSchema: {},
  };

  constructor(config = {}) {
    super({
      defaultRate: 1,
      defaultVolume: 1,
      ...config,
    });
    this._ctx = null;
    this._source = null;
    this._activeRequestId = null;
  }

  _bridge() {
    return window.electron?.audioEngine || null;
  }

  async isAvailable() {
    const bridge = this._bridge();
    if (!bridge?.ttsGenerate || !bridge?.ttsStatus) return false;
    try {
      const status = await bridge.ttsStatus();
      return !!status?.available;
    } catch {
      return false;
    }
  }

  async getVoices() {
    const bridge = this._bridge();
    if (!bridge?.ttsVoices) return [];
    try {
      const voices = await bridge.ttsVoices();
      return Array.isArray(voices) ? voices : [];
    } catch {
      return [];
    }
  }

  async speak(text, options = {}) {
    const bridge = this._bridge();
    if (!bridge?.ttsGenerate) throw new Error('NEURAL_UNAVAILABLE');
    if (!text?.trim()) return;

    this.stop();
    const requestId = `tts-${++_requestSeq}`;
    this._activeRequestId = requestId;
    this._setStatus(TTS_STATUS.SPEAKING);

    try {
      // rate maps to sherpa's generation-time speed (better quality than
      // resampling on playback); pitch is not supported by sherpa TTS.
      const result = await bridge.ttsGenerate({
        id: requestId,
        text,
        sid: options.voiceId || '',
        speed: options.rate ?? this.config.defaultRate ?? 1,
      });

      // A newer speak()/stop() superseded this request while it synthesized.
      if (this._activeRequestId !== requestId) return;
      if (!result?.samples?.length || !result.sampleRate) {
        throw new Error('NEURAL_EMPTY_RESULT');
      }

      await this._playPcm(result.samples, result.sampleRate, options.volume);
    } catch (e) {
      this._setStatus(TTS_STATUS.ERROR);
      logger.error('Neural TTS failed:', e);
      throw e;
    } finally {
      if (this._activeRequestId === requestId) {
        this._activeRequestId = null;
        if (this._status !== TTS_STATUS.ERROR) this._setStatus(TTS_STATUS.IDLE);
      }
    }
  }

  _playPcm(samples, sampleRate, volume) {
    return new Promise((resolve, reject) => {
      try {
        const ctx = new AudioContext();
        const buffer = ctx.createBuffer(1, samples.length, sampleRate);
        buffer.copyToChannel(
          samples instanceof Float32Array ? samples : Float32Array.from(samples),
          0
        );
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        const gain = ctx.createGain();
        gain.gain.value = volume ?? this.config.defaultVolume ?? 1;
        source.connect(gain);
        gain.connect(ctx.destination);
        source.onended = () => {
          if (this._ctx === ctx) {
            this._ctx = null;
            this._source = null;
          }
          ctx.close().catch(() => {});
          resolve();
        };
        this._ctx = ctx;
        this._source = source;
        source.start();
      } catch (e) {
        reject(e);
      }
    });
  }

  pause() {
    // AudioContext.suspend keeps the buffer position.
    this._ctx?.suspend().catch(() => {});
    this._setStatus(TTS_STATUS.PAUSED);
  }

  resume() {
    this._ctx?.resume().catch(() => {});
    this._setStatus(TTS_STATUS.SPEAKING);
  }

  stop() {
    if (this._activeRequestId) {
      // Generation cannot be interrupted worker-side; cancel = drop the result.
      this._bridge()?.ttsCancel?.({ id: this._activeRequestId });
      this._activeRequestId = null;
    }
    if (this._source) {
      try {
        this._source.stop();
      } catch {
        // already stopped
      }
      this._source = null;
    }
    if (this._ctx) {
      this._ctx.close().catch(() => {});
      this._ctx = null;
    }
    this._setStatus(TTS_STATUS.IDLE);
  }
}

export default NeuralTTSEngine;
