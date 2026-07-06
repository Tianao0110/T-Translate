// Environment-agnostic scoped logger, API-compatible with src/utils/logger.js
// (which is unusable here: import.meta.env is a Vite-ism). The host can inject
// a real logger factory via configureRuntime({ loggerFactory }) — the main
// process wires electron-log so stack output lands in the on-disk log files.
// Default: console with debug muted (providers log mostly at debug level).

import { getLoggerFactory } from './runtime.js';

function consoleLogger(scope) {
  const prefix = `[${scope}]`;
  return {
    debug: () => {},
    info: (...args) => console.log(prefix, ...args),
    warn: (...args) => console.warn(prefix, ...args),
    error: (...args) => console.error(prefix, ...args),
    success: (...args) => console.log(`${prefix} ✓`, ...args),
  };
}

export default function createLogger(scope) {
  // Resolve the factory per call, not per createLogger: stack modules build
  // their loggers at import time, BEFORE configureRuntime injects the real
  // factory — eager binding silently pinned the whole OCR/translation pipeline
  // to the console fallback and the on-disk log never saw it.
  const fallback = consoleLogger(scope);
  let real = null;
  const resolve = () => {
    if (!real) {
      const factory = getLoggerFactory();
      if (factory) real = factory(scope);
    }
    return real || fallback;
  };
  return {
    debug: (...args) => resolve().debug(...args),
    info: (...args) => resolve().info(...args),
    warn: (...args) => resolve().warn(...args),
    error: (...args) => resolve().error(...args),
    success: (...args) => (resolve().success || resolve().info)(...args),
  };
}
