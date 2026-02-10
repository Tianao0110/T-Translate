// electron/utils/logger.js
// 增强版日志系统 - 使用 electron-log
// 
// 需要安装依赖：npm install electron-log

const path = require('path');
const { app } = require('electron');

// 尝试加载 electron-log，不存在则降级
let electronLog = null;
try {
  electronLog = require('electron-log');
} catch (e) {
  // electron-log 未安装，使用降级模式
}

/**
 * 日志级别
 */
const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

/**
 * 隐私过滤 - 移除敏感信息
 */
const SENSITIVE_PATTERNS = [
  // API Keys
  { pattern: /(api[_-]?key|apikey|secret|token|password|bearer)\s*[=:]\s*["']?([a-zA-Z0-9_-]{8,})["']?/gi, replace: '$1=***FILTERED***' },
  { pattern: /sk-[a-zA-Z0-9]{32,}/g, replace: 'sk-***FILTERED***' },
  { pattern: /AIza[a-zA-Z0-9_-]{35}/g, replace: 'AIza***FILTERED***' },
  // Authorization headers
  { pattern: /(Authorization|Bearer)\s*[=:]\s*["']?[a-zA-Z0-9_-]+["']?/gi, replace: '$1=***FILTERED***' },
];

/**
 * 过滤敏感信息
 */
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

/**
 * 格式化日志参数
 */
function formatArgs(args) {
  return args.map(arg => {
    if (typeof arg === 'object' && arg !== null) {
      try {
        return filterSensitive(JSON.stringify(arg, null, 2));
      } catch {
        return String(arg);
      }
    }
    return filterSensitive(String(arg));
  });
}

/**
 * 配置 electron-log
 */
function configureElectronLog() {
  if (!electronLog) return;
  
  // 日志文件路径
  const logDir = path.join(app.getPath('userData'), 'logs');
  
  // 配置文件传输
  electronLog.transports.file.resolvePathFn = () => {
    const date = new Date().toISOString().slice(0, 10);
    return path.join(logDir, `app-${date}.log`);
  };
  
  // 文件日志级别
  electronLog.transports.file.level = 'info';
  
  // 文件大小限制（5MB）
  electronLog.transports.file.maxSize = 5 * 1024 * 1024;
  
  // 控制台日志级别（开发模式）
  electronLog.transports.console.level = process.env.NODE_ENV === 'development' ? 'debug' : 'warn';
  
  // 日志格式
  electronLog.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}] [{level}] {text}';
  electronLog.transports.console.format = '[{h}:{i}:{s}] [{level}] {text}';
  
  // 清理旧日志（保留 7 天）
  cleanOldLogs(logDir, 7);
  
  return logDir;
}

/**
 * 清理旧日志文件
 */
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

// 初始化日志目录
let logDirectory = null;
if (electronLog && app.isReady()) {
  logDirectory = configureElectronLog();
} else if (electronLog) {
  app.whenReady().then(() => {
    logDirectory = configureElectronLog();
  });
}

/**
 * 获取日志目录路径
 */
function getLogDirectory() {
  if (logDirectory) return logDirectory;
  if (app.isReady()) {
    return path.join(app.getPath('userData'), 'logs');
  }
  return null;
}

/**
 * 创建带作用域的 Logger
 * @param {string} scope - 模块名称
 * @returns {Object} Logger 实例
 */
function createLogger(scope) {
  const prefix = `[${scope}]`;
  
  // 如果 electron-log 可用，使用它
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
      
      // 保持兼容性
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
  
  // 降级模式：使用 console
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
module.exports.filterSensitive = filterSensitive;
