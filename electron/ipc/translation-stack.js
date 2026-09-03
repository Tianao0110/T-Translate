// Translation-stack IPC facade — the single enforcement point of the migrated
// stack. Responsibilities:
//   1. Own the stack singleton (bundle artifact of src/stack/).
//   2. Privacy: read privacyMode from the store per request and inject
//      privacyMode/useCache — whatever the renderer sends for those fields is
//      discarded, so no call site can weaken SECURE/OFFLINE ever again.
//   3. Abort registry: requestId/streamId -> AbortController, so canceling or
//      superseding a translation interrupts the upstream HTTP for real (P2-34).
//   4. Stream frames: forward each service emission (already coalesced at
//      ~33ms inside the stack) as a stack:stream-chunk frame to the invoker.
//
// Errors cross this boundary as plain localized strings (see the stack i18n
// pivot in src/stack/i18n.js) — invoke handlers return result objects and
// never throw (Electron flattens thrown Errors to bare messages).

const { ipcMain, app, net, BrowserWindow } = require('electron');
const path = require('path');
const crypto = require('crypto');
const { CHANNELS } = require('../shared/channels');
const { createSecureVault } = require('../utils/secure-vault');
const makeLogger = require('../utils/logger');
const logger = makeLogger('IPC:Stack');

// In-flight requests (one-shot and streams alike). Swept so an entry can never
// leak: normal completion deletes it, sender destruction aborts it, and a
// 10-minute GC catches anything pathological.
const INFLIGHT_TTL_MS = 10 * 60 * 1000;

