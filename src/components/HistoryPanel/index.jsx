import React, { useState, useMemo, useCallback, useEffect, useRef, memo } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n.js';
import {
  Clock, Search, Trash2, Copy, Star,
  Calendar, ChevronDown, ChevronRight, LayoutGrid,
  BarChart3, TrendingUp, X, Edit3, Download, Upload,
  FileText, Hash, Type, Languages, Activity, RotateCcw,
  Table, CheckSquare, Square, Trash, ArrowUpDown
} from 'lucide-react';
import useTranslationStore from '../../stores/translation-store';
import { useDebounce } from '../../utils/performance';
import useVisibleHotkey from '../../hooks/use-visible-hotkey.js';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter';
import 'dayjs/locale/zh-cn';
import './styles.css';

import { PRIVACY_MODES } from '@config/defaults';

dayjs.extend(relativeTime);
dayjs.extend(isSameOrAfter);
dayjs.locale('zh-cn');

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
  const { t } = useTranslation();
  const [showTranslated, setShowTranslated] = useState(true);

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

      <div className="card-body" onClick={handleToggle} title={t('history.card.clickHint')}>
        <div className="card-text-label">
          {showTranslated ? t('history.card.target') : t('history.card.source')}
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
        <button onClick={handleCopyClick} title={t('history.copyTarget')}>
          <Copy size={14} />
        </button>
        <button onClick={handleRestoreClick} title={t('history.restore')}>
          <Edit3 size={14} />
        </button>
        <button onClick={handleFavoriteClick} className={isFavorite ? 'active' : ''} title={isFavorite ? t('history.unfavorite') : t('history.favorite')}>
          <Star size={14} fill={isFavorite ? 'currentColor' : 'none'} />
        </button>
        <button onClick={handleDeleteClick} className="danger" title={t('history.delete')}>
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  // Custom comparator: only re-render on props that actually affect output.
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

