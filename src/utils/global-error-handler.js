// src/utils/global-error-handler.js
// 全局错误捕获 - 捕获未处理的 JS 错误和 Promise 拒绝

import createLogger from './logger.js';

const logger = createLogger('GlobalError');

/**
 * 初始化全局错误处理
 * 应在应用启动时调用
 */
export function initGlobalErrorHandler() {
  // 捕获未处理的 JS 错误
  window.onerror = (message, source, lineno, colno, error) => {
    logger.error('Uncaught error:', {
      message,
      source,
      line: lineno,
      column: colno,
    });
    
    // 返回 true 阻止默认处理（控制台报错）
    // 返回 false 或 undefined 允许默认处理
    return false;
  };

  // 捕获未处理的 Promise 拒绝
  window.onunhandledrejection = (event) => {
    logger.error('Unhandled promise rejection:', event.reason);
    
    // 阻止默认处理（控制台报错）
    // event.preventDefault();
  };

  // 捕获资源加载错误（图片、脚本等）
  window.addEventListener('error', (event) => {
    if (event.target !== window) {
      // 资源加载错误
      const target = event.target;
      logger.warn('Resource load error:', {
        tagName: target.tagName,
        src: target.src || target.href,
      });
    }
  }, true);

  logger.debug('Global error handler initialized');
}

/**
 * 安全执行函数
 * 捕获同步和异步错误
 * @param {Function} fn - 要执行的函数
 * @param {*} fallback - 错误时的返回值
 * @returns {*} 函数返回值或 fallback
 */
export async function safeExecute(fn, fallback = null) {
  try {
    const result = fn();
    // 如果返回 Promise，等待它
    if (result instanceof Promise) {
      return await result;
    }
    return result;
  } catch (error) {
    logger.error('Safe execute error:', error);
    return fallback;
  }
}

/**
 * 创建安全的事件处理器
 * @param {Function} handler - 原始处理器
 * @param {string} name - 处理器名称（用于日志）
 * @returns {Function} 包装后的处理器
 */
export function createSafeHandler(handler, name = 'handler') {
  return async (...args) => {
    try {
      const result = handler(...args);
      if (result instanceof Promise) {
        return await result;
      }
      return result;
    } catch (error) {
      logger.error(`${name} error:`, error);
      return null;
    }
  };
}

export default {
  initGlobalErrorHandler,
  safeExecute,
  createSafeHandler,
};
