// Renderer-side scoped logger. Mirrors the API of electron/utils/logger.js.

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

// Chained ?? was dead code: `NODE_ENV === '...'` is always a boolean, so the
// third operand could never be reached. Vite always defines import.meta.env.
const isDev = import.meta.env?.DEV ?? (process.env.NODE_ENV === 'development');

// Dev: all levels. Prod: warn+ only.
const currentLevel = isDev ? LOG_LEVELS.DEBUG : LOG_LEVELS.WARN;

function createLogger(scope) {
  const prefix = `[${scope}]`;

  return {
    debug: (...args) => {
      if (currentLevel <= LOG_LEVELS.DEBUG) {
        console.log(`${prefix}`, ...args);
      }
    },

    info: (...args) => {
      if (currentLevel <= LOG_LEVELS.INFO) {
        console.log(`${prefix}`, ...args);
      }
    },

    warn: (...args) => {
      if (currentLevel <= LOG_LEVELS.WARN) {
        console.warn(`${prefix}`, ...args);
      }
    },

    error: (...args) => {
      console.error(`${prefix}`, ...args);
    },

    success: (...args) => {
      if (currentLevel <= LOG_LEVELS.INFO) {
        console.log(`${prefix} ✓`, ...args);
      }
    },
  };
}

export default createLogger;
export { LOG_LEVELS, isDev };
