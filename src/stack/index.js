// Main-process translation stack — ESM source, bundled to CJS by
// scripts/build-stack.js into electron/generated/translation-stack.cjs.
//
// Contract: everything in src/stack/ must stay renderer-free AND electron-free
// (no window/localStorage/navigator, no `import 'electron'`). All platform
// capabilities arrive through the injected ctx (store, secureVault, fetch, ...).
//
// Batch 0 skeleton: proves the esbuild toolchain end to end; the real stack
// (service/registry/providers/cache) lands in later batches.

export function createTranslationStack(ctx = {}) {
  return {
    ping: () => 'stack-ok',
  };
}
