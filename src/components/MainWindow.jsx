// src/components/MainWindow.jsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  FileText, Languages, Settings, History, Star, Copy, Download, Upload, RefreshCw, X,
  Mic, Camera, Volume2, Loader2, ChevronDown, Search, Filter, MoreVertical, Sparkles,
  AlertCircle, CheckCircle, Info
} from 'lucide-react';

import useTranslationStore from '../stores/translation-store';
import TranslationPanel from './TranslationPanel';
import HistoryPanel from './HistoryPanel';
import SettingsPanel from './SettingsPanel';
import FavoritesPanel from './FavoritesPanel';
import '../styles/components/MainWindow.css'; 

/**
 * 主窗口组件
 */
const MainWindow = () => {
  // UI 状态
  const [activeTab, setActiveTab] = useState('translate');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showQuickActions, setShowQuickActions] = useState(false);
  const [notification, setNotification] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterOptions, setFilterOptions] = useState({
    language: 'all',
    dateRange: 'all',
    favorites: false
  });
  
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
    ocrStatus
  } = useTranslationStore();

  // Refs
  const searchInputRef = useRef(null);
  
  // 截图 OCR 数据（传递给 TranslationPanel）
  const [screenshotData, setScreenshotData] = useState(null);

  // 初始化统计数据 (如果 store 没有自动初始化)
  useEffect(() => {
    if(getStatistics) getStatistics();
  }, [getStatistics]);

  // 全局截图监听 - 始终挂载，不会因标签切换而丢失
  useEffect(() => {
    if (!window.electron?.screenshot?.onCaptured) {
      console.warn('[MainWindow] Screenshot onCaptured not available');
      return;
    }

    console.log('[MainWindow] Setting up global screenshot listener');
    
    const unsubscribe = window.electron.screenshot.onCaptured(async (dataURL) => {
      console.log('[MainWindow] Screenshot captured, dataURL length:', dataURL?.length || 0);
      
      // 1. 先切换到翻译标签
      setActiveTab('translate');
      
      if (!dataURL) {
        showNotification('截图失败', 'error');
        return;
      }
      
      // 2. 传递截图数据给 TranslationPanel 处理
      setScreenshotData({
        dataURL,
        timestamp: Date.now()
      });
    });

    return () => {
      console.log('[MainWindow] Cleaning up global screenshot listener');
      if (unsubscribe) unsubscribe();
    };
  }, []);

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
  const quickActions = [
    {
      label: '清空',
      icon: X,
      onClick: () => { clearCurrent(); showNotification('内容已清空', 'success'); }
    },
    {
      label: '切换语言',
      icon: RefreshCw,
      onClick: () => { swapLanguages(); showNotification('语言已切换', 'success'); },
      disabled: currentTranslation.sourceLanguage === 'auto'
    },
    {
      label: '复制译文',
      icon: Copy,
      onClick: () => {
        if (copyToClipboard('translated')) showNotification('已复制', 'success');
        else showNotification('无内容', 'warning');
      }
    },
    {
      label: '导出历史',
      icon: Download,
      onClick: () => {
        // exportHistory 返回数据，这里不再重复实现下载，或者在 Store 里实现
        // 简单提示
        showNotification('请在历史面板导出', 'info'); 
      }
    }
  ];

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
        return <HistoryPanel searchQuery={searchQuery} filterOptions={filterOptions} showNotification={showNotification} />;
      case 'favorites':
        return <FavoritesPanel searchQuery={searchQuery} showNotification={showNotification} />;
      case 'settings':
        return <SettingsPanel showNotification={showNotification} />;
      default:
        return null;
    }
  };

  const tabs = [
    { id: 'translate', label: '翻译', icon: Languages, shortcut: '1' },
    { id: 'history', label: '历史', icon: History, shortcut: '2' },
    { id: 'favorites', label: '收藏', icon: Star, shortcut: '3' },
    { id: 'settings', label: '设置', icon: Settings, shortcut: '4' }
  ];

  return (
    <div className={`main-window ${isFullscreen ? 'fullscreen' : ''}`}>
      {/* 顶部工具栏 */}
      <div className="main-toolbar">
        <div className="toolbar-brand">
          <div className="brand-logo"><Sparkles size={18} /></div>
          <span className="brand-title">T-Translate</span>
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
        </div>

        <div className="toolbar-actions">
          <div className="quick-actions-wrapper">
            <button className="quick-actions-trigger" onClick={() => setShowQuickActions(!showQuickActions)}>
              <MoreVertical size={18} />
            </button>
            {showQuickActions && (
              <div className="quick-actions-dropdown">
                {quickActions.map((action, idx) => (
                  <button key={idx} className="quick-action-item" onClick={()=>{action.onClick(); setShowQuickActions(false);}} disabled={action.disabled}>
                    <action.icon size={14} /><span>{action.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
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
            <div className={`status-indicator ${currentTranslation.status === 'translating' ? 'busy' : 'ready'}`}></div>
            <span className="status-text">
              {currentTranslation.status === 'translating' ? '翻译中...' : '就绪'}
            </span>
          </div>
          <div className="status-item">
            <Languages size={12} />
            <span className="status-text">{currentTranslation.sourceLanguage} → {currentTranslation.targetLanguage}</span>
          </div>
        </div>
        <div className="status-right">
          <div className="status-item">
            <span className="status-text">今日: {statistics.todayTranslations} 次</span>
          </div>
          <div className="status-item">
            <span className="status-text">v1.0.0</span>
          </div>
        </div>
      </div>

      {renderNotification()}
    </div>
  );
};

export default MainWindow;