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

  async translateStream(text, options = {}, onChunk) {
    const b = bridge();
    if (!b) {
      if (onChunk) onChunk(NO_BRIDGE.error);
      return NO_BRIDGE;
    }
    ensureChunkListener();

    // Supersede semantics: a new stream from this window aborts the previous
    // one — orchestration layers already drop stale frames by translation id;
    // this upgrade kills the upstream HTTP too (P2-34).
    if (this._activeStreamId) {
      const stale = this._activeStreamId;
      this._activeStreamId = null;
      chunkHandlers.delete(stale);
      b.abort(stale).catch(() => {});
    }

    const payload = { text, options: stripPrivacy(options) };

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
          this._activeStreamId = sid;
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
}

const stackClient = new StackClient();

export default stackClient;
export { StackClient };
