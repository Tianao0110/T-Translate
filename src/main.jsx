// src/main.jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import './i18n'; // 国际化配置 - 必须在组件导入前
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import createLogger from './utils/logger.js';
import { initGlobalErrorHandler } from './utils/global-error-handler.js';
import './styles/index.css';
import './styles/main.css';

/**
 * React 应用入口
 * 初始化应用并挂载到 DOM
 */

// 日志实例
const logger = createLogger('Main');

// 初始化全局错误处理
initGlobalErrorHandler();

// 开发环境性能监控
if (process.env.NODE_ENV === 'development') {
  // React DevTools 性能分析
  if (window.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot = (
      id,
      root,
      priorityLevel,
      didTimeout
    ) => {
      // 可以在这里添加性能监控逻辑
    };
  }

  // 监控长任务（仅报告超过 200ms 的任务）
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
      // LongTask API 不支持，静默忽略
    }
  }
}

// 检查 Electron API 是否可用
const checkElectronAPI = () => {
  if (!window.electron) {
    logger.warn('Electron API not available - Running in browser mode');
    return;
  }

  logger.debug('Electron API available');
    
  // 监听菜单事件
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
  
  // 监听文件导入事件
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

// 主题初始化
const initTheme = () => {
  const savedTheme = localStorage.getItem('theme') || 'light';
  document.documentElement.setAttribute('data-theme', savedTheme);
  
  // 监听系统主题变化
  if (window.matchMedia) {
    const darkModeQuery = window.matchMedia('(prefers-color-scheme: dark)');
    
    darkModeQuery.addEventListener('change', (e) => {
      if (localStorage.getItem('theme') === 'auto') {
        document.documentElement.setAttribute(
          'data-theme',
          e.matches ? 'dark' : 'light'
        );
      }
    });
    
    // 如果是 auto 模式，应用系统主题
    if (savedTheme === 'auto') {
      document.documentElement.setAttribute(
        'data-theme',
        darkModeQuery.matches ? 'dark' : 'light'
      );
    }
  }
};

// 初始化应用
const initApp = () => {
  checkElectronAPI();
  initTheme();
  
  // 创建 React 根节点
  const container = document.getElementById('root');
  
  if (!container) {
    logger.error('Root element not found!');
    document.body.innerHTML = '<div style="color: red; padding: 20px;">Error: Root element not found!</div>';
    return;
  }
  
  const root = ReactDOM.createRoot(container);
  
  // 渲染应用
  root.render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  );
  
  logger.success('T-Translate started');
};

// 等待 DOM 加载完成
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

// 热重载支持（开发环境）
if (import.meta.hot) {
  import.meta.hot.accept('./App', () => {
    logger.debug('Hot reload triggered');
  });
}

// 导出一些全局函数供调试使用（仅开发环境有日志输出）
window.TTranslate = {
  // 版本号 - 动态获取
  getVersion: async () => {
    try {
      return await window.electron?.app?.getVersion?.() || '0.0.0';
    } catch {
      return '0.0.0';
    }
  },
  
  // 调试函数
  debug: {
    // 清除所有缓存
    clearCache: () => {
      localStorage.clear();
      sessionStorage.clear();
      logger.info('Cache cleared');
    },
    
    // 重置应用
    reset: () => {
      if (confirm('确定要重置应用吗？这将清除所有数据')) {
        localStorage.clear();
        sessionStorage.clear();
        window.location.reload();
      }
    },
    
    // 导出应用状态
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
    
    // 显示性能信息
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
    
    // 测试 LM Studio 连接
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

// 开发环境下添加调试快捷键
if (process.env.NODE_ENV === 'development') {
  document.addEventListener('keydown', (e) => {
    // Ctrl+Shift+D 打开调试面板
    if (e.ctrlKey && e.shiftKey && e.key === 'D') {
      logger.debug('Debug shortcut triggered');
    }
  });
}