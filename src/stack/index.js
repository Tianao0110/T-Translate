// Main-process translation stack — ESM source, bundled to CJS by
// scripts/build-stack.js into electron/generated/translation-stack.cjs.
//
// Contract: everything in src/stack/ must stay renderer-free AND electron-free
// (no window/localStorage/navigator, no `import 'electron'`). All platform
// capabilities arrive through the injected ctx:
//   fetch               REQUIRED. electron net.fetch — Node's global fetch
//                       bypasses the system proxy / enterprise certs (design R1).
//   getLanguage         () => 'zh' | 'en', for provider error messages.
//   loggerFactory       (scope) => logger, e.g. electron/utils/logger.js.
//   loadProviderConfigs async () => ({ list, configs }) with decrypted configs
//                       (main process owns decryption via secureVault).
//   loadOcrConfigs      async () => flat settings.ocr bucket with vault
//                       secrets merged (same ownership rule).
//   localOcr            { paddle, windows, isWindows } — main-process local
//                       OCR recognizers (electron/utils/ocr-engine et al).
//   getCustomFilters    () => persisted custom filter defs (electron-store).
//   cacheFilePath       L2 cache JSON location (userData/Caches/...). Optional —
//                       omitted = memory-only cache (tests).

import { configureRuntime } from './runtime.js';
import { TranslationService } from './service.js';
import { StackTranslationCache } from './cache.js';
import { OCREngineManager } from './ocr/manager.js';
import { PROVIDER_METADATA } from './providers/metadata.js';
import * as privacyModes from './privacy-modes.js';

export function createTranslationStack(ctx = {}) {
  if (typeof ctx.fetch !== 'function') {
    throw new Error('createTranslationStack: ctx.fetch is required (inject electron net.fetch)');
  }

  configureRuntime({
    fetch: ctx.fetch,
    getLanguage: ctx.getLanguage,
    loggerFactory: ctx.loggerFactory,
    localOcr: ctx.localOcr,
  });

  const cache = new StackTranslationCache({ filePath: ctx.cacheFilePath || null });
  const service = new TranslationService({
    loadProviderConfigs: ctx.loadProviderConfigs,
    getCustomFilters: ctx.getCustomFilters,
    cache,
  });
  const ocr = new OCREngineManager({ loadConfigs: ctx.loadOcrConfigs });

  return {
    service,
    cache,
    ocr,
    metadata: PROVIDER_METADATA,
    privacyModes,
    // Load the L2 snapshot then warm provider + OCR configs. Idempotent.
    async init() {
      await cache.init();
      await service.init();
      await ocr.init();
    },
    // Settings saved anywhere: re-read store + vault for both subsystems.
    async reload() {
      await service.reload();
      await ocr.init();
    },
    ping: () => 'stack-ok',
  };
}
