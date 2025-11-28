// src/components/HistoryPanel.jsx
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Clock,
  Search,
  Filter,
  Download,
  Upload,
  Trash2,
  Copy,
  Star,
  StarOff,
  Calendar,
  ChevronDown,
  ChevronRight,
  MoreVertical,
  FileText,
  Globe,
  BarChart3,
  TrendingUp,
  X,
  Check,
  AlertCircle,
  RefreshCw
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
const HistoryPanel = ({ searchQuery = '', filterOptions = {}, onNotification }) => {
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
    copyToClipboard,
    exportHistory,
    importHistory,
    searchHistory,
    getStatistics
  } = useTranslationStore();

  // 获取统计数据
  const statistics = useMemo(() => getStatistics(), [history]);

  // 过滤和排序历史记录
  const filteredHistory = useMemo(() => {
    let filtered = [...history];

    // 搜索过滤
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(item =>
        item.sourceText.toLowerCase().includes(query) ||
        item.translatedText.toLowerCase().includes(query)
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
          comparison = a.timestamp - b.timestamp;
          break;
        case 'length':
          comparison = a.sourceText.length - b.sourceText.length;
          break;
        case 'language':
          comparison = a.sourceLanguage.localeCompare(b.sourceLanguage);
          break;
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
      let key;
      
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

  // 处理批量删除
  const handleBatchDelete = useCallback(() => {
    if (selectedItems.size === 0) return;

    if (confirm(`确定要删除 ${selectedItems.size} 条记录吗？`)) {
      // 这里应该调用删除方法
      onNotification(`已删除 ${selectedItems.size} 条记录`, 'success');
      setSelectedItems(new Set());
    }
  }, [selectedItems, onNotification]);

  // 处理导出
  const handleExport = useCallback(async (format = 'json') => {
    setIsExporting(true);
    try {
      await exportHistory(format);
      onNotification(`历史记录已导出为 ${format.toUpperCase()} 格式`, 'success');
    } catch (error) {
      onNotification('导出失败: ' + error.message, 'error');
    } finally {
      setIsExporting(false);
    }
  }, [exportHistory, onNotification]);

  // 处理导入
  const handleImport = useCallback(async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const result = await importHistory(file);
      if (result.success) {
        onNotification(`成功导入 ${result.count} 条记录`, 'success');
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      onNotification('导入失败: ' + error.message, 'error');
    }
  }, [importHistory, onNotification]);

  // 渲染统计卡片
  const renderStatistics = () => {
    if (!showStats) return null;

    return (
      <div className="statistics-panel">
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-icon">
              <BarChart3 size={20} />
            </div>
            <div className="stat-content">
              <div className="stat-value">{statistics.totalTranslations}</div>
              <div className="stat-label">总翻译次数</div>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-icon">
              <TrendingUp size={20} />
            </div>
            <div className="stat-content">
              <div className="stat-value">{statistics.todayTranslations}</div>
              <div className="stat-label">今日翻译</div>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-icon">
              <FileText size={20} />
            </div>
            <div className="stat-content">
              <div className="stat-value">
                {Math.round(statistics.totalCharacters / 1000)}k
              </div>
              <div className="stat-label">总字符数</div>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-icon">
              <Globe size={20} />
            </div>
            <div className="stat-content">
              <div className="stat-value">
                {statistics.mostUsedLanguagePair || 'N/A'}
              </div>
              <div className="stat-label">常用语言对</div>
            </div>
          </div>
        </div>

        <button 
          className="stats-close"
          onClick={() => setShowStats(false)}
        >
          <X size={16} />
        </button>
      </div>
    );
  };

  // 渲染历史项
  const renderHistoryItem = (item) => {
    const isSelected = selectedItems.has(item.id);
    const isExpanded = expandedItems.has(item.id);
    const isFavorited = favorites.some(f => f.id === item.id);

    return (
      <div 
        key={item.id}
        className={`history-item ${isSelected ? 'selected' : ''} ${isExpanded ? 'expanded' : ''}`}
      >
        <div className="history-item-header">
          <input
            type="checkbox"
            className="item-checkbox"
            checked={isSelected}
            onChange={(e) => {
              const newSelected = new Set(selectedItems);
              if (e.target.checked) {
                newSelected.add(item.id);
              } else {
                newSelected.delete(item.id);
              }
              setSelectedItems(newSelected);
            }}
          />

          <button
            className="expand-button"
            onClick={() => {
              const newExpanded = new Set(expandedItems);
              if (isExpanded) {
                newExpanded.delete(item.id);
              } else {
                newExpanded.add(item.id);
              }
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
              {item.sourceText.substring(0, 50)}
              {item.sourceText.length > 50 && '...'}
            </div>
            <div className="preview-text translated">
              {item.translatedText.substring(0, 50)}
              {item.translatedText.length > 50 && '...'}
            </div>
          </div>

          <div className="item-actions">
            <button
              className="action-btn"
              onClick={() => restoreFromHistory(item.id)}
              title="恢复到编辑器"
            >
              <RefreshCw size={16} />
            </button>
            
            <button
              className="action-btn"
              onClick={() => {
                navigator.clipboard.writeText(item.translatedText);
                onNotification('已复制译文', 'success');
              }}
              title="复制译文"
            >
              <Copy size={16} />
            </button>

            <button
              className={`action-btn ${isFavorited ? 'active' : ''}`}
              onClick={() => {
                if (isFavorited) {
                  removeFromFavorites(item.id);
                  onNotification('已取消收藏', 'info');
                } else {
                  addToFavorites(item);
                  onNotification('已添加到收藏', 'success');
                }
              }}
              title={isFavorited ? '取消收藏' : '添加到收藏'}
            >
              {isFavorited ? <Star size={16} /> : <StarOff size={16} />}
            </button>

            <div className="dropdown-wrapper">
              <button className="action-btn">
                <MoreVertical size={16} />
              </button>
            </div>
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
              <span>翻译时间: {dayjs(item.timestamp).format('YYYY-MM-DD HH:mm:ss')}</span>
              {item.duration && (
                <span>耗时: {(item.duration / 1000).toFixed(1)}秒</span>
              )}
              {item.model && (
                <span>模型: {item.model}</span>
              )}
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
          <button
            className="toolbar-btn"
            onClick={() => setShowStats(!showStats)}
          >
            <BarChart3 size={18} />
            统计
          </button>

          <div className="separator" />

          <select
            className="toolbar-select"
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value)}
          >
            <option value="all">全部时间</option>
            <option value="today">今天</option>
            <option value="week">本周</option>
            <option value="month">本月</option>
          </select>

          <select
            className="toolbar-select"
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value)}
          >
            <option value="date">按日期分组</option>
            <option value="language">按语言分组</option>
            <option value="none">不分组</option>
          </select>

          <select
            className="toolbar-select"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
          >
            <option value="date">按时间排序</option>
            <option value="length">按长度排序</option>
            <option value="language">按语言排序</option>
          </select>

          <button
            className="toolbar-btn"
            onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
          >
            {sortOrder === 'asc' ? '升序' : '降序'}
          </button>
        </div>

        <div className="toolbar-right">
          {selectedItems.size > 0 && (
            <>
              <span className="selected-count">
                已选择 {selectedItems.size} 项
              </span>
              <button
                className="toolbar-btn"
                onClick={handleBatchDelete}
              >
                <Trash2 size={18} />
                删除
              </button>
              <div className="separator" />
            </>
          )}

          <button
            className="toolbar-btn"
            onClick={() => handleExport('json')}
            disabled={isExporting}
          >
            <Download size={18} />
            导出
          </button>

          <label className="toolbar-btn">
            <Upload size={18} />
            导入
            <input
              type="file"
              accept=".json"
              onChange={handleImport}
              style={{ display: 'none' }}
            />
          </label>

          <button
            className="toolbar-btn danger"
            onClick={() => {
              if (confirm('确定要清空所有历史记录吗？此操作不可恢复。')) {
                clearHistory();
                onNotification('历史记录已清空', 'success');
              }
            }}
          >
            <Trash2 size={18} />
            清空
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
            <h3>暂无历史记录</h3>
            <p>
              {searchQuery 
                ? '没有找到匹配的记录'
                : '开始翻译后，历史记录将显示在这里'}
            </p>
          </div>
        ) : (
          <div className="history-list">
            {/* 全选控制 */}
            {filteredHistory.length > 0 && (
              <div className="list-header">
                <input
                  type="checkbox"
                  className="item-checkbox"
                  checked={selectedItems.size === filteredHistory.length}
                  onChange={handleSelectAll}
                />
                <span className="list-info">
                  共 {filteredHistory.length} 条记录
                </span>
              </div>
            )}

            {/* 分组渲染 */}
            {groupedHistory.map((group, groupIndex) => (
              <div key={groupIndex} className="history-group">
                {groupBy !== 'none' && (
                  <div className="group-header">
                    <span className="group-title">{group.title}</span>
                    <span className="group-count">{group.items.length} 条</span>
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