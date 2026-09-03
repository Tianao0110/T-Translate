// External TTS endpoint: the OpenAI-compatible `POST /v1/audio/speech`
// contract that local servers (kokoro-fastapi, IndexTTS / GPT-SoVITS /
// CosyVoice wrappers) and OpenAI itself all speak. Lives in the stack so the
// request goes through rtFetch (system proxy) and the key through the vault;
// the renderer never sees the URL being hit or the key.
//
// Config comes from the host per call (loadConfig): { baseUrl, model, voice,
// apiKey } — apiKey decrypted main-side, null when the vault refuses (offline
// mode blocks the tts_endpoint_ prefix outright).

import { _t } from '../providers/base.js';
import { rtFetch } from '../runtime.js';

const REQUEST_TIMEOUT_MS = 60000;
const MAX_INPUT_CHARS = 4096; // OpenAI's own input ceiling
const DEFAULT_MODEL = 'tts-1';
const DEFAULT_VOICE = 'alloy';

function normalizeBaseUrl(raw) {
  const url = String(raw || '').trim().replace(/\/+$/, '');
  if (!url) return '';
  // Accept both "http://host:8880" and "http://host:8880/v1".
  return url.endsWith('/v1') ? url : `${url}/v1`;
}

export function isLoopbackUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
  } catch {
    return false;
  }
}

export class TtsEndpointClient {
  constructor({ loadConfig } = {}) {
    this._loadConfig = typeof loadConfig === 'function' ? loadConfig : async () => ({});
  }

  async _config() {
    const cfg = (await this._loadConfig()) || {};
    return {
      baseUrl: normalizeBaseUrl(cfg.baseUrl),
      model: String(cfg.model || '').trim() || DEFAULT_MODEL,
      voice: String(cfg.voice || '').trim() || DEFAULT_VOICE,
      apiKey: typeof cfg.apiKey === 'string' ? cfg.apiKey.trim() : '',
      timeout: Number.isFinite(cfg.timeout) && cfg.timeout > 0 ? cfg.timeout : REQUEST_TIMEOUT_MS,
    };
  }

  // Configured = a base URL exists. Reachability is deliberately not probed
  // here (a probe on every settings render would hammer a server); speak()
  // degrades on failure instead.
  async getCapability() {
    const cfg = await this._config();
    if (!cfg.baseUrl) {
      return { available: false, reason: _t('ttsEndpoint.notConfigured', '未填写服务地址') };
    }
    return { available: true, baseUrl: cfg.baseUrl, model: cfg.model, voice: cfg.voice, local: isLoopbackUrl(cfg.baseUrl) };
  }

  /**
   * One utterance. Resolves { success, audio: ArrayBuffer, contentType } or
   * { success: false, error }. Never throws.
   */
  async speak({ text, voice, speed, signal } = {}) {
    const input = String(text || '').trim();
    if (!input) return { success: false, error: _t('providerError.emptyText', '文本为空') };
    const cfg = await this._config();
    if (!cfg.baseUrl) {
      return { success: false, error: _t('ttsEndpoint.notConfigured', '未填写服务地址'), notConfigured: true };
    }

    const body = {
      model: cfg.model,
      input: input.slice(0, MAX_INPUT_CHARS),
      voice: String(voice || '').trim() || cfg.voice,
      response_format: 'wav',
    };
    if (Number.isFinite(speed) && speed > 0 && speed !== 1) body.speed = Math.min(4, Math.max(0.25, speed));

    const headers = { 'Content-Type': 'application/json' };
    if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;

    if (signal?.aborted) return { success: false, error: _t('ttsEndpoint.cancelled', '已取消'), cancelled: true };
    const timeout = AbortSignal.timeout(cfg.timeout);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

    let res;
    try {
      res = await rtFetch(`${cfg.baseUrl}/audio/speech`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: combined,
      });
    } catch (e) {
      if (signal?.aborted) return { success: false, error: _t('ttsEndpoint.cancelled', '已取消'), cancelled: true };
      const timedOut = e?.name === 'TimeoutError' || timeout.aborted;
      return {
        success: false,
        error: timedOut
          ? _t('ttsEndpoint.timeout', '语音服务响应超时')
          : _t('ttsEndpoint.unreachable', '连不上语音服务：{{message}}', { message: e?.message || String(e) }),
      };
    }

    if (!res.ok) {
      let detail = '';
      try {
        detail = (await res.text()).slice(0, 200);
      } catch {
        // body unreadable — the status code is the message
      }
      if (res.status === 401 || res.status === 403) {
        return { success: false, error: _t('ttsEndpoint.unauthorized', '语音服务拒绝了密钥（HTTP {{status}}）', { status: res.status }) };
      }
      return {
        success: false,
        error: _t('ttsEndpoint.httpError', '语音服务返回 HTTP {{status}}：{{detail}}', { status: res.status, detail }),
      };
    }

    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json') || contentType.startsWith('text/')) {
      // A server that answers speech requests with JSON is telling us
      // something (wrong route, unsupported format) — surface it.
      let detail = '';
      try {
        detail = (await res.text()).slice(0, 200);
      } catch {
        // fall through with an empty detail
      }
      return { success: false, error: _t('ttsEndpoint.notAudio', '语音服务没有返回音频：{{detail}}', { detail }) };
    }

    let audio;
    try {
      audio = await res.arrayBuffer();
    } catch (e) {
      return { success: false, error: _t('ttsEndpoint.unreachable', '连不上语音服务：{{message}}', { message: e?.message || String(e) }) };
    }
    if (!audio || audio.byteLength < 64) {
      return { success: false, error: _t('ttsEndpoint.notAudio', '语音服务没有返回音频：{{detail}}', { detail: `${audio ? audio.byteLength : 0} bytes` }) };
    }
    return { success: true, audio, contentType: contentType || 'audio/wav' };
  }

  // Settings-page test: a short synthesis is the only honest reachability
  // check (there is no standard "are you a TTS server" route).
  async test(config = {}) {
    const client = new TtsEndpointClient({ loadConfig: async () => ({ ...(await this._loadConfig()), ...config }) });
    const t0 = Date.now();
    const result = await client.speak({ text: config.sampleText || 'This is a test.', voice: config.voice });
    return result.success
      ? { success: true, ms: Date.now() - t0, bytes: result.audio.byteLength, audio: result.audio, contentType: result.contentType }
      : result;
  }
}

export default TtsEndpointClient;
