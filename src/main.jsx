import React from 'react';
import ReactDOM from 'react-dom/client';
import './i18n'; // i18n init must run before any component imports a translation
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import createLogger from './utils/logger.js';
import { initGlobalErrorHandler } from './utils/global-error-handler.js';
import './styles/index.css';

const logger = createLogger('Main');

initGlobalErrorHandler();

if (process.env.NODE_ENV === 'development') {
  if (window.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot = (
      id,
      root,
      priorityLevel,
      didTimeout
    ) => {};
  }

  // Surface long-running tasks (>200ms) to find render jank
  if ('PerformanceObserver' in window) {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration > 200) {
          logger.warn('Long Task:', Math.round(entry.duration) + 'ms');
        }
      }
    });

    try {
      observer.observe({ entryTypes: ['longtask'] });
    } catch (e) {
      // longtask not supported on every Electron Chromium version — ignore
    }
  }
}

const checkElectronAPI = () => {
  if (!window.electron) {
    logger.warn('Electron API not available - Running in browser mode');
    return;
  }

  logger.debug('Electron API available');

  // Menu actions arrive via either the typed API (newer preload) or raw IPC
  if (window.electron.menu && window.electron.menu.onAction) {
    window.electron.menu.onAction((action) => {
      logger.debug('Menu action:', action);
      window.dispatchEvent(new CustomEvent('menu-action', { detail: action }));
    });
  } else if (window.electron.ipc) {
    window.electron.ipc.on('menu-action', (action) => {
      logger.debug('Menu action (IPC):', action);
      window.dispatchEvent(new CustomEvent('menu-action', { detail: action }));
    });
  }

  if (window.electron.translation && window.electron.translation.onImportFile) {
    window.electron.translation.onImportFile((filePath) => {
      logger.debug('Import file:', filePath);
      window.dispatchEvent(new CustomEvent('import-file', { detail: filePath }));
    });
  } else if (window.electron.ipc) {
    window.electron.ipc.on('import-file', (filePath) => {
      logger.debug('Import file (IPC):', filePath);
      window.dispatchEvent(new CustomEvent('import-file', { detail: filePath }));
    });
  }
};

const initTheme = () => {
  const savedTheme = localStorage.getItem('theme') || 'light';
  document.documentElement.setAttribute('data-theme', savedTheme);

  if (window.matchMedia) {
    const darkModeQuery = window.matchMedia('(prefers-color-scheme: dark)');

    // Only react to OS theme changes when user explicitly chose 'auto'
    darkModeQuery.addEventListener('change', (e) => {
      if (localStorage.getItem('theme') === 'auto') {
        document.documentElement.setAttribute(
          'data-theme',
          e.matches ? 'dark' : 'light'
        );
      }
    });

    if (savedTheme === 'auto') {
      document.documentElement.setAttribute(
        'data-theme',
        darkModeQuery.matches ? 'dark' : 'light'
      );
    }
  }
};

const initApp = () => {
  checkElectronAPI();
  initTheme();

  const container = document.getElementById('root');

  if (!container) {
    logger.error('Root element not found!');
    document.body.innerHTML = '<div style="color: red; padding: 20px;">Error: Root element not found!</div>';
    return;
  }

  const root = ReactDOM.createRoot(container);

  root.render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  );

  logger.success('T-Translate started');
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

if (import.meta.hot) {
  import.meta.hot.accept('./App', () => {
    logger.debug('Hot reload triggered');
  });
}

// Debug surface exposed globally for devtools console use.
window.TTranslate = {
  getVersion: async () => {
    try {
      return await window.electron?.app?.getVersion?.() || '0.0.0';
    } catch {
      return '0.0.0';
    }
  },

  debug: {
    clearCache: () => {
      localStorage.clear();
      sessionStorage.clear();
      logger.info('Cache cleared');
    },

    reset: () => {
      if (confirm('确定要重置应用吗？这将清除所有数据')) {
        localStorage.clear();
        sessionStorage.clear();
        window.location.reload();
      }
    },

    exportState: () => {
      const state = {
        localStorage: { ...localStorage },
        sessionStorage: { ...sessionStorage },
        timestamp: new Date().toISOString()
      };

      const blob = new Blob([JSON.stringify(state, null, 2)], {
        type: 'application/json'
      });

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `t-translate-state-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);

      logger.info('State exported');
    },

    showPerformance: () => {
      if (window.performance && window.performance.memory) {
        const memory = window.performance.memory;
        console.table({
          '已用 JS 堆大小': `${(memory.usedJSHeapSize / 1024 / 1024).toFixed(2)} MB`,
          'JS 堆大小限制': `${(memory.jsHeapSizeLimit / 1024 / 1024).toFixed(2)} MB`,
          '总 JS 堆大小': `${(memory.totalJSHeapSize / 1024 / 1024).toFixed(2)} MB`
        });
      }
    },

    testLLMConnection: async () => {
      try {
        const response = await fetch('http://localhost:1234/v1/models');
        if (response.ok) {
          const data = await response.json();
          logger.info('LM Studio connected');
          console.table(data.data?.map(m => ({ id: m.id })) || []);
          return data;
        } else {
          logger.error('LM Studio connection failed:', response.status);
        }
      } catch (error) {
        logger.error('LM Studio error:', error.message);
      }
    }
  }
};

if (process.env.NODE_ENV === 'development') {
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'D') {
      logger.debug('Debug shortcut triggered');
    }
  });
}
