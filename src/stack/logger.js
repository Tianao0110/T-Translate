// Environment-agnostic scoped logger, API-compatible with src/core/logger.js.
// The host injects a real factory via configureRuntime({ loggerFactory });
// default: console with debug muted.

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
  // Resolve the factory per call: stack modules build their loggers at
  // import time, before configureRuntime runs.
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
