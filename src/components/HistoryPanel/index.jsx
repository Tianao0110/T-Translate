// src/components/HistoryPanel.jsx
import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  Clock, Search, Trash2, Copy, Star, 
  Calendar, ChevronDown, ChevronRight, LayoutGrid,
  BarChart3, TrendingUp, X, Edit3, Download, Upload,
  FileText, Hash, Type, Languages, Activity, RotateCcw,
  Table, GitBranch, CheckSquare, Square, Trash, ArrowUpDown
} from 'lucide-react';
import useTranslationStore from '../../stores/translation-store';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter';
import 'dayjs/locale/zh-cn';
import './styles.css'; 

dayjs.extend(relativeTime);
dayjs.extend(isSameOrAfter);
dayjs.locale('zh-cn');

/**
 * 搜索高亮组件
 */
const HighlightText = ({ text, search }) => {
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
};

/**
 * 卡片组件 - 点击切换原文/译文
 */
const HistoryCard = ({ item, onCopy, onRestore, onFavorite, onDelete, isFavorite, isSelected, onSelect, showCheckbox, searchQuery }) => {
  const [showTranslated, setShowTranslated] = useState(true);
  
  return (
    <div className={`history-card ${isSelected ? 'selected' : ''}`}>
      <div className="card-header">
        <span className="card-lang">{item.sourceLanguage || 'auto'} → {item.targetLanguage || 'zh'}</span>
        <div className="card-header-right">
          <span className="card-time">{dayjs(item.timestamp).format('HH:mm')}</span>
          {showCheckbox && (
            <button className="card-checkbox" onClick={(e) => { e.stopPropagation(); onSelect(item.id); }}>
              {isSelected ? <CheckSquare size={16} /> : <Square size={16} />}
            </button>
          )}
        </div>
      </div>
      
      <div className="card-body" onClick={() => setShowTranslated(!showTranslated)} title="点击切换原文/译文">
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
        <button onClick={() => onCopy(item.translatedText)} title="复制译文">
          <Copy size={14} />
        </button>
        <button onClick={() => onRestore(item.id)} title="恢复编辑">
          <Edit3 size={14} />
        </button>
        <button onClick={() => onFavorite(item)} className={isFavorite ? 'active' : ''} title={isFavorite ? '取消收藏' : '收藏'}>
          <Star size={14} fill={isFavorite ? 'currentColor' : 'none'} />
        </button>
        <button onClick={() => onDelete(item.id)} className="danger" title="删除">
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
};

/**
 * 历史记录面板
 */
const HistoryPanel = ({ showNotification }) => {
  const notify = showNotification || ((msg, type) => console.log(`[${type}] ${msg}`));

  // 分页配置
  const PAGE_SIZE = 50; // 每页显示数量
  const LOAD_MORE_THRESHOLD = 100; // 滚动到底部多少像素时加载更多

  // 状态
  const [viewMode, setViewMode] = useState('card'); // card | timeline | table
  const [groupBy, setGroupBy] = useState('date'); // date | language
  const [showStats, setShowStats] = useState(false);
  const [dateRange, setDateRange] = useState('all');
  const [localSearch, setLocalSearch] = useState('');
  const [expandedGroups, setExpandedGroups] = useState(new Set(['今天', '昨天']));
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [sortConfig, setSortConfig] = useState({ key: 'timestamp', direction: 'desc' });
  const [focusIndex, setFocusIndex] = useState(-1);
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE); // 当前显示数量
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  
  const contentRef = useRef(null);
  
  // Store
  const {
    history, favorites, clearHistory, restoreFromHistory,
    addToFavorites, removeFromFavorites, removeFromHistory,
    exportHistory, importHistory,
    translationMode, // 隐私模式
  } = useTranslationStore();

  // 无痕模式检查
  const isSecureMode = translationMode === 'secure';

  // 统计数据
  const enhancedStats = useMemo(() => {
    if (!Array.isArray(history) || history.length === 0) {
      return { total: 0, today: 0, thisWeek: 0, thisMonth: 0, totalChars: 0, avgLength: 0, languagePairs: [], peakHour: null, streak: 0 };
    }

    const now = dayjs();
    let today = 0, thisWeek = 0, thisMonth = 0, totalChars = 0;
    const langPairCount = {}, hourCount = {}, dateSet = new Set();

    history.forEach(item => {
      const itemDate = dayjs(item.timestamp);
      totalChars += item.sourceText?.length || 0;
      
      if (itemDate.isSameOrAfter(now.startOf('day'))) today++;
      if (itemDate.isSameOrAfter(now.startOf('week'))) thisWeek++;
      if (itemDate.isSameOrAfter(now.startOf('month'))) thisMonth++;
      
      const pair = `${item.sourceLanguage || 'auto'} → ${item.targetLanguage || 'zh'}`;
      langPairCount[pair] = (langPairCount[pair] || 0) + 1;
      hourCount[itemDate.hour()] = (hourCount[itemDate.hour()] || 0) + 1;
      dateSet.add(itemDate.format('YYYY-MM-DD'));
    });

    let streak = 0, checkDate = now;
    while (dateSet.has(checkDate.format('YYYY-MM-DD'))) { streak++; checkDate = checkDate.subtract(1, 'day'); }

    const languagePairs = Object.entries(langPairCount).sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([pair, count]) => ({ pair, count, percent: Math.round(count / history.length * 100) }));
    const peakHour = Object.entries(hourCount).sort((a, b) => b[1] - a[1])[0];

    return { total: history.length, today, thisWeek, thisMonth, totalChars,
      avgLength: Math.round(totalChars / history.length), languagePairs,
      peakHour: peakHour ? { hour: parseInt(peakHour[0]), count: peakHour[1] } : null, streak };
  }, [history]);

  // 过滤和排序
  const filteredHistory = useMemo(() => {
    if (!Array.isArray(history)) return [];
    
    let filtered = [...history];

    if (localSearch) {
      const query = localSearch.toLowerCase();
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
  }, [history, localSearch, dateRange, sortConfig]);

  // 分页后的数据
  const paginatedHistory = useMemo(() => {
    return filteredHistory.slice(0, displayCount);
  }, [filteredHistory, displayCount]);

  // 是否还有更多数据
  const hasMore = filteredHistory.length > displayCount;

  // 加载更多
  const loadMore = useCallback(() => {
    if (isLoadingMore || !hasMore) return;
    setIsLoadingMore(true);
    // 模拟异步加载，提供更好的用户体验
    setTimeout(() => {
      setDisplayCount(prev => Math.min(prev + PAGE_SIZE, filteredHistory.length));
      setIsLoadingMore(false);
    }, 100);
  }, [isLoadingMore, hasMore, filteredHistory.length, PAGE_SIZE]);

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

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [loadMore, LOAD_MORE_THRESHOLD]);

  // 搜索时重置分页
  useEffect(() => {
    setDisplayCount(PAGE_SIZE);
  }, [localSearch, dateRange, PAGE_SIZE]);

  // 分组 - 使用分页后的数据
  const groupedHistory = useMemo(() => {
    const groups = {};
    const now = dayjs();
    
    paginatedHistory.forEach(item => {
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
    });

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
  }, [focusIndex, filteredHistory, selectMode, notify]);

  // 操作函数
  const toggleGroup = (title) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      next.has(title) ? next.delete(title) : next.add(title);
      return next;
    });
  };

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedIds.size === filteredHistory.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredHistory.map(i => i.id)));
    }
  };

  const deleteSelected = () => {
    if (selectedIds.size === 0) return;
    if (window.confirm(`确定删除选中的 ${selectedIds.size} 条记录？`)) {
      selectedIds.forEach(id => removeFromHistory(id));
      setSelectedIds(new Set());
      setSelectMode(false);
      notify(`已删除 ${selectedIds.size} 条`, 'success');
    }
  };

  const handleCopy = useCallback((text) => {
    navigator.clipboard.writeText(text);
    notify('已复制译文', 'success');
  }, [notify]);

  const handleRestore = useCallback((id) => {
    restoreFromHistory(id);
    notify('已恢复到编辑区', 'success');
  }, [restoreFromHistory, notify]);

  const handleFavorite = useCallback((item) => {
    const isFav = favorites?.some(f => f.id === item.id);
    isFav ? removeFromFavorites(item.id) : addToFavorites(item);
    notify(isFav ? '已取消收藏' : '已收藏', 'success');
  }, [favorites, addToFavorites, removeFromFavorites, notify]);

  const handleExport = useCallback(() => {
    try {
      const data = exportHistory('json');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `t-translate-history-${dayjs().format('YYYY-MM-DD')}.json`;
      a.click();
      notify('导出成功', 'success');
    } catch { notify('导出失败', 'error'); }
  }, [exportHistory, notify]);

  const handleImport = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const result = await importHistory(file);
        if (result?.success) notify(`导入 ${result.count || 0} 条`, 'success');
      } catch { notify('导入失败', 'error'); }
    };
    reader.readAsText(file);
    e.target.value = null;
  }, [importHistory, notify]);

  const handleSort = (key) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc'
    }));
  };

  // 高亮搜索文字（与 HighlightText 组件保持一致）
  const highlightText = (text, search) => {
    if (!search || !text) return text;
    try {
      const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const parts = text.split(new RegExp(`(${escapedSearch})`, 'gi'));
      return parts.map((part, i) => 
        part.toLowerCase() === search.toLowerCase() ? 
          <mark key={i} className="search-highlight">{part}</mark> : part
      );
    } catch {
      return text;
    }
  };

  // 渲染统计面板
  const renderStats = () => {
    if (!showStats) return null;
    return (
      <div className="stats-panel">
        <div className="stats-header">
          <h3><BarChart3 size={18} /> 翻译统计</h3>
          <button className="stats-close-btn" onClick={() => setShowStats(false)}><X size={16} /></button>
        </div>
        <div className="stats-grid">
          <div className="stat-card primary">
            <div className="stat-icon"><Hash size={20} /></div>
            <div className="stat-info"><span className="stat-value">{enhancedStats.total}</span><span className="stat-label">总翻译</span></div>
          </div>
          <div className="stat-card">
            <div className="stat-icon"><Calendar size={20} /></div>
            <div className="stat-info"><span className="stat-value">{enhancedStats.today}</span><span className="stat-label">今日</span></div>
          </div>
          <div className="stat-card">
            <div className="stat-icon"><TrendingUp size={20} /></div>
            <div className="stat-info"><span className="stat-value">{enhancedStats.thisWeek}</span><span className="stat-label">本周</span></div>
          </div>
          <div className="stat-card">
            <div className="stat-icon"><Activity size={20} /></div>
            <div className="stat-info"><span className="stat-value">{enhancedStats.thisMonth}</span><span className="stat-label">本月</span></div>
          </div>
        </div>
        <div className="stats-details">
          <div className="stat-row"><Type size={16} /><span>总字符</span><strong>{enhancedStats.totalChars.toLocaleString()}</strong></div>
          <div className="stat-row"><FileText size={16} /><span>平均长度</span><strong>{enhancedStats.avgLength} 字</strong></div>
          {enhancedStats.streak > 0 && <div className="stat-row highlight"><Activity size={16} /><span>连续使用</span><strong>{enhancedStats.streak} 天 🔥</strong></div>}
          {enhancedStats.peakHour && <div className="stat-row"><Clock size={16} /><span>高峰时段</span><strong>{enhancedStats.peakHour.hour}:00</strong></div>}
        </div>
        {enhancedStats.languagePairs.length > 0 && (
          <div className="stats-languages">
            <h4><Languages size={16} /> 常用语言</h4>
            {enhancedStats.languagePairs.map((lp, i) => (
              <div key={i} className="language-bar">
                <span className="lang-pair">{lp.pair}</span>
                <div className="lang-progress"><div className="lang-fill" style={{ width: `${lp.percent}%` }} /></div>
                <span className="lang-count">{lp.count}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  // 渲染时间轴视图项
  const renderTimelineItem = (item, index) => {
    const isFavorite = favorites?.some(f => f.id === item.id);
    const isFocused = index === focusIndex;
    
    return (
      <div key={`${item.id}-${index}`} className={`timeline-item ${isFocused ? 'focused' : ''} ${selectedIds.has(item.id) ? 'selected' : ''}`}>
        <div className="timeline-content">
          <div className="timeline-header">
            <span className="timeline-time">{dayjs(item.timestamp).format('HH:mm')}</span>
            <span className="timeline-lang">{item.sourceLanguage || 'auto'} → {item.targetLanguage || 'zh'}</span>
            {selectMode && (
              <button className="item-checkbox" onClick={() => toggleSelect(item.id)}>
                {selectedIds.has(item.id) ? <CheckSquare size={16} /> : <Square size={16} />}
              </button>
            )}
          </div>
          <div className="timeline-bubble source">
            <span className="bubble-label">原文</span>
            <p>{highlightText(item.sourceText, localSearch)}</p>
          </div>
          <div className="timeline-bubble translated">
            <span className="bubble-label">译文</span>
            <p>{highlightText(item.translatedText, localSearch)}</p>
          </div>
          <div className="timeline-actions">
            <button onClick={() => handleCopy(item.translatedText)} title="复制译文"><Copy size={14} /></button>
            <button onClick={() => handleRestore(item.id)} title="恢复编辑"><Edit3 size={14} /></button>
            <button onClick={() => handleFavorite(item)} className={isFavorite ? 'active' : ''} title="收藏">
              <Star size={14} fill={isFavorite ? 'currentColor' : 'none'} />
            </button>
            <button onClick={() => removeFromHistory(item.id)} className="danger" title="删除"><Trash2 size={14} /></button>
          </div>
        </div>
      </div>
    );
  };

  // 渲染表格视图
  const renderTableGroup = (group) => (
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
              {selectMode && (
                <th className="col-check">
                  <button onClick={selectAll}>
                    {selectedIds.size === filteredHistory.length ? <CheckSquare size={16} /> : <Square size={16} />}
                  </button>
                </th>
              )}
              <th className="col-time" onClick={() => handleSort('timestamp')}>
                时间 <ArrowUpDown size={14} className={sortConfig.key === 'timestamp' ? 'active' : ''} />
              </th>
              <th className="col-lang">语言</th>
              <th className="col-source">原文</th>
              <th className="col-translated">译文</th>
              <th className="col-actions">操作</th>
            </tr>
          </thead>
          <tbody>
            {group.items.map((item, index) => {
              const isFavorite = favorites?.some(f => f.id === item.id);
              const isFocused = filteredHistory.indexOf(item) === focusIndex;
              return (
                <tr key={`${item.id}-${index}`} className={`${isFocused ? 'focused' : ''} ${selectedIds.has(item.id) ? 'selected' : ''}`}>
                  {selectMode && (
                    <td className="col-check">
                      <button onClick={() => toggleSelect(item.id)}>
                        {selectedIds.has(item.id) ? <CheckSquare size={16} /> : <Square size={16} />}
                      </button>
                    </td>
                  )}
                  <td className="col-time">{dayjs(item.timestamp).format('HH:mm')}</td>
                  <td className="col-lang">{item.sourceLanguage || 'auto'} → {item.targetLanguage || 'zh'}</td>
                  <td className="col-source" title={item.sourceText}>
                    <div className="cell-text">{highlightText(item.sourceText, localSearch)}</div>
                  </td>
                  <td className="col-translated" title={item.translatedText}>
                    <div className="cell-text">{highlightText(item.translatedText, localSearch)}</div>
                  </td>
                  <td className="col-actions">
                    <button onClick={() => handleCopy(item.translatedText)} title="复制译文"><Copy size={14} /></button>
                    <button onClick={() => handleFavorite(item)} className={isFavorite ? 'active' : ''} title="收藏">
                      <Star size={14} fill={isFavorite ? 'currentColor' : 'none'} />
                    </button>
                    <button onClick={() => removeFromHistory(item.id)} className="danger" title="删除"><Trash2 size={14} /></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );

  // 渲染内容
  const renderContent = () => {
    if (filteredHistory.length === 0) {
      return (
        <div className="empty-state">
          <Clock size={48} />
          <p>{localSearch ? '没有找到匹配的记录' : '暂无翻译历史'}</p>
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

    // 时间轴视图
    if (viewMode === 'timeline') {
      return (
        <div className="history-timeline">
          {groupedHistory.map(group => (
            <div key={group.title} className="timeline-group">
              <div className="timeline-group-header" onClick={() => toggleGroup(group.title)}>
                {expandedGroups.has(group.title) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                <span>{group.title}</span>
                <span className="group-count">{group.count}</span>
              </div>
              {expandedGroups.has(group.title) && (
                <div className="timeline-items">
                  {group.items.map((item, i) => renderTimelineItem(item, i))}
                </div>
              )}
            </div>
          ))}
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
                    isFavorite={favorites?.some(f => f.id === item.id)}
                    isSelected={selectedIds.has(item.id)}
                    onSelect={toggleSelect}
                    showCheckbox={selectMode}
                    searchQuery={localSearch}
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
            <input type="text" placeholder="搜索历史..." value={localSearch} onChange={(e) => setLocalSearch(e.target.value)} />
            {localSearch && <button onClick={() => setLocalSearch('')}><X size={14} /></button>}
          </div>

          <div className="toolbar-divider" />

          <div className="view-toggle">
            <button className={viewMode === 'card' ? 'active' : ''} onClick={() => setViewMode('card')} title="卡片">
              <LayoutGrid size={16} /><span>卡片</span>
            </button>
            <button className={viewMode === 'timeline' ? 'active' : ''} onClick={() => setViewMode('timeline')} title="时间轴">
              <GitBranch size={16} /><span>时间轴</span>
            </button>
            <button className={viewMode === 'table' ? 'active' : ''} onClick={() => setViewMode('table')} title="表格">
              <Table size={16} /><span>表格</span>
            </button>
          </div>

          <div className="toolbar-divider" />

          <button className={`toolbar-btn ${showStats ? 'active' : ''}`} onClick={() => setShowStats(!showStats)}>
            <BarChart3 size={16} /><span>统计</span>
          </button>
          
          <button className={`toolbar-btn ${selectMode ? 'active' : ''}`} onClick={() => { setSelectMode(!selectMode); setSelectedIds(new Set()); }}>
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
          
          <button className="toolbar-btn danger" onClick={() => {
            if (window.confirm(`确定清空所有 ${history.length} 条记录？`)) {
              clearHistory();
              notify('已清空', 'success');
            }
          }}>
            <Trash2 size={16} /><span>清空</span>
          </button>
        </div>
      </div>

      {renderStats()}

      {localSearch && (
        <div className="search-hint">
          搜索 "<strong>{localSearch}</strong>" 找到 <strong>{filteredHistory.length}</strong> 条结果
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
    </div>
  );
};

export default HistoryPanel;
