import createLogger from './logger.js';

const logger = createLogger('GlobalError');

export function initGlobalErrorHandler() {
  window.onerror = (message, source, lineno, colno, error) => {
    // `error` carries the stack; the message/line/column trio alone points at
    // a bundled column number nobody can act on.
    logger.error(`Uncaught error at ${source}:${lineno}:${colno} —`, error || message);
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
