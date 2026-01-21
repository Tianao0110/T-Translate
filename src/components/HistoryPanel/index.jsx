// src/components/HistoryPanel/index.jsx
// 历史记录面板 - 性能优化版
// 
// 优化点：
// 1. HistoryCard 使用 React.memo
// 2. 收藏状态使用 Set 缓存查找
// 3. 搜索使用防抖
// 4. 回调函数使用 useCallback
// 5. 分组计算使用 useMemo

import React, { useState, useMemo, useCallback, useEffect, useRef, memo } from 'react';
import {
  Clock, Search, Trash2, Copy, Star, 
  Calendar, ChevronDown, ChevronRight, LayoutGrid,
  BarChart3, TrendingUp, X, Edit3, Download, Upload,
  FileText, Hash, Type, Languages, Activity, RotateCcw,
  Table, CheckSquare, Square, Trash, ArrowUpDown
} from 'lucide-react';
import useTranslationStore from '../../stores/translation-store';
import { useDebounce } from '../../utils/performance';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter';
import 'dayjs/locale/zh-cn';
import './styles.css';

// 从配置中心导入常量
import { PRIVACY_MODES } from '@config/defaults'; 

dayjs.extend(relativeTime);
dayjs.extend(isSameOrAfter);
dayjs.locale('zh-cn');

/**
 * 搜索高亮组件 - memo 优化
 */
const HighlightText = memo(({ text, search }) => {
  if (!search || !text) return text;
  try {
    const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const parts = text.split(new RegExp(`(${escapedSearch})`, 'gi'));
    return parts.map((part, i) =>
      part.toLowerCase() === search.toLowerCase() ? (
        <mark key={i} className="search-highlight">{part}</mark>
      ) : part
    );
  } catch {
    return text;
  }
});
HighlightText.displayName = 'HighlightText';

/**
 * 卡片组件 - React.memo 优化
 * 只有当 props 变化时才重新渲染
 */
