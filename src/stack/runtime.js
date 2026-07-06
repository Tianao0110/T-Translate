// Injected platform capabilities for the stack (set once by createTranslationStack).
// The stack must stay electron-free and renderer-free; fetch MUST be Electron's
// net.fetch in production — Node's global fetch bypasses the system proxy and
// enterprise certificates, which would break proxy users (design doc §3.2/R1).

const caps = {
  fetch: null,
  getLanguage: () => 'zh',
  loggerFactory: null,
};

export function configureRuntime(next = {}) {
  if (next.fetch) caps.fetch = next.fetch;
  if (next.getLanguage) caps.getLanguage = next.getLanguage;
  if (next.loggerFactory) caps.loggerFactory = next.loggerFactory;
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
