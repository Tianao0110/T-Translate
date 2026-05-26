import createLogger from './logger.js';

const logger = createLogger('GlobalError');

export function initGlobalErrorHandler() {
  window.onerror = (message, source, lineno, colno, error) => {
    logger.error('Uncaught error:', {
      message,
      source,
      line: lineno,
      column: colno,
    });
    return false;
  };

  window.onunhandledrejection = (event) => {
    logger.error('Unhandled promise rejection:', event.reason);
  };

  window.addEventListener('error', (event) => {
    if (event.target !== window) {
      const target = event.target;
      logger.warn('Resource load error:', {
        tagName: target.tagName,
        src: target.src || target.href,
      });
    }
  }, true);

  logger.debug('Global error handler initialized');
}

export async function safeExecute(fn, fallback = null) {
  try {
    const result = fn();
    if (result instanceof Promise) {
      return await result;
    }
    return result;
  } catch (error) {
    logger.error('Safe execute error:', error);
    return fallback;
  }
}

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
