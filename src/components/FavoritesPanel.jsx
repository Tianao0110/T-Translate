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

// dayjs 配置
dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

/**
 * 收藏面板组件 (已与 Store 集成并修复)
 */
const FavoritesPanel = ({ searchQuery = '', filterOptions = {}, showNotification }) => {
  // 兼容 props 名
  const notify = showNotification || ((msg, type) => console.log(`[${type}] ${msg}`));

  // ========== UI 状态 ==========
  const [viewMode, setViewMode] = useState('list'); // list | grid
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedTags, setSelectedTags] = useState([]);
  const [editingItem, setEditingItem] = useState(null); // 当前正在编辑笔记的 item ID
  const [editingNote, setEditingNote] = useState(''); // 编辑中的笔记内容
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [sortBy, setSortBy] = useState('date'); // date | title | language
  const [sortOrder, setSortOrder] = useState('desc'); // asc, desc
  const [expandedItems, setExpandedItems] = useState(new Set()); // 展开的项 ID
  const [selectedItems, setSelectedItems] = useState(new Set()); // 勾选的项 ID
  const [isExporting, setIsExporting] = useState(false); // 导出状态
  const [dateRange, setDateRange] = useState('all'); // 日期过滤
  const [showStats, setShowStats] = useState(false); // 是否显示统计

  // ========== Store Hooks ==========
  const {
    favorites, // 用户收藏列表
    history, // 历史记录 (用于关联 ID)
    removeFromFavorites, // 从收藏移除
    restoreFromHistory, // 从历史恢复到编辑器
    addToFavorites, // 添加到收藏
    copyToClipboard, // 复制到剪贴板
    exportHistory, // 导出历史 (返回数据)
    importHistory, // 导入历史 (处理文件)
    searchHistory, // 搜索历史 (用于主搜索)
    getStatistics, // 获取统计数据
  } = useTranslationStore();
  
  // ========== 基础数据 ==========
  const allTags = useMemo(() => {
    const tags = new Set();
    favorites.forEach(item => {
      if (item.tags && Array.isArray(item.tags)) {
        item.tags.forEach(tag => tags.add(tag));
      }
    });
    return Array.from(tags);
  }, [favorites]);

  // 分类数据 (模拟，实际应从 Store 读取)
  const [categories, setCategories] = useState([
    { id: 'all', name: '全部', icon: Star, count: 0 },
    { id: 'work', name: '工作', icon: BookOpen, count: 0 },
    { id: 'study', name: '学习', icon: Edit3, count: 0 },
    { id: 'personal', name: '个人', icon: Heart, count: 0 }
  ]);

  // ========== 状态更新与计算 ==========

  // 计算统计数据 (依赖 history，如果 favorites 包含更多统计信息，也应加入依赖)
  const statistics = useMemo(() => getStatistics(), [history, getStatistics]); // 假设 getStatistics 依赖 history

  // 过滤和排序收藏 (核心逻辑)
  const filteredFavorites = useMemo(() => {
    if (!Array.isArray(favorites)) return []; // 安全检查
    let filtered = [...favorites];

    // 搜索过滤
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(item =>
        (item.sourceText || '').toLowerCase().includes(query) ||
        (item.translatedText || '').toLowerCase().includes(query) ||
        (item.note && item.note.toLowerCase().includes(query)) ||
        (item.tags && item.tags.some(tag => tag.toLowerCase().includes(query)))
      );
    }

    // 日期范围过滤
    const now = Date.now();
    const today = new Date().setHours(0, 0, 0, 0);
    const week = now - 7 * 24 * 60 * 60 * 1000;
    const month = now - 30 * 24 * 60 * 60 * 1000;

    switch (dateRange) {
      case 'today': filtered = filtered.filter(item => item.timestamp >= today); break;
      case 'week': filtered = filtered.filter(item => item.timestamp >= week); break;
      case 'month': filtered = filtered.filter(item => item.timestamp >= month); break;
      default: break;
    }

    // 语言过滤
    if (filterOptions.language && filterOptions.language !== 'all') {
      filtered = filtered.filter(item =>
        item.sourceLanguage === filterOptions.language ||
        item.targetLanguage === filterOptions.language
      );
    }

    // 收藏过滤 (这应该是默认行为，如果 filterOptions.favorites 为 true 才做)
    // 这里的逻辑是：如果 filterOptions.favorites 为 true，则只显示收藏的
    // 但 FavoritesPanel 本身就是显示收藏，所以这个过滤可能需要调整
    // if (filterOptions.favorites) { ... }

    // 排序
    filtered.sort((a, b) => {
      let comparison = 0;
      switch (sortBy) {
        case 'date': comparison = (a.timestamp || 0) - (b.timestamp || 0); break;
        case 'title': comparison = (a.sourceText || '').localeCompare(b.sourceText || ''); break; // 用 sourceText 作为默认标题
        case 'language': comparison = `${a.sourceLanguage}-${a.targetLanguage}`.localeCompare(`${b.sourceLanguage}-${b.targetLanguage}`); break;
        default: break;
      }
      return sortOrder === 'asc' ? comparison : -comparison;
    });

    return filtered;
  }, [favorites, searchQuery, dateRange, filterOptions, sortBy, sortOrder]); // 移除了 favorites filterOptions.favorites 依赖

  // 更新分类计数
  useEffect(() => {
    const counts = {};
    favorites.forEach(item => {
      const category = item.category || 'uncategorized';
      counts[category] = (counts[category] || 0) + 1;
    });
    
    setCategories(prevCategories =>
      prevCategories.map(cat => ({
        ...cat,
        count: cat.id === 'all' ? favorites.length : (counts[cat.id] || 0)
      }))
    );
  }, [favorites]);

  // ========== Actions ==========

  // 添加分类
  const handleAddCategory = () => {
    if (!newCategoryName.trim()) return;
    const newCategory = {
      id: newCategoryName.toLowerCase().replace(/\s+/g, '-'),
      name: newCategoryName,
      icon: FolderOpen, // 默认图标
      count: 0
    };
    setCategories([...categories, newCategory]);
    setNewCategoryName('');
    setShowAddCategory(false);
    notify('分类已添加', 'success');
  };

  // 删除分类
  const handleDeleteCategory = (categoryId) => {
    if (categoryId === 'all') return;
    if (window.confirm(`确定删除分类 "${categories.find(c => c.id === categoryId)?.name}" 吗？`)) {
      setCategories(categories.filter(cat => cat.id !== categoryId));
      if (selectedCategory === categoryId) setSelectedCategory('all');
      // TODO: Store 里面也需要同步删除该分类下的收藏
      notify('分类已删除', 'success');
    }
  };

  // 批量删除收藏
  const handleBatchDelete = () => {
    if (selectedItems.size === 0) return;
    if (window.confirm(`确定要删除 ${selectedItems.size} 个收藏吗？`)) {
      selectedItems.forEach(id => removeFromFavorites(id)); // 调用 Store 方法
      setSelectedItems(new Set());
      notify(`已删除 ${selectedItems.size} 个收藏`, 'success');
    }
  };

  // 保存笔记
  const handleSaveNote = (itemId) => {
    // TODO: 需要一个 Action 在 Store 中更新特定 item 的 note
    setEditingItem(null);
    setEditingNote('');
    notify('笔记已保存', 'success');
  };

  // 导出收藏
  const handleExportFavorites = async () => {
    setIsExporting(true);
    try {
      // Store 的 exportHistory 返回原始数据
      const data = exportHistory('json'); // 假设只支持 JSON 导出
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `favorites_${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      notify('收藏已导出', 'success');
    } catch (error) {
      notify('导出失败: ' + error.message, 'error');
    } finally {
      setIsExporting(false);
    }
  };

  // 导入收藏
  const handleImportFavorites = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const result = await importHistory(file); // 使用 importHistory 方法
      if (result.success) {
        notify(`成功导入 ${result.count} 条记录`, 'success');
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      notify('导入失败: ' + error.message, 'error');
    }
    event.target.value = null; // 清空 input
  };

  // 渲染统计面板
  const renderStatistics = () => {
    if (!showStats) return null;
    return (
      <div className="statistics-panel">
        <div className="stats-grid">
          <div className="stat-card"><div className="stat-icon"><BarChart3 size={20} /></div><div className="stat-content"><div className="stat-value">{statistics.totalTranslations}</div><div className="stat-label">总翻译</div></div></div>
          <div className="stat-card"><div className="stat-icon"><TrendingUp size={20} /></div><div className="stat-content"><div className="stat-value">{statistics.todayTranslations}</div><div className="stat-label">今日</div></div></div>
          <div className="stat-card"><div className="stat-icon"><FileText size={20} /></div><div className="stat-content"><div className="stat-value">{Math.round((statistics.totalCharacters || 0) / 1000)}k</div><div className="stat-label">总字符</div></div></div>
          <div className="stat-card"><div className="stat-icon"><Globe size={20} /></div><div className="stat-content"><div className="stat-value">{statistics.mostUsedLanguagePair || 'N/A'}</div><div className="stat-label">常用对</div></div></div>
        </div>
        <button className="stats-close" onClick={() => setShowStats(false)}><X size={16} /></button>
      </div>
    );
  };

  // 渲染单个收藏项 (列表视图)
  const renderListItem = (item) => {
    const isSelected = selectedItems.has(item.id);
    const isExpanded = expandedItems.has(item.id);
    const isFavorited = favorites.some(f => f.id === item.id); // 检查是否已收藏 (虽然这里是收藏列表，但保留逻辑)

    return (
      <div key={item.id} className={`favorite-item ${isSelected ? 'selected' : ''} ${isExpanded ? 'expanded' : ''}`}>
        <div className="item-header">
          <input type="checkbox" className="item-checkbox" checked={isSelected} onChange={(e) => {
              const newSelected = new Set(selectedItems);
              if (e.target.checked) newSelected.add(item.id); else newSelected.delete(item.id);
              setSelectedItems(newSelected);
            }}
          />
          <button className="expand-btn" onClick={() => {
              const newExpanded = new Set(expandedItems);
              isExpanded ? newExpanded.delete(item.id) : newExpanded.add(item.id);
              setExpandedItems(newExpanded);
            }}
          >
            {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
          <div className="item-meta">
            <div className="language-pair"><span>{item.sourceLanguage}</span><span>→</span><span>{item.targetLanguage}</span></div>
            <div className="item-date"><Calendar size={14} /><span>{dayjs(item.timestamp).format('YYYY-MM-DD HH:mm')}</span></div>
          </div>
          <div className="item-preview">
            <div className="preview-source">{(item.sourceText || '').substring(0, 50)}{item.sourceText.length > 50 && '...'}</div>
            <div className="preview-translated">{(item.translatedText || '').substring(0, 50)}{item.translatedText.length > 50 && '...'}</div>
          </div>
          <div className="item-tags">
            {item.tags && item.tags.map(tag => <span key={tag} className="tag"><Hash size={10} />{tag}</span>)}
          </div>
          <div className="item-actions">
            <button onClick={() => { navigator.clipboard.writeText(item.translatedText); notify('已复制', 'success'); }} title="复制"><Copy size={16} /></button>
            <button onClick={() => { restoreFromHistory(item.id); notify('已恢复', 'success'); }} title="恢复"><RefreshCw size={16} /></button>
            <button onClick={() => { setEditingItem(item.id); setEditingNote(item.note || ''); }} title="编辑笔记"><Edit3 size={16} /></button>
            <button onClick={() => { removeFromFavorites(item.id); notify('已移除', 'info'); }} title="移除"><Trash2 size={16} /></button>
          </div>
        </div>
        {isExpanded && (
          <div className="item-content">
            <div className="content-section"><h4>原文</h4><div className="content-text">{item.sourceText}</div></div>
            <div className="content-section"><h4>译文</h4><div className="content-text">{item.translatedText}</div></div>
            <div className="content-section">
              <h4>笔记</h4>
              {editingItem === item.id ? (
                <div className="note-editor">
                  <textarea className="note-input" value={editingNote} onChange={(e) => setEditingNote(e.target.value)} placeholder="添加笔记..." rows="3"/>
                  <div className="note-actions">
                    <button className="save-btn" onClick={() => handleSaveNote(item.id)}><Save size={14} />保存</button>
                    <button className="cancel-btn" onClick={() => { setEditingItem(null); setEditingNote(''); }}><X size={14} />取消</button>
                  </div>
                </div>
              ) : (
                <div className="note-display">
                  {item.note || '暂无笔记'}
                  <button className="edit-note-btn" onClick={() => { setEditingItem(item.id); setEditingNote(item.note || ''); }}><Edit3 size={12} /></button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  // 渲染收藏卡片 (网格视图)
  const renderGridItem = (item) => {
    const isSelected = selectedItems.has(item.id);
    const isFavorited = favorites.some(f => f.id === item.id);
    return (
      <div key={item.id} className={`favorite-card ${isSelected ? 'selected' : ''}`}>
        <div className="card-header">
          <input type="checkbox" checked={isSelected} onChange={(e) => {
              const newSelected = new Set(selectedItems);
              if(e.target.checked) newSelected.add(item.id); else newSelected.delete(item.id);
              setSelectedItems(newSelected);
            }} className="card-checkbox"
          />
          <div className="card-language"><span>{item.sourceLanguage}</span><span>→</span><span>{item.targetLanguage}</span></div>
          <button className="card-action" onClick={() => { removeFromFavorites(item.id); notify('已移除', 'info'); }}><StarOff size={16} /></button>
        </div>
        <div className="card-content">
          <div className="card-text source">{(item.sourceText || '').substring(0, 100)}{item.sourceText.length > 100 && '...'}</div>
          <div className="card-text translated">{(item.translatedText || '').substring(0, 100)}{item.translatedText.length > 100 && '...'}</div>
        </div>
        {item.tags && item.tags.length > 0 && <div className="card-tags">{item.tags.map(tag => <span key={tag} className="tag"><Hash size={10} />{tag}</span>)}</div>}
        {item.note && <div className="card-note"><Bookmark size={12} /><span>{item.note}</span></div>}
        <div className="card-footer">
          <span className="card-date">{dayjs(item.timestamp).format('MM-DD HH:mm')}</span>
          <div className="card-actions">
            <button onClick={() => { navigator.clipboard.writeText(item.translatedText); notify('已复制', 'success'); }} title="复制"><Copy size={14} /></button>
            <button onClick={() => { restoreFromHistory(item.id); notify('已恢复', 'success'); }} title="恢复"><RefreshCw size={14} /></button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="favorites-panel">
      {/* 侧边栏 - 分类 */}
      <div className="favorites-sidebar">
        <div className="sidebar-header">
          <h3>分类</h3>
          <button className="add-category-btn" onClick={() => setShowAddCategory(!showAddCategory)}><FolderPlus size={16} /></button>
        </div>
        {showAddCategory && (
          <div className="add-category-form">
            <input type="text" placeholder="新分类名" value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} onKeyPress={(e) => e.key === 'Enter' && handleAddCategory()} className="category-input"/>
            <button onClick={handleAddCategory}><Save size={14} /></button>
            <button onClick={() => setShowAddCategory(false)}><X size={14} /></button>
          </div>
        )}
        <div className="categories-list">
          {categories.map(category => (
            <div key={category.id} className={`category-item ${selectedCategory === category.id ? 'active' : ''}`} onClick={() => setSelectedCategory(category.id)}>
              <category.icon size={16} />
              <span className="category-name">{category.name}</span>
              <span className="category-count">{category.count}</span>
              {category.id !== 'all' && <button className="delete-category" onClick={(e) => { e.stopPropagation(); handleDeleteCategory(category.id); }}><X size={12} /></button>}
            </div>
          ))}
        </div>
        {/* 标签云 */}
        <div className="sidebar-tags">
          <h3>标签</h3>
          <div className="tags-cloud">
            {allTags.map(tag => (
              <button key={tag} className={`tag-chip ${selectedTags.includes(tag) ? 'active' : ''}`} onClick={() => {
                  const newTags = [...selectedTags];
                  if (selectedTags.includes(tag)) newTags.splice(newTags.indexOf(tag), 1);
                  else newTags.push(tag);
                  setSelectedTags(newTags);
                }}
              >
                <Hash size={10} /> {tag}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 主内容区 */}
      <div className="favorites-main">
        {/* 工具栏 */}
        <div className="favorites-toolbar">
          <div className="toolbar-left">
            <div className="view-switcher">
              <button className={`view-btn ${viewMode === 'list' ? 'active' : ''}`} onClick={() => setViewMode('list')}><List size={18} /></button>
              <button className={`view-btn ${viewMode === 'grid' ? 'active' : ''}`} onClick={() => setViewMode('grid')}><Grid size={18} /></button>
            </div>
            <div className="sort-controls">
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="sort-select">
                <option value="date">时间</option><option value="title">标题</option><option value="language">语言</option>
              </select>
              <button className="sort-order" onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}>
                {sortOrder === 'asc' ? <SortAsc size={18} /> : <SortDesc size={18} />}
              </button>
            </div>
          </div>
          <div className="toolbar-right">
            {selectedItems.size > 0 && (
              <>
                <span className="selected-count">已选 {selectedItems.size}</span>
                <button className="batch-delete" onClick={handleBatchDelete}><Trash2 size={16} />删除</button>
                <div className="separator" />
              </>
            )}
            <button className="export-btn" onClick={handleExportFavorites} disabled={isExporting}>
              <Download size={16} /> 导出
            </button>
            <label className="import-btn">
              <Upload size={16} /> 导入
              <input type="file" accept=".json" onChange={handleImportFavorites} style={{ display: 'none' }} />
            </label>
          </div>
        </div>

        {/* 内容展示区 */}
        <div className={`favorites-content ${viewMode}`}>
          {!filteredFavorites.length ? (
            <div className="empty-state">
              <Star size={48} />
              <h3>暂无收藏</h3>
              <p>{searchQuery ? '未找到匹配项' : '收藏的内容将在此显示'}</p>
            </div>
          ) : viewMode === 'grid' ? (
            <div className="favorites-grid">
              {filteredFavorites.map(renderGridItem)}
            </div>
          ) : (
            <div className="favorites-list">
              {filteredFavorites.map(renderListItem)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default FavoritesPanel;