function register(ctx) {
  const { store } = ctx;
  const vault = createSecureVault({ store });

  let stack = null;
  let stackLoadError = null;
  try {
    const { createTranslationStack } = require('../generated/translation-stack.cjs');
    const localOcr = require('./ocr');
    stack = createTranslationStack({
      // Chromium network stack — system proxy and enterprise certs behave
      // exactly like the renderer fetch the providers were written against.
      fetch: net.fetch.bind(net),
      getLanguage: () => (store.get('settings.interface.language') === 'en' ? 'en' : 'zh'),
      loggerFactory: (scope) => makeLogger(`Stack:${scope}`),
      loadProviderConfigs: async () => vault.bulkDecryptProviderConfigs('stack-reload'),
      loadOcrConfigs: async () => vault.decryptOcrBucket('ocr-config'),
      localOcr: {
        paddle: (imageData, options) => localOcr.recognizePaddle(store, imageData, options),
        windows: (imageData, options) => localOcr.recognizeWindows(store, imageData, options),
        isWindows: process.platform === 'win32',
      },
      getCustomFilters: () => store.get('settings.translation.customFilters', []),
      cacheFilePath: path.join(app.getPath('userData'), 'Caches', 'translation-cache.json'),
      // External TTS endpoint: plain fields from settings, the key from the
      // vault (null under offline mode — the prefix is on the blocked list).
      loadTtsEndpointConfig: async () => {
        const cfg = store.get('settings.tts.endpoint', {}) || {};
        return {
          baseUrl: cfg.baseUrl,
          model: cfg.model,
          voice: cfg.voice,
          apiKey: await vault.decrypt('tts_endpoint_apiKey', 'tts-endpoint'),
        };
      },
    });
  } catch (e) {
    stackLoadError = e;
    logger.error('Stack bundle missing/broken — run `node scripts/build-stack.js`:', e.message);
  }

  // Idle boot load (decided D-5a): first translation must not pay the config
  // decrypt + cache read, and a broken load surfaces in the log at startup
  // instead of on first use.
  if (stack) {
    setTimeout(() => {
      stack.init()
        .then(() => {
          stack.cache.setPersistEnabled(getPrivacyMode() !== 'secure');
          logger.info('Translation stack initialized');
        })
        .catch((e) => logger.error('Stack init failed:', e));
    }, 1200);
  }

  function getPrivacyMode() {
    return store.get('privacyMode', 'standard');
  }

  // The renderer's opinion about privacyMode/useCache/signal is dropped here.
  // `noCache` (payload level, not options) is the one exception and it is safe
  // by construction: it can only turn caching further OFF, never on, so the
  // secure-mode gate below still decides the ceiling. Listen mode sets it —
  // subtitle lines are one-shot and would otherwise evict the shared cache.
  function sanitizeOptions(options = {}, mode, signal, noCache = false) {
    const { privacyMode: _pm, useCache: _uc, signal: _sig, ...rest } = options;
    return {
      ...rest,
      privacyMode: mode,
      useCache: mode !== 'secure' && !noCache,
      signal,
    };
  }

  function unavailable() {
    return {
      success: false,
      error: `翻译服务未就绪（stack bundle 加载失败：${stackLoadError?.message || 'unknown'}）`,
    };
  }

  const inflight = new Map(); // id -> { controller, senderId, startedAt }

  function track(id, sender) {
    const controller = new AbortController();
    inflight.set(id, { controller, senderId: sender.id, startedAt: Date.now() });
    // First request from this webContents: abort everything it owns when it dies.
    if (!sender.__stackAbortHooked) {
      sender.__stackAbortHooked = true;
      sender.once('destroyed', () => {
        for (const [key, entry] of inflight) {
          if (entry.senderId === sender.id) {
            entry.controller.abort();
            inflight.delete(key);
          }
        }
      });
    }
    return controller;
  }

  const gcTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of inflight) {
      if (now - entry.startedAt > INFLIGHT_TTL_MS) {
        entry.controller.abort();
        inflight.delete(key);
        logger.warn(`Stack request ${key} force-aborted after ${INFLIGHT_TTL_MS / 60000}min`);
      }
    }
  }, 60 * 1000);
  gcTimer.unref?.();

  // ===== Translation =====

  ipcMain.handle(CHANNELS.STACK.TRANSLATE, async (event, payload = {}) => {
    if (!stack) return unavailable();
    const { requestId, text, options, noCache } = payload;
    const mode = getPrivacyMode();
    const id = requestId || `rq_${crypto.randomUUID()}`;
    const controller = track(id, event.sender);
    try {
      const result = await stack.service.translate(
        text,
        sanitizeOptions(options, mode, controller.signal, noCache === true)
      );
      return { ...result, effectivePrivacyMode: mode };
    } catch (e) {
      logger.error('translate failed:', e);
      return { success: false, error: e.message, effectivePrivacyMode: mode };
    } finally {
      inflight.delete(id);
    }
  });

  ipcMain.handle(CHANNELS.STACK.STREAM_START, (event, payload = {}) => {
    if (!stack) return unavailable();
    // `noCache` has the same payload-level contract as on the unary path: it
    // can only ever reduce caching (listen subtitles stream through here).
    const { text, options, noCache } = payload;
    const mode = getPrivacyMode();
    const streamId = `st_${crypto.randomUUID()}`;
    const controller = track(streamId, event.sender);
    const sender = event.sender;
    let seq = 0;

    const send = (frame) => {
      if (!sender.isDestroyed()) {
        sender.send(CHANNELS.STACK.STREAM_CHUNK, frame);
      }
    };

    // Fire-and-return: the invoke resolves with the streamId immediately;
    // frames arrive via STREAM_CHUNK pushes.
    (async () => {
      try {
        const result = await stack.service.translateStream(
          text,
          sanitizeOptions(options, mode, controller.signal, noCache === true),
          (fullText) => send({ streamId, seq: seq++, kind: 'chunk', text: fullText })
        );
        if (result.success) {
          send({ streamId, seq: seq++, kind: 'done', result: { ...result, effectivePrivacyMode: mode } });
        } else {
          send({ streamId, seq: seq++, kind: 'error', error: { message: result.error } });
        }
      } catch (e) {
        logger.error('translateStream failed:', e);
        send({ streamId, seq: seq++, kind: 'error', error: { message: e.message } });
      } finally {
        inflight.delete(streamId);
      }
    })();

    return { streamId, effectivePrivacyMode: mode };
  });

  ipcMain.handle(CHANNELS.STACK.ABORT, (event, payload = {}) => {
    const entry = inflight.get(payload.id);
    if (!entry) return { ok: false };
    entry.controller.abort();
    inflight.delete(payload.id);
    return { ok: true };
  });

  ipcMain.handle(CHANNELS.STACK.CHAT, async (event, payload = {}) => {
    if (!stack) return unavailable();
    const { requestId, messages, options } = payload;
    const mode = getPrivacyMode();
    const id = requestId || `ch_${crypto.randomUUID()}`;
    const controller = track(id, event.sender);
    try {
      return await stack.service.chatCompletion(messages, sanitizeOptions(options, mode, controller.signal));
    } catch (e) {
      logger.error('chat failed:', e);
      return { success: false, error: e.message };
    } finally {
      inflight.delete(id);
    }
  });

  // Answered under the facade's privacy mode, like every other stack call: in
  // offline mode a cloud LLM must not count as "AI available".
  ipcMain.handle(CHANNELS.STACK.CHAT_CAPABILITY, async () => {
    if (!stack) return { available: false, providerId: null, providerName: null };
    try {
      await stack.service.init();
      return stack.service.getChatCapability({ privacyMode: getPrivacyMode() });
    } catch (e) {
      logger.error('chat capability probe failed:', e);
      return { available: false, providerId: null, providerName: null };
    }
  });

  // ===== Connection tests (offline gate enforced HERE, not in the renderer) =====

  ipcMain.handle(CHANNELS.STACK.TEST_PROVIDER, async (event, payload = {}) => {
    if (!stack) return { success: false, message: unavailable().error };
    // testProvider applies the privacy gate itself (allowlist plus, offline,
    // the local-endpoint rule); the mode is the facade's, never the renderer's.
    return stack.service.testProvider(payload.providerId, getPrivacyMode());
  });

  ipcMain.handle(CHANNELS.STACK.TEST_PROVIDER_CONFIG, async (event, payload = {}) => {
    if (!stack) return { success: false, message: unavailable().error };
    // testProviderWithConfig applies the isProviderAllowed gate itself; the
    // mode argument is the facade's, never the renderer's.
    return stack.service.testProviderWithConfig(payload.providerId, payload.config, getPrivacyMode());
  });

  // ===== Management / read-only =====

  ipcMain.handle(CHANNELS.STACK.PROVIDERS_STATUS, () => {
    if (!stack) return [];
    // Decrypted secrets live only in the main process — mask every
    // schema-encrypted field before the status crosses back to a renderer.
    return stack.service.getProvidersStatus().map((status) => {
      const schema = status.configSchema || {};
      const config = { ...(status.config || {}) };
      for (const [field, def] of Object.entries(schema)) {
        if (def.encrypted && config[field]) config[field] = '***encrypted***';
      }
      return { ...status, config };
    });
  });

  ipcMain.handle(CHANNELS.STACK.READINESS, async () => {
    if (!stack) return { ready: false, reason: 'no-provider', candidates: 0 };
    // Privacy mode is read here, never accepted from a renderer.
    return stack.service.getTranslationReadiness(getPrivacyMode());
  });

  ipcMain.handle(CHANNELS.STACK.CURRENT_PROVIDER, () => {
    if (!stack) return null;
    return stack.service.getCurrentProvider();
  });

  ipcMain.handle(CHANNELS.STACK.RELOAD, async () => {
    if (!stack) return unavailable();
    try {
      await stack.reload();
      // Lightweight invalidation signal — windows re-pull what they display.
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send(CHANNELS.STACK.CHANGED);
      }
      logger.info('Stack reloaded');
      return { success: true };
    } catch (e) {
      logger.error('Stack reload failed:', e);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle(CHANNELS.STACK.CLEAR_CACHE, (event, payload = {}) => {
    if (!stack) return unavailable();
    stack.service.clearCache(payload.level || 'all');
    return { success: true };
  });

  ipcMain.handle(CHANNELS.STACK.CACHE_STATS, () => {
    if (!stack) return null;
    return stack.service.getCacheStats();
  });

  // ===== OCR =====

  ipcMain.handle(CHANNELS.STACK.OCR_RECOGNIZE, async (event, payload = {}) => {
    if (!stack) return unavailable();
    const { imageData, options = {} } = payload;
    const mode = getPrivacyMode();
    // The allowlist is injected HERE from the live mode — a renderer cannot
    // widen the engine set (the old call sites passed it as a parameter and
    // relied on convention). Screen captures are the most privacy-sensitive
    // input in the app.
    const { allowedEngines: _ae, ...rest } = options;
    try {
      return await stack.ocr.recognize(imageData, {
        ...rest,
        allowedEngines: stack.privacyModes.getPrivacyModeConfig(mode).allowedOcrEngines || undefined,
      });
    } catch (e) {
      logger.error('ocr recognize failed:', e);
      return { success: false, error: e.message };
    }
  });

  // Path B carries a screen capture, so the same allowlist that guards OCR
  // guards this — plus offline's extra rule that the endpoint must be local.
  // Both are injected here; a renderer can only ask, never widen.
  function visionGate(mode) {
    return {
      allowedEngines: stack.privacyModes.getPrivacyModeConfig(mode).allowedOcrEngines || undefined,
      requireLocalVision: mode === 'offline',
    };
  }

  ipcMain.handle(CHANNELS.STACK.VISION_CHAT, async (event, payload = {}) => {
    if (!stack) return unavailable();
    const { messages, imageData, options = {} } = payload;
    const mode = getPrivacyMode();
    const { allowedEngines: _ae, requireLocalVision: _rl, ...rest } = options;
    try {
      return await stack.ocr.visionChat(messages, imageData, { ...rest, ...visionGate(mode) });
    } catch (e) {
      logger.error('vision chat failed:', e);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle(CHANNELS.STACK.VISION_CAPABILITY, () => {
    if (!stack) return { available: false, reason: unavailable().error };
    try {
      return stack.ocr.getVisionCapability(visionGate(getPrivacyMode()));
    } catch (e) {
      logger.error('vision capability probe failed:', e);
      return { available: false, reason: e.message };
    }
  });

  ipcMain.handle(CHANNELS.STACK.OCR_RESET_VISION, () => {
    if (!stack) return { success: false };
    stack.ocr.resetVisionFallback();
    return { success: true };
  });

  // ===== External TTS endpoint =====
  // A network service by definition (even on localhost), so offline mode
  // refuses all three here — the renderer engine reports itself unavailable
  // and the manager stays on system voices.
  const MAX_TTS_INPUT = 4096;
  const str = (v) => (typeof v === 'string' ? v : '');

  function ttsOffline() {
    return { success: false, available: false, error: 'offline-mode', reason: 'offline-mode', code: 'OFFLINE_BLOCKED' };
  }

  ipcMain.handle(CHANNELS.STACK.TTS_CAPABILITY, async () => {
    if (!stack) return { available: false, reason: unavailable().error };
    if (getPrivacyMode() === 'offline') return ttsOffline();
    try {
      return await stack.tts.getCapability();
    } catch (e) {
      logger.error('tts capability probe failed:', e);
      return { available: false, reason: e.message };
    }
  });

  ipcMain.handle(CHANNELS.STACK.TTS_SPEAK, async (event, payload = {}) => {
    if (!stack) return unavailable();
    if (getPrivacyMode() === 'offline') return ttsOffline();
    const id = str(payload.requestId) || crypto.randomUUID();
    const controller = track(id, event.sender);
    try {
      // The ArrayBuffer crosses IPC as-is (structured clone).
      return await stack.tts.speak({
        text: str(payload.text).slice(0, MAX_TTS_INPUT),
        voice: str(payload.voice),
        speed: Number.isFinite(payload.speed) ? payload.speed : 1,
        signal: controller.signal,
      });
    } catch (e) {
      logger.error('tts speak failed:', e);
      return { success: false, error: e.message };
    } finally {
      inflight.delete(id);
    }
  });

  // Settings page: a draft config (fields not yet saved, key optional) is
  // exercised end-to-end; the sample audio comes back for the page to play.
  ipcMain.handle(CHANNELS.STACK.TTS_TEST, async (event, payload = {}) => {
    if (!stack) return unavailable();
    if (getPrivacyMode() === 'offline') return ttsOffline();
    const cfg = payload.config || {};
    const draft = { baseUrl: str(cfg.baseUrl), model: str(cfg.model), voice: str(cfg.voice) };
    if (str(cfg.apiKey)) draft.apiKey = cfg.apiKey;
    if (str(cfg.sampleText)) draft.sampleText = cfg.sampleText.slice(0, 200);
    try {
      return await stack.tts.test(draft);
    } catch (e) {
      logger.error('tts test failed:', e);
      return { success: false, error: e.message };
    }
  });

  logger.info('Translation-stack IPC handlers registered');

  // privacy.js calls this after a mode switch: SECURE pauses L2 persistence
  // (pending writes are flushed first inside setPersistEnabled).
  return {
    onPrivacyModeChanged(mode) {
      stack?.cache.setPersistEnabled(mode !== 'secure');
    },
  };
}

module.exports = register;
