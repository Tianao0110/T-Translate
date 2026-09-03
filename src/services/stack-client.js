// Renderer-side thin client for the main-process translation stack.
// Same-name API as the old services/translation.js singleton so orchestration
// layers switch by changing one import.
//
// privacyMode/useCache are GONE from this surface: the main-process facade
// reads the live mode per request and injects both — a call site cannot weaken
// SECURE/OFFLINE anymore. stripPrivacy() below is belt-and-braces (and drops
// non-cloneable fields like AbortSignal that would break the IPC invoke).

import createLogger from '../utils/logger.js';

const logger = createLogger('StackClient');

const bridge = () => window.electron?.stack;

// Browser-mode (headless vite, no electron): panels must render, translation
// politely fails. Dev-only path, plain fallback text by convention.
const NO_BRIDGE = { success: false, error: '翻译服务不可用（需在桌面应用内使用）' };

function stripPrivacy(options = {}) {
  const { privacyMode: _pm, useCache: _uc, signal: _sig, ...rest } = options;
  return rest;
}

// One global chunk listener per window; frames route by streamId. A frame can
// arrive before the streamStart invoke resolves (the facade fires its async
// pipeline immediately), so unknown-stream frames buffer briefly.
let chunkHandlers = null;
const pendingFrames = new Map();

function ensureChunkListener() {
  if (chunkHandlers) return;
  chunkHandlers = new Map();
  bridge()?.onStreamChunk((frame) => {
    const handler = chunkHandlers.get(frame.streamId);
    if (handler) {
      handler(frame);
      return;
    }
    const buf = pendingFrames.get(frame.streamId) || [];
    buf.push(frame);
    pendingFrames.set(frame.streamId, buf);
    if (buf.length > 512) pendingFrames.delete(frame.streamId); // runaway guard
  });
}

class StackClient {
  constructor() {
    this._activeStreamId = null;
  }

  // The main process owns initialization; these exist for API compatibility.
  async init() {}
  get initialized() {
    return true;
  }

  async reload() {
    const b = bridge();
    if (!b) return NO_BRIDGE;
    return b.reload();
  }

  async translate(text, options = {}) {
    const b = bridge();
    if (!b) return NO_BRIDGE;
    try {
      return await b.translate({ text, options: stripPrivacy(options) });
    } catch (e) {
      logger.error('translate IPC failed:', e);
      return { success: false, error: e.message };
    }
  }

  // `supersede` (default on): a new stream from this window aborts the
  // previous one — right for a translation panel that only ever shows one
  // result. Listen subtitles are many independent lines in flight at once, so
  // they pass `supersede: false` and never touch the active-stream slot.
  // `noCache` mirrors the unary path's payload-level flag.
  async translateStream(text, options = {}, onChunk, { supersede = true, noCache = false } = {}) {
    const b = bridge();
    if (!b) {
      if (onChunk) onChunk(NO_BRIDGE.error);
      return NO_BRIDGE;
    }
    ensureChunkListener();

    // Supersede semantics: orchestration layers already drop stale frames by
    // translation id; this upgrade kills the upstream HTTP too (P2-34).
    if (supersede && this._activeStreamId) {
      const stale = this._activeStreamId;
      this._activeStreamId = null;
      chunkHandlers.delete(stale);
      b.abort(stale).catch(() => {});
    }

    const payload = { text, options: stripPrivacy(options), ...(noCache ? { noCache: true } : {}) };

    return new Promise((resolve) => {
      let sid = null;
      let settled = false;

      const finish = (result) => {
        if (settled) return;
        settled = true;
        if (sid) {
          chunkHandlers.delete(sid);
          pendingFrames.delete(sid);
          if (this._activeStreamId === sid) this._activeStreamId = null;
        }
        resolve(result);
      };

      const handle = (frame) => {
        if (frame.kind === 'chunk') {
          if (onChunk) onChunk(frame.text);
        } else if (frame.kind === 'done') {
          finish(frame.result);
        } else if (frame.kind === 'error') {
          finish({ success: false, error: frame.error?.message || '翻译失败' });
        }
      };

      b.streamStart(payload)
        .then((res) => {
          if (!res?.streamId) {
            finish(res && res.success === false ? res : NO_BRIDGE);
            return;
          }
          sid = res.streamId;
          if (supersede) this._activeStreamId = sid;
          chunkHandlers.set(sid, handle);
          const buffered = pendingFrames.get(sid);
          if (buffered) {
            pendingFrames.delete(sid);
            buffered.forEach(handle);
          }
        })
        .catch((e) => finish({ success: false, error: e.message }));
    });
  }

  // Kill the current in-flight stream (if any) without starting a new one.
  async abortActiveStream() {
    const b = bridge();
    const sid = this._activeStreamId;
    if (!b || !sid) return;
    this._activeStreamId = null;
    chunkHandlers?.delete(sid);
    await b.abort(sid).catch(() => {});
  }

