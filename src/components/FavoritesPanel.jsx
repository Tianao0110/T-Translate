// src/components/FavoritesPanel.jsx
import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  Star, Search, Trash2, Copy, Edit3, Save, X,
  ChevronDown, ChevronRight, LayoutGrid, Table, GitBranch,
  BarChart3, Calendar, TrendingUp, Activity, Hash, Type,
  Languages, FileText, Download, Upload, CheckSquare, Square,
  Trash, ArrowUpDown, FolderOpen, Tag, Clock, RotateCcw, Bookmark
} from 'lucide-react';
import useTranslationStore from '../stores/translation-store';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter';
import 'dayjs/locale/zh-cn';
import '../styles/components/FavoritesPanel.css';

dayjs.extend(relativeTime);
dayjs.extend(isSameOrAfter);
dayjs.locale('zh-cn');

/**
 * 收藏卡片组件
 */
const FavoriteCard = ({ item, onCopy, onRestore, onDelete, onEdit, isSelected, onSelect, showCheckbox, categories }) => {
  const [showTranslated, setShowTranslated] = useState(true);
  const categoryName = categories.find(c => c.id === item.category)?.name;
  
  return (
    <div className={`favorite-card ${isSelected ? 'selected' : ''}`}>
      <div className="card-header">
        <span className="card-lang">{item.sourceLanguage || 'auto'} → {item.targetLanguage || 'zh'}</span>
        <div className="card-header-right">
          {categoryName && <span className="card-category">{categoryName}</span>}
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
          {showTranslated ? item.translatedText : item.sourceText}
        </div>
      </div>

      {item.note && (
        <div className="card-note">
          <Bookmark size={12} />
          <span>{item.note}</span>
        </div>
      )}
      
      <div className="card-actions">
        <button onClick={() => onCopy(item.translatedText)} title="复制译文">
          <Copy size={14} />
        </button>
        <button onClick={() => onRestore(item)} title="恢复编辑">
          <Edit3 size={14} />
        </button>
        <button onClick={() => onEdit(item)} title="编辑笔记/分类">
          <Tag size={14} />
        </button>
        <button onClick={() => onDelete(item.id)} className="danger" title="取消收藏">
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
};

/**
 * 收藏面板
 */
const FavoritesPanel = ({ showNotification }) => {
  const notify = showNotification || ((msg, type) => console.log(`[${type}] ${msg}`));

  // 状态
  const [viewMode, setViewMode] = useState('card');
  const [groupBy, setGroupBy] = useState('date');
  const [showStats, setShowStats] = useState(false);
  const [dateRange, setDateRange] = useState('all');
  const [localSearch, setLocalSearch] = useState('');
  const [expandedGroups, setExpandedGroups] = useState(new Set(['今天', '昨天']));
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [sortConfig, setSortConfig] = useState({ key: 'timestamp', direction: 'desc' });
  
  // 编辑弹窗
  const [editingItem, setEditingItem] = useState(null);
  const [editNote, setEditNote] = useState('');
  const [editCategory, setEditCategory] = useState('');

  // 分类 (本地状态，可以后续持久化到 store)
  const [categories] = useState([
    { id: 'work', name: '工作', color: '#3b82f6' },
    { id: 'study', name: '学习', color: '#10b981' },
    { id: 'life', name: '生活', color: '#f59e0b' },
    { id: 'other', name: '其他', color: '#6b7280' }
  ]);

  // Store
  const {
    favorites,
    removeFromFavorites,
    restoreFromHistory,
    updateFavoriteItem,
    addToHistory
  } = useTranslationStore();

  // 统计
  const stats = useMemo(() => {
    if (!Array.isArray(favorites) || favorites.length === 0) {
      return { total: 0, today: 0, thisWeek: 0, totalChars: 0, categoryCount: {} };
    }

    const now = dayjs();
    let today = 0, thisWeek = 0, totalChars = 0;
    const categoryCount = {};

    favorites.forEach(item => {
      const d = dayjs(item.timestamp);
      totalChars += (item.sourceText?.length || 0);
      if (d.isSameOrAfter(now.startOf('day'))) today++;
      if (d.isSameOrAfter(now.startOf('week'))) thisWeek++;
      const cat = item.category || 'uncategorized';
      categoryCount[cat] = (categoryCount[cat] || 0) + 1;
    });

    return { total: favorites.length, today, thisWeek, totalChars, categoryCount };
  }, [favorites]);

  // 过滤
  const filteredFavorites = useMemo(() => {
    if (!Array.isArray(favorites)) return [];
    let filtered = [...favorites];

    if (localSearch) {
      const q = localSearch.toLowerCase();
      filtered = filtered.filter(item =>
        (item.sourceText || '').toLowerCase().includes(q) ||
        (item.translatedText || '').toLowerCase().includes(q) ||
        (item.note || '').toLowerCase().includes(q)
      );
    }

    const now = dayjs();
    switch (dateRange) {
      case 'today': filtered = filtered.filter(item => dayjs(item.timestamp).isSameOrAfter(now.startOf('day'))); break;
      case 'week': filtered = filtered.filter(item => dayjs(item.timestamp).isSameOrAfter(now.startOf('week'))); break;
      case 'month': filtered = filtered.filter(item => dayjs(item.timestamp).isSameOrAfter(now.startOf('month'))); break;
    }

    filtered.sort((a, b) => {
      const aVal = sortConfig.key === 'timestamp' ? (a.timestamp || 0) : (a.sourceText?.length || 0);
      const bVal = sortConfig.key === 'timestamp' ? (b.timestamp || 0) : (b.sourceText?.length || 0);
      return sortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
    });

    return filtered;
  }, [favorites, localSearch, dateRange, sortConfig]);

  // 分组
  const groupedFavorites = useMemo(() => {
    const groups = {};
    const now = dayjs();

    filteredFavorites.forEach(item => {
      let key;
      if (groupBy === 'date') {
        const d = dayjs(item.timestamp);
        if (d.isSame(now, 'day')) key = '今天';
        else if (d.isSame(now.subtract(1, 'day'), 'day')) key = '昨天';
        else if (d.isSame(now, 'week')) key = '本周';
        else if (d.isSame(now, 'month')) key = '本月';
        else key = d.format('YYYY年MM月');
      } else if (groupBy === 'category') {
        const cat = categories.find(c => c.id === item.category);
        key = cat ? cat.name : '未分类';
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
  }, [filteredFavorites, groupBy, categories]);

  // 操作
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

  const deleteSelected = () => {
    if (selectedIds.size === 0) return;
    if (window.confirm(`确定取消收藏选中的 ${selectedIds.size} 条？`)) {
      selectedIds.forEach(id => removeFromFavorites(id));
      setSelectedIds(new Set());
      setSelectMode(false);
      notify(`已取消 ${selectedIds.size} 条收藏`, 'success');
    }
  };

  const handleCopy = useCallback((text) => {
    navigator.clipboard.writeText(text);
    notify('已复制译文', 'success');
  }, [notify]);

  const handleRestore = useCallback((item) => {
    // 恢复到翻译区
    if (restoreFromHistory) {
      restoreFromHistory(item.id);
    }
    notify('已恢复到编辑区', 'success');
  }, [restoreFromHistory, notify]);

  const handleEdit = (item) => {
    setEditingItem(item);
    setEditNote(item.note || '');
    setEditCategory(item.category || '');
  };

  const handleSaveEdit = () => {
    if (editingItem && updateFavoriteItem) {
      updateFavoriteItem(editingItem.id, { 
        note: editNote, 
        category: editCategory 
      });
      notify('已保存', 'success');
    }
    setEditingItem(null);
  };

  const handleExport = useCallback(() => {
    try {
      const data = { favorites, exportedAt: new Date().toISOString() };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `t-translate-favorites-${dayjs().format('YYYY-MM-DD')}.json`;
      a.click();
      notify('导出成功', 'success');
    } catch { notify('导出失败', 'error'); }
  }, [favorites, notify]);

  const highlightText = (text, search) => {
    if (!search || !text) return text;
    const parts = text.split(new RegExp(`(${search})`, 'gi'));
    return parts.map((part, i) =>
      part.toLowerCase() === search.toLowerCase() ?
        <mark key={i} className="search-highlight">{part}</mark> : part
    );
  };

  // 渲染统计
  const renderStats = () => {
    if (!showStats) return null;
    return (
      <div className="stats-panel">
        <div className="stats-header">
          <h3><BarChart3 size={18} /> 收藏统计</h3>
          <button className="stats-close-btn" onClick={() => setShowStats(false)}><X size={16} /></button>
        </div>
        <div className="stats-grid">
          <div className="stat-card primary">
            <div className="stat-icon"><Star size={20} /></div>
            <div className="stat-info"><span className="stat-value">{stats.total}</span><span className="stat-label">总收藏</span></div>
          </div>
          <div className="stat-card">
            <div className="stat-icon"><Calendar size={20} /></div>
            <div className="stat-info"><span className="stat-value">{stats.today}</span><span className="stat-label">今日</span></div>
          </div>
          <div className="stat-card">
            <div className="stat-icon"><TrendingUp size={20} /></div>
            <div className="stat-info"><span className="stat-value">{stats.thisWeek}</span><span className="stat-label">本周</span></div>
          </div>
          <div className="stat-card">
            <div className="stat-icon"><Type size={20} /></div>
            <div className="stat-info"><span className="stat-value">{stats.totalChars.toLocaleString()}</span><span className="stat-label">总字符</span></div>
          </div>
        </div>
        {categories.length > 0 && (
          <div className="stats-categories">
            <h4><FolderOpen size={16} /> 分类统计</h4>
            {categories.map(cat => (
              <div key={cat.id} className="category-bar">
                <span className="cat-name" style={{ color: cat.color }}>{cat.name}</span>
                <div className="cat-progress">
                  <div className="cat-fill" style={{ 
                    width: `${stats.total > 0 ? (stats.categoryCount[cat.id] || 0) / stats.total * 100 : 0}%`,
                    background: cat.color 
                  }} />
                </div>
                <span className="cat-count">{stats.categoryCount[cat.id] || 0}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  // 渲染时间轴项
  const renderTimelineItem = (item) => (
    <div key={item.id} className={`timeline-item ${selectedIds.has(item.id) ? 'selected' : ''}`}>
      <div className="timeline-content">
        <div className="timeline-header">
          <span className="timeline-time">{dayjs(item.timestamp).format('HH:mm')}</span>
          <span className="timeline-lang">{item.sourceLanguage || 'auto'} → {item.targetLanguage || 'zh'}</span>
          {item.category && (
            <span className="timeline-category" style={{ color: categories.find(c => c.id === item.category)?.color }}>
              {categories.find(c => c.id === item.category)?.name}
            </span>
          )}
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
        {item.note && (
          <div className="timeline-note">
            <Bookmark size={12} /> {item.note}
          </div>
        )}
        <div className="timeline-actions">
          <button onClick={() => handleCopy(item.translatedText)} title="复制译文"><Copy size={14} /></button>
          <button onClick={() => handleRestore(item)} title="恢复编辑"><Edit3 size={14} /></button>
          <button onClick={() => handleEdit(item)} title="编辑"><Tag size={14} /></button>
          <button onClick={() => removeFromFavorites(item.id)} className="danger" title="取消收藏"><Trash2 size={14} /></button>
        </div>
      </div>
    </div>
  );

  // 渲染表格
  const renderTableGroup = (group) => (
    <div key={group.title} className="table-group">
      <div className="table-group-header" onClick={() => toggleGroup(group.title)}>
        {expandedGroups.has(group.title) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <span>{group.title}</span>
        <span className="group-count">{group.count}</span>
      </div>
      {expandedGroups.has(group.title) && (
        <table className="favorites-table">
          <thead>
            <tr>
              {selectMode && <th className="col-check"><Square size={16} /></th>}
              <th className="col-time">时间</th>
              <th className="col-lang">语言</th>
              <th className="col-source">原文</th>
              <th className="col-translated">译文</th>
              <th className="col-note">笔记</th>
              <th className="col-actions">操作</th>
            </tr>
          </thead>
          <tbody>
            {group.items.map(item => (
              <tr key={item.id} className={selectedIds.has(item.id) ? 'selected' : ''}>
                {selectMode && (
                  <td className="col-check">
                    <button onClick={() => toggleSelect(item.id)}>
                      {selectedIds.has(item.id) ? <CheckSquare size={16} /> : <Square size={16} />}
                    </button>
                  </td>
                )}
                <td className="col-time">{dayjs(item.timestamp).format('HH:mm')}</td>
                <td className="col-lang">{item.sourceLanguage || 'auto'} → {item.targetLanguage || 'zh'}</td>
                <td className="col-source"><div className="cell-text">{highlightText(item.sourceText, localSearch)}</div></td>
                <td className="col-translated"><div className="cell-text">{highlightText(item.translatedText, localSearch)}</div></td>
                <td className="col-note"><div className="cell-text">{item.note || '-'}</div></td>
                <td className="col-actions">
                  <button onClick={() => handleCopy(item.translatedText)} title="复制译文"><Copy size={14} /></button>
                  <button onClick={() => handleEdit(item)} title="编辑"><Tag size={14} /></button>
                  <button onClick={() => removeFromFavorites(item.id)} className="danger" title="取消收藏"><Trash2 size={14} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );

  // 渲染内容
  const renderContent = () => {
    if (filteredFavorites.length === 0) {
      return (
        <div className="empty-state">
          <Star size={48} />
          <p>{localSearch ? '没有找到匹配的收藏' : '暂无收藏'}</p>
          <span>在历史记录中点击星标可添加收藏</span>
        </div>
      );
    }

    if (viewMode === 'table') {
      return <div className="favorites-table-wrapper">{groupedFavorites.map(renderTableGroup)}</div>;
    }

    if (viewMode === 'timeline') {
      return (
        <div className="favorites-timeline">
          {groupedFavorites.map(group => (
            <div key={group.title} className="timeline-group">
              <div className="timeline-group-header" onClick={() => toggleGroup(group.title)}>
                {expandedGroups.has(group.title) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                <span>{group.title}</span>
                <span className="group-count">{group.count}</span>
              </div>
              {expandedGroups.has(group.title) && (
                <div className="timeline-items">{group.items.map(renderTimelineItem)}</div>
              )}
            </div>
          ))}
        </div>
      );
    }

    // 卡片视图
    return (
      <div className="favorites-cards">
        {groupedFavorites.map(group => (
          <div key={group.title} className="card-group">
            <div className="card-group-header" onClick={() => toggleGroup(group.title)}>
              {expandedGroups.has(group.title) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              <span>{group.title}</span>
              <span className="group-count">{group.count}</span>
            </div>
            {expandedGroups.has(group.title) && (
              <div className="card-grid">
                {group.items.map(item => (
                  <FavoriteCard
                    key={item.id}
                    item={item}
                    onCopy={handleCopy}
                    onRestore={handleRestore}
                    onDelete={removeFromFavorites}
                    onEdit={handleEdit}
                    isSelected={selectedIds.has(item.id)}
                    onSelect={toggleSelect}
                    showCheckbox={selectMode}
                    categories={categories}
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
    <div className="favorites-panel">
      {/* 工具栏 */}
      <div className="favorites-toolbar">
        <div className="toolbar-left">
          <div className="toolbar-search">
            <Search size={16} />
            <input type="text" placeholder="搜索收藏..." value={localSearch} onChange={(e) => setLocalSearch(e.target.value)} />
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
            <option value="category">按分类</option>
            <option value="language">按语言</option>
          </select>
        </div>

        <div className="toolbar-right">
          {selectMode && selectedIds.size > 0 && (
            <button className="toolbar-btn danger" onClick={deleteSelected}>
              <Trash size={16} /><span>取消收藏 ({selectedIds.size})</span>
            </button>
          )}

          <button className="toolbar-btn" onClick={handleExport} title="导出"><Download size={16} /></button>

          <div className="toolbar-divider" />

          <button className="toolbar-btn danger" onClick={() => {
            if (favorites.length > 0 && window.confirm(`确定清空所有 ${favorites.length} 条收藏？`)) {
              favorites.forEach(f => removeFromFavorites(f.id));
              notify('已清空收藏', 'success');
            }
          }}>
            <Trash2 size={16} /><span>清空</span>
          </button>
        </div>
      </div>

      {renderStats()}

      {localSearch && (
        <div className="search-hint">
          搜索 "<strong>{localSearch}</strong>" 找到 <strong>{filteredFavorites.length}</strong> 条收藏
        </div>
      )}

      <div className="favorites-content">
        {renderContent()}
      </div>

      {filteredFavorites.length > 0 && (
        <div className="favorites-footer">
          <span>共 {filteredFavorites.length} 条收藏</span>
          {selectMode && <span className="select-hint">已选 {selectedIds.size} 条</span>}
        </div>
      )}

      {/* 编辑弹窗 */}
      {editingItem && (
        <div className="edit-modal-overlay" onClick={() => setEditingItem(null)}>
          <div className="edit-modal" onClick={(e) => e.stopPropagation()}>
            <div className="edit-modal-header">
              <h3>编辑收藏</h3>
              <button onClick={() => setEditingItem(null)}><X size={18} /></button>
            </div>
            <div className="edit-modal-body">
              <div className="edit-field">
                <label>分类</label>
                <div className="category-chips">
                  {categories.map(cat => (
                    <button
                      key={cat.id}
                      className={`category-chip ${editCategory === cat.id ? 'active' : ''}`}
                      style={{ '--chip-color': cat.color }}
                      onClick={() => setEditCategory(cat.id)}
                    >
                      {cat.name}
                    </button>
                  ))}
                  <button
                    className={`category-chip ${!editCategory ? 'active' : ''}`}
                    onClick={() => setEditCategory('')}
                  >
                    无分类
                  </button>
                </div>
              </div>
              <div className="edit-field">
                <label>笔记</label>
                <textarea
                  value={editNote}
                  onChange={(e) => setEditNote(e.target.value)}
                  placeholder="添加笔记..."
                  rows={4}
                />
              </div>
            </div>
            <div className="edit-modal-footer">
              <button className="btn-cancel" onClick={() => setEditingItem(null)}>取消</button>
              <button className="btn-save" onClick={handleSaveEdit}>保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FavoritesPanel;
