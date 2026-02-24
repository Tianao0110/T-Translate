// src/components/DocumentTranslator/index.jsx
// 文档翻译组件 - 沉浸式双语对照翻译
// 已国际化版本

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FileText, Upload, X, Play, Pause, RotateCcw, Download,
  ChevronDown, ChevronRight, Settings, AlertCircle, CheckCircle, Clock,
  Loader, Eye, EyeOff, ArrowUp, Filter, FileDown, Trash2,
  SkipForward, RefreshCw, Languages, Zap, Lock, Key,
  List, Hash, DollarSign, Database, BookOpen, ChevronLeft,
  Edit3, Check, Copy, Search, Replace
} from 'lucide-react';
import createLogger from '../../utils/logger.js';
import {
  parseDocument,
  batchSegments,
  estimateTokens,
  exportBilingual,
  exportTranslatedOnly,
  exportSRT,
  exportVTT,
  exportDOCX,
  exportPDFHTML,
  SUPPORTED_FORMATS,
} from '../../utils/document-parser.js';
import translationService from '../../services/translation.js';
import useTranslationStore from '../../stores/translation-store';
import './styles.css';

// 段落状态
const STATUS = {
  PENDING: 'pending',
  TRANSLATING: 'translating',
  COMPLETED: 'completed',
  ERROR: 'error',
  SKIPPED: 'skipped',
};

// 进度持久化
const PROGRESS_KEY = 'dt_progress_';

function getFileFingerprint(file) {
  return `${file.name}_${file.size}_${file.lastModified}`;
}

function saveProgress(fp, segments, sLang, tLang) {
  try {
    const data = { ts: Date.now(), sLang, tLang,
      segs: segments.filter(s => s.status === STATUS.COMPLETED).map(s => ({ id: s.id, t: s.translated }))
    };
    localStorage.setItem(PROGRESS_KEY + fp, JSON.stringify(data));
  } catch { /* full */ }
}

function loadProgress(fp) {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY + fp);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (Date.now() - data.ts > 7 * 86400000) { localStorage.removeItem(PROGRESS_KEY + fp); return null; }
    return data;
  } catch { return null; }
}

/**
 * 单个段落组件
 */