const HistoryPanel = ({ showNotification }) => {
  const { t } = useTranslation();

  const notify = useCallback((msg, type) => {
    if (showNotification) showNotification(msg, type);
  }, [showNotification]);

  const PAGE_SIZE = 50;
  const LOAD_MORE_THRESHOLD = 100;

  const [viewMode, setViewMode] = useState('card');
  const [groupBy, setGroupBy] = useState('date');
  const [showStats, setShowStats] = useState(false);
  const [dateRange, setDateRange] = useState('all');
  const [searchInput, setSearchInput] = useState('');
  const [expandedGroups, setExpandedGroups] = useState(new Set(['today', 'yesterday']));
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [sortConfig, setSortConfig] = useState({ key: 'timestamp', direction: 'desc' });
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const [detailItem, setDetailItem] = useState(null);

  // Debounce typed search by 300ms — keeps filtering responsive without
  // refiltering on every keystroke.
  const debouncedSearch = useDebounce(searchInput, 300);

  const rootRef = useRef(null);
  const searchRef = useRef(null);
  const contentRef = useRef(null);

  // Ctrl+F focuses the panel search — guarded so the mounted-but-hidden
  // panel doesn't swallow the shortcut for the rest of the app.
  useVisibleHotkey(
    rootRef,
    (e) => (e.ctrlKey || e.metaKey) && e.key === 'f',
    (e) => {
      e.preventDefault();
      searchRef.current?.focus();
    }
  );

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

  // Set of favorite ids — O(1) lookup vs scanning the favorites array
  // for every history card we render.
  const favoriteIds = useMemo(() => {
    return new Set(favorites?.map(f => f.id) || []);
  }, [favorites]);

  const isSecureMode = translationMode === PRIVACY_MODES.SECURE;

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

  const filteredHistory = useMemo(() => {
    if (!Array.isArray(history)) return [];

    let filtered = [...history];

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

  const paginatedHistory = useMemo(() => {
    return filteredHistory.slice(0, displayCount);
  }, [filteredHistory, displayCount]);

  const hasMore = filteredHistory.length > displayCount;

  const loadMore = useCallback(() => {
    if (isLoadingMore || !hasMore) return;
    setIsLoadingMore(true);
    setTimeout(() => {
      setDisplayCount(prev => Math.min(prev + PAGE_SIZE, filteredHistory.length));
      setIsLoadingMore(false);
    }, 100);
  }, [isLoadingMore, hasMore, filteredHistory.length]);

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

  // Reset paging when the filter changes so the user sees results from
  // the top, not whatever offset they had scrolled to.
  useEffect(() => {
    setDisplayCount(PAGE_SIZE);
  }, [debouncedSearch, dateRange]);

  const groupedHistory = useMemo(() => {
    const groups = {};
    const now = dayjs();

    for (const item of paginatedHistory) {
      let key;
      if (groupBy === 'date') {
        const d = dayjs(item.timestamp);
        if (d.isSame(now, 'day')) key = 'today';
        else if (d.isSame(now.subtract(1, 'day'), 'day')) key = 'yesterday';
        else if (d.isSame(now, 'week')) key = 'thisWeek';
        else if (d.isSame(now, 'month')) key = 'thisMonth';
        else key = d.format('YYYY-MM');
      } else {
        key = `${item.sourceLanguage || 'auto'} → ${item.targetLanguage || 'zh'}`;
      }
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    }

    const order = ['today', 'yesterday', 'thisWeek', 'thisMonth'];
    return Object.entries(groups)
      .sort((a, b) => {
        const ai = order.indexOf(a[0]), bi = order.indexOf(b[0]);
        if (ai !== -1 && bi !== -1) return ai - bi;
        if (ai !== -1) return -1;
        if (bi !== -1) return 1;
        return b[0].localeCompare(a[0]);
      })
      .map(([key, items]) => ({ key, items, count: items.length }));
  }, [paginatedHistory, groupBy]);

  const getGroupTitle = useCallback((key) => {
    const dateGroupLabels = {
      today: t('history.today'),
      yesterday: t('history.yesterday'),
      thisWeek: t('history.thisWeek'),
      thisMonth: t('history.thisMonth'),
    };
    if (dateGroupLabels[key]) return dateGroupLabels[key];
    // YYYY-MM keys get localized: '2026年05月' for zh, 'May 2026' otherwise.
    if (/^\d{4}-\d{2}$/.test(key)) {
      const date = dayjs(key + '-01');
      const lang = i18n.language;
      return lang === 'zh' ? date.format('YYYY年MM月') : date.format('MMM YYYY');
    }
    return key;
  }, [t]);

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
    if (window.confirm(t('history.deleteSelectedConfirm', { count: selectedIds.size }))) {
      selectedIds.forEach(id => removeFromHistory(id));
      setSelectedIds(new Set());
      setSelectMode(false);
      notify(t('history.deletedCount', { count: selectedIds.size }), 'success');
    }
  }, [selectedIds, removeFromHistory, notify, t]);

  const handleCopy = useCallback((text) => {
    navigator.clipboard.writeText(text);
    notify(t('history.copied'), 'success');
  }, [notify, t]);

  const handleRestore = useCallback((id) => {
    restoreFromHistory(id);
    notify(t('history.restored'), 'success');
  }, [restoreFromHistory, notify, t]);

  const handleFavorite = useCallback((item) => {
    const isFav = favoriteIds.has(item.id);
    isFav ? removeFromFavorites(item.id) : addToFavorites(item);
    notify(isFav ? t('history.unfavorited') : t('history.favorited'), 'success');
  }, [favoriteIds, addToFavorites, removeFromFavorites, notify, t]);

  const handleExport = useCallback(async () => {
    try {
      const data = exportHistory('json');
      const content = JSON.stringify(data, null, 2);
      const filename = `t-translate-history-${dayjs().format('YYYY-MM-DD')}.json`;

      const saveFile = window.electron?.dialog?.saveFile;
      if (saveFile) {
        const result = await saveFile({
          defaultPath: filename,
          filters: [{ name: 'JSON', extensions: ['json'] }],
          data: content,
        });
        if (result.success) {
          notify(t('history.exportSuccess'), 'success');
        } else if (!result.canceled) {
          throw new Error(result.error);
        }
      } else {
        // Browser fallback when not running in Electron.
        const blob = new Blob([content], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        URL.revokeObjectURL(a.href);
        notify(t('history.exportSuccess'), 'success');
      }
    } catch {
      notify(t('history.exportFailed'), 'error');
    }
  }, [exportHistory, notify, t]);

  const handleImport = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const result = await importHistory(file);
        if (result?.success) notify(t('history.importedCount', { count: result.count || 0 }), 'success');
      } catch {
        notify(t('history.importFailed', 'Import failed'), 'error');
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
    if (window.confirm(t('history.clearAllConfirm', { count: history.length }))) {
      clearHistory();
      notify(t('history.cleared'), 'success');
    }
  }, [history.length, clearHistory, notify, t]);

  const toggleSelectMode = useCallback(() => {
    setSelectMode(prev => !prev);
    setSelectedIds(new Set());
  }, []);

  const toggleStats = useCallback(() => {
    setShowStats(prev => !prev);
  }, []);

  const renderStats = () => {
    if (!showStats) return null;
    return (
      <div className="stats-panel">
        <div className="stats-grid">
          <div className="stat-card">
            <Hash size={20} />
            <div className="stat-value">{enhancedStats.total}</div>
            <div className="stat-label">{t("history.stats.total")}</div>
          </div>
          <div className="stat-card highlight">
            <Calendar size={20} />
            <div className="stat-value">{enhancedStats.today}</div>
            <div className="stat-label">{t("history.stats.today")}</div>
          </div>
          <div className="stat-card">
            <TrendingUp size={20} />
            <div className="stat-value">{enhancedStats.thisWeek}</div>
            <div className="stat-label">{t("history.stats.thisWeek")}</div>
          </div>
          <div className="stat-card">
            <Type size={20} />
            <div className="stat-value">{enhancedStats.totalChars.toLocaleString()}</div>
            <div className="stat-label">{t("history.stats.totalChars")}</div>
          </div>
          <div className="stat-card">
            <Activity size={20} />
            <div className="stat-value">{enhancedStats.avgLength}</div>
            <div className="stat-label">{t("history.stats.avgLength")}</div>
          </div>
          <div className="stat-card">
            <Clock size={20} />
            <div className="stat-value">{enhancedStats.streak}</div>
            <div className="stat-label">{t("history.stats.streak")}</div>
          </div>
        </div>
        {enhancedStats.languagePairs.length > 0 && (
          <div className="lang-stats">
            <div className="lang-stats-title"><Languages size={14} /> {t('history.stats.languagePairs')}</div>
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

  const renderTableGroup = useCallback((group) => (
    <div key={group.key} className="table-group">
      <div className="table-group-header" onClick={() => toggleGroup(group.key)}>
        {expandedGroups.has(group.key) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <span>{getGroupTitle(group.key)}</span>
        <span className="group-count">{group.count}</span>
      </div>
      {expandedGroups.has(group.key) && (
        <table className="history-table">
          <thead>
            <tr>
              {selectMode && <th className="col-check"></th>}
              <th className="col-time" onClick={() => handleSort('timestamp')} style={{cursor: 'pointer'}}>
                {t('history.table.time')} {sortConfig.key === 'timestamp' && <ArrowUpDown size={12} />}
              </th>
              <th className="col-lang" onClick={() => handleSort('language')} style={{cursor: 'pointer'}}>
                {t('history.table.language')} {sortConfig.key === 'language' && <ArrowUpDown size={12} />}
              </th>
              <th className="col-source" onClick={() => handleSort('sourceLength')} style={{cursor: 'pointer'}}>
                {t('history.table.source')} {sortConfig.key === 'sourceLength' && <ArrowUpDown size={12} />}
              </th>
              <th className="col-translated">{t("history.table.target")}</th>
              <th className="col-actions">{t("history.table.actions")}</th>
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
                  <button onClick={() => handleCopy(item.translatedText)} title={t('translation.copy', 'Copy')}><Copy size={12} /></button>
                  <button onClick={() => handleRestore(item.id)} title={t('history.restore', 'Restore')}><Edit3 size={12} /></button>
                  <button onClick={() => handleFavorite(item)} title={t('translation.favorite', 'Favorite')} className={favoriteIds.has(item.id) ? 'active' : ''}>
                    <Star size={12} fill={favoriteIds.has(item.id) ? 'currentColor' : 'none'} />
                  </button>
                  <button onClick={() => removeFromHistory(item.id)} title={t('history.delete', 'Delete')} className="danger"><Trash2 size={12} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  ), [expandedGroups, selectMode, sortConfig, selectedIds, debouncedSearch, favoriteIds,
      toggleGroup, handleSort, toggleSelect, handleCopy, handleRestore, handleFavorite, removeFromHistory]);

  const renderContent = () => {
    if (filteredHistory.length === 0) {
      return (
        <div className="empty-state">
          <Clock size={48} />
          <p>{debouncedSearch ? t('history.noMatch', 'No matching records') : t('history.empty', 'No translation history yet')}</p>
          <span>{t('history.emptyHint', 'Translations are automatically saved here')}</span>
        </div>
      );
    }

    if (viewMode === 'table') {
      return (
        <div className="history-table-wrapper">
          {groupedHistory.map(renderTableGroup)}
        </div>
      );
    }

    return (
      <div className="history-cards">
        {groupedHistory.map(group => (
          <div key={group.key} className="card-group">
            <div className="card-group-header" onClick={() => toggleGroup(group.key)}>
              {expandedGroups.has(group.key) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              <span>{getGroupTitle(group.key)}</span>
              <span className="group-count">{group.count}</span>
            </div>
            {expandedGroups.has(group.key) && (
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
    <div className="history-panel" ref={rootRef}>
      {isSecureMode && (
        <div className="secure-mode-banner">
          <div className="secure-banner-icon">🔒</div>
          <div className="secure-banner-content">
            <h4>{t('history.secureMode.title')}</h4>
            <p>{t('history.secureMode.desc')}</p>
          </div>
        </div>
      )}

      <div className="history-toolbar">
        <div className="toolbar-left">
          <div className="toolbar-search">
            <Search size={16} />
            <input
              ref={searchRef}
              type="text"
              placeholder={t('history.search')}
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
            <button className={viewMode === 'card' ? 'active' : ''} onClick={() => setViewMode('card')} title={t('history.view.card')}>
              <LayoutGrid size={16} /><span>{t('history.view.card')}</span>
            </button>
            <button className={viewMode === 'table' ? 'active' : ''} onClick={() => setViewMode('table')} title={t('history.view.table')}>
              <Table size={16} /><span>{t('history.view.table')}</span>
            </button>
          </div>

          <div className="toolbar-divider" />

          <button className={`toolbar-btn ${showStats ? 'active' : ''}`} onClick={toggleStats}>
            <BarChart3 size={16} /><span>{t('history.stats.title')}</span>
          </button>

          <button className={`toolbar-btn ${selectMode ? 'active' : ''}`} onClick={toggleSelectMode}>
            <CheckSquare size={16} /><span>{t('history.select')}</span>
          </button>
        </div>

        <div className="toolbar-center">
          <select className="toolbar-select" value={dateRange} onChange={(e) => setDateRange(e.target.value)}>
            <option value="all">{t('history.filter.all')}</option>
            <option value="today">{t('history.filter.today')}</option>
            <option value="week">{t('history.filter.week')}</option>
            <option value="month">{t('history.filter.month')}</option>
          </select>

          <select className="toolbar-select" value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
            <option value="date">{t('history.group.date')}</option>
            <option value="language">{t('history.group.language')}</option>
          </select>
        </div>

        <div className="toolbar-right">
          {selectMode && selectedIds.size > 0 && (
            <button className="toolbar-btn danger" onClick={deleteSelected}>
              <Trash size={16} /><span>{t('history.deleteSelected', {count: selectedIds.size})}</span>
            </button>
          )}

          <button className="toolbar-btn" onClick={handleExport} title={t('history.export')}><Download size={16} /></button>
          <label className="toolbar-btn" title={t('history.import')}>
            <Upload size={16} />
            <input type="file" accept=".json" onChange={handleImport} style={{ display: 'none' }} />
          </label>

          <div className="toolbar-divider" />

          <button className="toolbar-btn danger" onClick={handleClearHistory}>
            <Trash2 size={16} /><span>{t('history.clearAll')}</span>
          </button>
        </div>
      </div>

      {renderStats()}

      {debouncedSearch && (
        <div className="search-hint">
          {t('history.searchResult', {keyword: debouncedSearch, count: filteredHistory.length})}
          {filteredHistory.length > 0 && <span className="hint-tip">{t('history.searchHint')}</span>}
        </div>
      )}

      <div className="history-content" ref={contentRef}>
        {renderContent()}

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
                  {t('common.loading')}
                </>
              ) : (
                <>{t('history.loadMore', {count: filteredHistory.length - displayCount})}</>
              )}
            </button>
          </div>
        )}
      </div>

      {filteredHistory.length > 0 && (
        <div className="history-footer">
          <span>{t('history.showing', {current: Math.min(displayCount, filteredHistory.length), total: filteredHistory.length})}</span>
          {selectMode && <span className="select-hint">{t('history.selectedHint', {count: selectedIds.size})}</span>}
        </div>
      )}

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
                <div className="detail-label">{t('translation.source')}</div>
                <div className="detail-text source">{detailItem.sourceText}</div>
              </div>
              <div className="detail-section">
                <div className="detail-label">{t('translation.target')}</div>
                <div className="detail-text translated">{detailItem.translatedText}</div>
              </div>
            </div>

            <div className="detail-modal-footer">
              <button className="detail-btn" onClick={() => { handleCopy(detailItem.sourceText); }}>
                <Copy size={14} /> {t('history.copySource')}
              </button>
              <button className="detail-btn" onClick={() => { handleCopy(detailItem.translatedText); }}>
                <Copy size={14} /> {t('history.copyTarget')}
              </button>
              <button className="detail-btn primary" onClick={() => { handleRestore(detailItem.id); setDetailItem(null); }}>
                <Edit3 size={14} /> {t('history.restore')}
              </button>
              <button
                className={`detail-btn ${favoriteIds.has(detailItem.id) ? 'active' : ''}`}
                onClick={() => handleFavorite(detailItem)}
              >
                <Star size={14} fill={favoriteIds.has(detailItem.id) ? 'currentColor' : 'none'} />
                {favoriteIds.has(detailItem.id) ? t('history.unfavorite') : t('history.favorite')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default memo(HistoryPanel);
