import createLogger from '../../utils/logger.js';
const logger = createLogger('MainWindow');
import React, { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FileText, Languages, Settings, History, Star,
  AlertCircle, CheckCircle, Info, X, FileUp, Loader2
} from 'lucide-react';

import useTranslationStore from '../../stores/translation-store';
import appIcon from '/icon.png';
// TranslationPanel is the initial view — keep it eagerly imported to avoid first-paint stall
import TranslationPanel from '../TranslationPanel';
const HistoryPanel = lazy(() => import('../HistoryPanel'));
const SettingsPanel = lazy(() => import('../SettingsPanel'));
const FavoritesPanel = lazy(() => import('../FavoritesPanel'));
const DocumentTranslator = lazy(() => import('../DocumentTranslator'));
import './styles.css';

import { TRANSLATION_STATUS } from '@config/defaults';

const LazyLoadingFallback = () => (
  <div className="lazy-loading-fallback">
    <Loader2 className="spinning" size={24} />
    <span>Loading...</span>
  </div>
);

const MainWindow = () => {
  const { t } = useTranslation();

  const [activeTab, setActiveTab] = useState('translate');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [notification, setNotification] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterOptions, setFilterOptions] = useState({
    language: 'all',
    dateRange: 'all',
    favorites: false
  });

  const [version, setVersion] = useState('');

  const {
    currentTranslation,
    statistics,
    getStatistics,
    translate,
    clearCurrent,
    swapLanguages,
    copyToClipboard,
    exportHistory,
    setSourceText,
    ocrStatus,
    recognizeImage,
  } = useTranslationStore();

  const searchInputRef = useRef(null);

  // Bridge from main-process screenshot capture down to TranslationPanel
  const [screenshotData, setScreenshotData] = useState(null);

  useEffect(() => {
    if (getStatistics) getStatistics();
  }, [getStatistics]);

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

  // Global screenshot listener: stays mounted regardless of active tab so a
  // screenshot triggered from outside the app doesn't get lost
  useEffect(() => {
    if (!window.electron?.screenshot?.onCaptured) {
      logger.warn('Screenshot onCaptured not available');
      return;
    }

    logger.debug('Setting up global screenshot listener');

    const unsubscribe = window.electron.screenshot.onCaptured(async (dataURL) => {
      logger.debug('Screenshot captured, dataURL length:', dataURL?.length || 0);

      setActiveTab('translate');

      if (!dataURL) {
        showNotification(t('screenshot.failed'), 'error');
        return;
      }

      setScreenshotData({
        dataURL,
        timestamp: Date.now()
      });
    });

    return () => {
      logger.debug('Cleaning up global screenshot listener');
      if (unsubscribe) unsubscribe();
    };
  }, []);

  // Silent-mode screenshot: OCR + push result to selection overlay,
  // without showing the main window. Used by Alt+Q hotkey path.
  useEffect(() => {
    if (!window.electron?.screenshot?.onCapturedSilent) {
      logger.debug('Screenshot onCapturedSilent not available');
      return;
    }

    logger.debug('Setting up silent screenshot listener');

    const unsubscribe = window.electron.screenshot.onCapturedSilent(async (dataURL) => {
      logger.debug('[Silent] Screenshot captured, processing OCR...');

      if (!dataURL) {
        logger.error('[Silent] Screenshot failed: no data');
        return;
      }

      try {
        const engineToUse = ocrStatus?.engine || 'llm-vision';
        logger.debug('[Silent] OCR with engine:', engineToUse);

        const ocrResult = await recognizeImage(dataURL, {
          engine: engineToUse,
          autoSetSource: false
        });

        if (!ocrResult.success || !ocrResult.text) {
          logger.warn('[Silent] OCR failed or no text:', ocrResult);
          window.electron?.screenshot?.notifyOcrComplete?.({
            success: false,
            error: ocrResult.error || t('translation.ocrFailed', '未识别到文字')
          });
          return;
        }

        logger.debug('[Silent] OCR success, sending text to selection window');

        // Selection window will run its own translation pass on this text
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
      logger.debug('Cleaning up silent screenshot listener');
      if (unsubscribe) unsubscribe();
    };
  }, [ocrStatus, recognizeImage, translate]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ctrl/Cmd + 1-5 jumps to that tab
      if ((e.ctrlKey || e.metaKey) && e.key >= '1' && e.key <= '5') {
        const tabs = ['translate', 'history', 'favorites', 'settings', 'document'];
        const index = parseInt(e.key) - 1;
        if (tabs[index]) setActiveTab(tabs[index]);
      }

      // Ctrl/Cmd + F focuses search (only valid in history/favorites tabs)
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        if (activeTab === 'history' || activeTab === 'favorites') {
          e.preventDefault();
          searchInputRef.current?.focus();
        }
      }

      if (e.key === 'Escape') {
        if (isFullscreen) setIsFullscreen(false);
        if (searchQuery) setSearchQuery('');
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [activeTab, isFullscreen, searchQuery]);

  const showNotification = useCallback((message, type = 'info', duration = 3000) => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), duration);
  }, []);

  // Startup may report shortcuts that another app already grabbed
  useEffect(() => {
    const cleanup = window.electron?.ipc?.on('shortcut-conflict', (failedList) => {
      if (failedList?.length > 0) {
        const names = failedList.map(f => f.shortcut).join(', ');
        showNotification(
          t('shortcuts.conflictNotice', { shortcuts: names }) ||
          '快捷键被其他程序占用: ' + names + '，可在设置中修改',
          'warning',
          6000
        );
      }
    });
    return () => cleanup?.();
  }, [t, showNotification]);

  useEffect(() => {
    const cleanup = window.electron?.ipc?.on('navigate', (target) => {
      logger.debug('Navigate request:', target);
      if (target === 'settings') {
        setActiveTab('settings');
      } else if (target === 'history') {
        setActiveTab('history');
      } else if (target === 'translate') {
        setActiveTab('translate');
      }
    });
    return () => cleanup?.();
  }, []);

  // Surface secure-storage anomaly alerts (e.g. mass-decrypt of API keys)
  useEffect(() => {
    const cleanup = window.electron?.ipc?.on('security-alert', (alert) => {
      if (alert?.type === 'suspicious-key-access') {
        showNotification(
          t('security.suspiciousAccess', {
            count: alert.count,
            keys: alert.uniqueKeys,
            defaultValue: `⚠️ 安全警告：检测到异常的密钥访问（${alert.count} 次，涉及 ${alert.uniqueKeys} 个密钥）。如非您本人操作，请立即更换所有 API Key。`
          }),
          'error',
          15000
        );
      }
    });
    return () => cleanup?.();
  }, [t, showNotification]);

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

  // Lazy-mount pattern: each tab is created on first visit, then kept mounted
  // so the user doesn't lose in-flight state (e.g. document translation progress)
  const [mountedTabs, setMountedTabs] = useState(new Set(['translate']));

  useEffect(() => {
    setMountedTabs(prev => {
      if (prev.has(activeTab)) return prev;
      const next = new Set(prev);
      next.add(activeTab);
      return next;
    });
  }, [activeTab]);

  const tabs = [
    { id: 'translate', label: t('nav.translate'), icon: Languages, shortcut: '1' },
    { id: 'history', label: t('nav.history'), icon: History, shortcut: '2' },
    { id: 'favorites', label: t('nav.favorites'), icon: Star, shortcut: '3' },
    { id: 'settings', label: t('nav.settings'), icon: Settings, shortcut: '4' }
  ];

  return (
    <div className={`main-window ${isFullscreen ? 'fullscreen' : ''}`}>
      <div className="main-toolbar">
        <div className="toolbar-brand">
          <img src={appIcon} alt="T-Translate" className="brand-logo-img" />
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

          <div className="toolbar-divider" />

          <button
            className={`tab-button doc-translate-btn ${activeTab === 'document' ? 'active' : ''}`}
            onClick={() => setActiveTab(activeTab === 'document' ? 'translate' : 'document')}
            title={t('nav.documents')}
          >
            <FileUp size={16} />
            <span>{t('nav.documents')}</span>
          </button>
        </div>
      </div>

      <div className="main-content">
        <div className="tab-panel" style={{ display: activeTab === 'translate' ? 'flex' : 'none' }}>
          <TranslationPanel
            showNotification={showNotification}
            screenshotData={screenshotData}
            onScreenshotProcessed={() => setScreenshotData(null)}
          />
        </div>

        {mountedTabs.has('history') && (
          <div className="tab-panel" style={{ display: activeTab === 'history' ? 'flex' : 'none' }}>
            <Suspense fallback={<LazyLoadingFallback />}>
              <HistoryPanel searchQuery={searchQuery} filterOptions={filterOptions} showNotification={showNotification} />
            </Suspense>
          </div>
        )}

        {mountedTabs.has('favorites') && (
          <div className="tab-panel" style={{ display: activeTab === 'favorites' ? 'flex' : 'none' }}>
            <Suspense fallback={<LazyLoadingFallback />}>
              <FavoritesPanel searchQuery={searchQuery} showNotification={showNotification} />
            </Suspense>
          </div>
        )}

        {mountedTabs.has('settings') && (
          <div className="tab-panel" style={{ display: activeTab === 'settings' ? 'flex' : 'none' }}>
            <Suspense fallback={<LazyLoadingFallback />}>
              <SettingsPanel showNotification={showNotification} />
            </Suspense>
          </div>
        )}

        {mountedTabs.has('document') && (
          <div className="tab-panel" style={{ display: activeTab === 'document' ? 'flex' : 'none' }}>
            <Suspense fallback={<LazyLoadingFallback />}>
              <DocumentTranslator
                notify={showNotification}
                sourceLang={currentTranslation.sourceLanguage}
                targetLang={currentTranslation.targetLanguage}
              />
            </Suspense>
          </div>
        )}
      </div>

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
    </div>
  );
};

export default MainWindow;
