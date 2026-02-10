// src/utils/logger.js
// 渲染进程统一日志系统
// 与主进程 electron/utils/logger.js 保持一致的接口

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
 * 检测是否为开发环境
 */
const isDev = import.meta.env?.DEV ?? 
              process.env.NODE_ENV === 'development' ?? 
              window.location.hostname === 'localhost';

/**
 * 当前日志级别
 * - 开发环境：显示所有日志
 * - 生产环境：只显示 WARN 和 ERROR
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
 * 
 * @example
 * const logger = createLogger('TranslationService');
 * logger.debug('Initializing...');
 * logger.info('Ready');
 * logger.warn('Config missing');
 * logger.error('Failed:', error);
 */
function createLogger(scope) {
  const prefix = `[${scope}]`;
  
  return {
    /**
     * 调试日志 - 仅开发环境显示
     */
    debug: (...args) => {
      if (currentLevel <= LOG_LEVELS.DEBUG) {
        console.log(`${prefix}`, ...args);
      }
    },
    
    /**
     * 信息日志 - 开发环境显示
     */
    info: (...args) => {
      if (currentLevel <= LOG_LEVELS.INFO) {
        console.log(`${prefix}`, ...args);
      }
    },
    
    /**
     * 警告日志 - 始终显示
     */
    warn: (...args) => {
      if (currentLevel <= LOG_LEVELS.WARN) {
        console.warn(`${prefix}`, ...args);
      }
    },
    
    /**
     * 错误日志 - 始终显示
     */
    error: (...args) => {
      console.error(`${prefix}`, ...args);
    },
    
    /**
     * 成功日志（等同于 info）
     */
    success: (...args) => {
      if (currentLevel <= LOG_LEVELS.INFO) {
        console.log(`${prefix} ✓`, ...args);
      }
    },
  };
}

// 导出
export default createLogger;
export { LOG_LEVELS, isDev };
