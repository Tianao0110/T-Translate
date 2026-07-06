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
  const factory = getLoggerFactory();
  return factory ? factory(scope) : consoleLogger(scope);
}
