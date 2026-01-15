// electron/utils/logger.js
// 统一日志入口

const { isDev } = require('../state');

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
 * 当前日志级别（可通过环境变量调整）
 */
const currentLevel = isDev ? LOG_LEVELS.DEBUG : LOG_LEVELS.WARN;

/**
 * 格式化时间戳
 */
function getTimestamp() {
  const now = new Date();
  return now.toTimeString().slice(0, 8);
}

/**
 * 创建带作用域的 Logger
 * @param {string} scope - 模块名称
 * @returns {Object} Logger 实例
 */
function createLogger(scope) {
  const prefix = `[${scope}]`;
  
  return {
    debug: (...args) => {
      if (currentLevel <= LOG_LEVELS.DEBUG) {
        console.log(`[${getTimestamp()}] ${prefix} [DEBUG]`, ...args);
      }
    },
    
    info: (...args) => {
      if (currentLevel <= LOG_LEVELS.INFO) {
        console.log(`[${getTimestamp()}] ${prefix} [INFO]`, ...args);
      }
    },
    
    warn: (...args) => {
      if (currentLevel <= LOG_LEVELS.WARN) {
        console.warn(`[${getTimestamp()}] ${prefix} [WARN]`, ...args);
      }
    },
    
    error: (...args) => {
      console.error(`[${getTimestamp()}] ${prefix} [ERROR]`, ...args);
    },
    
    success: (...args) => {
      if (currentLevel <= LOG_LEVELS.INFO) {
        console.log(`[${getTimestamp()}] ${prefix} [OK]`, ...args);
      }
    },
    
    group: (label) => {
      if (isDev) {
        console.group(`[${getTimestamp()}] ${prefix} ${label}`);
      }
    },
    
    groupEnd: () => {
      if (isDev) {
        console.groupEnd();
      }
    },
    
    time: (label) => {
      if (isDev) {
        console.time(`${prefix} ${label}`);
      }
    },
    
    timeEnd: (label) => {
      if (isDev) {
        console.timeEnd(`${prefix} ${label}`);
      }
    },
  };
}

module.exports = createLogger;
module.exports.LOG_LEVELS = LOG_LEVELS;
