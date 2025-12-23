// src/components/FavoritesPanel.jsx
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Star, StarOff, Search, Filter, Tag, Calendar, Globe, Copy, Trash2, Edit3, Save, X,
  ChevronDown, ChevronRight, FolderOpen, FolderPlus, Hash, MoreVertical, Download, Upload,
  SortAsc, SortDesc, Grid, List, Eye, EyeOff, Heart, BookOpen, Bookmark, RefreshCw, FileText
} from 'lucide-react';
import useTranslationStore from '../stores/translation-store';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import '../styles/components/FavoritesPanel.css'; 

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

const FavoritesPanel = ({ searchQuery = '', filterOptions = {}, showNotification }) => {
  const notify = showNotification || ((msg, type) => console.log(`[${type}] ${msg}`));

  // UI State
  const [viewMode, setViewMode] = useState('list');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedTags, setSelectedTags] = useState([]);
  const [editingItem, setEditingItem] = useState(null);
  const [editingNote, setEditingNote] = useState('');
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [sortBy, setSortBy] = useState('date');
  const [sortOrder, setSortOrder] = useState('desc');
  const [expandedItems, setExpandedItems] = useState(new Set());
  const [selectedItems, setSelectedItems] = useState(new Set());
  const [isExporting, setIsExporting] = useState(false);
  const [dateRange, setDateRange] = useState('all');
  const [showStats, setShowStats] = useState(false);

  // Store Hooks
  const {
    favorites,
    history,
    removeFromFavorites,
    restoreFromHistory,
    addToFavorites,
    updateFavoriteItem, // 🟢 必须确保 Store 里加了这个方法
    copyToClipboard,
    exportHistory,
    importHistory,
    searchHistory,
    getStatistics,
  } = useTranslationStore();
  
  // 标签提取
  const allTags = useMemo(() => {
    const tags = new Set();
    favorites.forEach(item => {
      if (item.tags && Array.isArray(item.tags)) item.tags.forEach(tag => tags.add(tag));
    });
    return Array.from(tags);
  }, [favorites]);

  // 分类管理 (简单的本地状态模拟，如果想持久化分类，需要在 Store 里加 categories 状态)
  const [categories, setCategories] = useState([
    { id: 'all', name: '全部', icon: Star, count: 0 },
    { id: 'work', name: '工作', icon: BookOpen, count: 0 },
    { id: 'study', name: '学习', icon: Edit3, count: 0 },
    { id: 'personal', name: '个人', icon: Heart, count: 0 }
  ]);

  // 计算统计
  const statistics = useMemo(() => getStatistics(), [history, getStatistics]);

  // 过滤与排序
  const filteredFavorites = useMemo(() => {
    if (!Array.isArray(favorites)) return [];
    let filtered = [...favorites];

    // 搜索
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(item =>
        (item.sourceText || '').toLowerCase().includes(query) ||
        (item.translatedText || '').toLowerCase().includes(query) ||
        (item.note && item.note.toLowerCase().includes(query)) ||
        (item.tags && item.tags.some(tag => tag.toLowerCase().includes(query)))
      );
    }

    // 分类过滤
    if (selectedCategory !== 'all') {
      filtered = filtered.filter(item => item.category === selectedCategory);
    }

    // 标签过滤
    if (selectedTags.length > 0) {
      filtered = filtered.filter(item => 
        item.tags && selectedTags.every(t => item.tags.includes(t))
      );
    }

    // 排序
    filtered.sort((a, b) => {
      let comparison = 0;
      switch (sortBy) {
        case 'date': comparison = (a.timestamp || 0) - (b.timestamp || 0); break;
        case 'title': comparison = (a.sourceText || '').localeCompare(b.sourceText || ''); break;
        case 'language': comparison = `${a.sourceLanguage}`.localeCompare(`${b.sourceLanguage}`); break;
        default: break;
      }
      return sortOrder === 'asc' ? comparison : -comparison;
    });

    return filtered;
  }, [favorites, searchQuery, selectedCategory, selectedTags, sortBy, sortOrder]);

  // 更新分类计数
  useEffect(() => {
    const counts = {};
    favorites.forEach(item => {
      const cat = item.category || 'uncategorized';
      counts[cat] = (counts[cat] || 0) + 1;
    });
    setCategories(prev => prev.map(c => ({
      ...c,
      count: c.id === 'all' ? favorites.length : (counts[c.id] || 0)
    })));
  }, [favorites]);

  // Actions
  const handleAddCategory = () => {
    if (!newCategoryName.trim()) return;
    const id = newCategoryName.toLowerCase().replace(/\s+/g, '-');
    if (categories.some(c => c.id === id)) {
      notify('分类已存在', 'warning');
      return;
    }
    setCategories([...categories, { id, name: newCategoryName, icon: FolderOpen, count: 0 }]);
    setNewCategoryName('');
    setShowAddCategory(false);
    notify('分类已添加', 'success');
  };

  const handleBatchDelete = () => {
    if (!selectedItems.size) return;
    if (window.confirm(`确定删除 ${selectedItems.size} 个收藏？`)) {
      selectedItems.forEach(id => removeFromFavorites(id));
      setSelectedItems(new Set());
      notify('删除成功', 'success');
    }
  };

  // 🟢 修复：保存笔记逻辑
  const handleSaveNote = (itemId) => {
    if (!updateFavoriteItem) {
      console.error("Store missing updateFavoriteItem action");
      return;
    }
    updateFavoriteItem(itemId, { note: editingNote });
    setEditingItem(null);
    setEditingNote('');
    notify('笔记已更新', 'success');
  };

  // 新增：移动到分类 (示例：通过右键菜单或拖拽，这里简化为点击分类设置)
  const moveToCategory = (itemId, categoryId) => {
    if (updateFavoriteItem) {
      updateFavoriteItem(itemId, { category: categoryId });
      notify('分类已更新', 'success');
    }
  };

  // 渲染列表项
  const renderListItem = (item) => {
    const isSelected = selectedItems.has(item.id);
    const isExpanded = expandedItems.has(item.id);
    const isEditing = editingItem === item.id;

    return (
      <div key={item.id} className={`favorite-item ${isSelected ? 'selected' : ''} ${isExpanded ? 'expanded' : ''}`}>
        <div className="item-header">
          <input type="checkbox" checked={isSelected} onChange={(e) => {
              const newSet = new Set(selectedItems);
              e.target.checked ? newSet.add(item.id) : newSet.delete(item.id);
              setSelectedItems(newSet);
            }} className="item-checkbox" />
          
          <button className="expand-btn" onClick={() => {
              const newSet = new Set(expandedItems);
              isExpanded ? newSet.delete(item.id) : newSet.add(item.id);
              setExpandedItems(newSet);
            }}>
            {isExpanded ? <ChevronDown size={16}/> : <ChevronRight size={16}/>}
          </button>

          <div className="item-meta">
            <div className="language-pair"><span>{item.sourceLanguage}</span>→<span>{item.targetLanguage}</span></div>
            <div className="item-date">{dayjs(item.timestamp).format('MM-DD HH:mm')}</div>
            {/* 显示分类标签 */}
            {item.category && item.category !== 'all' && (
              <span className="category-tag">{categories.find(c=>c.id===item.category)?.name || item.category}</span>
            )}
          </div>

          <div className="item-preview">
            <div className="preview-source">{(item.sourceText||'').substring(0, 40)}</div>
            <div className="preview-translated">{(item.translatedText||'').substring(0, 40)}</div>
          </div>

          <div className="item-actions">
            <button onClick={() => { setEditingItem(item.id); setEditingNote(item.note || ''); setExpandedItems(prev => new Set(prev).add(item.id)); }} title="写笔记"><Edit3 size={16}/></button>
            <button onClick={() => removeFromFavorites(item.id)} title="删除"><Trash2 size={16}/></button>
          </div>
        </div>

        {isExpanded && (
          <div className="item-content">
            <div className="content-section"><h4>原文</h4><div className="content-text">{item.sourceText}</div></div>
            <div className="content-section"><h4>译文</h4><div className="content-text">{item.translatedText}</div></div>
            
            <div className="content-section">
              <h4>笔记</h4>
              {isEditing ? (
                <div className="note-editor">
                  <textarea className="note-input" value={editingNote} onChange={e=>setEditingNote(e.target.value)} rows={3} autoFocus />
                  <div className="note-actions">
                    <button className="save-btn" onClick={() => handleSaveNote(item.id)}><Save size={14}/> 保存</button>
                    <button className="cancel-btn" onClick={() => setEditingItem(null)}><X size={14}/> 取消</button>
                  </div>
                </div>
              ) : (
                <div className="note-display" onClick={() => { setEditingItem(item.id); setEditingNote(item.note || ''); }}>
                  {item.note || <span style={{color:'var(--text-tertiary)', fontStyle:'italic'}}>点击添加笔记...</span>}
                </div>
              )}
            </div>

            <div className="content-section">
              <h4>分类</h4>
              <div className="category-chips">
                {categories.filter(c=>c.id!=='all').map(cat => (
                  <button 
                    key={cat.id} 
                    className={`tag-chip ${item.category === cat.id ? 'active' : ''}`}
                    onClick={() => moveToCategory(item.id, cat.id)}
                  >
                    {cat.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  // 渲染网格项
  const renderGridItem = (item) => {
    const isSelected = selectedItems.has(item.id);
    return (
      <div key={item.id} className={`favorite-card ${isSelected ? 'selected' : ''}`}>
        <div className="card-header">
          <input type="checkbox" checked={isSelected} onChange={(e) => {
              const newSet = new Set(selectedItems);
              e.target.checked ? newSet.add(item.id) : newSet.delete(item.id);
              setSelectedItems(newSet);
            }} className="card-checkbox" />
          <div className="card-language">{item.sourceLanguage} → {item.targetLanguage}</div>
          <button onClick={() => removeFromFavorites(item.id)} className="card-action"><Trash2 size={14}/></button>
        </div>
        <div className="card-content">
          <div className="card-text source">{(item.sourceText||'').substring(0, 80)}</div>
          <div className="card-text translated">{(item.translatedText||'').substring(0, 80)}</div>
        </div>
        {item.note && <div className="card-note"><Bookmark size={12}/> {item.note}</div>}
        <div className="card-footer">
          <button onClick={() => { setEditingItem(item.id); setEditingNote(item.note || ''); setViewMode('list'); setExpandedItems(new Set([item.id])); }} title="编辑详情"><Edit3 size={14}/></button>
          <button onClick={() => navigator.clipboard.writeText(item.translatedText)} title="复制"><Copy size={14}/></button>
        </div>
      </div>
    );
  };

  return (
    <div className="favorites-panel">
      {/* 侧边栏 */}
      <div className="favorites-sidebar">
        <div className="sidebar-header">
          <h3>分类</h3>
          <button className="add-category-btn" onClick={() => setShowAddCategory(!showAddCategory)}><FolderPlus size={16}/></button>
        </div>
        {showAddCategory && (
          <div className="add-category-form">
            <input className="category-input" value={newCategoryName} onChange={e=>setNewCategoryName(e.target.value)} onKeyDown={e=>e.key==='Enter'&&handleAddCategory()} placeholder="新分类..." autoFocus />
            <button onClick={handleAddCategory}><Save size={14}/></button>
          </div>
        )}
        <div className="categories-list">
          {categories.map(cat => (
            <div key={cat.id} className={`category-item ${selectedCategory===cat.id?'active':''}`} onClick={()=>setSelectedCategory(cat.id)}>
              <cat.icon size={16}/>
              <span className="category-name">{cat.name}</span>
              <span className="category-count">{cat.count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 主区域 */}
      <div className="favorites-main">
        <div className="favorites-toolbar">
          <div className="toolbar-left">
            <div className="view-switcher">
              <button className={`view-btn ${viewMode==='list'?'active':''}`} onClick={()=>setViewMode('list')}><List size={18}/></button>
              <button className={`view-btn ${viewMode==='grid'?'active':''}`} onClick={()=>setViewMode('grid')}><Grid size={18}/></button>
            </div>
          </div>
          <div className="toolbar-right">
            {selectedItems.size > 0 && <button className="batch-delete" onClick={handleBatchDelete}><Trash2 size={14}/> 删除 ({selectedItems.size})</button>}
          </div>
        </div>

        <div className={`favorites-content ${viewMode}`}>
          {!filteredFavorites.length ? (
            <div className="empty-state"><Star size={48}/><p>暂无收藏</p></div>
          ) : viewMode === 'grid' ? (
            <div className="favorites-grid">{filteredFavorites.map(renderGridItem)}</div>
          ) : (
            <div className="favorites-list">{filteredFavorites.map(renderListItem)}</div>
          )}
        </div>
      </div>
    </div>
  );
};

export default FavoritesPanel;