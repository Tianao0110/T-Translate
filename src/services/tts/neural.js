// Neural TTS engine — plays PCM synthesized by the audio-engine
// utilityProcess (sherpa-onnx voice packs). Available once the preload
// exposes the bridge and at least one voice pack is installed; otherwise the
// manager falls back to web-speech.
//
// Bridge (preload `window.electron.audioEngine`):
//   ttsStatus():   Promise<{available, packs, loaded}>
//   ttsVoices():   Promise<Array<{id:'pack:sid', packId, sid, lang, gender, n,
//                                 featured, preferMixed, languages, engine}>>
//   ttsGenerate({id, text, packId, sid, speed}): Promise<{success, error?}>
//   ttsCancel({id})
//   onTtsChunk(cb): cb({id, samples, sampleRate}) per sentence, then
//                   {id, done, cancelled} or {id, error}
// Audio is scheduled on one AudioContext as the chunks arrive, so playback
// starts at the first sentence instead of after the whole paragraph.

import i18n from 'i18next';
import { BaseTTSEngine, TTS_STATUS } from './base.js';
import { pickVoice, normalizeLang, detectTextLang } from '../../utils/tts-voice-pick.js';
import createLogger from '../../utils/logger.js';
const logger = createLogger('NeuralTTS');

let _requestSeq = 0;
// Small lead so the first buffer is not scheduled in the past.
const SCHEDULE_LEAD_S = 0.03;

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
    this._gain = null;
    this._sources = new Set();
    this._nextStartS = 0;
    this._activeRequestId = null;
    this._playback = null; // { resolve, reject, done }
    this._unsubChunk = null;
    this._voices = null;
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

  _voiceName(v) {
    const genderKey = v.gender === 'm' ? 'male' : 'female';
    // i18n may not be initialized where this runs (tests); the raw fields
    // still make a usable label.
    const lang = i18n.t(`tts.langNames.${v.lang}`, { defaultValue: v.lang }) || v.lang;
    const gender = i18n.t(`tts.neural.${genderKey}`, { defaultValue: genderKey }) || genderKey;
    const tag = i18n.t(`tts.neural.engineTag.${v.engine}`, { defaultValue: '' }) || '';
    const base = i18n.t('tts.neural.voiceName', { lang, gender, n: v.n, defaultValue: `${lang} ${gender} ${v.n}` }) || `${lang} ${gender} ${v.n}`;
    return tag ? `${base} · ${tag}` : base;
  }

  async getVoices() {
    const bridge = this._bridge();
    if (!bridge?.ttsVoices) return [];
    try {
      const voices = await bridge.ttsVoices();
      this._voices = Array.isArray(voices)
        ? voices.map((v) => ({ ...v, name: this._voiceName(v) }))
        : [];
    } catch {
      this._voices = [];
    }
    return this._voices;
  }

  _ensureChunkListener() {
    if (this._unsubChunk) return;
    const bridge = this._bridge();
    if (!bridge?.onTtsChunk) return;
    this._unsubChunk = bridge.onTtsChunk((data) => this._onChunk(data));
  }

  async speak(text, options = {}) {
    const bridge = this._bridge();
    if (!bridge?.ttsGenerate) throw new Error('NEURAL_UNAVAILABLE');
    const clean = (text || '').trim();
    if (!clean) return;

    this.stop();
    const voices = this._voices || (await this.getVoices());
    if (!voices.length) throw new Error('NO_VOICES');
    const voice = pickVoice(voices, { voiceId: options.voiceId, lang: options.lang, text: clean });
    if (!voice) {
      throw new Error(`NO_VOICE_FOR_LANG:${normalizeLang(options.lang) || detectTextLang(clean) || 'en'}`);
    }

    const requestId = `tts-${++_requestSeq}`;
    this._activeRequestId = requestId;
    this._setStatus(TTS_STATUS.SPEAKING);
    this._ensureChunkListener();
    this._openContext(options.volume);

    const playback = new Promise((resolve, reject) => {
      this._playback = { resolve, reject, done: false };
    });

    try {
      // rate maps to sherpa's generation-time speed (better quality than
      // resampling on playback); pitch is not supported by sherpa TTS.
      const res = await bridge.ttsGenerate({
        id: requestId,
        text: clean,
        packId: voice.packId,
        sid: voice.sid,
        speed: options.rate ?? this.config.defaultRate ?? 1,
      });
      if (this._activeRequestId !== requestId) return;
      if (!res?.success) throw new Error(`NEURAL_${res?.error || 'FAILED'}`);
      await playback;
    } catch (e) {
      if (this._activeRequestId === requestId) {
        this._teardownAudio();
        this._setStatus(TTS_STATUS.ERROR);
      }
      logger.error('Neural TTS failed:', e);
      throw e;
    } finally {
      if (this._activeRequestId === requestId) {
        this._activeRequestId = null;
        this._playback = null;
        this._teardownAudio();
        if (this._status !== TTS_STATUS.ERROR) this._setStatus(TTS_STATUS.IDLE);
      }
    }
  }

  _openContext(volume) {
    const ctx = new AudioContext();
    const gain = ctx.createGain();
    gain.gain.value = volume ?? this.config.defaultVolume ?? 1;
    gain.connect(ctx.destination);
    this._ctx = ctx;
    this._gain = gain;
    this._nextStartS = 0;
  }

  _onChunk(data) {
    if (!data || data.id !== this._activeRequestId || !this._playback) return;
    if (data.error) {
      this._playback.reject(new Error(`NEURAL_${data.error}`));
      return;
    }
    if (data.done) {
      this._playback.done = true;
      if (data.cancelled) this._playback.resolve();
      else this._maybeFinish();
      return;
    }
    if (!data.samples?.length || !data.sampleRate || !this._ctx) return;

    const samples = data.samples instanceof Float32Array ? data.samples : Float32Array.from(data.samples);
    const ctx = this._ctx;
    const buffer = ctx.createBuffer(1, samples.length, data.sampleRate);
    buffer.copyToChannel(samples, 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this._gain);
    const startAt = Math.max(this._nextStartS, ctx.currentTime + SCHEDULE_LEAD_S);
    this._nextStartS = startAt + buffer.duration;
    this._sources.add(source);
    source.onended = () => {
      this._sources.delete(source);
      this._maybeFinish();
    };
    source.start(startAt);
  }

  _maybeFinish() {
    if (this._playback?.done && this._sources.size === 0) this._playback.resolve();
  }

  _teardownAudio() {
    for (const source of this._sources) {
      try {
        source.onended = null;
        source.stop();
      } catch {
        // already stopped
      }
    }
    this._sources.clear();
    if (this._ctx) {
      this._ctx.close().catch(() => {});
      this._ctx = null;
      this._gain = null;
    }
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
      // Stops synthesis mid-text worker-side; whatever is queued is dropped.
      this._bridge()?.ttsCancel?.({ id: this._activeRequestId });
      this._activeRequestId = null;
    }
    if (this._playback) {
      this._playback.resolve();
      this._playback = null;
    }
    this._teardownAudio();
    this._setStatus(TTS_STATUS.IDLE);
  }

  dispose() {
    super.dispose();
    if (this._unsubChunk) {
      this._unsubChunk();
      this._unsubChunk = null;
    }
    this._voices = null;
  }
}

export default NeuralTTSEngine;