const HistoryCard = memo(({ 
  item, 
  onCopy, 
  onRestore, 
  onFavorite, 
  onDelete, 
  isFavorite, 
  isSelected, 
  onSelect, 
  showCheckbox, 
  searchQuery,
  onDoubleClick
}) => {
  const [showTranslated, setShowTranslated] = useState(true);
  
  // 使用 useCallback 避免内联函数
  const handleToggle = useCallback(() => {
    setShowTranslated(prev => !prev);
  }, []);

  const handleSelect = useCallback((e) => {
    e.stopPropagation();
    onSelect(item.id);
  }, [onSelect, item.id]);

  const handleCopyClick = useCallback(() => {
    onCopy(item.translatedText);
  }, [onCopy, item.translatedText]);

  const handleRestoreClick = useCallback(() => {
    onRestore(item.id);
  }, [onRestore, item.id]);

  const handleFavoriteClick = useCallback(() => {
    onFavorite(item);
  }, [onFavorite, item]);

  const handleDeleteClick = useCallback(() => {
    onDelete(item.id);
  }, [onDelete, item.id]);
  
  // 双击查看详情
  const handleDoubleClick = useCallback(() => {
    if (onDoubleClick) {
      onDoubleClick(item);
    }
  }, [onDoubleClick, item]);

  return (
    <div className={`history-card ${isSelected ? 'selected' : ''}`} onDoubleClick={handleDoubleClick}>
      <div className="card-header">
        <span className="card-lang">{item.sourceLanguage || 'auto'} → {item.targetLanguage || 'zh'}</span>
        <div className="card-header-right">
          <span className="card-time">{dayjs(item.timestamp).format('HH:mm')}</span>
          {showCheckbox && (
            <button className="card-checkbox" onClick={handleSelect}>
              {isSelected ? <CheckSquare size={16} /> : <Square size={16} />}
            </button>
          )}
        </div>
      </div>
      
      <div className="card-body" onClick={handleToggle} title="点击切换原文/译文，双击查看详情">
        <div className="card-text-label">
          {showTranslated ? '译文' : '原文'}
          <RotateCcw size={12} className="switch-hint" />
        </div>
        <div className={`card-text ${showTranslated ? 'translated' : 'source'}`}>
          <HighlightText 
            text={showTranslated ? item.translatedText : item.sourceText} 
            search={searchQuery}
          />
        </div>
      </div>
      
      <div className="card-actions">
        <button onClick={handleCopyClick} title="复制译文">
          <Copy size={14} />
        </button>
        <button onClick={handleRestoreClick} title="恢复编辑">
          <Edit3 size={14} />
        </button>
        <button onClick={handleFavoriteClick} className={isFavorite ? 'active' : ''} title={isFavorite ? '取消收藏' : '收藏'}>
          <Star size={14} fill={isFavorite ? 'currentColor' : 'none'} />
        </button>
        <button onClick={handleDeleteClick} className="danger" title="删除">
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  // 自定义比较函数 - 只比较会影响渲染的 props
  return (
    prevProps.item.id === nextProps.item.id &&
    prevProps.item.sourceText === nextProps.item.sourceText &&
    prevProps.item.translatedText === nextProps.item.translatedText &&
    prevProps.isFavorite === nextProps.isFavorite &&
    prevProps.isSelected === nextProps.isSelected &&
    prevProps.showCheckbox === nextProps.showCheckbox &&
    prevProps.searchQuery === nextProps.searchQuery
  );
});
HistoryCard.displayName = 'HistoryCard';

/**
 * 历史记录面板 - 性能优化版
 */
const HistoryPanel = ({ showNotification }) => {
  const notify = useCallback((msg, type) => {
    if (showNotification) showNotification(msg, type);
  }, [showNotification]);

  // 分页配置
  const PAGE_SIZE = 50;
  const LOAD_MORE_THRESHOLD = 100;

  // 状态
  const [viewMode, setViewMode] = useState('card');
  const [groupBy, setGroupBy] = useState('date');
  const [showStats, setShowStats] = useState(false);
  const [dateRange, setDateRange] = useState('all');
  const [searchInput, setSearchInput] = useState(''); // 原始输入
  const [expandedGroups, setExpandedGroups] = useState(new Set(['今天', '昨天']));
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [sortConfig, setSortConfig] = useState({ key: 'timestamp', direction: 'desc' });
  const [focusIndex, setFocusIndex] = useState(-1);
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  
  // 详情弹窗状态
  const [detailItem, setDetailItem] = useState(null);
  
  // 🔧 搜索防抖 - 300ms 延迟
  const debouncedSearch = useDebounce(searchInput, 300);
  
  const contentRef = useRef(null);
  
  // Store - 使用选择器减少重渲染
  const history = useTranslationStore(state => state.history);
  const favorites = useTranslationStore(state => state.favorites);
  const translationMode = useTranslationStore(state => state.translationMode);
  const clearHistory = useTranslationStore(state => state.clearHistory);
  const restoreFromHistory = useTranslationStore(state => state.restoreFromHistory);
  const addToFavorites = useTranslationStore(state => state.addToFavorites);
  const removeFromFavorites = useTranslationStore(state => state.removeFromFavorites);
  const removeFromHistory = useTranslationStore(state => state.removeFromHistory);
  const exportHistory = useTranslationStore(state => state.exportHistory);
  const importHistory = useTranslationStore(state => state.importHistory);

  // 🔧 收藏 ID Set 缓存 - O(1) 查找替代 O(n) 遍历
  const favoriteIds = useMemo(() => {
    return new Set(favorites?.map(f => f.id) || []);
  }, [favorites]);

  // 无痕模式检查
  const isSecureMode = translationMode === PRIVACY_MODES.SECURE;

  // 统计数据 - useMemo 缓存
  const enhancedStats = useMemo(() => {
    if (!Array.isArray(history) || history.length === 0) {
      return { total: 0, today: 0, thisWeek: 0, thisMonth: 0, totalChars: 0, avgLength: 0, languagePairs: [], peakHour: null, streak: 0 };
    }

    const now = dayjs();
    let today = 0, thisWeek = 0, thisMonth = 0, totalChars = 0;
    const langPairCount = {}, hourCount = {}, dateSet = new Set();

    for (const item of history) {
      const itemDate = dayjs(item.timestamp);
      totalChars += item.sourceText?.length || 0;
      
      if (itemDate.isSameOrAfter(now.startOf('day'))) today++;
      if (itemDate.isSameOrAfter(now.startOf('week'))) thisWeek++;
      if (itemDate.isSameOrAfter(now.startOf('month'))) thisMonth++;
      
      const pair = `${item.sourceLanguage || 'auto'} → ${item.targetLanguage || 'zh'}`;
      langPairCount[pair] = (langPairCount[pair] || 0) + 1;
      hourCount[itemDate.hour()] = (hourCount[itemDate.hour()] || 0) + 1;
      dateSet.add(itemDate.format('YYYY-MM-DD'));
    }

    let streak = 0, checkDate = now;
    while (dateSet.has(checkDate.format('YYYY-MM-DD'))) { streak++; checkDate = checkDate.subtract(1, 'day'); }

    const languagePairs = Object.entries(langPairCount).sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([pair, count]) => ({ pair, count, percent: Math.round(count / history.length * 100) }));
    const peakHour = Object.entries(hourCount).sort((a, b) => b[1] - a[1])[0];

    return { 
      total: history.length, today, thisWeek, thisMonth, totalChars,
      avgLength: Math.round(totalChars / history.length), languagePairs,
      peakHour: peakHour ? { hour: parseInt(peakHour[0]), count: peakHour[1] } : null, streak 
    };
  }, [history]);

  // 过滤和排序 - 使用防抖后的搜索词
  const filteredHistory = useMemo(() => {
    if (!Array.isArray(history)) return [];
    
    let filtered = [...history];

    // 使用防抖后的搜索词
    if (debouncedSearch) {
      const query = debouncedSearch.toLowerCase();
      filtered = filtered.filter(item =>
        (item.sourceText || '').toLowerCase().includes(query) ||
        (item.translatedText || '').toLowerCase().includes(query)
      );
    }

    const now = dayjs();
    switch (dateRange) {
      case 'today': filtered = filtered.filter(item => dayjs(item.timestamp).isSameOrAfter(now.startOf('day'))); break;
      case 'week': filtered = filtered.filter(item => dayjs(item.timestamp).isSameOrAfter(now.startOf('week'))); break;
      case 'month': filtered = filtered.filter(item => dayjs(item.timestamp).isSameOrAfter(now.startOf('month'))); break;
    }

    // 排序
    filtered.sort((a, b) => {
      let aVal, bVal;
      switch (sortConfig.key) {
        case 'timestamp': aVal = a.timestamp || 0; bVal = b.timestamp || 0; break;
        case 'sourceLength': aVal = a.sourceText?.length || 0; bVal = b.sourceText?.length || 0; break;
        case 'language': aVal = `${a.sourceLanguage}${a.targetLanguage}`; bVal = `${b.sourceLanguage}${b.targetLanguage}`; break;
        default: aVal = a.timestamp || 0; bVal = b.timestamp || 0;
      }
      if (typeof aVal === 'string') return sortConfig.direction === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      return sortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
    });

    return filtered;
  }, [history, debouncedSearch, dateRange, sortConfig]);

  // 分页后的数据
  const paginatedHistory = useMemo(() => {
    return filteredHistory.slice(0, displayCount);
  }, [filteredHistory, displayCount]);

  // 是否还有更多数据
  const hasMore = filteredHistory.length > displayCount;

  // 加载更多 - useCallback
  const loadMore = useCallback(() => {
    if (isLoadingMore || !hasMore) return;
    setIsLoadingMore(true);
    setTimeout(() => {
      setDisplayCount(prev => Math.min(prev + PAGE_SIZE, filteredHistory.length));
      setIsLoadingMore(false);
    }, 100);
  }, [isLoadingMore, hasMore, filteredHistory.length]);

  // 滚动加载更多
  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      if (scrollHeight - scrollTop - clientHeight < LOAD_MORE_THRESHOLD) {
        loadMore();
      }
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [loadMore]);

  // 搜索/筛选变化时重置分页
  useEffect(() => {
    setDisplayCount(PAGE_SIZE);
  }, [debouncedSearch, dateRange]);

  // 分组 - 使用分页后的数据
  const groupedHistory = useMemo(() => {
    const groups = {};
    const now = dayjs();
    
    for (const item of paginatedHistory) {
      let key;
      if (groupBy === 'date') {
        const d = dayjs(item.timestamp);
        if (d.isSame(now, 'day')) key = '今天';
        else if (d.isSame(now.subtract(1, 'day'), 'day')) key = '昨天';
        else if (d.isSame(now, 'week')) key = '本周';
        else if (d.isSame(now, 'month')) key = '本月';
        else key = d.format('YYYY年MM月');
      } else {
        key = `${item.sourceLanguage || 'auto'} → ${item.targetLanguage || 'zh'}`;
      }
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    }

    const order = ['今天', '昨天', '本周', '本月'];
    return Object.entries(groups)
      .sort((a, b) => {
        const ai = order.indexOf(a[0]), bi = order.indexOf(b[0]);
        if (ai !== -1 && bi !== -1) return ai - bi;
        if (ai !== -1) return -1;
        if (bi !== -1) return 1;
        return b[0].localeCompare(a[0]);
      })
      .map(([title, items]) => ({ title, items, count: items.length }));
  }, [paginatedHistory, groupBy]);

  // 🔧 所有回调函数使用 useCallback

  const toggleGroup = useCallback((title) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      next.has(title) ? next.delete(title) : next.add(title);
      return next;
    });
  }, []);

  const toggleSelect = useCallback((id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    if (selectedIds.size === filteredHistory.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredHistory.map(i => i.id)));
    }
  }, [selectedIds.size, filteredHistory]);

  const deleteSelected = useCallback(() => {
    if (selectedIds.size === 0) return;
    if (window.confirm(`确定删除选中的 ${selectedIds.size} 条记录？`)) {
      selectedIds.forEach(id => removeFromHistory(id));
      setSelectedIds(new Set());
      setSelectMode(false);
      notify(`已删除 ${selectedIds.size} 条`, 'success');
    }
  }, [selectedIds, removeFromHistory, notify]);

  const handleCopy = useCallback((text) => {
    navigator.clipboard.writeText(text);
    notify('已复制译文', 'success');
  }, [notify]);

  const handleRestore = useCallback((id) => {
    restoreFromHistory(id);
    notify('已恢复到编辑区', 'success');
  }, [restoreFromHistory, notify]);

  // 🔧 使用 favoriteIds Set 优化查找
  const handleFavorite = useCallback((item) => {
    const isFav = favoriteIds.has(item.id);
    isFav ? removeFromFavorites(item.id) : addToFavorites(item);
    notify(isFav ? '已取消收藏' : '已收藏', 'success');
  }, [favoriteIds, addToFavorites, removeFromFavorites, notify]);

  const handleExport = useCallback(() => {
    try {
      const data = exportHistory('json');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `t-translate-history-${dayjs().format('YYYY-MM-DD')}.json`;
      a.click();
      URL.revokeObjectURL(a.href); // 清理
      notify('导出成功', 'success');
    } catch { 
      notify('导出失败', 'error'); 
    }
  }, [exportHistory, notify]);

  const handleImport = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const result = await importHistory(file);
        if (result?.success) notify(`导入 ${result.count || 0} 条`, 'success');
      } catch { 
        notify('导入失败', 'error'); 
      }
    };
    reader.readAsText(file);
    e.target.value = null;
  }, [importHistory, notify]);

  const handleSort = useCallback((key) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc'
    }));
  }, []);

  const handleClearSearch = useCallback(() => {
    setSearchInput('');
  }, []);

  const handleSearchChange = useCallback((e) => {
    setSearchInput(e.target.value);
  }, []);

  const handleClearHistory = useCallback(() => {
    if (window.confirm(`确定清空所有 ${history.length} 条记录？`)) {
      clearHistory();
      notify('已清空', 'success');
    }
  }, [history.length, clearHistory, notify]);

  const toggleSelectMode = useCallback(() => {
    setSelectMode(prev => !prev);
    setSelectedIds(new Set());
  }, []);

  const toggleStats = useCallback(() => {
    setShowStats(prev => !prev);
  }, []);

  // 键盘导航
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!contentRef.current) return;
      
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusIndex(prev => Math.min(prev + 1, filteredHistory.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusIndex(prev => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter' && focusIndex >= 0) {
        e.preventDefault();
        const item = filteredHistory[focusIndex];
        if (item) {
          navigator.clipboard.writeText(item.translatedText);
          notify('已复制译文', 'success');
        }
      } else if (e.key === ' ' && focusIndex >= 0 && selectMode) {
        e.preventDefault();
        const item = filteredHistory[focusIndex];
        if (item) toggleSelect(item.id);
      } else if (e.key === 'Escape') {
        setSelectMode(false);
        setSelectedIds(new Set());
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [focusIndex, filteredHistory, selectMode, notify, toggleSelect]);

  // 统计面板
  const renderStats = () => {
    if (!showStats) return null;
    return (
      <div className="stats-panel">
        <div className="stats-grid">
          <div className="stat-card">
            <Hash size={20} />
            <div className="stat-value">{enhancedStats.total}</div>
            <div className="stat-label">总记录</div>
          </div>
          <div className="stat-card highlight">
            <Calendar size={20} />
            <div className="stat-value">{enhancedStats.today}</div>
            <div className="stat-label">今日翻译</div>
          </div>
          <div className="stat-card">
            <TrendingUp size={20} />
            <div className="stat-value">{enhancedStats.thisWeek}</div>
            <div className="stat-label">本周</div>
          </div>
          <div className="stat-card">
            <Type size={20} />
            <div className="stat-value">{enhancedStats.totalChars.toLocaleString()}</div>
            <div className="stat-label">总字符</div>
          </div>
          <div className="stat-card">
            <Activity size={20} />
            <div className="stat-value">{enhancedStats.avgLength}</div>
            <div className="stat-label">平均长度</div>
          </div>
          <div className="stat-card">
            <Clock size={20} />
            <div className="stat-value">{enhancedStats.streak}</div>
            <div className="stat-label">连续天数</div>
          </div>
        </div>
        {enhancedStats.languagePairs.length > 0 && (
          <div className="lang-stats">
            <div className="lang-stats-title"><Languages size={14} /> 常用语言对</div>
            {enhancedStats.languagePairs.map(({ pair, count, percent }) => (
              <div key={pair} className="lang-stat-item">
                <span className="lang-pair">{pair}</span>
                <div className="lang-bar" style={{ width: `${percent}%` }} />
                <span className="lang-count">{count} ({percent}%)</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  // 渲染表格
  const renderTableGroup = useCallback((group) => (
    <div key={group.title} className="table-group">
      <div className="table-group-header" onClick={() => toggleGroup(group.title)}>
        {expandedGroups.has(group.title) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <span>{group.title}</span>
        <span className="group-count">{group.count}</span>
      </div>
      {expandedGroups.has(group.title) && (
        <table className="history-table">
          <thead>
            <tr>
              {selectMode && <th className="col-check"></th>}
              <th className="col-time" onClick={() => handleSort('timestamp')} style={{cursor: 'pointer'}}>
                时间 {sortConfig.key === 'timestamp' && <ArrowUpDown size={12} />}
              </th>
              <th className="col-lang" onClick={() => handleSort('language')} style={{cursor: 'pointer'}}>
                语言 {sortConfig.key === 'language' && <ArrowUpDown size={12} />}
              </th>
              <th className="col-source" onClick={() => handleSort('sourceLength')} style={{cursor: 'pointer'}}>
                原文 {sortConfig.key === 'sourceLength' && <ArrowUpDown size={12} />}
              </th>
              <th className="col-translated">译文</th>
              <th className="col-actions">操作</th>
            </tr>
          </thead>
          <tbody>
            {group.items.map((item, index) => (
              <tr 
                key={`${item.id}-${index}`} 
                className={selectedIds.has(item.id) ? 'selected' : ''}
                onDoubleClick={() => setDetailItem(item)}
                style={{ cursor: 'pointer' }}
              >
                {selectMode && (
                  <td className="col-check">
                    <button onClick={(e) => { e.stopPropagation(); toggleSelect(item.id); }}>
                      {selectedIds.has(item.id) ? <CheckSquare size={14} /> : <Square size={14} />}
                    </button>
                  </td>
                )}
                <td className="cell-time">{dayjs(item.timestamp).format('HH:mm')}</td>
                <td className="cell-lang">{item.sourceLanguage || 'auto'} → {item.targetLanguage || 'zh'}</td>
                <td><div className="cell-text"><HighlightText text={item.sourceText?.slice(0, 60)} search={debouncedSearch} />{item.sourceText?.length > 60 ? '...' : ''}</div></td>
                <td><div className="cell-text"><HighlightText text={item.translatedText?.slice(0, 60)} search={debouncedSearch} />{item.translatedText?.length > 60 ? '...' : ''}</div></td>
                <td className="cell-actions" onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => handleCopy(item.translatedText)} title="复制"><Copy size={12} /></button>
                  <button onClick={() => handleRestore(item.id)} title="恢复"><Edit3 size={12} /></button>
                  <button onClick={() => handleFavorite(item)} title="收藏" className={favoriteIds.has(item.id) ? 'active' : ''}>
                    <Star size={12} fill={favoriteIds.has(item.id) ? 'currentColor' : 'none'} />
                  </button>
                  <button onClick={() => removeFromHistory(item.id)} title="删除" className="danger"><Trash2 size={12} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  ), [expandedGroups, selectMode, sortConfig, selectedIds, debouncedSearch, favoriteIds, 
      toggleGroup, handleSort, toggleSelect, handleCopy, handleRestore, handleFavorite, removeFromHistory]);

  // 渲染内容
  const renderContent = () => {
    if (filteredHistory.length === 0) {
      return (
        <div className="empty-state">
          <Clock size={48} />
          <p>{debouncedSearch ? '没有找到匹配的记录' : '暂无翻译历史'}</p>
          <span>翻译内容会自动保存在这里</span>
        </div>
      );
    }

    // 表格视图
    if (viewMode === 'table') {
      return (
        <div className="history-table-wrapper">
          {groupedHistory.map(renderTableGroup)}
        </div>
      );
    }

    // 卡片视图
    return (
      <div className="history-cards">
        {groupedHistory.map(group => (
          <div key={group.title} className="card-group">
            <div className="card-group-header" onClick={() => toggleGroup(group.title)}>
              {expandedGroups.has(group.title) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              <span>{group.title}</span>
              <span className="group-count">{group.count}</span>
            </div>
            {expandedGroups.has(group.title) && (
              <div className="card-grid">
                {group.items.map((item, index) => (
                  <HistoryCard
                    key={`${item.id}-${index}`}
                    item={item}
                    onCopy={handleCopy}
                    onRestore={handleRestore}
                    onFavorite={handleFavorite}
                    onDelete={removeFromHistory}
                    isFavorite={favoriteIds.has(item.id)}
                    isSelected={selectedIds.has(item.id)}
                    onSelect={toggleSelect}
                    showCheckbox={selectMode}
                    searchQuery={debouncedSearch}
                    onDoubleClick={setDetailItem}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="history-panel">
      {/* 无痕模式提示 */}
      {isSecureMode && (
        <div className="secure-mode-banner">
          <div className="secure-banner-icon">🔒</div>
          <div className="secure-banner-content">
            <h4>无痕模式已启用</h4>
            <p>当前模式下不会保存任何翻译历史记录。如需保存历史，请切换到标准模式。</p>
          </div>
        </div>
      )}
      
      {/* 工具栏 */}
      <div className="history-toolbar">
        <div className="toolbar-left">
          <div className="toolbar-search">
            <Search size={16} />
            <input 
              type="text" 
              placeholder="搜索历史..." 
              value={searchInput} 
              onChange={handleSearchChange} 
            />
            {searchInput && (
              <button onClick={handleClearSearch}>
                <X size={14} />
              </button>
            )}
          </div>

          <div className="toolbar-divider" />

          <div className="view-toggle">
            <button className={viewMode === 'card' ? 'active' : ''} onClick={() => setViewMode('card')} title="卡片">
              <LayoutGrid size={16} /><span>卡片</span>
            </button>
            <button className={viewMode === 'table' ? 'active' : ''} onClick={() => setViewMode('table')} title="表格">
              <Table size={16} /><span>表格</span>
            </button>
          </div>

          <div className="toolbar-divider" />

          <button className={`toolbar-btn ${showStats ? 'active' : ''}`} onClick={toggleStats}>
            <BarChart3 size={16} /><span>统计</span>
          </button>
          
          <button className={`toolbar-btn ${selectMode ? 'active' : ''}`} onClick={toggleSelectMode}>
            <CheckSquare size={16} /><span>选择</span>
          </button>
        </div>

        <div className="toolbar-center">
          <select className="toolbar-select" value={dateRange} onChange={(e) => setDateRange(e.target.value)}>
            <option value="all">全部时间</option>
            <option value="today">今天</option>
            <option value="week">本周</option>
            <option value="month">本月</option>
          </select>

          <select className="toolbar-select" value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
            <option value="date">按日期</option>
            <option value="language">按语言</option>
          </select>
        </div>

        <div className="toolbar-right">
          {selectMode && selectedIds.size > 0 && (
            <button className="toolbar-btn danger" onClick={deleteSelected}>
              <Trash size={16} /><span>删除 ({selectedIds.size})</span>
            </button>
          )}
          
          <button className="toolbar-btn" onClick={handleExport} title="导出"><Download size={16} /></button>
          <label className="toolbar-btn" title="导入">
            <Upload size={16} />
            <input type="file" accept=".json" onChange={handleImport} style={{ display: 'none' }} />
          </label>
          
          <div className="toolbar-divider" />
          
          <button className="toolbar-btn danger" onClick={handleClearHistory}>
            <Trash2 size={16} /><span>清空</span>
          </button>
        </div>
      </div>

      {renderStats()}

      {debouncedSearch && (
        <div className="search-hint">
          搜索 "<strong>{debouncedSearch}</strong>" 找到 <strong>{filteredHistory.length}</strong> 条结果
          {filteredHistory.length > 0 && <span className="hint-tip">（↑↓ 导航，Enter 复制）</span>}
        </div>
      )}

      <div className="history-content" ref={contentRef}>
        {renderContent()}
        
        {/* 加载更多 */}
        {hasMore && (
          <div className="load-more-wrapper">
            <button 
              className="load-more-btn" 
              onClick={loadMore}
              disabled={isLoadingMore}
            >
              {isLoadingMore ? (
                <>
                  <span className="loading-spinner"></span>
                  加载中...
                </>
              ) : (
                <>加载更多 ({filteredHistory.length - displayCount} 条)</>
              )}
            </button>
          </div>
        )}
      </div>

      {filteredHistory.length > 0 && (
        <div className="history-footer">
          <span>显示 {Math.min(displayCount, filteredHistory.length)} / {filteredHistory.length} 条</span>
          {selectMode && <span className="select-hint">已选 {selectedIds.size} 条 | 空格选择，Esc 退出</span>}
        </div>
      )}

      {/* 详情弹窗 */}
      {detailItem && (
        <div className="detail-modal-overlay" onClick={() => setDetailItem(null)}>
          <div className="detail-modal" onClick={e => e.stopPropagation()}>
            <div className="detail-modal-header">
              <span className="detail-lang">{detailItem.sourceLanguage || 'auto'} → {detailItem.targetLanguage || 'zh'}</span>
              <span className="detail-time">{dayjs(detailItem.timestamp).format('YYYY-MM-DD HH:mm:ss')}</span>
              <button className="detail-close" onClick={() => setDetailItem(null)}>
                <X size={18} />
              </button>
            </div>
            
            <div className="detail-modal-body">
              <div className="detail-section">
                <div className="detail-label">原文</div>
                <div className="detail-text source">{detailItem.sourceText}</div>
              </div>
              <div className="detail-section">
                <div className="detail-label">译文</div>
                <div className="detail-text translated">{detailItem.translatedText}</div>
              </div>
            </div>
            
            <div className="detail-modal-footer">
              <button className="detail-btn" onClick={() => { handleCopy(detailItem.sourceText); }}>
                <Copy size={14} /> 复制原文
              </button>
              <button className="detail-btn" onClick={() => { handleCopy(detailItem.translatedText); }}>
                <Copy size={14} /> 复制译文
              </button>
              <button className="detail-btn primary" onClick={() => { handleRestore(detailItem.id); setDetailItem(null); }}>
                <Edit3 size={14} /> 恢复编辑
              </button>
              <button 
                className={`detail-btn ${favoriteIds.has(detailItem.id) ? 'active' : ''}`} 
                onClick={() => handleFavorite(detailItem)}
              >
                <Star size={14} fill={favoriteIds.has(detailItem.id) ? 'currentColor' : 'none'} /> 
                {favoriteIds.has(detailItem.id) ? '取消收藏' : '收藏'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default memo(HistoryPanel);
