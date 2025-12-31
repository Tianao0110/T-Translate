// src/components/FavoritesPanel.jsx
// Muse Memory - 灵感记忆收藏面板
import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  Star, Search, Trash2, Copy, Edit3, Save, X, Plus,
  Folder, FolderPlus, ChevronDown, ChevronRight,
  Tag, Hash, MoreVertical, GripVertical,
  Check, Palette, RotateCcw, Bookmark
} from 'lucide-react';
import useTranslationStore from '../stores/translation-store';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';
import '../styles/components/FavoritesPanel.css';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

// 预设文件夹颜色
const FOLDER_COLORS = [
  '#3b82f6', // 蓝
  '#10b981', // 绿
  '#f59e0b', // 橙
  '#ef4444', // 红
  '#8b5cf6', // 紫
  '#ec4899', // 粉
  '#06b6d4', // 青
  '#6b7280', // 灰
];

// 搜索高亮组件
const HighlightText = ({ text, search }) => {
  if (!search || !text) return text;
  
  const parts = text.split(new RegExp(`(${search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
  
  return parts.map((part, i) =>
    part.toLowerCase() === search.toLowerCase() ? (
      <mark key={i} className="search-highlight">{part}</mark>
    ) : part
  );
};

// 默认文件夹
const DEFAULT_FOLDERS = [
  { id: 'work', name: '工作', color: '#3b82f6', order: 0 },
  { id: 'study', name: '学习', color: '#10b981', order: 1 },
  { id: 'life', name: '生活', color: '#f59e0b', order: 2 },
  { id: 'style_library', name: '风格库', color: '#8b5cf6', order: 3, isSystem: true, icon: 'palette' },
];

/**
 * 收藏卡片组件
 */
const FavoriteCard = ({ 
  item, 
  folders,
  searchQuery,
  onCopy, 
  onEdit, 
  onDelete,
  onMove,
  onUpdateTags,
  onUpdateNote,
  onUpdateStyleRef,
  isSelected,
  onSelect
}) => {
  const [showTranslated, setShowTranslated] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editNote, setEditNote] = useState(item.note || '');
  const [editTags, setEditTags] = useState(item.tags?.join(', ') || '');
  const [editStyleRef, setEditStyleRef] = useState(item.isStyleReference || false);
  const [showMoveMenu, setShowMoveMenu] = useState(false);

  const folder = folders.find(f => f.id === item.folderId);

  const handleSaveEdit = () => {
    const newTags = editTags
      .split(/[,，]/)
      .map(t => t.trim())
      .filter(t => t.length > 0);
    onUpdateTags(item.id, newTags);
    onUpdateNote(item.id, editNote);
    // 如果切换了风格参考状态
    if (editStyleRef !== item.isStyleReference) {
      onUpdateStyleRef(item.id, editStyleRef);
    }
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    setEditNote(item.note || '');
    setEditTags(item.tags?.join(', ') || '');
    setEditStyleRef(item.isStyleReference || false);
    setIsEditing(false);
  };

  return (
    <div className={`favorite-card ${isSelected ? 'selected' : ''}`}>
      {/* 卡片头部 */}
      <div className="card-header">
        <div className="card-header-left">
          <span className="card-lang">
            {item.sourceLanguage || 'auto'} → {item.targetLanguage || 'zh'}
          </span>
          {folder && (
            <span className="card-folder" style={{ color: folder.color }}>
              <Folder size={12} />
              {folder.name}
            </span>
          )}
        </div>
        <span className="card-time">{dayjs(item.timestamp).fromNow()}</span>
      </div>

      {/* 卡片内容 - 点击切换 */}
      <div 
        className="card-body" 
        onClick={() => !isEditing && setShowTranslated(!showTranslated)}
      >
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

      {/* 标签区域 */}
      {!isEditing && item.tags && item.tags.length > 0 && (
        <div className="card-tags">
          {item.tags.map((tag, idx) => (
            <span key={idx} className="tag-chip">
              <Tag size={10} />
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* 笔记区域 */}
      {!isEditing && item.note && (
        <div className="card-note">
          <Bookmark size={12} />
          <span><HighlightText text={item.note} search={searchQuery} /></span>
        </div>
      )}

      {/* 编辑模式 */}
      {isEditing && (
        <div className="card-edit-form">
          <div className="edit-field">
            <label><Tag size={12} /> 标签（逗号分隔）</label>
            <input
              type="text"
              value={editTags}
              onChange={(e) => setEditTags(e.target.value)}
              placeholder="正式, 学术, 重要..."
            />
          </div>
          <div className="edit-field">
            <label><Bookmark size={12} /> 笔记</label>
            <textarea
              value={editNote}
              onChange={(e) => setEditNote(e.target.value)}
              placeholder="添加笔记..."
              rows={3}
            />
          </div>
          <div className="edit-field style-ref-toggle">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={editStyleRef}
                onChange={(e) => setEditStyleRef(e.target.checked)}
              />
              <Palette size={14} />
              <span>标记为风格参考</span>
            </label>
            <span className="toggle-hint">
              {editStyleRef ? '将移动到风格库' : '普通收藏'}
            </span>
          </div>
          <div className="edit-actions">
            <button className="btn-cancel" onClick={handleCancelEdit}>
              <X size={14} /> 取消
            </button>
            <button className="btn-save" onClick={handleSaveEdit}>
              <Check size={14} /> 保存
            </button>
          </div>
        </div>
      )}

      {/* 操作按钮 */}
      {!isEditing && (
        <div className="card-actions">
          <button onClick={() => onCopy(item.translatedText)} title="复制译文">
            <Copy size={14} />
          </button>
          <button onClick={() => setIsEditing(true)} title="编辑标签和笔记">
            <Edit3 size={14} />
          </button>
          <div className="move-menu-wrapper">
            <button 
              onClick={() => setShowMoveMenu(!showMoveMenu)} 
              title="移动到文件夹"
              className={showMoveMenu ? 'active' : ''}
            >
              <Folder size={14} />
            </button>
            {showMoveMenu && (
              <div className="move-menu">
                <div className="move-menu-header">移动到</div>
                <button 
                  className={!item.folderId ? 'active' : ''}
                  onClick={() => { onMove(item.id, null, false); setShowMoveMenu(false); }}
                >
                  <Folder size={14} /> 未分类
                </button>
                {folders.filter(f => !f.isSystem).map(f => (
                  <button
                    key={f.id}
                    className={item.folderId === f.id ? 'active' : ''}
                    onClick={() => { onMove(item.id, f.id, false); setShowMoveMenu(false); }}
                  >
                    <Folder size={14} style={{ color: f.color }} />
                    {f.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button onClick={() => onDelete(item.id)} className="danger" title="删除">
            <Trash2 size={14} />
          </button>
        </div>
      )}
    </div>
  );
};

/**
 * 主面板组件
 */
const FavoritesPanel = ({ showNotification }) => {
  const notify = showNotification || ((msg, type) => console.log(`[${type}] ${msg}`));

  // 文件夹状态
  const [folders, setFolders] = useState(() => {
    const saved = localStorage.getItem('t-translate-folders');
    return saved ? JSON.parse(saved) : DEFAULT_FOLDERS;
  });
  const [selectedFolder, setSelectedFolder] = useState('all');
  const [editingFolder, setEditingFolder] = useState(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderColor, setNewFolderColor] = useState(FOLDER_COLORS[0]);
  const [showAddFolder, setShowAddFolder] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);

  // 搜索和筛选
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState(null);

  // Store
  const {
    favorites,
    removeFromFavorites,
    updateFavoriteItem
  } = useTranslationStore();

  // 保存文件夹到 localStorage
  useEffect(() => {
    localStorage.setItem('t-translate-folders', JSON.stringify(folders));
  }, [folders]);

  // 提取所有标签
  const allTags = useMemo(() => {
    const tags = new Set();
    favorites?.forEach(item => {
      item.tags?.forEach(tag => tags.add(tag));
    });
    return Array.from(tags).sort();
  }, [favorites]);

  // 计算每个文件夹的数量
  const folderCounts = useMemo(() => {
    const counts = { all: favorites?.length || 0, uncategorized: 0 };
    favorites?.forEach(item => {
      if (!item.folderId) {
        counts.uncategorized++;
      } else {
        counts[item.folderId] = (counts[item.folderId] || 0) + 1;
      }
    });
    return counts;
  }, [favorites]);

  // 过滤收藏
  const filteredFavorites = useMemo(() => {
    if (!Array.isArray(favorites)) return [];
    
    let filtered = [...favorites];

    // 文件夹筛选
    if (selectedFolder === 'uncategorized') {
      filtered = filtered.filter(item => !item.folderId);
    } else if (selectedFolder !== 'all') {
      filtered = filtered.filter(item => item.folderId === selectedFolder);
    }

    // 标签筛选
    if (selectedTag) {
      filtered = filtered.filter(item => item.tags?.includes(selectedTag));
    }

    // 搜索
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(item =>
        (item.sourceText || '').toLowerCase().includes(query) ||
        (item.translatedText || '').toLowerCase().includes(query) ||
        (item.note || '').toLowerCase().includes(query) ||
        (item.tags || []).some(tag => tag.toLowerCase().includes(query))
      );
    }

    // 按时间倒序
    filtered.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    return filtered;
  }, [favorites, selectedFolder, selectedTag, searchQuery]);

  // 文件夹操作
  const handleAddFolder = () => {
    if (!newFolderName.trim()) return;
    
    const id = `folder_${Date.now()}`;
    const newFolder = {
      id,
      name: newFolderName.trim(),
      color: newFolderColor,
      order: folders.length
    };
    
    setFolders([...folders, newFolder]);
    setNewFolderName('');
    setNewFolderColor(FOLDER_COLORS[0]);
    setShowAddFolder(false);
    notify('文件夹已创建', 'success');
  };

  const handleUpdateFolder = (id, updates) => {
    setFolders(folders.map(f => f.id === id ? { ...f, ...updates } : f));
    setEditingFolder(null);
  };

  const handleDeleteFolder = (id) => {
    if (!window.confirm('删除文件夹后，其中的收藏将移至"未分类"')) return;
    
    // 移动该文件夹下的收藏到未分类
    favorites?.forEach(item => {
      if (item.folderId === id) {
        updateFavoriteItem(item.id, { folderId: null });
      }
    });
    
    setFolders(folders.filter(f => f.id !== id));
    if (selectedFolder === id) setSelectedFolder('all');
    notify('文件夹已删除', 'success');
  };

  // 收藏操作
  const handleCopy = useCallback((text) => {
    navigator.clipboard.writeText(text);
    notify('已复制译文', 'success');
  }, [notify]);

  const handleMove = useCallback((itemId, folderId) => {
    updateFavoriteItem(itemId, { folderId });
    notify('已移动', 'success');
  }, [updateFavoriteItem, notify]);

  const handleUpdateTags = useCallback((itemId, tags) => {
    updateFavoriteItem(itemId, { tags });
  }, [updateFavoriteItem]);

  const handleUpdateNote = useCallback((itemId, note) => {
    updateFavoriteItem(itemId, { note });
  }, [updateFavoriteItem]);

  const handleUpdateStyleRef = useCallback((itemId, isStyleReference) => {
    // 更新风格参考状态，同时更新文件夹
    updateFavoriteItem(itemId, { 
      isStyleReference,
      folderId: isStyleReference ? 'style_library' : null
    });
    notify(isStyleReference ? '已移动到风格库' : '已移出风格库', 'success');
  }, [updateFavoriteItem, notify]);

  const handleDelete = useCallback((itemId) => {
    if (window.confirm('确定要删除这条收藏吗？')) {
      removeFromFavorites(itemId);
      notify('已删除', 'success');
    }
  }, [removeFromFavorites, notify]);

  return (
    <div className="favorites-panel">
      {/* 左侧边栏 - 文件夹 */}
      <div className="favorites-sidebar">
        <div className="sidebar-header">
          <h3>收藏夹</h3>
          <button 
            className="add-folder-btn"
            onClick={() => setShowAddFolder(!showAddFolder)}
            title="新建文件夹"
          >
            <FolderPlus size={18} />
          </button>
        </div>

        {/* 新建文件夹表单 */}
        {showAddFolder && (
          <div className="add-folder-form">
            <input
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="文件夹名称"
              onKeyDown={(e) => e.key === 'Enter' && handleAddFolder()}
              autoFocus
            />
            <div className="folder-color-row">
              <button 
                className="color-preview"
                style={{ background: newFolderColor }}
                onClick={() => setShowColorPicker(!showColorPicker)}
              >
                <Palette size={12} />
              </button>
              {showColorPicker && (
                <div className="color-picker">
                  {FOLDER_COLORS.map(color => (
                    <button
                      key={color}
                      className={`color-option ${newFolderColor === color ? 'active' : ''}`}
                      style={{ background: color }}
                      onClick={() => { setNewFolderColor(color); setShowColorPicker(false); }}
                    />
                  ))}
                </div>
              )}
              <button className="btn-create" onClick={handleAddFolder}>
                <Plus size={14} /> 创建
              </button>
            </div>
          </div>
        )}

        {/* 文件夹列表 */}
        <div className="folder-list">
          {/* 全部 */}
          <div
            className={`folder-item ${selectedFolder === 'all' ? 'active' : ''}`}
            onClick={() => { setSelectedFolder('all'); setSelectedTag(null); }}
          >
            <Star size={16} className="folder-icon" />
            <span className="folder-name">全部收藏</span>
            <span className="folder-count">{folderCounts.all}</span>
          </div>

          {/* 未分类 */}
          <div
            className={`folder-item ${selectedFolder === 'uncategorized' ? 'active' : ''}`}
            onClick={() => { setSelectedFolder('uncategorized'); setSelectedTag(null); }}
          >
            <Folder size={16} className="folder-icon" style={{ color: '#6b7280' }} />
            <span className="folder-name">未分类</span>
            <span className="folder-count">{folderCounts.uncategorized}</span>
          </div>

          <div className="folder-divider" />

          {/* 用户文件夹 */}
          {folders.map(folder => (
            <div
              key={folder.id}
              className={`folder-item ${selectedFolder === folder.id ? 'active' : ''} ${folder.isSystem ? 'system-folder' : ''}`}
            >
              {editingFolder === folder.id ? (
                <div className="folder-edit-form">
                  <input
                    type="text"
                    defaultValue={folder.name}
                    id={`folder-edit-${folder.id}`}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleUpdateFolder(folder.id, { name: e.target.value });
                      } else if (e.key === 'Escape') {
                        setEditingFolder(null);
                      }
                    }}
                    autoFocus
                  />
                  <div className="folder-edit-actions">
                    <button 
                      className="btn-confirm"
                      onClick={() => {
                        const input = document.getElementById(`folder-edit-${folder.id}`);
                        handleUpdateFolder(folder.id, { name: input.value });
                      }}
                      title="确认"
                    >
                      <Check size={14} />
                    </button>
                    <button 
                      className="btn-cancel-small"
                      onClick={() => setEditingFolder(null)}
                      title="取消"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div 
                    className="folder-item-main"
                    onClick={() => { setSelectedFolder(folder.id); setSelectedTag(null); }}
                  >
                    {folder.icon === 'palette' ? (
                      <Palette size={16} className="folder-icon" style={{ color: folder.color }} />
                    ) : (
                      <Folder size={16} className="folder-icon" style={{ color: folder.color }} />
                    )}
                    <span className="folder-name">{folder.name}</span>
                    <span className="folder-count">{folderCounts[folder.id] || 0}</span>
                  </div>
                  {!folder.isSystem && (
                    <div className="folder-item-actions">
                      <button onClick={(e) => { e.stopPropagation(); setEditingFolder(folder.id); }}>
                        <Edit3 size={12} />
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); handleDeleteFolder(folder.id); }}>
                        <Trash2 size={12} />
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
        </div>

        {/* 标签列表 */}
        {allTags.length > 0 && (
          <>
            <div className="sidebar-section-title">
              <Tag size={14} /> 标签
            </div>
            <div className="tag-list">
              {allTags.map(tag => (
                <button
                  key={tag}
                  className={`tag-item ${selectedTag === tag ? 'active' : ''}`}
                  onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
                >
                  <Hash size={12} />
                  {tag}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* 右侧主内容区 */}
      <div className="favorites-main">
        {/* 搜索栏 */}
        <div className="favorites-toolbar">
          <div className="toolbar-search">
            <Search size={16} />
            <input
              type="text"
              placeholder="搜索收藏..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')}>
                <X size={14} />
              </button>
            )}
          </div>

          <div className="toolbar-info">
            {selectedTag && (
              <span className="active-filter">
                <Tag size={12} /> {selectedTag}
                <button onClick={() => setSelectedTag(null)}><X size={12} /></button>
              </span>
            )}
            <span className="result-count">
              {filteredFavorites.length} 条收藏
            </span>
          </div>
        </div>

        {/* 收藏列表 */}
        <div className="favorites-content">
          {filteredFavorites.length === 0 ? (
            <div className="empty-state">
              <Star size={48} />
              <p>{searchQuery || selectedTag ? '没有找到匹配的收藏' : '暂无收藏'}</p>
              <span>在翻译结果中点击星标可添加收藏</span>
            </div>
          ) : (
            <div className="favorites-grid">
              {filteredFavorites.map(item => (
                <FavoriteCard
                  key={item.id}
                  item={item}
                  folders={folders}
                  searchQuery={searchQuery}
                  onCopy={handleCopy}
                  onDelete={handleDelete}
                  onMove={handleMove}
                  onUpdateTags={handleUpdateTags}
                  onUpdateNote={handleUpdateNote}
                  onUpdateStyleRef={handleUpdateStyleRef}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default FavoritesPanel;
