// Injected platform capabilities for the stack (set once by
// createTranslationStack). fetch must be Electron's net.fetch in production
// (docs/design/stack.md §1).

const caps = {
  fetch: null,
  getLanguage: () => 'zh',
  loggerFactory: null,
  // Local OCR recognizers (paddle / windows), electron/ocr/ocr-engine.js.
  localOcr: null,
  // The built-in model (T-Engine's LLM host, electron/llm/llm-manager):
  // { generate(request, onToken) -> { promise, cancel }, status(), selected(),
  //   recognize({ image, task }) -> { promise, cancel }, visionStatus() }.
  localLlm: null,
};

export function configureRuntime(next = {}) {
  if (next.fetch) caps.fetch = next.fetch;
  if (next.getLanguage) caps.getLanguage = next.getLanguage;
  if (next.loggerFactory) caps.loggerFactory = next.loggerFactory;
  if (next.localOcr) caps.localOcr = next.localOcr;
  if (next.localLlm !== undefined) caps.localLlm = next.localLlm;
}

export function rtFetch(...args) {
  if (!caps.fetch) {
    throw new Error('stack fetch not configured — createTranslationStack(ctx) requires ctx.fetch');
  }
  return caps.fetch(...args);
}

export function getLanguage() {
  try {
    return caps.getLanguage() || 'zh';
  } catch {
    return 'zh';
  }
}

export function getLoggerFactory() {
  return caps.loggerFactory;
}

export function getLocalOcr() {
  return caps.localOcr;
}

export function getLocalLlm() {
  return caps.localLlm;
}
