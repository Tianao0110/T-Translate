// src/main.jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/index.css';
import './styles/main.css';

/**
 * React 应用入口
 * 初始化应用并挂载到 DOM
 */

// 错误边界组件
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error('React Error Boundary Caught:', error, errorInfo);
    this.setState({
      error,
      errorInfo
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100vh',
          padding: '20px',
          backgroundColor: '#f5f5f5'
        }}>
          <h1 style={{ color: '#ff4444', marginBottom: '20px' }}>
            😕 出现了一些问题
          </h1>
          <p style={{ marginBottom: '20px', color: '#666' }}>
            应用遇到了错误，请尝试刷新页面
          </p>
          <details style={{ whiteSpace: 'pre-wrap', maxWidth: '600px' }}>
            <summary style={{ cursor: 'pointer', marginBottom: '10px' }}>
              错误详情
            </summary>
            {this.state.error && this.state.error.toString()}
            <br />
            {this.state.errorInfo && this.state.errorInfo.componentStack}
          </details>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: '20px',
              padding: '10px 20px',
              backgroundColor: '#4CAF50',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '16px'
            }}
          >
            刷新页面
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

// 全局错误处理
window.addEventListener('unhandledrejection', event => {
  console.error('Unhandled promise rejection:', event.reason);
});

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

  // 监控长任务
  if ('PerformanceObserver' in window) {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration > 50) {
          console.warn('Long Task detected:', {
            name: entry.name,
            duration: entry.duration,
            startTime: entry.startTime
          });
        }
      }
    });
    
    try {
      observer.observe({ entryTypes: ['longtask'] });
    } catch (e) {
      console.log('LongTask monitoring not supported');
    }
  }
}

// 检查 Electron API 是否可用
const checkElectronAPI = () => {
  if (!window.electron) {
    console.warn('⚠️ Electron API not available - Running in browser mode');
    return;
  }

  console.log('✅ Electron API available');
    
    // 获取应用信息
    if (window.electron.app && window.electron.app.getVersion) {
      window.electron.app.getVersion().then(version => {
        console.log('App Version:', version);
      }).catch(e => console.error(e));
    }
    
    // 获取平台信息
    // const systemInfo = window.electron.system.getInfo();
    // console.log('System Info:', systemInfo);
    
    // 监听菜单事件
    if (window.electron.menu && window.electron.menu.onAction) {
      window.electron.menu.onAction((action) => {
        console.log('Menu action received:', action);
        window.dispatchEvent(new CustomEvent('menu-action', { detail: action }));
      });
    } else if (window.electron.ipc) {
      // 备用方案：如果 menu 对象不存在，尝试直接用通用 IPC
      window.electron.ipc.on('menu-action', (action) => {
        console.log('Menu action received (IPC):', action);
        window.dispatchEvent(new CustomEvent('menu-action', { detail: action }));
      });
    }
    
    // 监听文件导入事件
    if (window.electron.translation && window.electron.translation.onImportFile) {
      window.electron.translation.onImportFile((filePath) => {
        console.log('Import file:', filePath);
        window.dispatchEvent(new CustomEvent('import-file', { detail: filePath }));
      });
    } else if (window.electron.ipc) {
      // 备用方案
      window.electron.ipc.on('import-file', (filePath) => {
        console.log('Import file (IPC):', filePath);
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
    console.error('Root element not found!');
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
  
  console.log('🚀 T-Translate Core started');
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
    console.log('🔥 Hot reload triggered');
  });
}

// 导出一些全局函数供调试使用
window.TTranslate = {
  version: '1.0.0',
  
  // 调试函数
  debug: {
    // 清除所有缓存
    clearCache: () => {
      localStorage.clear();
      sessionStorage.clear();
      console.log('Cache cleared');
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
      
      console.log('State exported');
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
      
      if (window.electron && window.performance.getMemoryUsage) {
        const usage = window.performance.getMemoryUsage();
        console.table(usage);
      }
    },
    
    // 测试 LM Studio 连接
    testLLMConnection: async () => {
      try {
        const response = await fetch('http://localhost:1234/v1/models');
        if (response.ok) {
          const data = await response.json();
          console.log('✅ LM Studio 连接成功');
          console.log('可用模型:', data);
          return data;
        } else {
          console.error('❌ LM Studio 连接失败:', response.status);
        }
      } catch (error) {
        console.error('❌ LM Studio 连接错误:', error.message);
        console.log('请确保 LM Studio 正在运行并且已加载模型');
      }
    }
  }
};

// 开发环境下自动打开 DevTools
if (process.env.NODE_ENV === 'development') {
  // 添加键盘快捷键
  document.addEventListener('keydown', (e) => {
    // Ctrl+Shift+D 打开调试面板
    if (e.ctrlKey && e.shiftKey && e.key === 'D') {
      console.log('Debug panel shortcut triggered');
      // 可以在这里打开自定义调试面板
    }
  });
}