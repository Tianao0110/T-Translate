// src/App.jsx
import React, { useEffect, useState } from 'react';
import TitleBar from './components/TitleBar';
import MainWindow from './components/MainWindow';
import useTranslationStore from './stores/translation-store';
import useConfigStore from './stores/config';
import createLogger from './utils/logger.js';
import './styles/App.css';

// 从配置中心导入常量
import { THEMES } from '@config/defaults'; 

// 日志实例
const logger = createLogger('App');

// 暴露 store 到 window，供玻璃窗口/划词翻译通过 IPC 获取设置
if (typeof window !== 'undefined') {
  window.__TRANSLATION_STORE__ = useTranslationStore;
  window.__CONFIG_STORE__ = useConfigStore;
}

function App() {
  try {
    const [theme, setTheme] = useState(THEMES.LIGHT);
    const setPendingScreenshot = useTranslationStore(state => state.setPendingScreenshot);
    const addToFavorites = useTranslationStore(state => state.addToFavorites);
    const addToHistory = useTranslationStore(state => state.addToHistory);
    const setTargetLanguage = useTranslationStore(state => state.setTargetLanguage);

    useEffect(() => {
      // 1. 初始化主题 - 优先从 store 获取，确保与设置同步
      const initTheme = async () => {
        let savedTheme = 'light';
        
        try {
          // 优先从 store 获取（settings 中的主题是权威来源）
          if (window.electron?.theme?.get) {
            const result = await window.electron.theme.get();
            if (result?.success && result.theme) {
              savedTheme = result.theme;
            }
          } else {
            // 降级：从 localStorage 获取
            savedTheme = localStorage.getItem('theme') || 'light';
          }
        } catch (e) {
          // 出错时从 localStorage 获取
          savedTheme = localStorage.getItem('theme') || 'light';
        }
        
        // 同步到 localStorage（确保一致性）
        localStorage.setItem('theme', savedTheme);
        setTheme(savedTheme);
        document.documentElement.setAttribute('data-theme', savedTheme);
      };
      
      initTheme();

      // 2. 监听主题变化（来自 IPC 广播）
      let unsubscribeTheme = null;
      if (window.electron?.theme?.onChanged) {
        unsubscribeTheme = window.electron.theme.onChanged((newTheme) => {
          logger.debug('Theme changed via IPC:', newTheme);
          setTheme(newTheme);
          document.documentElement.setAttribute('data-theme', newTheme);
          localStorage.setItem('theme', newTheme);
        });
      }

      // 3. 监听 storage 事件（跨标签页同步）
      const handleStorageChange = (e) => {
        if (e.key === 'theme') {
          const newTheme = e.newValue || 'light';
          setTheme(newTheme);
          document.documentElement.setAttribute('data-theme', newTheme);
        }
      };
      window.addEventListener('storage', handleStorageChange);

      // 4. 通知 index.html 移除加载动画
      const timer = setTimeout(() => {
        if (window) {
            window.__APP_LOADED__ = true;
            window.dispatchEvent(new Event('app-ready'));
        }
      }, 500);

      return () => {
        window.removeEventListener('storage', handleStorageChange);
        if (unsubscribeTheme) unsubscribeTheme();
        clearTimeout(timer);
      };
    }, []);

    // 全局截图监听（始终挂载，不会因标签切换而丢失）
    useEffect(() => {
      if (!window.electron?.screenshot?.onCaptured) {
        logger.warn('Screenshot API not available');
        return;
      }

      const unsubscribe = window.electron.screenshot.onCaptured((dataURL) => {
        logger.debug('Screenshot captured, length:', dataURL?.length || 0);
        if (dataURL) {
          setPendingScreenshot(dataURL);
        }
      });

      return () => {
        if (unsubscribe) unsubscribe();
      };
    }, [setPendingScreenshot]);

    // 监听玻璃窗口的收藏请求
    useEffect(() => {
      if (!window.electron?.ipcRenderer) {
        logger.warn('IPC not available for glass favorites');
        return;
      }

      const handleAddToFavorites = (event, item) => {
        logger.debug('Received add-to-favorites:', item?.sourceText?.substring(0, 30));
        if (item && addToFavorites) {
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
        logger.debug('Received add-to-history from:', item?.from || item?.source);
        if (item && addToHistory) {
          addToHistory({
            id: item.id || `${item.from || 'unknown'}-${Date.now()}`,
            sourceText: item.sourceText || item.source || '',
            translatedText: item.translatedText || item.result || '',
            sourceLanguage: item.sourceLanguage || 'auto',
            targetLanguage: item.targetLanguage || 'en',
            timestamp: item.timestamp || Date.now(),
            source: item.from || item.source || 'unknown'
          });
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
        logger.debug('Sync target language:', langCode);
        if (langCode && setTargetLanguage) {
          setTargetLanguage(langCode);
        }
      };

      window.electron.ipcRenderer.on('sync-target-language', handleSyncLanguage);

      return () => {
        window.electron.ipcRenderer.removeListener('sync-target-language', handleSyncLanguage);
      };
    }, [setTargetLanguage]);

    return (
      <div className={`app ${theme} no-titlebar`}>
        {/* Electron 标题栏 */}
        <TitleBar />
        
        {/* 主应用界面 */}
        <MainWindow />
      </div>
    );

  } catch (error) {
    logger.error('App crashed:', error);
    return (
      <div style={{ color: 'white', backgroundColor: '#333', padding: '20px', height: '100vh' }}>
        <h1>程序启动失败</h1>
        <pre>{error.toString()}</pre>
      </div>
    );
  }
}

export default App;