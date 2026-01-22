// src/components/MainWindow/index.jsx
import createLogger from '../../utils/logger.js';
const logger = createLogger('MainWindow');
import React, { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FileText, Languages, Settings, History, Star,
  AlertCircle, CheckCircle, Info, X, FileUp, Loader2
} from 'lucide-react';

import useTranslationStore from '../../stores/translation-store';
// TranslationPanel 是首屏必需，直接导入
import TranslationPanel from '../TranslationPanel';
// 其他面板懒加载
const HistoryPanel = lazy(() => import('../HistoryPanel'));
const SettingsPanel = lazy(() => import('../SettingsPanel'));
const FavoritesPanel = lazy(() => import('../FavoritesPanel'));
const DocumentTranslator = lazy(() => import('../DocumentTranslator'));
import './styles.css';

// 从配置中心导入常量
import { TRANSLATION_STATUS } from '@config/defaults'; 

// 懒加载 Loading 组件
const LazyLoadingFallback = () => (
  <div className="lazy-loading-fallback">
    <Loader2 className="spinning" size={24} />
    <span>Loading...</span>
  </div>
); 

/**
 * 主窗口组件
 */
const MainWindow = () => {
  const { t } = useTranslation();
  
  // UI 状态
  const [activeTab, setActiveTab] = useState('translate');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [notification, setNotification] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterOptions, setFilterOptions] = useState({
    language: 'all',
    dateRange: 'all',
    favorites: false
  });
  
  // 版本号
  const [version, setVersion] = useState('');
  
  // 文档翻译弹窗
  const [showDocTranslator, setShowDocTranslator] = useState(false);
  
  // Store
  const {
    currentTranslation,
    statistics, // 这个可能是旧的，如果 store 没有实时计算，可能需要 getStatistics
    getStatistics, // 获取最新的统计数据方法
    translate,
    clearCurrent,
    swapLanguages,
    copyToClipboard,
    exportHistory,
    setSourceText,
    ocrStatus,
    recognizeImage, // OCR 识别
  } = useTranslationStore();

  // Refs
  const searchInputRef = useRef(null);
  
  // 截图 OCR 数据（传递给 TranslationPanel）
  const [screenshotData, setScreenshotData] = useState(null);

  // 初始化统计数据 (如果 store 没有自动初始化)
  useEffect(() => {
    if(getStatistics) getStatistics();
  }, [getStatistics]);

  // 获取应用版本号
  useEffect(() => {
    const fetchVersion = async () => {
      try {
        const ver = await window.electron?.app?.getVersion?.();
        setVersion(ver || '0.0.0');
      } catch {
        setVersion('0.0.0');
      }
    };
    fetchVersion();
  }, []);

  // 全局截图监听 - 始终挂载，不会因标签切换而丢失
  useEffect(() => {
    if (!window.electron?.screenshot?.onCaptured) {
      logger.warn(' Screenshot onCaptured not available');
      return;
    }

    logger.debug(' Setting up global screenshot listener');
    
    const unsubscribe = window.electron.screenshot.onCaptured(async (dataURL) => {
      logger.debug(' Screenshot captured, dataURL length:', dataURL?.length || 0);
      
      // 1. 先切换到翻译标签
      setActiveTab('translate');
      
      if (!dataURL) {
        showNotification(t('screenshot.failed'), 'error');
        return;
      }
      
      // 2. 传递截图数据给 TranslationPanel 处理
      setScreenshotData({
        dataURL,
        timestamp: Date.now()
      });
    });

    return () => {
      logger.debug(' Cleaning up global screenshot listener');
      if (unsubscribe) unsubscribe();
    };
  }, []);

  // 静默模式截图监听 - 后台处理，不显示主窗口
  useEffect(() => {
    if (!window.electron?.screenshot?.onCapturedSilent) {
      logger.debug(' Screenshot onCapturedSilent not available');
      return;
    }

    logger.debug(' Setting up silent screenshot listener');
    
    const unsubscribe = window.electron.screenshot.onCapturedSilent(async (dataURL) => {
      logger.debug(' [Silent] Screenshot captured, processing OCR...');
      
      if (!dataURL) {
        logger.error(' [Silent] Screenshot failed: no data');
        return;
      }
      
      try {
        // OCR 识别
        const engineToUse = ocrStatus?.engine || 'llm-vision';
        logger.debug('[Silent] OCR with engine:', engineToUse);
        
        const ocrResult = await recognizeImage(dataURL, { 
          engine: engineToUse,
          autoSetSource: false
        });
        
        if (!ocrResult.success || !ocrResult.text) {
          logger.warn('[Silent] OCR failed or no text:', ocrResult);
          // 通知主进程 OCR 失败
          window.electron?.screenshot?.notifyOcrComplete?.({ 
            success: false, 
            error: ocrResult.error || '未识别到文字' 
          });
          return;
        }
        
        logger.debug('[Silent] OCR success, sending text to selection window');
        
        // OCR 完成，把文字发给划词窗口让它自己翻译
        window.electron?.screenshot?.notifyOcrComplete?.({
          success: true,
          text: ocrResult.text,
        });
      } catch (error) {
        logger.error('[Silent] OCR error:', error);
        window.electron?.screenshot?.notifyOcrComplete?.({ 
          success: false, 
          error: error.message 
        });
      }
    });

    return () => {
      logger.debug(' Cleaning up silent screenshot listener');
      if (unsubscribe) unsubscribe();
    };
  }, [ocrStatus, recognizeImage, translate]);

  // 全局快捷键
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ctrl/Cmd + 1-4 切换标签
      if ((e.ctrlKey || e.metaKey) && e.key >= '1' && e.key <= '4') {
        // e.preventDefault(); // 暂时不阻止默认，防止影响输入数字
        const tabs = ['translate', 'history', 'favorites', 'settings'];
        const index = parseInt(e.key) - 1;
        if (tabs[index]) setActiveTab(tabs[index]);
      }
      
      // Ctrl/Cmd + F 搜索
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        if (activeTab === 'history' || activeTab === 'favorites') {
          e.preventDefault();
          searchInputRef.current?.focus();
        }
      }
      
      // Esc 退出全屏或清除搜索
      if (e.key === 'Escape') {
        if (isFullscreen) setIsFullscreen(false);
        if (searchQuery) setSearchQuery('');
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [activeTab, isFullscreen, searchQuery]);

  // 显示通知
  const showNotification = useCallback((message, type = 'info', duration = 3000) => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), duration);
  }, []);

  // 快速操作菜单
  // 渲染通知
  const renderNotification = () => {
    if (!notification) return null;
    const icons = {
      success: <CheckCircle size={16} />,
      error: <AlertCircle size={16} />,
      warning: <AlertCircle size={16} />,
      info: <Info size={16} />
    };
    return (
      <div className={`notification notification-${notification.type}`}>
        {icons[notification.type]}
        <span>{notification.message}</span>
        <button className="notification-close" onClick={() => setNotification(null)}><X size={14} /></button>
      </div>
    );
  };

  // 渲染标签页内容
  const renderContent = () => {
    switch(activeTab) {
      case 'translate':
        return <TranslationPanel 
          showNotification={showNotification} 
          screenshotData={screenshotData}
          onScreenshotProcessed={() => setScreenshotData(null)}
        />;
      case 'history':
        return (
          <Suspense fallback={<LazyLoadingFallback />}>
            <HistoryPanel searchQuery={searchQuery} filterOptions={filterOptions} showNotification={showNotification} />
          </Suspense>
        );
      case 'favorites':
        return (
          <Suspense fallback={<LazyLoadingFallback />}>
            <FavoritesPanel searchQuery={searchQuery} showNotification={showNotification} />
          </Suspense>
        );
      case 'settings':
        return (
          <Suspense fallback={<LazyLoadingFallback />}>
            <SettingsPanel showNotification={showNotification} />
          </Suspense>
        );
      default:
        return null;
    }
  };

  const tabs = [
    { id: 'translate', label: t('nav.translate'), icon: Languages, shortcut: '1' },
    { id: 'history', label: t('nav.history'), icon: History, shortcut: '2' },
    { id: 'favorites', label: t('nav.favorites'), icon: Star, shortcut: '3' },
    { id: 'settings', label: t('nav.settings'), icon: Settings, shortcut: '4' }
  ];

  return (
    <div className={`main-window ${isFullscreen ? 'fullscreen' : ''}`}>
      {/* 顶部工具栏 */}
      <div className="main-toolbar">
        <div className="toolbar-brand">
          <img src="./icon.png" alt="T-Translate" className="brand-logo-img" />
        </div>

        <div className="toolbar-tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={`tab-button ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
              title={`${tab.label} (Ctrl+${tab.shortcut})`}
            >
              <tab.icon size={16} />
              <span>{tab.label}</span>
              {tab.badge > 0 && <span className="tab-badge">{tab.badge}</span>}
            </button>
          ))}
          
          {/* 分隔线 */}
          <div className="toolbar-divider" />
          
          {/* 文档翻译按钮 */}
          <button
            className="tab-button doc-translate-btn"
            onClick={() => setShowDocTranslator(true)}
            title={t('nav.documents')}
          >
            <FileUp size={16} />
            <span>{t('nav.documents')}</span>
          </button>
        </div>
      </div>

      {/* 主内容区 */}
      <div className="main-content">
        {renderContent()}
      </div>

      {/* 底部状态栏 */}
      <div className="status-bar">
        <div className="status-left">
          <div className="status-item">
            <div className={`status-indicator ${currentTranslation.status === TRANSLATION_STATUS.TRANSLATING ? 'busy' : 'ready'}`}></div>
            <span className="status-text">
              {currentTranslation.status === TRANSLATION_STATUS.TRANSLATING ? t('translation.translating') : t('status.ready')}
            </span>
          </div>
          <div className="status-item">
            <Languages size={12} />
            <span className="status-text">{currentTranslation.sourceLanguage} → {currentTranslation.targetLanguage}</span>
          </div>
        </div>
        <div className="status-right">
          <div className="status-item">
            <span className="status-text">{t('status.today')}: {statistics.todayTranslations}</span>
          </div>
          <div className="status-item">
            <span className="status-text">v{version}</span>
          </div>
        </div>
      </div>

      {renderNotification()}
      
      {/* 文档翻译弹窗 */}
      {showDocTranslator && (
        <div className="doc-translator-modal">
          <div className="doc-translator-overlay" onClick={() => setShowDocTranslator(false)} />
          <div className="doc-translator-container">
            <Suspense fallback={<LazyLoadingFallback />}>
              <DocumentTranslator
                onClose={() => setShowDocTranslator(false)}
                notify={showNotification}
                sourceLang={currentTranslation.sourceLanguage}
                targetLang={currentTranslation.targetLanguage}
              />
            </Suspense>
          </div>
        </div>
      )}
    </div>
  );
};

export default MainWindow;