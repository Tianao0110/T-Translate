// src/components/HistoryPanel.jsx
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Clock, Search, Filter, Download, Upload, Trash2, Copy, Star, StarOff,
  Calendar, ChevronDown, ChevronRight, MoreVertical, FileText, Globe,
  BarChart3, TrendingUp, X, Check, AlertCircle, RefreshCw
} from 'lucide-react';
import useTranslationStore from '../stores/translation-store';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';
import '../styles/components/HistoryPanel.css'; 

// 配置 dayjs
dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

/**
 * 历史记录面板组件
 */
const HistoryPanel = ({ searchQuery = '', filterOptions = {}, showNotification }) => {
  // 兼容 props 名
  const notify = showNotification || ((msg, type) => console.log(`[${type}] ${msg}`));

  // 状态
  const [selectedItems, setSelectedItems] = useState(new Set());
  const [expandedItems, setExpandedItems] = useState(new Set());
  const [sortBy, setSortBy] = useState('date'); // date, length, language
  const [sortOrder, setSortOrder] = useState('desc'); // asc, desc
  const [groupBy, setGroupBy] = useState('date'); // date, language, none
  const [showStats, setShowStats] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [dateRange, setDateRange] = useState('all'); // all, today, week, month
  
  // Store
  const {
    history,
    favorites,
    clearHistory,
    restoreFromHistory,
    addToFavorites,
    removeFromFavorites,
    exportHistory,
    importHistory,
    getStatistics
  } = useTranslationStore();

  // 获取统计数据
  const statistics = useMemo(() => getStatistics(), [history, getStatistics]);

  // 过滤和排序历史记录
  const filteredHistory = useMemo(() => {
    // 确保 history 是数组
    if (!Array.isArray(history)) return [];
    
    let filtered = [...history];

    // 搜索过滤
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(item =>
        (item.sourceText || '').toLowerCase().includes(query) ||
        (item.translatedText || '').toLowerCase().includes(query)
      );
    }

    // 日期范围过滤
    const now = Date.now();
    const today = new Date().setHours(0, 0, 0, 0);
    const week = now - 7 * 24 * 60 * 60 * 1000;
    const month = now - 30 * 24 * 60 * 60 * 1000;

    switch (dateRange) {
      case 'today':
        filtered = filtered.filter(item => item.timestamp >= today);
        break;
      case 'week':
        filtered = filtered.filter(item => item.timestamp >= week);
        break;
      case 'month':
        filtered = filtered.filter(item => item.timestamp >= month);
        break;
      default:
        break;
    }

    // 语言过滤
    if (filterOptions.language && filterOptions.language !== 'all') {
      filtered = filtered.filter(item =>
        item.sourceLanguage === filterOptions.language ||
        item.targetLanguage === filterOptions.language
      );
    }

    // 收藏过滤
    if (filterOptions.favorites) {
      const favoriteIds = new Set(favorites.map(f => f.id));
      filtered = filtered.filter(item => favoriteIds.has(item.id));
    }

    // 排序
    filtered.sort((a, b) => {
      let comparison = 0;
      switch (sortBy) {
        case 'date':
          comparison = (a.timestamp || 0) - (b.timestamp || 0);
          break;
        case 'length':
          comparison = (a.sourceText?.length || 0) - (b.sourceText?.length || 0);
          break;
        case 'language':
          comparison = (a.sourceLanguage || '').localeCompare(b.sourceLanguage || '');
          break;
        default: break;
      }
      return sortOrder === 'asc' ? comparison : -comparison;
    });

    return filtered;
  }, [history, searchQuery, dateRange, filterOptions, sortBy, sortOrder, favorites]);

  // 分组历史记录
  const groupedHistory = useMemo(() => {
    if (groupBy === 'none') {
      return [{ title: '所有记录', items: filteredHistory }];
    }

    const groups = {};

    filteredHistory.forEach(item => {
      let key = '其他';
      
      if (groupBy === 'date') {
        const date = dayjs(item.timestamp);
        const today = dayjs();
        const yesterday = dayjs().subtract(1, 'day');

        if (date.isSame(today, 'day')) {
          key = '今天';
        } else if (date.isSame(yesterday, 'day')) {
          key = '昨天';
        } else if (date.isAfter(today.subtract(7, 'days'))) {
          key = '本周';
        } else if (date.isAfter(today.subtract(30, 'days'))) {
          key = '本月';
        } else {
          key = date.format('YYYY年MM月');
        }
      } else if (groupBy === 'language') {
        key = `${item.sourceLanguage} → ${item.targetLanguage}`;
      }

      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(item);
    });

    return Object.entries(groups).map(([title, items]) => ({ title, items }));
  }, [filteredHistory, groupBy]);

  // 处理全选
  const handleSelectAll = useCallback(() => {
    if (selectedItems.size === filteredHistory.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(filteredHistory.map(item => item.id)));
    }
  }, [filteredHistory, selectedItems]);

  // 处理批量删除 (注意：Store 需要补充 deleteItems Action，如果没实现暂时只能假删除)
  const handleBatchDelete = useCallback(() => {
    if (selectedItems.size === 0) return;

    if (window.confirm(`确定要删除 ${selectedItems.size} 条记录吗？`)) {
      // TODO: 在 Store 中添加 deleteItems 方法
      // 目前演示效果
      notify(`已删除 ${selectedItems.size} 条记录 (需完善Store逻辑)`, 'success');
      setSelectedItems(new Set());
    }
  }, [selectedItems, notify]);

  // 处理导出
  const handleExport = useCallback(async (format = 'json') => {
    setIsExporting(true);
    try {
      // Store 里的 exportHistory 只返回数据，这里处理下载
      const data = exportHistory(format);
      
      const blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `history_${Date.now()}.json`;
      a.click();
      
      notify(`历史记录已导出为 ${format.toUpperCase()} 格式`, 'success');
    } catch (error) {
      notify('导出失败: ' + error.message, 'error');
    } finally {
      setIsExporting(false);
    }
  }, [exportHistory, notify]);

  // 处理导入
  const handleImport = useCallback(async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const result = await importHistory(file);
      if (result.success) {
        notify(`成功导入 ${result.count} 条记录`, 'success');
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      notify('导入失败: ' + error.message, 'error');
    }
    event.target.value = null; // 重置
  }, [importHistory, notify]);

  // 渲染统计卡片
  const renderStatistics = () => {
    if (!showStats) return null;

    return (
      <div className="statistics-panel">
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-icon"><BarChart3 size={20} /></div>
            <div className="stat-content">
              <div className="stat-value">{statistics.totalTranslations}</div>
              <div className="stat-label">总翻译次数</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon"><TrendingUp size={20} /></div>
            <div className="stat-content">
              <div className="stat-value">{statistics.todayTranslations}</div>
              <div className="stat-label">今日翻译</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon"><FileText size={20} /></div>
            <div className="stat-content">
              <div className="stat-value">{Math.round(statistics.totalCharacters / 1000)}k</div>
              <div className="stat-label">总字符数</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon"><Globe size={20} /></div>
            <div className="stat-content">
              <div className="stat-value">{statistics.mostUsedLanguagePair || 'N/A'}</div>
              <div className="stat-label">常用语言对</div>
            </div>
          </div>
        </div>
        <button className="stats-close" onClick={() => setShowStats(false)}><X size={16} /></button>
      </div>
    );
  };

  // 渲染历史项
  const renderHistoryItem = (item) => {
    const isSelected = selectedItems.has(item.id);
    const isExpanded = expandedItems.has(item.id);
    const isFavorited = favorites.some(f => f.id === item.id);

    return (
      <div key={item.id} className={`history-item ${isSelected ? 'selected' : ''} ${isExpanded ? 'expanded' : ''}`}>
        <div className="history-item-header">
          <input
            type="checkbox"
            className="item-checkbox"
            checked={isSelected}
            onChange={(e) => {
              const newSelected = new Set(selectedItems);
              if (e.target.checked) newSelected.add(item.id);
              else newSelected.delete(item.id);
              setSelectedItems(newSelected);
            }}
          />

          <button
            className="expand-button"
            onClick={() => {
              const newExpanded = new Set(expandedItems);
              if (isExpanded) newExpanded.delete(item.id);
              else newExpanded.add(item.id);
              setExpandedItems(newExpanded);
            }}
          >
            {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>

          <div className="item-info">
            <div className="language-pair">
              <span className="language-tag">{item.sourceLanguage}</span>
              <span className="arrow">→</span>
              <span className="language-tag">{item.targetLanguage}</span>
            </div>
            <div className="item-time">
              <Clock size={12} />
              <span>{dayjs(item.timestamp).fromNow()}</span>
            </div>
          </div>

          <div className="item-preview">
            <div className="preview-text source">
              {(item.sourceText || '').substring(0, 50)}
              {(item.sourceText || '').length > 50 && '...'}
            </div>
            <div className="preview-text translated">
              {(item.translatedText || '').substring(0, 50)}
              {(item.translatedText || '').length > 50 && '...'}
            </div>
          </div>

          <div className="item-actions">
            <button className="action-btn" onClick={() => {
                restoreFromHistory(item.id);
                notify('已恢复到编辑器', 'success');
              }} title="恢复">
              <RefreshCw size={16} />
            </button>
            <button className="action-btn" onClick={() => {
                navigator.clipboard.writeText(item.translatedText);
                notify('已复制', 'success');
              }} title="复制">
              <Copy size={16} />
            </button>
            <button className={`action-btn ${isFavorited ? 'active' : ''}`}
              onClick={() => {
                if (isFavorited) {
                  removeFromFavorites(item.id);
                  notify('已取消收藏', 'info');
                } else {
                  addToFavorites(item);
                  notify('已添加到收藏', 'success');
                }
              }}
              title={isFavorited ? '取消收藏' : '收藏'}
            >
              {isFavorited ? <Star size={16} fill="currentColor" /> : <StarOff size={16} />}
            </button>
          </div>
        </div>

        {isExpanded && (
          <div className="history-item-content">
            <div className="content-section">
              <h4>原文</h4>
              <div className="content-text">{item.sourceText}</div>
            </div>
            <div className="content-section">
              <h4>译文</h4>
              <div className="content-text">{item.translatedText}</div>
            </div>
            <div className="content-meta">
              <span>时间: {dayjs(item.timestamp).format('YYYY-MM-DD HH:mm:ss')}</span>
              {item.duration && <span>耗时: {item.duration}ms</span>}
              {item.model && <span>模型: {item.model}</span>}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="history-panel">
      {/* 工具栏 */}
      <div className="history-toolbar">
        <div className="toolbar-left">
          <button className={`toolbar-btn ${showStats?'active':''}`} onClick={() => setShowStats(!showStats)}>
            <BarChart3 size={16} /> 统计
          </button>
          <div className="separator" />
          <select className="toolbar-select" value={dateRange} onChange={(e) => setDateRange(e.target.value)}>
            <option value="all">全部时间</option>
            <option value="today">今天</option>
            <option value="week">本周</option>
            <option value="month">本月</option>
          </select>
          <select className="toolbar-select" value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
            <option value="date">按日期</option>
            <option value="language">按语言</option>
            <option value="none">不分组</option>
          </select>
        </div>

        <div className="toolbar-right">
          <button className="toolbar-btn" onClick={() => handleExport('json')} disabled={isExporting}>
            <Download size={16} /> 导出
          </button>
          <label className="toolbar-btn">
            <Upload size={16} /> 导入
            <input type="file" accept=".json" onChange={handleImport} style={{ display: 'none' }} />
          </label>
          <button className="toolbar-btn danger" onClick={() => {
              if (window.confirm('确定清空所有历史？')) {
                clearHistory();
                notify('已清空', 'success');
              }
            }}>
            <Trash2 size={16} /> 清空
          </button>
        </div>
      </div>

      {/* 统计面板 */}
      {renderStatistics()}

      {/* 历史列表 */}
      <div className="history-content">
        {filteredHistory.length === 0 ? (
          <div className="empty-state">
            <Clock size={48} className="empty-icon" />
            <p>暂无历史记录</p>
          </div>
        ) : (
          <div className="history-list">
            {groupedHistory.map((group, idx) => (
              <div key={idx} className="history-group">
                {groupBy !== 'none' && (
                  <div className="group-header">
                    <span className="group-title">{group.title}</span>
                    <span className="group-count">{group.items.length}</span>
                  </div>
                )}
                <div className="group-items">
                  {group.items.map(renderHistoryItem)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default HistoryPanel;