const SegmentItem = React.memo(({ segment, displayStyle, onRetry, onRetranslate, onEdit, onCopy, searchQuery, replaceQuery, onReplace, t }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const editRef = useRef(null);

  const statusIcon = {
    [STATUS.PENDING]: <Clock size={14} className="status-icon pending" />,
    [STATUS.TRANSLATING]: <Loader size={14} className="status-icon translating" />,
    [STATUS.COMPLETED]: <CheckCircle size={14} className="status-icon completed" />,
    [STATUS.ERROR]: <AlertCircle size={14} className="status-icon error" />,
    [STATUS.SKIPPED]: <SkipForward size={14} className="status-icon skipped" />,
  };

  const isSubtitle = segment.type === 'subtitle';

  const startEdit = () => {
    setEditText(segment.translated || '');
    setIsEditing(true);
    setTimeout(() => editRef.current?.focus(), 50);
  };
  const saveEdit = () => {
    if (editText.trim() !== (segment.translated || '')) onEdit(segment.id, editText.trim());
    setIsEditing(false);
  };
  const cancelEdit = () => { setIsEditing(false); setEditText(''); };

  // 高亮搜索匹配
  const highlightText = (text) => {
    if (!searchQuery || !text) return text;
    try {
      const regex = new RegExp(`(${searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
      const parts = text.split(regex);
      return parts.map((part, i) => regex.test(part) ? <mark key={i} className="search-highlight">{part}</mark> : part);
    } catch { return text; }
  };

  const hasSearchMatch = searchQuery && segment.translated && segment.translated.toLowerCase().includes(searchQuery.toLowerCase());

  return (
    <div 
      className={`segment-item ${segment.status} ${displayStyle} ${segment.edited ? 'edited' : ''}`}
      data-segment-id={segment.id}
    >
      {/* 段落序号和状态 */}
      <div className="segment-header">
        <span className="segment-index">#{segment.id + 1}</span>
        {statusIcon[segment.status]}
        {segment.edited && <span className="edited-badge" title={t('documentTranslator.segment.edited')}>✏️</span>}
        {segment.status === STATUS.SKIPPED && segment.filterReason && (
          <span className="skip-reason">{segment.filterReason}</span>
        )}
        {isSubtitle && <span className="timecode">{segment.timecode}</span>}
        
        {/* 段落操作按钮 */}
        <div className="segment-actions">
          {segment.status === STATUS.ERROR && (
            <button className="seg-btn" onClick={() => onRetry(segment.id)} title={t('documentTranslator.actions.retry')}>
              <RotateCcw size={12} />
            </button>
          )}
          {segment.status === STATUS.COMPLETED && (
            <>
              <button className="seg-btn" onClick={() => onRetranslate(segment.id)} title={t('documentTranslator.segment.retranslate')}>
                <RefreshCw size={12} />
              </button>
              <button className="seg-btn" onClick={startEdit} title={t('documentTranslator.segment.edit')}>
                <Edit3 size={12} />
              </button>
              <button className="seg-btn" onClick={() => onCopy(segment.translated)} title={t('documentTranslator.segment.copy')}>
                <Copy size={12} />
              </button>
              {hasSearchMatch && replaceQuery !== undefined && (
                <button className="seg-btn replace" onClick={() => onReplace(segment.id)} title={t('documentTranslator.search.replaceThis')}>
                  <Replace size={12} />
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* 原文 */}
      {displayStyle !== 'translated-only' && (
        <div className="segment-original">
          {highlightText(segment.original)}
        </div>
      )}

      {/* 译文 */}
      {displayStyle !== 'source-only' && segment.status !== STATUS.SKIPPED && (
        <div className={`segment-translated ${segment.status}`}>
          {segment.status === STATUS.TRANSLATING && (
            <span className="translating-hint">
              <Loader size={14} className="spinning" /> {t('documentTranslator.status.translating')}
            </span>
          )}
          {segment.status === STATUS.COMPLETED && !isEditing && (
            <span onDoubleClick={startEdit} className="translated-text">
              {highlightText(segment.translated)}
            </span>
          )}
          {segment.status === STATUS.COMPLETED && isEditing && (
            <div className="edit-area">
              <textarea
                ref={editRef}
                value={editText}
                onChange={e => setEditText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) saveEdit(); if (e.key === 'Escape') cancelEdit(); }}
                className="edit-textarea"
                rows={Math.max(2, editText.split('\n').length)}
              />
              <div className="edit-actions">
                <button className="edit-btn save" onClick={saveEdit} title="Ctrl+Enter">
                  <Check size={12} /> {t('documentTranslator.segment.save')}
                </button>
                <button className="edit-btn cancel" onClick={cancelEdit} title="Esc">
                  <X size={12} /> {t('documentTranslator.segment.cancel')}
                </button>
              </div>
            </div>
          )}
          {segment.status === STATUS.ERROR && (
            <span className="error-hint">
              <AlertCircle size={14} /> {segment.error || t('documentTranslator.status.failed')}
            </span>
          )}
          {segment.status === STATUS.PENDING && (
            <span className="pending-hint">{t('documentTranslator.status.pending')}</span>
          )}
        </div>
      )}
    </div>
  );
});

/**
 * 大纲项组件
 */
const OutlineItem = ({ item, onNavigate, level = 0 }) => {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = item.children && item.children.length > 0;
  
  return (
    <div className="outline-item" style={{ paddingLeft: level * 12 }}>
      <div 
        className="outline-item-header"
        onClick={() => onNavigate(item.segmentId)}
      >
        {hasChildren && (
          <button 
            className="outline-toggle"
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
          >
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        )}
        <span className={`outline-text level-${item.level}`}>
          {item.text}
        </span>
      </div>
      {hasChildren && expanded && (
        <div className="outline-children">
          {item.children.map((child, idx) => (
            <OutlineItem 
              key={idx} 
              item={child} 
              onNavigate={onNavigate}
              level={level + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// 日志实例
const logger = createLogger('DocTranslator');

/**
 * 主组件
 */
const DocumentTranslator = ({ 
  onClose, 
  notify,
  sourceLang = 'auto',
  targetLang = 'zh',
}) => {
  const { t } = useTranslation();
  
  // 显示样式配置 - 使用 i18n
  const DISPLAY_STYLES = useMemo(() => [
    { id: 'below', name: t('documentTranslator.displayStyles.below'), icon: '⬇️' },
    { id: 'side-by-side', name: t('documentTranslator.displayStyles.sideBySide'), icon: '⬛' },
  ], [t]);
  
  // 文件状态
  const [document, setDocument] = useState(null);
  const [segments, setSegments] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  
  // 文件指纹（进度持久化）
  const fileFingerprint = useRef(null);
  
  // 大纲导航
  const [outline, setOutline] = useState([]);
  
  // 翻译记忆缓存
  const translationCache = useRef(new Map());
  
  // 翻译状态
  const [isTranslating, setIsTranslating] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const pauseRef = useRef(false);
  const abortRef = useRef(false);
  
  // 批量翻译模式
  const [batchMode, setBatchMode] = useState(true);  // 默认启用批量模式
  const [batchSize, setBatchSize] = useState(10);     // 每批处理数量
  const [useGlossary, setUseGlossary] = useState(true);  // 启用术语表
  
  // 获取术语表
  const getGlossaryTerms = useTranslationStore(state => state.getGlossaryTerms);
  const translationMode = useTranslationStore(state => state.translationMode);
  
  // 计时
  const [startTime, setStartTime] = useState(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  
  // UI 状态
  const [displayStyle, setDisplayStyle] = useState('below');
  const [showFilters, setShowFilters] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  
  // 搜索替换
  const [searchQuery, setSearchQuery] = useState('');
  const [replaceQuery, setReplaceQuery] = useState('');
  const [searchMatchCount, setSearchMatchCount] = useState(0);
  
  // 进度恢复提示
  const [pendingRestore, setPendingRestore] = useState(null);
  
  // 密码弹窗
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [pendingFile, setPendingFile] = useState(null);
  const [password, setPassword] = useState('');
  
  // 过滤设置
  const [filters, setFilters] = useState({
    skipShort: true,
    minLength: 10,
    skipNumbers: true,
    skipCode: true,
    skipTargetLang: true,
    skipKeywords: [],
  });
  
  // 拖放区域 ref
  const dropZoneRef = useRef(null);
  const fileInputRef = useRef(null);
  const [isDragOver, setIsDragOver] = useState(false);
  
  // 列表引用
  const listRef = useRef(null);
  
  // 统计信息
  const stats = useMemo(() => {
    const total = segments.length;
    const completed = segments.filter(s => s.status === STATUS.COMPLETED).length;
    const failed = segments.filter(s => s.status === STATUS.ERROR).length;
    const skipped = segments.filter(s => s.status === STATUS.SKIPPED).length;
    const pending = segments.filter(s => s.status === STATUS.PENDING).length;
    const translating = segments.filter(s => s.status === STATUS.TRANSLATING).length;
    const totalTokens = segments.reduce((sum, s) => sum + (s.tokens || 0), 0);
    const usedTokens = segments
      .filter(s => s.status === STATUS.COMPLETED)
      .reduce((sum, s) => sum + (s.tokens || 0), 0);
    const cacheHits = segments.filter(s => s.fromCache).length;
    const edited = segments.filter(s => s.edited).length;
    const progress = total > 0 ? Math.round((completed / (total - skipped)) * 100) : 0;
    
    return { 
      total, completed, failed, skipped, pending, translating,
      totalTokens, usedTokens, cacheHits, edited, progress 
    };
  }, [segments]);

  // 计时器
  useEffect(() => {
    let timer;
    if (isTranslating && startTime && !isPaused) {
      timer = setInterval(() => {
        setElapsedTime(Date.now() - startTime);
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [isTranslating, startTime, isPaused]);

  // 搜索匹配计数
  useEffect(() => {
    if (!searchQuery) { setSearchMatchCount(0); return; }
    const count = segments.filter(s => 
      s.status === STATUS.COMPLETED && s.translated &&
      s.translated.toLowerCase().includes(searchQuery.toLowerCase())
    ).length;
    setSearchMatchCount(count);
  }, [searchQuery, segments]);

  // 自动保存进度
  useEffect(() => {
    if (fileFingerprint.current && stats.completed > 0 && !isTranslating) {
      saveProgress(fileFingerprint.current, segments, sourceLang, targetLang);
    }
  }, [stats.completed, isTranslating]);

  // 键盘快捷键 Ctrl+F / Ctrl+H
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.ctrlKey && e.key === 'f' && document) { e.preventDefault(); setShowSearch(prev => !prev); }
      if (e.ctrlKey && e.key === 'h' && document) { e.preventDefault(); setShowSearch(true); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [document]);

  // 格式化时间
  const formatTime = (ms) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}:${String(minutes % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    }
    return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
  };

  // 拖放处理
  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  // 加载文件
  const loadFile = useCallback(async (file, filePassword = null) => {
    logger.debug('Loading file:', file.name, file.type, file.size);
    setIsLoading(true);
    
    try {
      const result = await parseDocument(file, {
        maxCharsPerSegment: 800,
        password: filePassword,
        filters: {
          ...filters,
          targetLang,
        },
      });
      
      logger.debug('parseDocument result:', result);
      
      if (result.success) {
        const fingerprint = getFileFingerprint(file);
        fileFingerprint.current = fingerprint;
        
        setDocument({
          filename: result.filename,
          format: result.format,
          formatName: result.formatName,
          stats: result.stats,
          pageCount: result.pageCount,
        });
        setSegments(result.segments);
        setOutline(result.outline || []);
        setShowPasswordModal(false);
        setPendingFile(null);
        setPassword('');
        // 重置计时
        setStartTime(null);
        setElapsedTime(0);
        
        // 检查是否有可恢复的进度
        const saved = loadProgress(fingerprint);
        if (saved && saved.segs.length > 0 && saved.sLang === sourceLang && saved.tLang === targetLang) {
          setPendingRestore(saved);
        } else {
          setPendingRestore(null);
        }
        
        // 通知消息
        const message = result.pageCount
          ? t('documentTranslator.notify.fileLoadedWithPages', { count: result.segments.length, pages: result.pageCount })
          : t('documentTranslator.notify.fileLoaded', { count: result.segments.length });
        notify?.(message, 'success');
      } else if (result.needPassword) {
        // 需要密码，显示密码弹窗
        setPendingFile(file);
        setShowPasswordModal(true);
        setIsLoading(false);
        if (filePassword) {
          notify?.(t('documentTranslator.password.wrongPassword'), 'error');
        }
        return;
      } else {
        notify?.(result.error || t('documentTranslator.notify.parseFailed'), 'error');
      }
    } catch (error) {
      logger.error('Error:', error);
      notify?.(error.message, 'error');
    } finally {
      setIsLoading(false);
    }
  }, [filters, targetLang, notify, t]);

  // 提交密码
  const handlePasswordSubmit = useCallback(async () => {
    if (!pendingFile || !password) return;
    await loadFile(pendingFile, password);
  }, [pendingFile, password, loadFile]);

  // 取消密码输入
  const handlePasswordCancel = useCallback(() => {
    setShowPasswordModal(false);
    setPendingFile(null);
    setPassword('');
  }, []);

  // 拖放文件
  const handleDrop = useCallback(async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    
    logger.debug('File dropped:', e.dataTransfer.files);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      logger.debug('Loading dropped file:', file.name);
      await loadFile(file);
    }
  }, [loadFile]);

  // 选择文件
  const handleFileSelect = useCallback(async (e) => {
    logger.debug('File selected:', e.target.files);
    const file = e.target.files?.[0];
    if (file) {
      logger.debug('Loading file:', file.name, file.type, file.size);
      await loadFile(file);
    }
    e.target.value = null;
  }, [loadFile]);

  // 开始翻译
  const startTranslation = async () => {
    if (isTranslating) return;
    
    setIsTranslating(true);
    setIsPaused(false);
    pauseRef.current = false;
    abortRef.current = false;
    setStartTime(Date.now());
    
    // 获取待翻译的段落
    let pendingSegments = segments.filter(s => s.status === STATUS.PENDING || s.status === STATUS.ERROR);
    
    // 先检查缓存，标记可从缓存获取的段落
    const toTranslate = [];
    for (const segment of pendingSegments) {
      const cacheKey = `${segment.original}|${sourceLang}|${targetLang}`;
      const cachedTranslation = translationCache.current.get(cacheKey);
      
      if (cachedTranslation) {
        // 使用缓存
        setSegments(prev => prev.map(s => 
          s.id === segment.id ? { 
            ...s, 
            status: STATUS.COMPLETED, 
            translated: cachedTranslation,
            fromCache: true,
          } : s
        ));
      } else {
        toTranslate.push(segment);
      }
    }
    
    if (toTranslate.length === 0) {
      setIsTranslating(false);
      notify?.(t('documentTranslator.notify.translationCompleteFromCache'), 'success');
      return;
    }
    
    // 根据模式选择翻译方式
    if (batchMode) {
      // 批量翻译模式
      await translateBatchMode(toTranslate);
    } else {
      // 单条翻译模式
      await translateSingleMode(toTranslate);
    }
    
    setIsTranslating(false);
    if (!abortRef.current) {
      notify?.(t('documentTranslator.notify.translationComplete'), 'success');
    }
  };

  // 批量翻译模式
  const translateBatchMode = async (toTranslate) => {
    // 获取术语表（如果启用）
    const glossary = useGlossary ? getGlossaryTerms() : [];
    if (glossary.length > 0) {
      logger.debug(`Using glossary with ${glossary.length} terms`);
    }
    
    // 分批处理
    for (let i = 0; i < toTranslate.length; i += batchSize) {
      if (abortRef.current) break;
      
      // 暂停检查
      while (pauseRef.current) {
        await new Promise(resolve => setTimeout(resolve, 100));
        if (abortRef.current) break;
      }
      if (abortRef.current) break;
      
      const batch = toTranslate.slice(i, i + batchSize);
      const batchIds = batch.map(s => s.id);
      const batchTexts = batch.map(s => s.original);
      
      // 标记这批段落为翻译中
      setSegments(prev => prev.map(s => 
        batchIds.includes(s.id) ? { ...s, status: STATUS.TRANSLATING } : s
      ));
      
      try {
        // 批量翻译
        const result = await translationService.translateBatch(batchTexts, {
          sourceLang,
          targetLang,
          glossary: glossary.length > 0 ? glossary : undefined,
        });
        
        if (result.success && result.translations) {
          // 更新翻译结果
          setSegments(prev => prev.map(s => {
            const batchIndex = batchIds.indexOf(s.id);
            if (batchIndex >= 0) {
              const translation = result.translations[batchIndex];
              // 缓存翻译结果
              const cacheKey = `${s.original}|${sourceLang}|${targetLang}`;
              translationCache.current.set(cacheKey, translation);
              
              return {
                ...s,
                status: STATUS.COMPLETED,
                translated: translation,
              };
            }
            return s;
          }));
        } else {
          throw new Error(result.error || 'Batch translation failed');
        }
      } catch (error) {
        // 批量失败，回退到单条翻译
        logger.warn('Batch translation failed, falling back to single mode:', error);
        for (const segment of batch) {
          if (abortRef.current) break;
          await translateSingleSegment(segment);
        }
      }
    }
  };

  // 单条翻译模式
  const translateSingleMode = async (toTranslate) => {
    for (const segment of toTranslate) {
      if (abortRef.current) break;
      
      // 暂停检查
      while (pauseRef.current) {
        await new Promise(resolve => setTimeout(resolve, 100));
        if (abortRef.current) break;
      }
      if (abortRef.current) break;
      
      await translateSingleSegment(segment);
    }
  };

  // 翻译单个段落
  const translateSingleSegment = async (segment) => {
    setSegments(prev => prev.map(s => 
      s.id === segment.id ? { ...s, status: STATUS.TRANSLATING } : s
    ));
    
    try {
      const result = await translationService.translate(segment.original, {
        sourceLang,
        targetLang,
      });
      
      if (result.success) {
        const translated = result.text || result.translatedText || '';
        // 缓存翻译结果
        const cacheKey = `${segment.original}|${sourceLang}|${targetLang}`;
        translationCache.current.set(cacheKey, translated);
        
        setSegments(prev => prev.map(s => 
          s.id === segment.id ? { 
            ...s, 
            status: STATUS.COMPLETED, 
            translated,
          } : s
        ));
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      setSegments(prev => prev.map(s => 
        s.id === segment.id ? { 
          ...s, 
          status: STATUS.ERROR, 
          error: error.message,
        } : s
      ));
    }
  };

  // 暂停/继续
  const togglePause = () => {
    pauseRef.current = !pauseRef.current;
    setIsPaused(pauseRef.current);
  };

  // 停止翻译
  const stopTranslation = () => {
    abortRef.current = true;
    pauseRef.current = false;
    setIsPaused(false);
    setIsTranslating(false);
  };

  // 重试单个段落
  const retrySegment = async (segmentId) => {
    const segment = segments.find(s => s.id === segmentId);
    if (!segment) return;
    
    setSegments(prev => prev.map(s => 
      s.id === segmentId ? { ...s, status: STATUS.TRANSLATING } : s
    ));
    
    try {
      const result = await translationService.translate(segment.original, {
        sourceLang,
        targetLang,
      });
      
      if (result.success) {
        setSegments(prev => prev.map(s => 
          s.id === segmentId ? { 
            ...s, 
            status: STATUS.COMPLETED, 
            translated: result.text || result.translatedText || '',
          } : s
        ));
        notify?.(t('documentTranslator.notify.retrySuccess'), 'success');
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      setSegments(prev => prev.map(s => 
        s.id === segmentId ? { 
          ...s, 
          status: STATUS.ERROR, 
          error: error.message,
        } : s
      ));
      notify?.(t('documentTranslator.notify.retryFailed', { error: error.message }), 'error');
    }
  };

  // 重试所有失败
  const retryAllFailed = async () => {
    const failedIds = segments.filter(s => s.status === STATUS.ERROR).map(s => s.id);
    for (const id of failedIds) {
      await retrySegment(id);
    }
  };

  // 重新翻译已完成段落
  const retranslateSegment = async (segmentId) => {
    const segment = segments.find(s => s.id === segmentId);
    if (!segment || segment.status !== STATUS.COMPLETED) return;
    const cacheKey = `${segment.original}|${sourceLang}|${targetLang}`;
    translationCache.current.delete(cacheKey);
    setSegments(prev => prev.map(s => s.id === segmentId ? { ...s, status: STATUS.TRANSLATING, edited: false } : s));
    try {
      const result = await translationService.translate(segment.original, { sourceLang, targetLang });
      if (result.success) {
        const translated = result.text || result.translatedText || '';
        translationCache.current.set(cacheKey, translated);
        setSegments(prev => prev.map(s => s.id === segmentId ? { ...s, status: STATUS.COMPLETED, translated, edited: false } : s));
        notify?.(t('documentTranslator.notify.retranslateSuccess'), 'success');
      } else { throw new Error(result.error); }
    } catch (error) {
      setSegments(prev => prev.map(s => s.id === segmentId ? { ...s, status: STATUS.ERROR, error: error.message } : s));
      notify?.(t('documentTranslator.notify.retryFailed', { error: error.message }), 'error');
    }
  };

  // 编辑段落译文
  const editSegment = useCallback((segmentId, newText) => {
    setSegments(prev => prev.map(s => s.id === segmentId ? { ...s, translated: newText, edited: true } : s));
    const segment = segments.find(s => s.id === segmentId);
    if (segment) {
      const cacheKey = `${segment.original}|${sourceLang}|${targetLang}`;
      translationCache.current.set(cacheKey, newText);
    }
  }, [segments, sourceLang, targetLang]);

  // 复制译文
  const copySegmentText = useCallback((text) => {
    if (text) { navigator.clipboard.writeText(text); notify?.(t('documentTranslator.notify.copied'), 'success'); }
  }, [notify, t]);

  // 替换单个段落中的搜索匹配
  const replaceInSegment = useCallback((segmentId) => {
    if (!searchQuery || replaceQuery === undefined) return;
    setSegments(prev => prev.map(s => {
      if (s.id === segmentId && s.status === STATUS.COMPLETED && s.translated) {
        const regex = new RegExp(searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        const newText = s.translated.replace(regex, replaceQuery);
        if (newText !== s.translated) {
          const cacheKey = `${s.original}|${sourceLang}|${targetLang}`;
          translationCache.current.set(cacheKey, newText);
          return { ...s, translated: newText, edited: true };
        }
      }
      return s;
    }));
  }, [searchQuery, replaceQuery, sourceLang, targetLang]);

  // 全部替换
  const replaceAll = useCallback(() => {
    if (!searchQuery || replaceQuery === undefined) return;
    let count = 0;
    setSegments(prev => prev.map(s => {
      if (s.status === STATUS.COMPLETED && s.translated) {
        const regex = new RegExp(searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        const newText = s.translated.replace(regex, replaceQuery);
        if (newText !== s.translated) {
          count++;
          const cacheKey = `${s.original}|${sourceLang}|${targetLang}`;
          translationCache.current.set(cacheKey, newText);
          return { ...s, translated: newText, edited: true };
        }
      }
      return s;
    }));
    if (count > 0) notify?.(t('documentTranslator.notify.replacedCount', { count }), 'success');
  }, [searchQuery, replaceQuery, sourceLang, targetLang, notify, t]);

  // 恢复进度
  const restoreProgress = useCallback(() => {
    if (!pendingRestore) return;
    const restoredMap = new Map(pendingRestore.segs.map(s => [s.id, s.t]));
    setSegments(prev => prev.map(s => {
      const restored = restoredMap.get(s.id);
      if (restored) {
        const cacheKey = `${s.original}|${sourceLang}|${targetLang}`;
        translationCache.current.set(cacheKey, restored);
        return { ...s, status: STATUS.COMPLETED, translated: restored, fromCache: true };
      }
      return s;
    }));
    setPendingRestore(null);
    notify?.(t('documentTranslator.notify.progressRestored', { count: restoredMap.size }), 'success');
  }, [pendingRestore, sourceLang, targetLang, notify, t]);

  // 忽略恢复
  const dismissRestore = useCallback(() => {
    setPendingRestore(null);
    if (fileFingerprint.current) localStorage.removeItem(PROGRESS_KEY + fileFingerprint.current);
  }, []);

  // 导出
  const handleExport = async (type) => {
    if (segments.length === 0) return;
    
    let content = '';
    let filename = document?.filename?.replace(/\.[^.]+$/, '') || 'translated';
    let ext = 'txt';
    let filterName = 'Text';
    let isBinary = false;
    
    try {
      switch (type) {
        case 'bilingual-txt':
          content = exportBilingual(segments, { style: 'below' });
          filename += t('documentTranslator.fileSuffix.bilingual');
          filterName = 'Text';
          break;
        case 'bilingual-md':
          content = exportBilingual(segments, { style: 'below', format: 'md' });
          filename += t('documentTranslator.fileSuffix.bilingual');
          ext = 'md';
          filterName = 'Markdown';
          break;
        case 'translated-only':
          content = exportTranslatedOnly(segments);
          filename += t('documentTranslator.fileSuffix.translatedOnly');
          filterName = 'Text';
          break;
        case 'srt':
          content = exportSRT(segments);
          filename += '_translated';
          ext = 'srt';
          filterName = 'SRT Subtitle';
          break;
        case 'vtt':
          content = exportVTT(segments);
          filename += '_translated';
          ext = 'vtt';
          filterName = 'VTT Subtitle';
          break;
        case 'docx': {
          const blob = exportDOCX(segments, { 
            style: 'bilingual', 
            title: document?.filename || t('documentTranslator.defaultDocTitle')
          });
          content = await blob.text();
          filename += t('documentTranslator.fileSuffix.bilingual');
          ext = 'doc';
          filterName = 'Word Document';
          break;
        }
        case 'docx-translated': {
          const blob = exportDOCX(segments, { 
            style: 'translated-only', 
            title: document?.filename || t('documentTranslator.defaultDocTitle')
          });
          content = await blob.text();
          filename += t('documentTranslator.fileSuffix.translatedOnly');
          ext = 'doc';
          filterName = 'Word Document';
          break;
        }
        case 'pdf':
          content = exportPDFHTML(segments, { 
            style: 'bilingual', 
            title: document?.filename || t('documentTranslator.defaultDocTitle')
          });
          filename += t('documentTranslator.fileSuffix.bilingual');
          ext = 'html';
          filterName = 'HTML (Print to PDF)';
          break;
        default:
          return;
      }
      
      // 使用 Electron 保存对话框
      const saveFile = window.electron?.dialog?.saveFile;
      if (saveFile) {
        const result = await saveFile({
          defaultPath: `${filename}.${ext}`,
          filters: [
            { name: filterName, extensions: [ext] },
            { name: 'All Files', extensions: ['*'] },
          ],
          data: content,
          encoding: isBinary ? 'binary' : 'utf8',
        });
        
        if (result.success) {
          setShowExport(false);
          notify?.(t('documentTranslator.notify.exportSuccess'), 'success');
        } else if (!result.canceled) {
          throw new Error(result.error || 'Save failed');
        }
      } else {
        // 回退：浏览器环境或 preload 不可用时用 blob 下载
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = window.document.createElement('a');
        a.href = url;
        a.download = `${filename}.${ext}`;
        a.click();
        URL.revokeObjectURL(url);
        setShowExport(false);
        notify?.(t('documentTranslator.notify.exportSuccess'), 'success');
      }
    } catch (error) {
      logger.error('Export error:', error);
      notify?.(t('documentTranslator.notify.exportFailed', { error: error.message }), 'error');
    }
  };

  // 清空文档
  const clearDocument = () => {
    if (isTranslating) {
      stopTranslation();
    }
    setDocument(null);
    setSegments([]);
    setOutline([]);
    setStartTime(null);
    setElapsedTime(0);
    setPendingRestore(null);
    setShowSearch(false);
    setSearchQuery('');
    setReplaceQuery('');
    fileFingerprint.current = null;
  };

  // 滚动处理 - 仅用于显示/隐藏滚动到顶部按钮
  const lastScrollTopState = useRef(false);
  
  const handleScroll = useCallback((e) => {
    const scrollTop = e.target.scrollTop;
    const shouldShow = scrollTop > 400;
    
    if (shouldShow !== lastScrollTopState.current) {
      lastScrollTopState.current = shouldShow;
      setShowScrollTop(shouldShow);
    }
  }, []);

  // 滚动到顶部
  const scrollToTop = () => {
    listRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // 跳转到指定段落（使用 DOM 查询实际位置）
  const scrollToSegment = (segmentId) => {
    const element = listRef.current?.querySelector(`[data-segment-id="${segmentId}"]`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  // 清除翻译记忆缓存
  const clearCache = () => {
    translationCache.current.clear();
    notify?.(t('documentTranslator.notify.cacheCleared'), 'success');
  };

  // 获取支持的格式列表
  const supportedExtensions = Object.keys(SUPPORTED_FORMATS)
    .map(ext => `.${ext}`)
    .join(', ');

  return (
    <div className="document-translator">
      {/* 头部 */}
      <div className="dt-header">
        <div className="dt-title">
          <FileText size={20} />
          <span>{t('documentTranslator.title')}</span>
        </div>
        <div className="dt-actions">
          {document && (
            <>
              {/* 搜索按钮 */}
              <button 
                className={`dt-btn icon-only ${showSearch ? 'active' : ''}`}
                onClick={() => setShowSearch(!showSearch)}
                title={t('documentTranslator.search.title') + ' (Ctrl+F)'}
              >
                <Search size={16} />
              </button>

              {/* 显示样式 */}
              <div className="style-selector">
                {DISPLAY_STYLES.map(style => (
                  <button
                    key={style.id}
                    className={displayStyle === style.id ? 'active' : ''}
                    onClick={() => setDisplayStyle(style.id)}
                    title={style.name}
                  >
                    {style.icon}
                  </button>
                ))}
              </div>
              
              {/* 导出 */}
              <div className="export-dropdown">
                <button 
                  className="dt-btn"
                  onClick={() => setShowExport(!showExport)}
                >
                  <Download size={16} />
                  <span>{t('documentTranslator.actions.export')}</span>
                  <ChevronDown size={14} />
                </button>
                {showExport && (
                  <div className="export-menu">
                    <div className="export-section-title">{t('documentTranslator.export.textFormat')}</div>
                    <button onClick={() => handleExport('bilingual-txt')}>
                      <FileDown size={14} /> {t('documentTranslator.export.bilingualTxt')}
                    </button>
                    <button onClick={() => handleExport('bilingual-md')}>
                      <FileDown size={14} /> {t('documentTranslator.export.bilingualMd')}
                    </button>
                    <button onClick={() => handleExport('translated-only')}>
                      <FileDown size={14} /> {t('documentTranslator.export.translatedOnlyTxt')}
                    </button>
                    
                    <div className="export-divider" />
                    <div className="export-section-title">{t('documentTranslator.export.docFormat')}</div>
                    <button onClick={() => handleExport('docx')}>
                      <FileText size={14} /> {t('documentTranslator.export.bilingualWord')}
                    </button>
                    <button onClick={() => handleExport('docx-translated')}>
                      <FileText size={14} /> {t('documentTranslator.export.translatedOnlyWord')}
                    </button>
                    <button onClick={() => handleExport('pdf')}>
                      <FileText size={14} /> {t('documentTranslator.export.exportPdf')}
                    </button>
                    
                    {segments[0]?.type === 'subtitle' && (
                      <>
                        <div className="export-divider" />
                        <div className="export-section-title">{t('documentTranslator.export.subtitleFormat')}</div>
                        <button onClick={() => handleExport('srt')}>
                          <FileDown size={14} /> {t('documentTranslator.export.srtSubtitle')}
                        </button>
                        <button onClick={() => handleExport('vtt')}>
                          <FileDown size={14} /> {t('documentTranslator.export.vttSubtitle')}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
          <button className="dt-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
      </div>

      {/* 搜索替换栏 */}
      {showSearch && document && (
        <div className="dt-search-bar">
          <div className="search-row">
            <Search size={14} className="search-icon" />
            <input type="text" placeholder={t('documentTranslator.search.searchPlaceholder')} value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)} autoFocus className="search-input" />
            {searchQuery && <span className="search-count">{searchMatchCount} {t('documentTranslator.search.matches')}</span>}
          </div>
          <div className="search-row">
            <Replace size={14} className="search-icon" />
            <input type="text" placeholder={t('documentTranslator.search.replacePlaceholder')} value={replaceQuery}
              onChange={e => setReplaceQuery(e.target.value)} className="search-input" />
            <button className="search-btn" onClick={replaceAll} disabled={!searchQuery || searchMatchCount === 0}>
              {t('documentTranslator.search.replaceAll')}
            </button>
          </div>
          <button className="search-close" onClick={() => { setShowSearch(false); setSearchQuery(''); setReplaceQuery(''); }}>
            <X size={14} />
          </button>
        </div>
      )}

      {/* 主体内容 */}
      <div className="dt-body">
        {/* 无文件时显示上传区域 */}
        {!document && (
          <div 
            className={`dt-dropzone ${isDragOver ? 'drag-over' : ''}`}
            ref={dropZoneRef}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            {isLoading ? (
              <div className="loading-state">
                <Loader size={32} className="spinning" />
                <p>{t('documentTranslator.upload.parsing')}</p>
              </div>
            ) : (
              <>
                <Upload size={48} />
                <h3>{t('documentTranslator.upload.dropHere')}</h3>
                <p>{t('documentTranslator.upload.orClick')}</p>
                <p className="format-hint">{t('documentTranslator.upload.supported', { formats: supportedExtensions })}</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.md,.srt,.vtt,.pdf,.docx,.csv,.json,.epub"
                  onChange={handleFileSelect}
                  style={{ display: 'none' }}
                />
              </>
            )}
          </div>
        )}

        {/* 有文件时显示翻译界面 */}
        {document && stats && (
          <>
            {/* 进度恢复提示 */}
            {pendingRestore && (
              <div className="dt-restore-banner">
                <div className="restore-info">
                  <RefreshCw size={16} />
                  <span>{t('documentTranslator.restore.found', { count: pendingRestore.segs.length })}</span>
                </div>
                <div className="restore-actions">
                  <button className="restore-btn primary" onClick={restoreProgress}>{t('documentTranslator.restore.restore')}</button>
                  <button className="restore-btn secondary" onClick={dismissRestore}>{t('documentTranslator.restore.dismiss')}</button>
                </div>
              </div>
            )}

            {/* 文件信息栏 */}
            <div className="dt-file-info">
              <div className="file-details">
                <FileText size={18} />
                <span className="filename">{document.filename}</span>
                <span className="format-badge">{document.formatName}</span>
                <span 
                  className="stats clickable" 
                  onClick={() => setShowStats(!showStats)}
                  title={t('documentTranslator.stats.title')}
                >
                  {stats.total} {t('documentTranslator.stats.totalSegments')} · {document.stats?.totalChars?.toLocaleString() || 0} {t('documentTranslator.stats.totalChars')} · ~{stats.totalTokens?.toLocaleString()} tokens
                </span>
              </div>
            </div>

            {/* 进度条 */}
            <div className="dt-progress">
              <div className="progress-bar">
                <div 
                  className="progress-fill" 
                  style={{ width: `${stats.progress}%` }}
                />
              </div>
              <div className="progress-stats">
                <span className="progress-percent">{stats.progress}%</span>
                <span className="progress-detail">
                  {t('documentTranslator.progress.completed')} {stats.completed}/{stats.total - stats.skipped}
                  {stats.skipped > 0 && <span> · {t('documentTranslator.progress.skipped')} {stats.skipped}</span>}
                  {stats.failed > 0 && <span className="failed"> · {t('documentTranslator.progress.failed')} {stats.failed}</span>}
                  {stats.cacheHits > 0 && <span className="cache-hits"> · {t('documentTranslator.progress.cached')} {stats.cacheHits}</span>}
                  {stats.edited > 0 && <span className="edited-count"> · {t('documentTranslator.progress.edited')} {stats.edited}</span>}
                </span>
                {isTranslating && (
                  <span className="elapsed-time">
                    <Clock size={12} /> {formatTime(elapsedTime)}
                  </span>
                )}
              </div>
            </div>

            {/* 主内容区（带侧边栏） */}
            <div className="dt-main-content">
              {/* 大纲侧边栏 - 安全访问 outline */}
              {outline && outline.length > 0 && (
                <div className="dt-outline">
                  <div className="outline-header">
                    <BookOpen size={14} />
                    <span>{t('documentTranslator.outline.title')}</span>
                  </div>
                  <div className="outline-tree">
                    {outline.map((item, idx) => (
                      <OutlineItem 
                        key={idx} 
                        item={item} 
                        onNavigate={scrollToSegment}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* 段落列表 - 使用 CSS content-visibility 优化渲染 */}
              <div 
                className={`dt-segments ${outline?.length > 0 ? 'with-outline' : ''}`}
                ref={listRef}
                onScroll={handleScroll}
              >
                {segments.map(segment => (
                  <SegmentItem
                    key={segment.id}
                    segment={segment}
                    displayStyle={displayStyle}
                    onRetry={retrySegment}
                    onRetranslate={retranslateSegment}
                    onEdit={editSegment}
                    onCopy={copySegmentText}
                    searchQuery={showSearch ? searchQuery : ''}
                    replaceQuery={showSearch ? replaceQuery : undefined}
                    onReplace={replaceInSegment}
                    t={t}
                  />
                ))}
              </div>
            </div>

            {/* 滚动到顶部 */}
            <button 
              className={`scroll-top-btn ${showScrollTop ? 'visible' : ''}`} 
              onClick={scrollToTop}
              aria-hidden={!showScrollTop}
            >
              <ArrowUp size={18} />
            </button>

            {/* 统计弹出卡片 */}
            {showStats && (
              <>
                <div className="stats-overlay" onClick={() => setShowStats(false)} />
                <div className="stats-popup">
                  <div className="stats-popup-header">
                    <span>📊 {t('documentTranslator.stats.title')}</span>
                    <button className="close-btn" onClick={() => setShowStats(false)}>
                      <X size={14} />
                    </button>
                  </div>
                  <div className="stats-popup-content">
                    <div className="stats-grid">
                      <div className="stat-card">
                        <span className="stat-number">{stats.total}</span>
                        <span className="stat-desc">{t('documentTranslator.stats.totalSegments')}</span>
                      </div>
                      <div className="stat-card completed">
                        <span className="stat-number">{stats.completed}</span>
                        <span className="stat-desc">{t('documentTranslator.stats.translated')}</span>
                      </div>
                      <div className="stat-card">
                        <span className="stat-number">{stats.pending}</span>
                        <span className="stat-desc">{t('documentTranslator.stats.pending')}</span>
                      </div>
                      <div className="stat-card skipped">
                        <span className="stat-number">{stats.skipped}</span>
                        <span className="stat-desc">{t('documentTranslator.stats.skipped')}</span>
                      </div>
                      {stats.failed > 0 && (
                        <div className="stat-card error">
                          <span className="stat-number">{stats.failed}</span>
                          <span className="stat-desc">{t('documentTranslator.stats.failed')}</span>
                        </div>
                      )}
                      {stats.cacheHits > 0 && (
                        <div className="stat-card cache">
                          <span className="stat-number">{stats.cacheHits}</span>
                          <span className="stat-desc">{t('documentTranslator.stats.cacheHits')}</span>
                        </div>
                      )}
                      {stats.edited > 0 && (
                        <div className="stat-card edited">
                          <span className="stat-number">{stats.edited}</span>
                          <span className="stat-desc">{t('documentTranslator.stats.edited')}</span>
                        </div>
                      )}
                    </div>
                    
                    <div className="stats-detail">
                      <div className="detail-row">
                        <span>{t('documentTranslator.stats.totalChars')}</span>
                        <span>{document.stats?.totalChars?.toLocaleString() || 0}</span>
                      </div>
                      <div className="detail-row">
                        <span>{t('documentTranslator.stats.estimatedTokens')}</span>
                        <span>{stats.totalTokens?.toLocaleString()}</span>
                      </div>
                      <div className="detail-row">
                        <span>{t('documentTranslator.stats.usedTokens')}</span>
                        <span>{stats.usedTokens?.toLocaleString()}</span>
                      </div>
                      {elapsedTime > 0 && (
                        <div className="detail-row">
                          <span>{t('documentTranslator.stats.elapsedTime')}</span>
                          <span>{formatTime(elapsedTime)}</span>
                        </div>
                      )}
                    </div>
                    
                    <div className="stats-footer">
                      <button className="cache-btn" onClick={clearCache}>
                        <Database size={12} /> {t('documentTranslator.stats.clearCache')} ({translationCache.current?.size || 0})
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </div>

      {/* 底部控制栏 */}
      {document && (
        <div className="dt-footer">
          <div className="control-left">
            <div className="lang-display">
              <Languages size={16} />
              <span>{sourceLang === 'auto' ? t('documentTranslator.footer.auto') : sourceLang} → {targetLang}</span>
            </div>
            {/* 批量模式开关 */}
            <label className="batch-mode-toggle" title={batchMode ? t('documentTranslator.footer.batchModeOnHint', { count: batchSize }) : t('documentTranslator.footer.batchModeOffHint')}>
              <input 
                type="checkbox" 
                checked={batchMode}
                onChange={(e) => setBatchMode(e.target.checked)}
                disabled={isTranslating}
              />
              <Zap size={14} />
              <span>{t('documentTranslator.footer.batchMode')}</span>
            </label>
            {/* 术语表开关 */}
            <label 
              className="batch-mode-toggle glossary-toggle" 
              title={useGlossary ? t('documentTranslator.footer.glossaryEnabledHint') : t('documentTranslator.footer.glossaryDisabledHint')}
            >
              <input 
                type="checkbox" 
                checked={useGlossary}
                onChange={(e) => setUseGlossary(e.target.checked)}
                disabled={isTranslating}
              />
              <BookOpen size={14} />
              <span>{t('documentTranslator.footer.glossary')}</span>
            </label>
          </div>
          
          <div className="control-center">
            {!isTranslating ? (
              <button 
                className="btn-primary"
                onClick={startTranslation}
                disabled={stats.pending === 0 && stats.failed === 0}
              >
                <Play size={16} />
                <span>{t('documentTranslator.actions.startTranslation')}</span>
              </button>
            ) : (
              <>
                <button 
                  className={`btn-secondary ${isPaused ? 'paused' : ''}`}
                  onClick={togglePause}
                >
                  {isPaused ? <Play size={16} /> : <Pause size={16} />}
                  <span>{isPaused ? t('documentTranslator.actions.resume') : t('documentTranslator.actions.pause')}</span>
                </button>
                <button 
                  className="btn-danger"
                  onClick={stopTranslation}
                >
                  <X size={16} />
                  <span>{t('documentTranslator.actions.stop')}</span>
                </button>
              </>
            )}
            
            {stats.failed > 0 && !isTranslating && (
              <button 
                className="btn-secondary"
                onClick={retryAllFailed}
              >
                <RefreshCw size={16} />
                <span>{t('documentTranslator.actions.retryFailed', { count: stats.failed })}</span>
              </button>
            )}
          </div>
          
          <div className="control-right">
            {isTranslating && (
              <span className="translating-status">
                <Loader size={14} className="spinning" />
                {t('documentTranslator.footer.translatingStatus')} {stats.translating > 0 && `(${stats.completed + 1}/${stats.total - stats.skipped})`}
              </span>
            )}
          </div>
        </div>
      )}
      
      {/* 密码输入弹窗 */}
      {showPasswordModal && (
        <div className="password-modal-overlay" onClick={handlePasswordCancel}>
          <div className="password-modal" onClick={e => e.stopPropagation()}>
            <div className="password-modal-header">
              <Lock size={24} />
              <h3>{t('documentTranslator.password.title')}</h3>
            </div>
            <p className="password-modal-desc" dangerouslySetInnerHTML={{ 
              __html: t('documentTranslator.password.desc', { filename: pendingFile?.name }) 
            }} />
            <div className="password-input-group">
              <Key size={18} />
              <input
                type="password"
                placeholder={t('documentTranslator.password.placeholder')}
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handlePasswordSubmit()}
                autoFocus
              />
            </div>
            <div className="password-modal-actions">
              <button className="btn-secondary" onClick={handlePasswordCancel}>
                {t('documentTranslator.password.cancel')}
              </button>
              <button 
                className="btn-primary" 
                onClick={handlePasswordSubmit}
                disabled={!password}
              >
                {t('documentTranslator.password.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DocumentTranslator;