  async chatCompletion(messages, options = {}) {
    const b = bridge();
    if (!b) return NO_BRIDGE;
    try {
      return await b.chat({ messages, options: stripPrivacy(options) });
    } catch (e) {
      logger.error('chat IPC failed:', e);
      return { success: false, error: e.message };
    }
  }

  // Whether a real chat completion is possible right now. Asked before an AI
  // action is offered — a provider that only translates would answer a prompt
  // with a translation of that prompt.
  async getChatCapability() {
    const b = bridge();
    if (!b?.chatCapability) return { available: false, providerId: null, providerName: null };
    try {
      return await b.chatCapability();
    } catch (e) {
      logger.error('chat capability IPC failed:', e);
      return { available: false, providerId: null, providerName: null };
    }
  }

  async testProvider(providerId) {
    const b = bridge();
    if (!b) return { success: false, message: NO_BRIDGE.error };
    return b.testProvider(providerId);
  }

  // Third arg (privacyMode) accepted for drop-in compatibility but never sent —
  // the facade applies the real mode.
  async testProviderWithConfig(providerId, config) {
    const b = bridge();
    if (!b) return { success: false, message: NO_BRIDGE.error };
    return b.testProviderConfig(providerId, config);
  }

  async getCurrentProvider() {
    const b = bridge();
    if (!b) return null;
    return b.currentProvider();
  }

  async getProvidersStatus() {
    const b = bridge();
    if (!b) return [];
    return b.providersStatus();
  }

  // Whether anything can translate right now. Without the bridge (dev browser
  // session) the honest answer is "unknown", and an unknown must not be shown
  // as a problem.
  async getReadiness() {
    const b = bridge();
    if (!b?.readiness) return null;
    return b.readiness();
  }

  async getCacheStats() {
    const b = bridge();
    if (!b) return null;
    return b.cacheStats();
  }

  async clearCache(level = 'all') {
    const b = bridge();
    if (!b) return;
    await b.clearCache(level);
  }

  // Stack reloaded in the main process (settings save from any window).
  onChanged(callback) {
    return bridge()?.onChanged(callback);
  }

  // ===== OCR (main-process engine chain; allowedEngines injected there) =====

  get ocr() {
    return {
      recognize: async (imageData, options = {}) => {
        const b = bridge();
        if (!b?.ocrRecognize) return NO_BRIDGE;
        try {
          return await b.ocrRecognize(imageData, options);
        } catch (e) {
          logger.error('ocr recognize IPC failed:', e);
          return { success: false, error: e.message };
        }
      },
      resetVisionFallback: async () => {
        const b = bridge();
        if (!b?.ocrResetVision) return;
        await b.ocrResetVision().catch(() => {});
      },
    };
  }

  // ===== Path B: the vision model reads the capture directly =====
  // Only the windows that hold a capture expose these; elsewhere the bridge
  // method is absent and path B simply never applies.

  async visionChat(messages, imageData, options = {}) {
    const b = bridge();
    if (!b?.visionChat) return { success: false, error: NO_BRIDGE.error, visionUnsupported: true };
    try {
      return await b.visionChat(messages, imageData, options);
    } catch (e) {
      logger.error('vision chat IPC failed:', e);
      return { success: false, error: e.message };
    }
  }

  async getVisionCapability() {
    const b = bridge();
    if (!b?.visionCapability) return { available: false, reason: 'unavailable' };
    try {
      return await b.visionCapability();
    } catch (e) {
      logger.error('vision capability IPC failed:', e);
      return { available: false, reason: e.message };
    }
  }

  // ===== External TTS endpoint (services/tts/endpoint.js is the consumer) =====

  // Cancels one tracked request by id (the facade aborts its HTTP call).
  abortRequest(requestId) {
    const b = bridge();
    if (!b?.abort || !requestId) return;
    b.abort(requestId).catch(() => {});
  }

  async getTtsCapability() {
    const b = bridge();
    if (!b?.ttsCapability) return { available: false, reason: 'unavailable' };
    try {
      return await b.ttsCapability();
    } catch (e) {
      logger.error('tts capability IPC failed:', e);
      return { available: false, reason: e.message };
    }
  }

  async ttsSpeak(payload) {
    const b = bridge();
    if (!b?.ttsSpeak) return { success: false, error: NO_BRIDGE.error };
    try {
      return await b.ttsSpeak(payload);
    } catch (e) {
      logger.error('tts speak IPC failed:', e);
      return { success: false, error: e.message };
    }
  }

  async ttsTest(config) {
    const b = bridge();
    if (!b?.ttsTest) return { success: false, error: NO_BRIDGE.error };
    try {
      return await b.ttsTest(config);
    } catch (e) {
      logger.error('tts test IPC failed:', e);
      return { success: false, error: e.message };
    }
  }
}

const stackClient = new StackClient();

export default stackClient;
export { StackClient };
