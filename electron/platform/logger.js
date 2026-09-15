// Scoped logger backed by electron-log when available; falls back to console.
// Privacy: filters API keys / bearer tokens from log output before writing.

const path = require('path');
const { app } = require('electron');

let electronLog = null;
try {
  electronLog = require('electron-log');
} catch (e) {
  // electron-log absent — drop to console-only fallback.
}

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

// Regex set for redacting secrets. Order matters: specific patterns (sk-, AIza)
// before generic key=value matchers.
const SENSITIVE_PATTERNS = [
  { pattern: /(api[_-]?key|apikey|secret|token|password|bearer)\s*[=:]\s*["']?([a-zA-Z0-9_-]{8,})["']?/gi, replace: '$1=***FILTERED***' },
  { pattern: /sk-[a-zA-Z0-9]{32,}/g, replace: 'sk-***FILTERED***' },
  { pattern: /AIza[a-zA-Z0-9_-]{35}/g, replace: 'AIza***FILTERED***' },
  { pattern: /(Authorization|Bearer)\s*[=:]\s*["']?[a-zA-Z0-9_-]+["']?/gi, replace: '$1=***FILTERED***' },
];

function filterSensitive(data) {
  if (typeof data !== 'string') {
    try {
      data = JSON.stringify(data);
    } catch {
      return String(data);
    }
  }

  let filtered = data;
  for (const { pattern, replace } of SENSITIVE_PATTERNS) {
    filtered = filtered.replace(pattern, replace);
  }
  return filtered;
}

function formatArgs(args) {
  return args.map(arg => {
    // Errors first: message/stack/code are non-enumerable, so JSON.stringify
    // renders every Error as "{}" — which is exactly what the log files were
    // full of, and why they could not diagnose a single crash.
    if (arg instanceof Error) {
      const parts = [arg.stack || `${arg.name}: ${arg.message}`];
      if (arg.code) parts.push(`code=${arg.code}`);
      if (arg.cause) parts.push(`cause=${arg.cause.message || arg.cause}`);
      return filterSensitive(parts.join(' | '));
    }
    if (typeof arg === 'object' && arg !== null) {
      try {
        const json = JSON.stringify(arg, null, 2);
        // Same blind spot one level down: an object whose own keys are all
        // non-enumerable (or an empty one) says nothing. Fall back to the
        // runtime's own description.
        return filterSensitive(json === '{}' ? String(arg) : json);
      } catch {
        return String(arg);
      }
    }
    return filterSensitive(String(arg));
  });
}

// Local YYYY-MM-DD. Not toISOString(): that is UTC, so west-of-UTC machines
// rolled the file over mid-evening and named it for the next day, while the
// timestamps written inside stayed local.
function localDateStamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Secure (incognito) mode keeps only errors on disk: routine info/warn lines
// describe what the user was doing, and the mode promises no such trail.
// Console output is unaffected. Renderer lines arriving over logs:write go
// through the same transport, so they are covered too.
const NORMAL_FILE_LEVEL = 'info';
const SECURE_FILE_LEVEL = 'error';
let secureFileLogging = false;

function setSecureFileLogging(on) {
  secureFileLogging = Boolean(on);
  if (electronLog) {
    electronLog.transports.file.level = secureFileLogging ? SECURE_FILE_LEVEL : NORMAL_FILE_LEVEL;
  }
}

// Configure electron-log: per-day rotated files, 5MB cap, 7-day retention.
function configureElectronLog() {
  if (!electronLog) return;

  const logDir = path.join(app.getPath('userData'), 'logs');

  electronLog.transports.file.resolvePathFn = () => {
    return path.join(logDir, `app-${localDateStamp()}.log`);
  };

  electronLog.transports.file.level = secureFileLogging ? SECURE_FILE_LEVEL : NORMAL_FILE_LEVEL;
  electronLog.transports.file.maxSize = 5 * 1024 * 1024;

  electronLog.transports.console.level = process.env.NODE_ENV === 'development' ? 'debug' : 'warn';

  electronLog.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}] [{level}] {text}';
  electronLog.transports.console.format = '[{h}:{i}:{s}] [{level}] {text}';

  cleanOldLogs(logDir, 7);

  return logDir;
}

function cleanOldLogs(logDir, keepDays) {
  try {
    const fs = require('fs');
    if (!fs.existsSync(logDir)) return;

    const now = Date.now();
    const maxAge = keepDays * 24 * 60 * 60 * 1000;

    const files = fs.readdirSync(logDir);
    for (const file of files) {
      if (!file.endsWith('.log')) continue;

      const filePath = path.join(logDir, file);
      const stats = fs.statSync(filePath);

      if (now - stats.mtime.getTime() > maxAge) {
        fs.unlinkSync(filePath);
        console.log(`[Logger] Cleaned old log: ${file}`);
      }
    }
  } catch (e) {
    console.error('[Logger] Failed to clean old logs:', e.message);
  }
}

// Initialize the log dir as soon as the module loads: app.getPath already
// works before ready, and waiting for ready left every line logged during
// startup in electron-log's default main.log. app is optional-chained so
// the module stays loadable outside a real Electron main process (vitest
// requires it through the electron mock).
let logDirectory = null;
if (electronLog && typeof app?.getPath === 'function') {
  logDirectory = configureElectronLog();
}

function getLogDirectory() {
  if (logDirectory) return logDirectory;
  if (app?.isReady?.()) {
    return path.join(app.getPath('userData'), 'logs');
  }
  return null;
}

// Create a logger with a `[scope]` prefix; routes through electron-log when present.
function createLogger(scope) {
  const prefix = `[${scope}]`;

  if (electronLog) {
    return {
      debug: (...args) => {
        electronLog.debug(prefix, ...formatArgs(args));
      },

      info: (...args) => {
        electronLog.info(prefix, ...formatArgs(args));
      },

      warn: (...args) => {
        electronLog.warn(prefix, ...formatArgs(args));
      },

      error: (...args) => {
        electronLog.error(prefix, ...formatArgs(args));
      },

      success: (...args) => {
        electronLog.info(prefix, '[OK]', ...formatArgs(args));
      },

      // Dev-only grouping/timing — silenced in production.
      group: (label) => {
        if (process.env.NODE_ENV === 'development') {
          console.group(`${prefix} ${label}`);
        }
      },

      groupEnd: () => {
        if (process.env.NODE_ENV === 'development') {
          console.groupEnd();
        }
      },

      time: (label) => {
        if (process.env.NODE_ENV === 'development') {
          console.time(`${prefix} ${label}`);
        }
      },

      timeEnd: (label) => {
        if (process.env.NODE_ENV === 'development') {
          console.timeEnd(`${prefix} ${label}`);
        }
      },
    };
  }

  // Console-only fallback.
  const isDev = process.env.NODE_ENV === 'development';
  const currentLevel = isDev ? LOG_LEVELS.DEBUG : LOG_LEVELS.WARN;

  function getTimestamp() {
    return new Date().toTimeString().slice(0, 8);
  }

  return {
    debug: (...args) => {
      if (currentLevel <= LOG_LEVELS.DEBUG) {
        console.log(`[${getTimestamp()}] ${prefix} [DEBUG]`, ...formatArgs(args));
      }
    },

    info: (...args) => {
      if (currentLevel <= LOG_LEVELS.INFO) {
        console.log(`[${getTimestamp()}] ${prefix} [INFO]`, ...formatArgs(args));
      }
    },

    warn: (...args) => {
      if (currentLevel <= LOG_LEVELS.WARN) {
        console.warn(`[${getTimestamp()}] ${prefix} [WARN]`, ...formatArgs(args));
      }
    },

    error: (...args) => {
      console.error(`[${getTimestamp()}] ${prefix} [ERROR]`, ...formatArgs(args));
    },

    success: (...args) => {
      if (currentLevel <= LOG_LEVELS.INFO) {
        console.log(`[${getTimestamp()}] ${prefix} [OK]`, ...formatArgs(args));
      }
    },

    group: (label) => {
      if (isDev) console.group(`[${getTimestamp()}] ${prefix} ${label}`);
    },

    groupEnd: () => {
      if (isDev) console.groupEnd();
    },

    time: (label) => {
      if (isDev) console.time(`${prefix} ${label}`);
    },

    timeEnd: (label) => {
      if (isDev) console.timeEnd(`${prefix} ${label}`);
    },
  };
}

module.exports = createLogger;
module.exports.LOG_LEVELS = LOG_LEVELS;
module.exports.getLogDirectory = getLogDirectory;
module.exports.setSecureFileLogging = setSecureFileLogging;
module.exports.filterSensitive = filterSensitive;
module.exports.localDateStamp = localDateStamp;
