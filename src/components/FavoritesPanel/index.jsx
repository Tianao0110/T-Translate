// src/components/FavoritesPanel.jsx
// Muse Memory - 灵感记忆收藏面板
import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  Star, Search, Trash2, Copy, Edit3, Save, X, Plus,
  Folder, FolderPlus, ChevronDown, ChevronRight,
  Tag, Hash, MoreVertical, GripVertical,
  Check, Palette, RotateCcw, Bookmark, Sparkles, RefreshCw, BookOpen,
  Download, Upload
} from 'lucide-react';
import useTranslationStore from '../../stores/translation-store';
import translationService from '../../services/translation.js';
import { 
  exportToJSON, exportToCSV, exportToTBX, 
  autoImport, downloadFile 
} from '../../utils/glossary-io.js';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';
import './styles.css';

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
  { id: 'glossary', name: '术语库', color: '#06b6d4', order: 3, isSystem: true, icon: 'book' },
  { id: 'style_library', name: '风格库', color: '#8b5cf6', order: 4, isSystem: true, icon: 'palette' },
];

/**
 * 术语库行组件 - 支持内联编辑
 */
const GlossaryRow = ({ item, onCopy, onDelete, onUpdateNote, onUpdateTags, notify }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editNote, setEditNote] = useState(item.note || '');
  const [editTags, setEditTags] = useState(item.tags?.join(', ') || '');

  const handleSave = () => {
    const newTags = editTags
      .split(/[,，]/)
      .map(t => t.trim())
      .filter(t => t.length > 0);
    onUpdateTags(item.id, newTags);
    onUpdateNote(item.id, editNote);
    setIsEditing(false);
    notify?.('术语已更新', 'success');
  };

  const handleCancel = () => {
    setEditNote(item.note || '');
    setEditTags(item.tags?.join(', ') || '');
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <tr className="glossary-editing">
        <td className="glossary-source">{item.sourceText}</td>
        <td className="glossary-target">{item.translatedText}</td>
        <td className="glossary-note-edit">
          <input
            type="text"
            value={editNote}
            onChange={(e) => setEditNote(e.target.value)}
            placeholder="添加备注..."
            autoFocus
          />
        </td>
        <td className="glossary-actions">
          <button onClick={handleSave} className="save" title="保存">
            <Check size={16} />
          </button>
          <button onClick={handleCancel} title="取消">
            <X size={16} />
          </button>
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td className="glossary-source">{item.sourceText}</td>
      <td className="glossary-target">{item.translatedText}</td>
      <td className="glossary-note">{item.note || '-'}</td>
      <td className="glossary-actions">
        <button onClick={() => onCopy(item.translatedText)} title="复制">
          <Copy size={16} />
        </button>
        <button onClick={() => setIsEditing(true)} title="编辑">
          <Edit3 size={16} />
        </button>
        <button onClick={() => onDelete(item.id)} className="danger" title="删除">
          <Trash2 size={16} />
        </button>
      </td>
    </tr>
  );
};

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
  onSelect,
  notify
}) => {
  const [showTranslated, setShowTranslated] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editNote, setEditNote] = useState(item.note || '');
  const [editTags, setEditTags] = useState(item.tags?.join(', ') || '');
  const [editStyleRef, setEditStyleRef] = useState(item.isStyleReference || false);
  const [showMoveMenu, setShowMoveMenu] = useState(false);
  const [isGeneratingTags, setIsGeneratingTags] = useState(false);

  const folder = folders.find(f => f.id === item.folderId);

  // AI 生成标签
  const generateAITags = async () => {
    setIsGeneratingTags(true);
    
    try {
      const systemPrompt = `你是一个智能标签和摘要生成助手。根据用户提供的原文和译文，生成合适的标签和摘要。

请严格按照以下 JSON 格式返回，不要包含任何其他内容：
{
  "tags": ["标签1", "标签2", "标签3"],
  "summary": "简短摘要（20字以内）",
  "isStyleSuggested": true/false
}

标签规则：
- 生成 3-5 个相关标签
- 标签应该反映内容的主题、领域、风格等
- 使用中文标签

摘要规则：
- 20字以内的简短描述
- 概括内容的核心特点

风格参考判断规则（isStyleSuggested）：
- 如果文本具有独特的文学风格、修辞手法、或值得模仿的表达方式，返回 true
- 如果只是普通的术语、短语、或日常表达，返回 false
- 长度超过 30 字且有明显风格特点的文本更适合作为风格参考`;

      const userPrompt = `原文：${item.sourceText}
译文：${item.translatedText}

请分析并返回 JSON 格式的标签、摘要和风格建议。`;

      const result = await translationService.chatCompletion([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]);

      if (result.success && result.content) {
        let parsed;
        try {
          let content = result.content.trim();
          content = content.replace(/^```json\s*/, '').replace(/```\s*$/, '');
          content = content.replace(/^```\s*/, '').replace(/```\s*$/, '');
          parsed = JSON.parse(content);
        } catch (parseError) {
          console.error('JSON parse error:', parseError);
          parsed = {
            tags: ['未分类'],
            summary: '',
            isStyleSuggested: item.translatedText?.length > 30
          };
        }
        
        // 更新编辑状态
        setEditTags(parsed.tags?.join(', ') || '');
        if (parsed.summary) {
          setEditNote(parsed.summary);
        }
        setEditStyleRef(parsed.isStyleSuggested || false);
        
        notify?.('AI 标签生成成功', 'success');
      } else {
        throw new Error(result.error || '生成失败');
      }
    } catch (error) {
      console.error('AI tag generation error:', error);
      notify?.('AI 标签生成失败: ' + error.message, 'error');
    } finally {
      setIsGeneratingTags(false);
    }
  };

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
            <div className="edit-field-header">
              <label><Tag size={12} /> 标签（逗号分隔）</label>
              <button 
                className="btn-ai-generate"
                onClick={generateAITags}
                disabled={isGeneratingTags}
                title="AI 智能生成标签"
              >
                {isGeneratingTags ? (
                  <RefreshCw size={12} className="spinning" />
                ) : (
                  <Sparkles size={12} />
                )}
                <span>{isGeneratingTags ? '生成中...' : 'AI 生成'}</span>
              </button>
            </div>
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
                {/* 用户文件夹 */}
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
                {/* 系统文件夹分隔线 */}
                <div className="move-menu-divider" />
                {/* 系统文件夹（术语库、风格库）*/}
                {folders.filter(f => f.isSystem).map(f => (
                  <button
                    key={f.id}
                    className={item.folderId === f.id ? 'active' : ''}
                    onClick={() => { onMove(item.id, f.id, false); setShowMoveMenu(false); }}
                  >
                    {f.icon === 'book' ? <BookOpen size={14} style={{ color: f.color }} /> : 
                     f.icon === 'palette' ? <Palette size={14} style={{ color: f.color }} /> :
                     <Folder size={14} style={{ color: f.color }} />}
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
  const notify = showNotification || ((msg, type) => {});

  // 文件夹状态 - 确保系统文件夹始终存在
  const [folders, setFolders] = useState(() => {
    const saved = localStorage.getItem('t-translate-folders');
    if (saved) {
      const savedFolders = JSON.parse(saved);
      const savedIds = savedFolders.map(f => f.id);
      
      // 找出缺失的系统文件夹
      const missingSystemFolders = DEFAULT_FOLDERS.filter(
        f => f.isSystem && !savedIds.includes(f.id)
      );
      
      // 合并并按 order 排序
      const merged = [...savedFolders, ...missingSystemFolders];
      merged.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
      
      return merged;
    }
    return DEFAULT_FOLDERS;
  });
  const [selectedFolder, setSelectedFolder] = useState('all');
  const [editingFolder, setEditingFolder] = useState(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderColor, setNewFolderColor] = useState(FOLDER_COLORS[0]);
  const [showAddFolder, setShowAddFolder] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  
  // 术语库导入导出
  const [showExportMenu, setShowExportMenu] = useState(false);
  const glossaryInputRef = useRef(null);

  // 搜索和筛选
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState(null);

  // Store
  const {
    favorites,
    removeFromFavorites,
    updateFavoriteItem
  } = useTranslationStore();

  // 获取术语库数据
  const glossaryItems = useMemo(() => {
    return favorites?.filter(item => item.folderId === 'glossary') || [];
  }, [favorites]);

  // 导出术语库
  const handleExportGlossary = (format) => {
    if (glossaryItems.length === 0) {
      notify('术语库为空', 'warning');
      return;
    }
    
    const timestamp = dayjs().format('YYYYMMDD');
    let content, filename, mimeType;
    
    switch (format) {
      case 'json':
        content = exportToJSON(glossaryItems);
        filename = `glossary_${timestamp}.json`;
        mimeType = 'application/json';
        break;
      case 'csv':
        content = exportToCSV(glossaryItems);
        filename = `glossary_${timestamp}.csv`;
        mimeType = 'text/csv';
        break;
      case 'tbx':
        content = exportToTBX(glossaryItems);
        filename = `glossary_${timestamp}.tbx`;
        mimeType = 'application/xml';
        break;
      default:
        return;
    }
    
    downloadFile(content, filename, mimeType);
    notify(`已导出 ${glossaryItems.length} 条术语 (${format.toUpperCase()})`, 'success');
    setShowExportMenu(false);
  };

  // 导入术语库
  const handleImportGlossary = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    try {
      const content = await file.text();
      const terms = autoImport(content, file.name);
      
      if (terms.length === 0) {
        notify('未找到有效术语', 'warning');
        return;
      }
      
      // 添加到收藏
      const { addToFavorites } = useTranslationStore.getState();
      let added = 0;
      
      for (const term of terms) {
        // 检查是否已存在（避免重复）
        const exists = favorites?.some(
          f => f.sourceText === term.sourceText && f.translatedText === term.translatedText
        );
        
        if (!exists) {
          addToFavorites({
            sourceText: term.sourceText,
            translatedText: term.translatedText,
            note: term.note,
            tags: term.tags,
            folderId: 'glossary',
          });
          added++;
        }
      }
      
      notify(`已导入 ${added} 条术语${added < terms.length ? ` (跳过 ${terms.length - added} 条重复)` : ''}`, 'success');
    } catch (e) {
      notify(`导入失败: ${e.message}`, 'error');
    }
    
    // 清除文件选择
    event.target.value = '';
  };

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
    const systemFolderIds = folders.filter(f => f.isSystem).map(f => f.id);
    let allCount = 0;
    let uncategorizedCount = 0;
    const counts = {};
    
    favorites?.forEach(item => {
      if (!item.folderId) {
        uncategorizedCount++;
        allCount++; // 未分类算在"全部"里
      } else {
        counts[item.folderId] = (counts[item.folderId] || 0) + 1;
        // 系统文件夹的内容不计入"全部"
        if (!systemFolderIds.includes(item.folderId)) {
          allCount++;
        }
      }
    });
    
    return { all: allCount, uncategorized: uncategorizedCount, ...counts };
  }, [favorites, folders]);

  // 过滤收藏
  const filteredFavorites = useMemo(() => {
    if (!Array.isArray(favorites)) return [];
    
    let filtered = [...favorites];

    // 文件夹筛选
    if (selectedFolder === 'uncategorized') {
      filtered = filtered.filter(item => !item.folderId);
    } else if (selectedFolder === 'all') {
      // "全部收藏"排除系统文件夹（术语库、风格库）的内容
      const systemFolderIds = folders.filter(f => f.isSystem).map(f => f.id);
      filtered = filtered.filter(item => !systemFolderIds.includes(item.folderId));
    } else {
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
  }, [favorites, selectedFolder, selectedTag, searchQuery, folders]);

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
                    ) : folder.icon === 'book' ? (
                      <BookOpen size={16} className="folder-icon" style={{ color: folder.color }} />
                    ) : (
                      <Folder size={16} className="folder-icon" style={{ color: folder.color }} />
                    )}
                    <span className="folder-name">{folder.name}</span>
                    <span className="folder-count">{folderCounts[folder.id] || 0}</span>
                  </div>
                  {/* 术语库的导入导出按钮 */}
                  {folder.id === 'glossary' && (
                    <div className="folder-item-actions glossary-actions">
                      <input
                        ref={glossaryInputRef}
                        type="file"
                        accept=".json,.csv,.tbx,.xml"
                        style={{ display: 'none' }}
                        onChange={handleImportGlossary}
                      />
                      <button 
                        onClick={(e) => { e.stopPropagation(); glossaryInputRef.current?.click(); }}
                        title="导入术语"
                      >
                        <Upload size={12} />
                      </button>
                      <div className="export-menu-wrapper">
                        <button 
                          onClick={(e) => { e.stopPropagation(); setShowExportMenu(!showExportMenu); }}
                          title="导出术语"
                        >
                          <Download size={12} />
                        </button>
                        {showExportMenu && (
                          <div className="export-menu" onClick={(e) => e.stopPropagation()}>
                            <button onClick={() => handleExportGlossary('json')}>JSON</button>
                            <button onClick={() => handleExportGlossary('csv')}>CSV</button>
                            <button onClick={() => handleExportGlossary('tbx')}>TBX</button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
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
              {filteredFavorites.length} 条{selectedFolder === 'glossary' ? '术语' : '收藏'}
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
          ) : selectedFolder === 'glossary' ? (
            /* 术语库表格视图 */
            <div className="glossary-table-wrapper">
              <table className="glossary-table">
                <thead>
                  <tr>
                    <th style={{ width: '30%' }}>原文</th>
                    <th style={{ width: '30%' }}>译文</th>
                    <th style={{ width: '25%' }}>备注</th>
                    <th style={{ width: '15%' }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredFavorites.map(item => (
                    <GlossaryRow
                      key={item.id}
                      item={item}
                      onCopy={handleCopy}
                      onDelete={handleDelete}
                      onUpdateNote={handleUpdateNote}
                      onUpdateTags={handleUpdateTags}
                      notify={notify}
                    />
                  ))}
                </tbody>
              </table>
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
                  notify={notify}
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
