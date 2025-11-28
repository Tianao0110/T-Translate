// src/components/FavoritesPanel.jsx
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Star,
  StarOff,
  Search,
  Filter,
  Tag,
  Calendar,
  Globe,
  Copy,
  Trash2,
  Edit3,
  Save,
  X,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  FolderPlus,
  Hash,
  MoreVertical,
  Download,
  Upload,
  SortAsc,
  SortDesc,
  Grid,
  List,
  Eye,
  EyeOff,
  Heart,
  BookOpen,
  Bookmark,
  RefreshCw
} from 'lucide-react';
import useTranslationStore from '../stores/translation-store';
import dayjs from 'dayjs';
import '../styles/components/FavoritesPanel.css';

/**
 * 收藏面板组件
 * 管理和展示用户收藏的翻译内容
 */
const FavoritesPanel = ({ searchQuery = '', onNotification }) => {
  // 状态
  const [viewMode, setViewMode] = useState('list'); // list | grid
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedTags, setSelectedTags] = useState([]);
  const [editingItem, setEditingItem] = useState(null);
  const [editingNote, setEditingNote] = useState('');
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [sortBy, setSortBy] = useState('date'); // date | title | language
  const [sortOrder, setSortOrder] = useState('desc');
  const [expandedItems, setExpandedItems] = useState(new Set());
  const [selectedItems, setSelectedItems] = useState(new Set());
  
  // Store
  const {
    favorites,
    removeFromFavorites,
    restoreFromHistory,
    copyToClipboard
  } = useTranslationStore();

  // 自定义分类（这里应该从存储中读取）
  const [categories, setCategories] = useState([
    { id: 'all', name: '全部', icon: Star, count: 0 },
    { id: 'work', name: '工作', icon: BookOpen, count: 0 },
    { id: 'study', name: '学习', icon: Edit3, count: 0 },
    { id: 'personal', name: '个人', icon: Heart, count: 0 }
  ]);

  // 获取所有标签
  const allTags = useMemo(() => {
    const tags = new Set();
    favorites.forEach(item => {
      if (item.tags && Array.isArray(item.tags)) {
        item.tags.forEach(tag => tags.add(tag));
      }
    });
    return Array.from(tags);
  }, [favorites]);

  // 过滤和排序收藏
  const filteredFavorites = useMemo(() => {
    let filtered = [...favorites];

    // 搜索过滤
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(item =>
        item.sourceText.toLowerCase().includes(query) ||
        item.translatedText.toLowerCase().includes(query) ||
        (item.note && item.note.toLowerCase().includes(query)) ||
        (item.tags && item.tags.some(tag => tag.toLowerCase().includes(query)))
      );
    }

    // 分类过滤
    if (selectedCategory && selectedCategory !== 'all') {
      filtered = filtered.filter(item => item.category === selectedCategory);
    }

    // 标签过滤
    if (selectedTags.length > 0) {
      filtered = filtered.filter(item =>
        item.tags && selectedTags.every(tag => item.tags.includes(tag))
      );
    }

    // 排序
    filtered.sort((a, b) => {
      let comparison = 0;
      
      switch (sortBy) {
        case 'date':
          comparison = (a.timestamp || 0) - (b.timestamp || 0);
          break;
        case 'title':
          comparison = (a.title || a.sourceText).localeCompare(b.title || b.sourceText);
          break;
        case 'language':
          comparison = `${a.sourceLanguage}-${a.targetLanguage}`.localeCompare(
            `${b.sourceLanguage}-${b.targetLanguage}`
          );
          break;
      }

      return sortOrder === 'asc' ? comparison : -comparison;
    });

    return filtered;
  }, [favorites, searchQuery, selectedCategory, selectedTags, sortBy, sortOrder]);

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

  // 处理添加分类
  const handleAddCategory = () => {
    if (!newCategoryName.trim()) return;
    
    const newCategory = {
      id: newCategoryName.toLowerCase().replace(/\s+/g, '-'),
      name: newCategoryName,
      icon: FolderOpen,
      count: 0
    };
    
    setCategories([...categories, newCategory]);
    setNewCategoryName('');
    setShowAddCategory(false);
    onNotification('分类已添加', 'success');
  };

  // 处理删除分类
  const handleDeleteCategory = (categoryId) => {
    if (categoryId === 'all') return;
    
    if (confirm('确定要删除这个分类吗？')) {
      setCategories(categories.filter(cat => cat.id !== categoryId));
      if (selectedCategory === categoryId) {
        setSelectedCategory('all');
      }
      onNotification('分类已删除', 'success');
    }
  };

  // 处理批量操作
  const handleBatchDelete = () => {
    if (selectedItems.size === 0) return;
    
    if (confirm(`确定要删除 ${selectedItems.size} 个收藏吗？`)) {
      selectedItems.forEach(id => removeFromFavorites(id));
      setSelectedItems(new Set());
      onNotification(`已删除 ${selectedItems.size} 个收藏`, 'success');
    }
  };

  // 处理编辑笔记
  const handleSaveNote = (itemId) => {
    // 这里应该调用更新笔记的方法
    setEditingItem(null);
    setEditingNote('');
    onNotification('笔记已保存', 'success');
  };

  // 处理导出收藏
  const handleExportFavorites = () => {
    const data = JSON.stringify(filteredFavorites, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `favorites-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    onNotification('收藏已导出', 'success');
  };

  // 渲染收藏卡片（网格视图）
  const renderGridItem = (item) => {
    const isExpanded = expandedItems.has(item.id);
    const isSelected = selectedItems.has(item.id);

    return (
      <div 
        key={item.id}
        className={`favorite-card ${isSelected ? 'selected' : ''}`}
      >
        <div className="card-header">
          <input
            type="checkbox"
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
            className="card-checkbox"
          />
          
          <div className="card-language">
            <span>{item.sourceLanguage}</span>
            <span>→</span>
            <span>{item.targetLanguage}</span>
          </div>
          
          <button
            className="card-action"
            onClick={() => removeFromFavorites(item.id)}
          >
            <StarOff size={16} />
          </button>
        </div>

        <div className="card-content">
          <div className="card-text source">
            {item.sourceText.substring(0, 100)}
            {item.sourceText.length > 100 && '...'}
          </div>
          <div className="card-text translated">
            {item.translatedText.substring(0, 100)}
            {item.translatedText.length > 100 && '...'}
          </div>
        </div>

        {item.tags && item.tags.length > 0 && (
          <div className="card-tags">
            {item.tags.map(tag => (
              <span key={tag} className="tag">
                <Hash size={10} />
                {tag}
              </span>
            ))}
          </div>
        )}

        {item.note && (
          <div className="card-note">
            <Bookmark size={12} />
            <span>{item.note}</span>
          </div>
        )}

        <div className="card-footer">
          <span className="card-date">
            {dayjs(item.timestamp).format('MM-DD HH:mm')}
          </span>
          <div className="card-actions">
            <button
              onClick={() => {
                navigator.clipboard.writeText(item.translatedText);
                onNotification('已复制', 'success');
              }}
              title="复制译文"
            >
              <Copy size={14} />
            </button>
            <button
              onClick={() => restoreFromHistory(item.id)}
              title="恢复到编辑器"
            >
              <RefreshCw size={14} />
            </button>
          </div>
        </div>
      </div>
    );
  };

  // 渲染收藏列表（列表视图）
  const renderListItem = (item) => {
    const isExpanded = expandedItems.has(item.id);
    const isSelected = selectedItems.has(item.id);
    const isEditingNote = editingItem === item.id;

    return (
      <div 
        key={item.id}
        className={`favorite-item ${isSelected ? 'selected' : ''} ${isExpanded ? 'expanded' : ''}`}
      >
        <div className="item-header">
          <input
            type="checkbox"
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
            className="item-checkbox"
          />

          <button
            className="expand-btn"
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

          <div className="item-meta">
            <div className="language-pair">
              <Globe size={14} />
              <span>{item.sourceLanguage} → {item.targetLanguage}</span>
            </div>
            <div className="item-date">
              <Calendar size={14} />
              <span>{dayjs(item.timestamp).format('YYYY-MM-DD HH:mm')}</span>
            </div>
          </div>

          <div className="item-preview">
            <div className="preview-source">
              {item.sourceText.substring(0, 50)}
              {item.sourceText.length > 50 && '...'}
            </div>
            <div className="preview-translated">
              {item.translatedText.substring(0, 50)}
              {item.translatedText.length > 50 && '...'}
            </div>
          </div>

          <div className="item-tags">
            {item.tags && item.tags.map(tag => (
              <span key={tag} className="tag">
                <Hash size={10} />
                {tag}
              </span>
            ))}
          </div>

          <div className="item-actions">
            <button
              onClick={() => {
                navigator.clipboard.writeText(item.translatedText);
                onNotification('已复制译文', 'success');
              }}
              title="复制译文"
            >
              <Copy size={16} />
            </button>
            <button
              onClick={() => restoreFromHistory(item.id)}
              title="恢复到编辑器"
            >
              <RefreshCw size={16} />
            </button>
            <button
              onClick={() => {
                setEditingItem(item.id);
                setEditingNote(item.note || '');
              }}
              title="编辑笔记"
            >
              <Edit3 size={16} />
            </button>
            <button
              onClick={() => {
                removeFromFavorites(item.id);
                onNotification('已移除收藏', 'info');
              }}
              title="取消收藏"
            >
              <StarOff size={16} />
            </button>
          </div>
        </div>

        {isExpanded && (
          <div className="item-content">
            <div className="content-section">
              <h4>原文</h4>
              <div className="content-text">{item.sourceText}</div>
            </div>
            <div className="content-section">
              <h4>译文</h4>
              <div className="content-text">{item.translatedText}</div>
            </div>
            
            {/* 笔记编辑区 */}
            <div className="content-section">
              <h4>笔记</h4>
              {isEditingNote ? (
                <div className="note-editor">
                  <textarea
                    className="note-input"
                    value={editingNote}
                    onChange={(e) => setEditingNote(e.target.value)}
                    placeholder="添加笔记..."
                    rows="3"
                  />
                  <div className="note-actions">
                    <button
                      className="save-btn"
                      onClick={() => handleSaveNote(item.id)}
                    >
                      <Save size={14} />
                      保存
                    </button>
                    <button
                      className="cancel-btn"
                      onClick={() => {
                        setEditingItem(null);
                        setEditingNote('');
                      }}
                    >
                      <X size={14} />
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <div className="note-display">
                  {item.note || '暂无笔记'}
                  <button
                    className="edit-note-btn"
                    onClick={() => {
                      setEditingItem(item.id);
                      setEditingNote(item.note || '');
                    }}
                  >
                    <Edit3 size={12} />
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="favorites-panel">
      {/* 侧边栏 - 分类 */}
      <div className="favorites-sidebar">
        <div className="sidebar-header">
          <h3>分类</h3>
          <button
            className="add-category-btn"
            onClick={() => setShowAddCategory(!showAddCategory)}
          >
            <FolderPlus size={16} />
          </button>
        </div>

        {showAddCategory && (
          <div className="add-category-form">
            <input
              type="text"
              placeholder="新分类名称"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleAddCategory()}
              className="category-input"
            />
            <button onClick={handleAddCategory}>
              <Save size={14} />
            </button>
            <button onClick={() => setShowAddCategory(false)}>
              <X size={14} />
            </button>
          </div>
        )}

        <div className="categories-list">
          {categories.map(category => (
            <div
              key={category.id}
              className={`category-item ${selectedCategory === category.id ? 'active' : ''}`}
              onClick={() => setSelectedCategory(category.id)}
            >
              <category.icon size={16} />
              <span className="category-name">{category.name}</span>
              <span className="category-count">{category.count}</span>
              {category.id !== 'all' && (
                <button
                  className="delete-category"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteCategory(category.id);
                  }}
                >
                  <X size={12} />
                </button>
              )}
            </div>
          ))}
        </div>

        {/* 标签云 */}
        <div className="sidebar-tags">
          <h3>标签</h3>
          <div className="tags-cloud">
            {allTags.map(tag => (
              <button
                key={tag}
                className={`tag-chip ${selectedTags.includes(tag) ? 'active' : ''}`}
                onClick={() => {
                  if (selectedTags.includes(tag)) {
                    setSelectedTags(selectedTags.filter(t => t !== tag));
                  } else {
                    setSelectedTags([...selectedTags, tag]);
                  }
                }}
              >
                <Hash size={10} />
                {tag}
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
              <button
                className={`view-btn ${viewMode === 'list' ? 'active' : ''}`}
                onClick={() => setViewMode('list')}
              >
                <List size={18} />
              </button>
              <button
                className={`view-btn ${viewMode === 'grid' ? 'active' : ''}`}
                onClick={() => setViewMode('grid')}
              >
                <Grid size={18} />
              </button>
            </div>

            <div className="sort-controls">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="sort-select"
              >
                <option value="date">按时间</option>
                <option value="title">按标题</option>
                <option value="language">按语言</option>
              </select>
              <button
                className="sort-order"
                onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
              >
                {sortOrder === 'asc' ? <SortAsc size={18} /> : <SortDesc size={18} />}
              </button>
            </div>
          </div>

          <div className="toolbar-right">
            {selectedItems.size > 0 && (
              <>
                <span className="selected-count">
                  已选择 {selectedItems.size} 项
                </span>
                <button
                  className="batch-delete"
                  onClick={handleBatchDelete}
                >
                  <Trash2 size={16} />
                  删除
                </button>
              </>
            )}
            
            <button
              className="export-btn"
              onClick={handleExportFavorites}
            >
              <Download size={16} />
              导出
            </button>
          </div>
        </div>

        {/* 内容区 */}
        <div className={`favorites-content ${viewMode}`}>
          {filteredFavorites.length === 0 ? (
            <div className="empty-state">
              <Star size={48} />
              <h3>暂无收藏</h3>
              <p>
                {searchQuery 
                  ? '没有找到匹配的收藏' 
                  : '收藏的翻译将显示在这里'}
              </p>
            </div>
          ) : viewMode === 'grid' ? (
            <div className="favorites-grid">
              {filteredFavorites.map(item => renderGridItem(item))}
            </div>
          ) : (
            <div className="favorites-list">
              {filteredFavorites.map(item => renderListItem(item))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default FavoritesPanel;