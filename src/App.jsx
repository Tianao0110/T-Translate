// src/App.jsx
import React, { useEffect, useState } from 'react';
import TitleBar from './components/TitleBar';
import MainWindow from './components/MainWindow';
import useTranslationStore from './stores/translation-store';
import './styles/App.css'; 

// 暴露 store 到 window，供玻璃窗口通过 IPC 获取设置
if (typeof window !== 'undefined') {
  window.__TRANSLATION_STORE__ = useTranslationStore;
}

function App() {
  console.log("▶ App component started rendering...");

  try {
    const [theme, setTheme] = useState('light');
    const setPendingScreenshot = useTranslationStore(state => state.setPendingScreenshot);
    const addToFavorites = useTranslationStore(state => state.addToFavorites);
    const addToHistory = useTranslationStore(state => state.addToHistory);
    const setTargetLanguage = useTranslationStore(state => state.setTargetLanguage);

    useEffect(() => {
      console.log("▶ App useEffect running...");
      
      // 1. 初始化主题
      const savedTheme = localStorage.getItem('theme') || 'light';
      setTheme(savedTheme);
      document.documentElement.setAttribute('data-theme', savedTheme);

      const handleStorageChange = () => {
        const newTheme = localStorage.getItem('theme') || 'light';
        setTheme(newTheme);
        document.documentElement.setAttribute('data-theme', newTheme);
      };
      
      window.addEventListener('storage', handleStorageChange);

      // =========================================================
      // 🔴 关键修复：通知 index.html 移除加载动画
      // =========================================================
      const timer = setTimeout(() => {
        console.log("🚀 Signaling app-ready to index.html...");
        // 设置全局标记，防止超时报错
        if (window) {
            window.__APP_LOADED__ = true;
            // 触发自定义事件，通知 index.html 淡出加载屏
            window.dispatchEvent(new Event('app-ready'));
        }
      }, 500); // 稍微延迟一点，确保界面渲染完成
      // =========================================================

      return () => {
        window.removeEventListener('storage', handleStorageChange);
        clearTimeout(timer);
      };
    }, []);

    // 全局截图监听（始终挂载，不会因标签切换而丢失）
    useEffect(() => {
      console.log('[App] Setting up global screenshot listener');
      
      if (!window.electron?.screenshot?.onCaptured) {
        console.warn('[App] Screenshot API not available');
        return;
      }

      const unsubscribe = window.electron.screenshot.onCaptured((dataURL) => {
        console.log('[App] Screenshot captured, length:', dataURL?.length || 0);
        if (dataURL) {
          // 将截图数据存入 Store，TranslationPanel 会监听并处理
          setPendingScreenshot(dataURL);
        }
      });

      return () => {
        console.log('[App] Cleaning up global screenshot listener');
        if (unsubscribe) unsubscribe();
      };
    }, [setPendingScreenshot]);

    // 监听玻璃窗口的收藏请求
    useEffect(() => {
      console.log('[App] Setting up glass window favorites listener');
      
      if (!window.electron?.ipcRenderer) {
        console.warn('[App] IPC not available for glass favorites');
        return;
      }

      const handleAddToFavorites = (event, item) => {
        console.log('[App] Received add-to-favorites from glass window:', item);
        if (item && addToFavorites) {
          // 传递完整数据，包括 id、tags 等，以支持 AI 标签等功能
          addToFavorites({
            id: item.id || `glass-${Date.now()}`,
            sourceText: item.sourceText || '',
            translatedText: item.translatedText || '',
            sourceLanguage: item.sourceLanguage || 'auto',
            targetLanguage: item.targetLanguage || 'zh',
            timestamp: item.timestamp || Date.now(),
            tags: item.tags || [],
            folderId: item.folderId || null,
            isStyleReference: item.isStyleReference || false,
            source: item.source || 'glass-translator'
          });
          console.log('[App] Added to favorites successfully');
        }
      };

      window.electron.ipcRenderer.on('add-to-favorites', handleAddToFavorites);

      return () => {
        window.electron.ipcRenderer.removeListener('add-to-favorites', handleAddToFavorites);
      };
    }, [addToFavorites]);

    // 监听玻璃窗口和划词翻译的历史记录请求
    useEffect(() => {
      if (!window.electron?.ipcRenderer) return;

      const handleAddToHistory = (event, item) => {
        console.log('[App] Received add-to-history:', item);
        if (item && addToHistory) {
          // 兼容不同来源的字段名
          // glass: sourceText, translatedText
          // selection: source, result
          addToHistory({
            id: item.id || `${item.from || 'unknown'}-${Date.now()}`,
            sourceText: item.sourceText || item.source || '',
            translatedText: item.translatedText || item.result || '',
            sourceLanguage: item.sourceLanguage || 'auto',
            targetLanguage: item.targetLanguage || 'en',
            timestamp: item.timestamp || Date.now(),
            source: item.from || item.source || 'unknown'
          });
          console.log('[App] Added to history successfully');
        }
      };

      window.electron.ipcRenderer.on('add-to-history', handleAddToHistory);

      return () => {
        window.electron.ipcRenderer.removeListener('add-to-history', handleAddToHistory);
      };
    }, [addToHistory]);

    // 监听玻璃窗口的目标语言同步
    useEffect(() => {
      if (!window.electron?.ipcRenderer) return;

      const handleSyncLanguage = (event, langCode) => {
        console.log('[App] Received sync-target-language from glass window:', langCode);
        if (langCode && setTargetLanguage) {
          setTargetLanguage(langCode);
          console.log('[App] Target language synced to:', langCode);
        }
      };

      window.electron.ipcRenderer.on('sync-target-language', handleSyncLanguage);

      return () => {
        window.electron.ipcRenderer.removeListener('sync-target-language', handleSyncLanguage);
      };
    }, [setTargetLanguage]);

    console.log("▶ App state initialized, rendering JSX...");

    return (
      <div className={`app ${theme} no-titlebar`}>
        {/* Electron 标题栏 */}
        <TitleBar />
        
        {/* 主应用界面 */}
        <MainWindow />
      </div>
    );

  } catch (error) {
    console.error("❌ App crashed:", error);
    return (
      <div style={{ color: 'white', backgroundColor: '#333', padding: '20px', height: '100vh' }}>
        <h1>程序启动失败</h1>
        <pre>{error.toString()}</pre>
      </div>
    );
  }
}

export default App;