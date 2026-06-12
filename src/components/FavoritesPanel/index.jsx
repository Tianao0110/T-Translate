import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Star, Search, Trash2, Copy, Edit3, Save, X, Plus,
  Folder, FolderPlus, ChevronDown, ChevronRight,
  Tag, Hash, MoreVertical, GripVertical,
  Check, Palette, RotateCcw, Bookmark, Sparkles, RefreshCw, BookOpen,
  Download, Upload
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import useTranslationStore from '../../stores/translation-store';
import translationService from '../../services/translation.js';
import { getAnalysisPrompts, parseJsonReply } from '../../utils/ai-prompts.js';
import useVisibleHotkey from '../../hooks/use-visible-hotkey.js';
import {
  exportToJSON, exportToCSV, exportToTBX,
  autoImport, downloadFile
} from '../../utils/glossary-io.js';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';
import 'dayjs/locale/en';
import './styles.css';
import createLogger from '../../utils/logger.js';
const logger = createLogger('Favorites');

dayjs.extend(relativeTime);

const FOLDER_COLORS = [
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#ec4899',
  '#06b6d4',
  '#6b7280',
];

const HighlightText = ({ text, search }) => {
  if (!search || !text) return text;

  const parts = text.split(new RegExp(`(${search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));

  return parts.map((part, i) =>
    part.toLowerCase() === search.toLowerCase() ? (
      <mark key={i} className="search-highlight">{part}</mark>
    ) : part
  );
};

const DEFAULT_FOLDERS = [
  { id: 'work', name: '工作', color: '#3b82f6', order: 0 },
  { id: 'study', name: '学习', color: '#10b981', order: 1 },
  { id: 'life', name: '生活', color: '#f59e0b', order: 2 },
  { id: 'glossary', name: '术语库', color: '#06b6d4', order: 3, isSystem: true, icon: 'book' },
  { id: 'style_library', name: '风格库', color: '#8b5cf6', order: 4, isSystem: true, icon: 'palette' },
];

const GlossaryRow = ({ item, onCopy, onDelete, onUpdateNote, onUpdateTags, notify }) => {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [editNote, setEditNote] = useState(item.note || '');
  const [editTags, setEditTags] = useState(item.tags?.join(', ') || '');

  const handleSave = () => {
    const newTags = editTags
      .split(/[,，]/)
      .map(tag => tag.trim())
      .filter(tag => tag.length > 0);
    onUpdateTags(item.id, newTags);
    onUpdateNote(item.id, editNote);
    setIsEditing(false);
    notify?.(t('favorites.termUpdated'), 'success');
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
            placeholder={t('favorites.addNote')}
            autoFocus
          />
        </td>
        <td className="glossary-actions">
          <button onClick={handleSave} className="save" title={t('favorites.save')}>
            <Check size={16} />
          </button>
          <button onClick={handleCancel} title={t('favorites.cancel')}>
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
        <button onClick={() => onCopy(item.translatedText)} title={t('favorites.copy')}>
          <Copy size={16} />
        </button>
        <button onClick={() => setIsEditing(true)} title={t('favorites.edit')}>
          <Edit3 size={16} />
        </button>
        <button onClick={() => onDelete(item.id)} className="danger" title={t('favorites.delete')}>
          <Trash2 size={16} />
        </button>
      </td>
    </tr>
  );
};

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
  const { t } = useTranslation();
  const [showTranslated, setShowTranslated] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editNote, setEditNote] = useState(item.note || '');
  const [editTags, setEditTags] = useState(item.tags?.join(', ') || '');
  const [editStyleRef, setEditStyleRef] = useState(item.isStyleReference || false);
  const [showMoveMenu, setShowMoveMenu] = useState(false);
  const [isGeneratingTags, setIsGeneratingTags] = useState(false);

  const folder = folders.find(f => f.id === item.folderId);

  const getFolderDisplayName = (f) => {
    const folderNameKeys = {
      work: 'favorites.folders.work',
      study: 'favorites.folders.study',
      life: 'favorites.folders.life',
      glossary: 'favorites.folders.glossary',
      style_library: 'favorites.folders.styleLibrary',
    };
    if (folderNameKeys[f.id]) {
      return t(folderNameKeys[f.id]);
    }
    return f.name;
  };

  const generateAITags = async () => {
    setIsGeneratingTags(true);

    try {
      const { systemPrompt, userPrompt } = getAnalysisPrompts(item.sourceText, item.translatedText);

      const result = await translationService.chatCompletion(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        useTranslationStore.getState().getPrivacyOptions()
      );

      if (result.success && result.content) {
        let parsed;
        try {
          parsed = parseJsonReply(result.content);
        } catch (parseError) {
          logger.error('JSON parse error:', parseError);
          parsed = {
            tags: [t('favorites.uncategorized', 'Uncategorized')],
            summary: '',
            isStyleSuggested: item.translatedText?.length > 30
          };
        }

        setEditTags(parsed.tags?.join(', ') || '');
        if (parsed.summary) {
          setEditNote(parsed.summary);
        }
        setEditStyleRef(parsed.isStyleSuggested || false);

        notify?.(t('favorites.aiTagSuccess'), 'success');
      } else {
        throw new Error(result.error || t('favorites.aiTagFailed'));
      }
    } catch (error) {
      logger.error('AI tag generation error:', error);
      notify?.(t('favorites.aiTagFailed') + ': ' + error.message, 'error');
    } finally {
      setIsGeneratingTags(false);
    }
  };

  const handleSaveEdit = () => {
    const newTags = editTags
      .split(/[,，]/)
      .map(tag => tag.trim())
      .filter(tag => tag.length > 0);
    onUpdateTags(item.id, newTags);
    onUpdateNote(item.id, editNote);
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
      <div className="card-header">
        <div className="card-header-left">
          <span className="card-lang">
            {item.sourceLanguage || 'auto'} → {item.targetLanguage || 'zh'}
          </span>
          {folder && (
            <span className="card-folder" style={{ color: folder.color }}>
              <Folder size={12} />
              {getFolderDisplayName(folder)}
            </span>
          )}
        </div>
        <span className="card-time">{dayjs(item.timestamp).fromNow()}</span>
      </div>

      <div
        className="card-body"
        onClick={() => !isEditing && setShowTranslated(!showTranslated)}
      >
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

      {!isEditing && item.note && (
        <div className="card-note">
          <Bookmark size={12} />
          <span><HighlightText text={item.note} search={searchQuery} /></span>
        </div>
      )}

      {isEditing && (
        <div className="card-edit-form">
          <div className="edit-field">
            <div className="edit-field-header">
              <label><Tag size={12} /> {t('favorites.tagsLabel')}</label>
              <button
                className="btn-ai-generate"
                onClick={generateAITags}
                disabled={isGeneratingTags}
                title={t('favorites.aiGenerateTags')}
              >
                {isGeneratingTags ? (
                  <RefreshCw size={12} className="spinning" />
                ) : (
                  <Sparkles size={12} />
                )}
                <span>{isGeneratingTags ? t('favorites.generating') : t('favorites.aiGenerate')}</span>
              </button>
            </div>
            <input
              type="text"
              value={editTags}
              onChange={(e) => setEditTags(e.target.value)}
              placeholder={t('favorites.tagsPlaceholder')}
            />
          </div>
          <div className="edit-field">
            <label><Bookmark size={12} /> {t('favorites.noteLabel')}</label>
            <textarea
              value={editNote}
              onChange={(e) => setEditNote(e.target.value)}
              placeholder={t('favorites.notePlaceholder')}
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
              <span>{t('favorites.markAsStyle')}</span>
            </label>
            <span className="toggle-hint">
              {editStyleRef ? t('favorites.willMoveToStyle') : t('favorites.normalFavorite')}
            </span>
          </div>
          <div className="edit-actions">
            <button className="btn-cancel" onClick={handleCancelEdit}>
              <X size={14} /> {t('favorites.cancel')}
            </button>
            <button className="btn-save" onClick={handleSaveEdit}>
              <Check size={14} /> {t('favorites.save')}
            </button>
          </div>
        </div>
      )}

      {!isEditing && (
        <div className="card-actions">
          <button onClick={() => onCopy(item.translatedText)} title={t('favorites.copyTarget')}>
            <Copy size={14} />
          </button>
          <button onClick={() => setIsEditing(true)} title={t('favorites.editTagsNotes')}>
            <Edit3 size={14} />
          </button>
          <div className="move-menu-wrapper">
            <button
              onClick={() => setShowMoveMenu(!showMoveMenu)}
              title={t('favorites.moveToFolder')}
              className={showMoveMenu ? 'active' : ''}
            >
              <Folder size={14} />
            </button>
            {showMoveMenu && (
              <div className="move-menu">
                <div className="move-menu-header">{t('favorites.moveTo')}</div>
                <button
                  className={!item.folderId ? 'active' : ''}
                  onClick={() => { onMove(item.id, null, false); setShowMoveMenu(false); }}
                >
                  <Folder size={14} /> {t('favorites.uncategorized')}
                </button>
                {folders.filter(f => !f.isSystem).map(f => (
                  <button
                    key={f.id}
                    className={item.folderId === f.id ? 'active' : ''}
                    onClick={() => { onMove(item.id, f.id, false); setShowMoveMenu(false); }}
                  >
                    <Folder size={14} style={{ color: f.color }} />
                    {getFolderDisplayName(f)}
                  </button>
                ))}
                <div className="move-menu-divider" />
                {folders.filter(f => f.isSystem).map(f => (
                  <button
                    key={f.id}
                    className={item.folderId === f.id ? 'active' : ''}
                    onClick={() => { onMove(item.id, f.id, false); setShowMoveMenu(false); }}
                  >
                    {f.icon === 'book' ? <BookOpen size={14} style={{ color: f.color }} /> :
                     f.icon === 'palette' ? <Palette size={14} style={{ color: f.color }} /> :
                     <Folder size={14} style={{ color: f.color }} />}
                    {getFolderDisplayName(f)}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button onClick={() => onDelete(item.id)} className="danger" title={t('favorites.delete')}>
            <Trash2 size={14} />
          </button>
        </div>
      )}
    </div>
  );
};

const FavoritesPanel = ({ showNotification }) => {
  const { t, i18n } = useTranslation();
  const notify = showNotification || ((msg, type) => {});

  useEffect(() => {
    dayjs.locale(i18n.language === 'zh' ? 'zh-cn' : 'en');
  }, [i18n.language]);

  const getFolderName = useCallback((folder) => {
    const folderNameKeys = {
      work: 'favorites.folders.work',
      study: 'favorites.folders.study',
      life: 'favorites.folders.life',
      glossary: 'favorites.folders.glossary',
      style_library: 'favorites.folders.styleLibrary',
    };
    if (folderNameKeys[folder.id]) {
      return t(folderNameKeys[folder.id]);
    }
    return folder.name;
  }, [t]);

  const [folders, setFolders] = useState(() => {
    const saved = localStorage.getItem('t-translate-folders');
    if (saved) {
      const savedFolders = JSON.parse(saved);
      const savedIds = savedFolders.map(f => f.id);

      // Re-inject any system folders that aren't in localStorage so
      // upgrades from older versions still get glossary / style library.
      const missingSystemFolders = DEFAULT_FOLDERS.filter(
        f => f.isSystem && !savedIds.includes(f.id)
      );

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

  const [showExportMenu, setShowExportMenu] = useState(false);
  const glossaryInputRef = useRef(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState(null);

  const rootRef = useRef(null);
  const searchRef = useRef(null);

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

  // useShallow: favorites tab stays mounted behind other tabs — without a
  // selector every streaming flush would re-render it
  const {
    favorites,
    removeFromFavorites,
    updateFavoriteItem
  } = useTranslationStore(useShallow((s) => ({
    favorites: s.favorites,
    removeFromFavorites: s.removeFromFavorites,
    updateFavoriteItem: s.updateFavoriteItem,
  })));

  const glossaryItems = useMemo(() => {
    return favorites?.filter(item => item.folderId === 'glossary') || [];
  }, [favorites]);

  const handleExportGlossary = (format) => {
    if (glossaryItems.length === 0) {
      notify(t('favorites.glossaryEmpty'), 'warning');
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
    notify(t('favorites.exportedTerms', { count: glossaryItems.length, format: format.toUpperCase() }), 'success');
    setShowExportMenu(false);
  };

  const handleImportGlossary = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const content = await file.text();
      const terms = autoImport(content, file.name);

      if (terms.length === 0) {
        notify(t('favorites.noValidTerms'), 'warning');
        return;
      }

      const { addToFavorites } = useTranslationStore.getState();
      let added = 0;

      for (const term of terms) {
        // Dedupe against existing favorites — match on source+target pair.
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

      const skipped = terms.length - added;
      notify(t('favorites.importedTerms', { count: added }) + (skipped > 0 ? t('favorites.importSkipped', { skipped }) : ''), 'success');
    } catch (e) {
      notify(t('favorites.importFailed') + ': ' + e.message, 'error');
    }

    event.target.value = '';
  };

  useEffect(() => {
    localStorage.setItem('t-translate-folders', JSON.stringify(folders));
  }, [folders]);

  const allTags = useMemo(() => {
    const tags = new Set();
    favorites?.forEach(item => {
      item.tags?.forEach(tag => tags.add(tag));
    });
    return Array.from(tags).sort();
  }, [favorites]);

  const folderCounts = useMemo(() => {
    const systemFolderIds = folders.filter(f => f.isSystem).map(f => f.id);
    let allCount = 0;
    let uncategorizedCount = 0;
    const counts = {};

    favorites?.forEach(item => {
      if (!item.folderId) {
        uncategorizedCount++;
        allCount++;
      } else {
        counts[item.folderId] = (counts[item.folderId] || 0) + 1;
        // System folders (glossary, style_library) are excluded from "All".
        if (!systemFolderIds.includes(item.folderId)) {
          allCount++;
        }
      }
    });

    return { all: allCount, uncategorized: uncategorizedCount, ...counts };
  }, [favorites, folders]);

  const filteredFavorites = useMemo(() => {
    if (!Array.isArray(favorites)) return [];

    let filtered = [...favorites];

    if (selectedFolder === 'uncategorized') {
      filtered = filtered.filter(item => !item.folderId);
    } else if (selectedFolder === 'all') {
      // "All favorites" excludes the system folders.
      const systemFolderIds = folders.filter(f => f.isSystem).map(f => f.id);
      filtered = filtered.filter(item => !systemFolderIds.includes(item.folderId));
    } else {
      filtered = filtered.filter(item => item.folderId === selectedFolder);
    }

    if (selectedTag) {
      filtered = filtered.filter(item => item.tags?.includes(selectedTag));
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(item =>
        (item.sourceText || '').toLowerCase().includes(query) ||
        (item.translatedText || '').toLowerCase().includes(query) ||
        (item.note || '').toLowerCase().includes(query) ||
        (item.tags || []).some(tag => tag.toLowerCase().includes(query))
      );
    }

    filtered.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    return filtered;
  }, [favorites, selectedFolder, selectedTag, searchQuery, folders]);

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
    notify(t('favorites.folderCreated'), 'success');
  };

  const handleUpdateFolder = (id, updates) => {
    setFolders(folders.map(f => f.id === id ? { ...f, ...updates } : f));
    setEditingFolder(null);
  };

  const handleDeleteFolder = (id) => {
    if (!window.confirm(t('favorites.deleteFolderConfirm'))) return;

    // Move items in this folder back to uncategorized before deletion.
    favorites?.forEach(item => {
      if (item.folderId === id) {
        updateFavoriteItem(item.id, { folderId: null });
      }
    });

    setFolders(folders.filter(f => f.id !== id));
    if (selectedFolder === id) setSelectedFolder('all');
    notify(t('favorites.folderDeleted'), 'success');
  };

  const handleCopy = useCallback((text) => {
    navigator.clipboard.writeText(text);
    notify(t('favorites.copied'), 'success');
  }, [notify, t]);

  const handleMove = useCallback((itemId, folderId) => {
    updateFavoriteItem(itemId, { folderId });
    notify(t('favorites.moved'), 'success');
  }, [updateFavoriteItem, notify, t]);

  const handleUpdateTags = useCallback((itemId, tags) => {
    updateFavoriteItem(itemId, { tags });
  }, [updateFavoriteItem]);

  const handleUpdateNote = useCallback((itemId, note) => {
    updateFavoriteItem(itemId, { note });
  }, [updateFavoriteItem]);

  const handleUpdateStyleRef = useCallback((itemId, isStyleReference) => {
    // Toggling the style-reference flag also moves the item to / from the
    // style library folder.
    updateFavoriteItem(itemId, {
      isStyleReference,
      folderId: isStyleReference ? 'style_library' : null
    });
    notify(isStyleReference ? t('favorites.movedToStyle') : t('favorites.movedFromStyle'), 'success');
  }, [updateFavoriteItem, notify]);

  const handleDelete = useCallback((itemId) => {
    if (window.confirm(t('favorites.deleteConfirm'))) {
      removeFromFavorites(itemId);
      notify(t('favorites.deleted'), 'success');
    }
  }, [removeFromFavorites, notify, t]);

  return (
    <div className="favorites-panel" ref={rootRef}>
      <div className="favorites-sidebar">
        <div className="sidebar-header">
          <h3>{t('favorites.title')}</h3>
          <button
            className="add-folder-btn"
            onClick={() => setShowAddFolder(!showAddFolder)}
            title={t('favorites.newFolder')}
          >
            <FolderPlus size={18} />
          </button>
        </div>

        {showAddFolder && (
          <div className="add-folder-form">
            <input
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder={t('favorites.folderName')}
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
                <Plus size={14} /> {t('favorites.create')}
              </button>
            </div>
          </div>
        )}

        <div className="folder-list">
          <div
            className={`folder-item ${selectedFolder === 'all' ? 'active' : ''}`}
            onClick={() => { setSelectedFolder('all'); setSelectedTag(null); }}
          >
            <Star size={16} className="folder-icon" />
            <span className="folder-name">{t('favorites.allFavorites')}</span>
            <span className="folder-count">{folderCounts.all}</span>
          </div>

          <div
            className={`folder-item ${selectedFolder === 'uncategorized' ? 'active' : ''}`}
            onClick={() => { setSelectedFolder('uncategorized'); setSelectedTag(null); }}
          >
            <Folder size={16} className="folder-icon" style={{ color: '#6b7280' }} />
            <span className="folder-name">{t('favorites.uncategorized')}</span>
            <span className="folder-count">{folderCounts.uncategorized}</span>
          </div>

          <div className="folder-divider" />

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
                      title={t('favorites.save', 'Confirm')}
                    >
                      <Check size={14} />
                    </button>
                    <button
                      className="btn-cancel-small"
                      onClick={() => setEditingFolder(null)}
                      title={t('favorites.cancel', 'Cancel')}
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
                    <span className="folder-name">{getFolderName(folder)}</span>
                    <span className="folder-count">{folderCounts[folder.id] || 0}</span>
                  </div>
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
                        title={t('favorites.importTerms')}
                      >
                        <Upload size={12} />
                      </button>
                      <div className="export-menu-wrapper">
                        <button
                          onClick={(e) => { e.stopPropagation(); setShowExportMenu(!showExportMenu); }}
                          title={t('favorites.exportTerms')}
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

        {allTags.length > 0 && (
          <>
            <div className="sidebar-section-title">
              <Tag size={14} /> {t('favorites.tags')}
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

      <div className="favorites-main">
        <div className="favorites-toolbar">
          <div className="toolbar-search">
            <Search size={16} />
            <input
              ref={searchRef}
              type="text"
              placeholder={t('favorites.search')}
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
              {filteredFavorites.length} {selectedFolder === 'glossary' ? t('favorites.terms') : t('favorites.items')}
            </span>
          </div>
        </div>

        <div className="favorites-content">
          {filteredFavorites.length === 0 ? (
            <div className="empty-state">
              <Star size={48} />
              <p>{searchQuery || selectedTag ? t('favorites.noMatch') : t('favorites.empty')}</p>
              <span>{t('favorites.emptyHint')}</span>
            </div>
          ) : selectedFolder === 'glossary' ? (
            <div className="glossary-table-wrapper">
              <table className="glossary-table">
                <thead>
                  <tr>
                    <th style={{ width: '30%' }}>{t('translation.source')}</th>
                    <th style={{ width: '30%' }}>{t('translation.target')}</th>
                    <th style={{ width: '25%' }}>{t('favorites.note')}</th>
                    <th style={{ width: '15%' }}>{t('favorites.actions')}</th>
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
