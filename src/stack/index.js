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
//   getCustomFilters    () => persisted custom filter defs (electron-store).
//   cacheFilePath       L2 cache JSON location (userData/Caches/...). Optional —
//                       omitted = memory-only cache (tests).

import { configureRuntime } from './runtime.js';
import { TranslationService } from './service.js';
import { StackTranslationCache } from './cache.js';
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
  });

  const cache = new StackTranslationCache({ filePath: ctx.cacheFilePath || null });
  const service = new TranslationService({
    loadProviderConfigs: ctx.loadProviderConfigs,
    getCustomFilters: ctx.getCustomFilters,
    cache,
  });

  return {
    service,
    cache,
    metadata: PROVIDER_METADATA,
    privacyModes,
    // Load the L2 snapshot then warm provider configs. Idempotent.
    async init() {
      await cache.init();
      await service.init();
    },
    ping: () => 'stack-ok',
  };
}
