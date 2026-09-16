// Renderer-side scoped logger. Mirrors the API of electron/platform/logger.js.

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

const isDev = import.meta.env?.DEV ?? (process.env.NODE_ENV === 'development');

// Dev: all levels. Prod: warn+ only.
const currentLevel = isDev ? LOG_LEVELS.DEBUG : LOG_LEVELS.WARN;

// Flatten to a string here (structured clone drops an Error's stack).
function flatten(args) {
  return args.map((arg) => {
    if (arg instanceof Error) {
      return arg.stack || `${arg.name}: ${arg.message}`;
    }
    if (typeof arg === 'object' && arg !== null) {
      try {
        const json = JSON.stringify(arg);
        return json === '{}' ? String(arg) : json;
      } catch {
        return String(arg);
      }
    }
    return String(arg);
  }).join(' ');
}

// Mirror warn / error to the main-process log file. Never throws, never awaits.
function forward(level, scope, args) {
  try {
    window.electron?.logs?.write?.({ level, scope, text: flatten(args) });
  } catch {
    // Bridge missing (tests, a window without the API) — console still has it.
  }
}

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
      forward('warn', scope, args);
    },

    error: (...args) => {
      console.error(`${prefix}`, ...args);
      forward('error', scope, args);
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
