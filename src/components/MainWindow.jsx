// src/components/MainWindow.jsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  FileText,
  Languages,
  Settings,
  History,
  Star,
  Copy,
  Download,
  Upload,
  RefreshCw,
  X,
  Mic,
  Camera,
  Volume2,
  Loader2,
  ChevronDown,
  Search,
  Filter,
  MoreVertical,
  Sparkles,
  AlertCircle,
  CheckCircle,
  Info
} from 'lucide-react';
import useTranslationStore from '../stores/translation-store';
import TranslationPanel from './TranslationPanel';
import HistoryPanel from './HistoryPanel';
import SettingsPanel from './SettingsPanel';
import FavoritesPanel from './FavoritesPanel';
import '../styles/components/MainWindow.css';

/**
 * 主窗口组件
 * 管理整个应用的布局和主要功能区域
 */
const MainWindow = () => {
  // 状态管理
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
  
  // Zustand store
  const {
    currentTranslation,
    statistics,
    translate,
    clearCurrent,
    swapLanguages,
    setLanguages,
    copyToClipboard,
    pasteFromClipboard,
    exportHistory
  } = useTranslationStore();

  // Refs
  const mainContentRef = useRef(null);
  const searchInputRef = useRef(null);

  // 快捷键处理
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ctrl/Cmd + 1-4 切换标签
      if ((e.ctrlKey || e.metaKey) && e.key >= '1' && e.key <= '4') {
        e.preventDefault();
        const tabs = ['translate', 'history', 'favorites', 'settings'];
        const index = parseInt(e.key) - 1;
        if (tabs[index]) {
          setActiveTab(tabs[index]);
        }
      }
      
      // Ctrl/Cmd + F 搜索
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        if (activeTab === 'history' || activeTab === 'favorites') {
          searchInputRef.current?.focus();
        }
      }
      
      // Esc 退出全屏
      if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [activeTab, isFullscreen]);

  // 标签配置
  const tabs = [
    { id: 'translate', label: '翻译', icon: Languages, shortcut: '1' },
    { id: 'history', label: '历史', icon: History, shortcut: '2', badge: statistics.todayTranslations },
    { id: 'favorites', label: '收藏', icon: Star, shortcut: '3' },
    { id: 'settings', label: '设置', icon: Settings, shortcut: '4' }
  ];

  // 显示通知
  const showNotification = useCallback((message, type = 'info', duration = 3000) => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), duration);
  }, []);

  // 快速操作
  const quickActions = [
    {
      label: '清空',
      icon: X,
      onClick: () => {
        clearCurrent();
        showNotification('内容已清空', 'success');
      }
    },
    {
      label: '切换语言',
      icon: RefreshCw,
      onClick: () => {
        swapLanguages();
        showNotification('语言已切换', 'success');
      },
      disabled: currentTranslation.sourceLanguage === 'auto'
    },
    {
      label: '复制译文',
      icon: Copy,
      onClick: () => {
        if (copyToClipboard('translated')) {
          showNotification('已复制到剪贴板', 'success');
        } else {
          showNotification('没有可复制的内容', 'warning');
        }
      }
    },
    {
      label: '导出历史',
      icon: Download,
      onClick: () => {
        exportHistory('json');
        showNotification('历史已导出', 'success');
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
        <button 
          className="notification-close"
          onClick={() => setNotification(null)}
        >
          <X size={14} />
        </button>
      </div>
    );
  };

  // 渲染统计卡片
  const renderStatisticsCard = () => {
    return (
      <div className="statistics-card">
        <div className="stat-item">
          <div className="stat-value">{statistics.totalTranslations}</div>
          <div className="stat-label">总翻译</div>
        </div>
        <div className="stat-item">
          <div className="stat-value">{statistics.todayTranslations}</div>
          <div className="stat-label">今日</div>
        </div>
        <div className="stat-item">
          <div className="stat-value">
            {Math.round(statistics.totalCharacters / 1000)}k
          </div>
          <div className="stat-label">字符数</div>
        </div>
        <div className="stat-item">
          <div className="stat-value">
            {(statistics.averageTranslationTime / 1000).toFixed(1)}s
          </div>
          <div className="stat-label">平均用时</div>
        </div>
      </div>
    );
  };

  // 渲染搜索栏
  const renderSearchBar = () => {
    if (activeTab !== 'history' && activeTab !== 'favorites') {
      return null;
    }

    return (
      <div className="search-bar">
        <div className="search-input-wrapper">
          <Search size={18} className="search-icon" />
          <input
            ref={searchInputRef}
            type="text"
            className="search-input"
            placeholder={`搜索${activeTab === 'history' ? '历史' : '收藏'}...`}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button 
              className="search-clear"
              onClick={() => setSearchQuery('')}
            >
              <X size={16} />
            </button>
          )}
        </div>
        
        <div className="filter-controls">
          <button className="filter-button">
            <Filter size={16} />
            筛选
            <ChevronDown size={14} />
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className={`main-window ${isFullscreen ? 'fullscreen' : ''}`}>
      {/* 顶部工具栏 */}
      <div className="main-toolbar">
        {/* Logo 和标题 */}
        <div className="toolbar-brand">
          <div className="brand-logo">
            <Sparkles size={20} />
          </div>
          <span className="brand-title">T-Translate Core</span>
        </div>

        {/* 标签栏 */}
        <div className="toolbar-tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={`tab-button ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
              title={`${tab.label} (Ctrl+${tab.shortcut})`}
            >
              <tab.icon size={18} />
              <span>{tab.label}</span>
              {tab.badge > 0 && (
                <span className="tab-badge">{tab.badge}</span>
              )}
            </button>
          ))}
        </div>

        {/* 右侧工具栏 */}
        <div className="toolbar-actions">
          {/* 快速操作 */}
          <div className="quick-actions-wrapper">
            <button 
              className="quick-actions-trigger"
              onClick={() => setShowQuickActions(!showQuickActions)}
            >
              <MoreVertical size={18} />
            </button>
            
            {showQuickActions && (
              <div className="quick-actions-dropdown">
                {quickActions.map((action, index) => (
                  <button
                    key={index}
                    className="quick-action-item"
                    onClick={action.onClick}
                    disabled={action.disabled}
                  >
                    <action.icon size={16} />
                    <span>{action.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 搜索栏 */}
      {renderSearchBar()}

      {/* 主内容区 */}
      <div className="main-content" ref={mainContentRef}>
        {/* 翻译面板 */}
        {activeTab === 'translate' && (
          <TranslationPanel 
            onNotification={showNotification}
          />
        )}

        {/* 历史面板 */}
        {activeTab === 'history' && (
          <HistoryPanel 
            searchQuery={searchQuery}
            filterOptions={filterOptions}
            onNotification={showNotification}
          />
        )}

        {/* 收藏面板 */}
        {activeTab === 'favorites' && (
          <FavoritesPanel 
            searchQuery={searchQuery}
            onNotification={showNotification}
          />
        )}

        {/* 设置面板 */}
        {activeTab === 'settings' && (
          <SettingsPanel 
            onNotification={showNotification}
          />
        )}
      </div>

      {/* 底部状态栏 */}
      <div className="status-bar">
        <div className="status-left">
          {/* 连接状态 */}
          <div className="status-item">
            <div className={`status-indicator ${currentTranslation.status}`}></div>
            <span className="status-text">
              {currentTranslation.status === 'translating' ? '翻译中...' :
               currentTranslation.status === 'success' ? '就绪' :
               currentTranslation.status === 'error' ? '错误' : '就绪'}
            </span>
          </div>

          {/* 当前语言对 */}
          <div className="status-item">
            <Languages size={14} />
            <span className="status-text">
              {currentTranslation.sourceLanguage} → {currentTranslation.targetLanguage}
            </span>
          </div>
        </div>

        <div className="status-right">
          {/* 统计信息 */}
          <div className="status-item">
            <span className="status-text">
              今日: {statistics.todayTranslations} 次
            </span>
          </div>
          
          {/* 字符计数 */}
          {currentTranslation.sourceText && (
            <div className="status-item">
              <span className="status-text">
                {currentTranslation.sourceText.length} 字符
              </span>
            </div>
          )}

          {/* 版本信息 */}
          <div className="status-item">
            <span className="status-text version">
              v1.0.0
            </span>
          </div>
        </div>
      </div>

      {/* 通知 */}
      {renderNotification()}

      {/* 浮动统计卡片 */}
      {activeTab === 'translate' && (
        <div className="floating-stats">
          {renderStatisticsCard()}
        </div>
      )}

      {/* 快捷键提示 */}
      {activeTab === 'translate' && currentTranslation.sourceText === '' && (
        <div className="shortcut-hints">
          <div className="hint-item">
            <kbd>Ctrl</kbd> + <kbd>Enter</kbd>
            <span>翻译</span>
          </div>
          <div className="hint-item">
            <kbd>Ctrl</kbd> + <kbd>L</kbd>
            <span>切换语言</span>
          </div>
          <div className="hint-item">
            <kbd>Ctrl</kbd> + <kbd>V</kbd>
            <span>粘贴</span>
          </div>
          <div className="hint-item">
            <kbd>Ctrl</kbd> + <kbd>1-4</kbd>
            <span>切换标签</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default MainWindow;