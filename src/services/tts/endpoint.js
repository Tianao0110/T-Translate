// External TTS endpoint engine — an OpenAI-compatible `/v1/audio/speech`
// server (local IndexTTS / GPT-SoVITS / CosyVoice / kokoro-fastapi wrappers,
// or OpenAI itself). The request itself runs in the main process through the
// translation stack (system proxy, vaulted key, offline gate); this side only
// asks for bytes and plays them. Available while a server address is
// configured and the privacy mode is not offline.

import stackClient from '../stack-client.js';
import { BaseTTSEngine, TTS_STATUS } from './base.js';
import createLogger from '../../utils/logger.js';
const logger = createLogger('EndpointTTS');

let _requestSeq = 0;

export class EndpointTTSEngine extends BaseTTSEngine {
  static metadata = {
    id: 'endpoint',
    name: 'External TTS server',
    description: 'OpenAI-compatible /v1/audio/speech server',
    type: 'online',
    isOnline: true,
    supportedLanguages: [], // whatever the server speaks; no voice list standard
    configSchema: {},
  };

  constructor(config = {}) {
    super({ defaultRate: 1, defaultVolume: 1, ...config });
    this._ctx = null;
    this._source = null;
    this._activeRequestId = null;
  }

  async isAvailable() {
    if (!window.electron?.stack?.ttsSpeak) return false;
    try {
      const cap = await stackClient.getTtsCapability();
      return !!cap?.available;
    } catch {
      return false;
    }
  }

  // The voice is part of the server config (settings page), not a list.
  async getVoices() {
    return [];
  }

  async speak(text, options = {}) {
    if (!window.electron?.stack?.ttsSpeak) throw new Error('ENDPOINT_UNAVAILABLE');
    const clean = (text || '').trim();
    if (!clean) return;

    this._cancelActive();
    const requestId = `tts-ep-${++_requestSeq}`;
    this._activeRequestId = requestId;
    this._setStatus(TTS_STATUS.SPEAKING);

    try {
      const res = await stackClient.ttsSpeak({
        requestId,
        text: clean,
        speed: options.rate ?? this.config.defaultRate ?? 1,
      });
      if (this._activeRequestId !== requestId) return;
      if (!res?.success) {
        if (res?.cancelled) return;
        if (res?.code === 'OFFLINE_BLOCKED') throw new Error('ENDPOINT_OFFLINE');
        throw new Error(`ENDPOINT_FAILED:${res?.error || 'unknown'}`);
      }
      await this._play(res.audio, options.volume, requestId);
    } catch (e) {
      if (this._activeRequestId === requestId) {
        this._teardownAudio();
        this._setStatus(TTS_STATUS.ERROR);
      }
      logger.error('Endpoint TTS failed:', e);
      throw e;
    } finally {
      if (this._activeRequestId === requestId) {
        this._activeRequestId = null;
        this._teardownAudio();
        if (this._status !== TTS_STATUS.ERROR) this._setStatus(TTS_STATUS.IDLE);
      }
    }
  }

  async _play(audio, volume, requestId) {
    const ctx = new AudioContext();
    this._ctx = ctx;
    let buffer;
    try {
      // decodeAudioData detaches the buffer; copy so a retry could reuse it.
      buffer = await ctx.decodeAudioData(audio.slice(0));
    } catch (e) {
      throw new Error(`ENDPOINT_FAILED:undecodable audio (${e?.message || e})`);
    }
    if (this._activeRequestId !== requestId || this._ctx !== ctx) return;
    await new Promise((resolve) => {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const gain = ctx.createGain();
      gain.gain.value = volume ?? this.config.defaultVolume ?? 1;
      source.connect(gain);
      gain.connect(ctx.destination);
      source.onended = resolve;
      this._source = source;
      source.start();
    });
  }

  _teardownAudio() {
    if (this._source) {
      try {
        this._source.onended = null;
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
  }

  // Drop the in-flight request (aborting the HTTP call main-side) and any
  // playback without announcing IDLE; stop() is the one that does.
  _cancelActive() {
    if (this._activeRequestId) {
      stackClient.abortRequest(this._activeRequestId);
      this._activeRequestId = null;
    }
    this._teardownAudio();
  }

  pause() {
    this._ctx?.suspend().catch(() => {});
    this._setStatus(TTS_STATUS.PAUSED);
  }

  resume() {
    this._ctx?.resume().catch(() => {});
    this._setStatus(TTS_STATUS.SPEAKING);
  }

  stop() {
    this._cancelActive();
    this._setStatus(TTS_STATUS.IDLE);
  }
}

export default EndpointTTSEngine;
