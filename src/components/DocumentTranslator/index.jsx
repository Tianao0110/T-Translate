// src/components/DocumentTranslator/index.jsx
// 文档翻译组件 - 沉浸式双语对照翻译

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  FileText, Upload, X, Play, Pause, RotateCcw, Download,
  ChevronDown, ChevronRight, Settings, AlertCircle, CheckCircle, Clock,
  Loader, Eye, EyeOff, ArrowUp, Filter, FileDown, Trash2,
  SkipForward, RefreshCw, Languages, Zap, Lock, Key,
  List, Hash, DollarSign, Database, BookOpen, ChevronLeft
} from 'lucide-react';
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

// 显示样式
const DISPLAY_STYLES = [
  { id: 'below', name: '上下对照', icon: '⬇️' },
  { id: 'side-by-side', name: '左右对照', icon: '⬛' },
  { id: 'source-only', name: '仅原文', icon: '📄' },
  { id: 'translated-only', name: '仅译文', icon: '🌐' },
];

/**
 * 单个段落组件
 */
const SegmentItem = React.memo(({ segment, displayStyle, onRetry }) => {
  const statusIcon = {
    [STATUS.PENDING]: <Clock size={14} className="status-icon pending" />,
    [STATUS.TRANSLATING]: <Loader size={14} className="status-icon translating" />,
    [STATUS.COMPLETED]: <CheckCircle size={14} className="status-icon completed" />,
    [STATUS.ERROR]: <AlertCircle size={14} className="status-icon error" />,
    [STATUS.SKIPPED]: <SkipForward size={14} className="status-icon skipped" />,
  };

  const isSubtitle = segment.type === 'subtitle';

  return (
    <div 
      className={`segment-item ${segment.status} ${displayStyle}`}
      data-segment-id={segment.id}
    >
      {/* 段落序号和状态 */}
      <div className="segment-header">
        <span className="segment-index">#{segment.id + 1}</span>
        {statusIcon[segment.status]}
        {segment.status === STATUS.SKIPPED && segment.filterReason && (
          <span className="skip-reason">{segment.filterReason}</span>
        )}
        {isSubtitle && (
          <span className="timecode">{segment.timecode}</span>
        )}
        {segment.status === STATUS.ERROR && (
          <button className="retry-btn" onClick={() => onRetry(segment.id)} title="重试">
            <RotateCcw size={12} />
          </button>
        )}
      </div>

      {/* 原文 */}
      {displayStyle !== 'translated-only' && (
        <div className="segment-original">
          {segment.original}
        </div>
      )}

      {/* 译文 */}
      {displayStyle !== 'source-only' && segment.status !== STATUS.SKIPPED && (
        <div className={`segment-translated ${segment.status}`}>
          {segment.status === STATUS.TRANSLATING && (
            <span className="translating-hint">
              <Loader size={14} className="spinning" /> 翻译中...
            </span>
          )}
          {segment.status === STATUS.COMPLETED && segment.translated}
          {segment.status === STATUS.ERROR && (
            <span className="error-hint">
              <AlertCircle size={14} /> {segment.error || '翻译失败'}
            </span>
          )}
          {segment.status === STATUS.PENDING && (
            <span className="pending-hint">等待翻译</span>
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

/**
 * 主组件
 */
const DocumentTranslator = ({ 
  onClose, 
  notify,
  sourceLang = 'auto',
  targetLang = 'zh',
}) => {
  // 文件状态
  const [document, setDocument] = useState(null);
  const [segments, setSegments] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  
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
    const progress = total > 0 ? Math.round((completed / (total - skipped)) * 100) : 0;
    
    // 缓存命中数
    const cacheHits = segments.filter(s => s.fromCache).length;
    
    return { 
      total, completed, failed, skipped, pending, translating, 
      totalTokens, usedTokens, progress, cacheHits 
    };
  }, [segments]);

  // 计时器
  useEffect(() => {
    let timer;
    if (isTranslating && !isPaused && startTime) {
      timer = setInterval(() => {
        setElapsedTime(Math.floor((Date.now() - startTime) / 1000));
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [isTranslating, isPaused, startTime]);

  // 格式化时间
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // 处理文件拖放
  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  // 加载文件（放在前面，供其他函数调用）
  const loadFile = useCallback(async (file, filePassword = null) => {
    console.log('[DocumentTranslator] loadFile called:', file.name, filePassword ? '(with password)' : '');
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
      
      console.log('[DocumentTranslator] parseDocument result:', result);
      
      if (result.success) {
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
        notify?.(`文件加载成功：${result.segments.length} 个段落${result.pageCount ? ` (${result.pageCount} 页)` : ''}`, 'success');
      } else if (result.needPassword) {
        // 需要密码，显示密码弹窗
        setPendingFile(file);
        setShowPasswordModal(true);
        setIsLoading(false);
        if (filePassword) {
          notify?.('密码错误，请重试', 'error');
        }
        return;
      } else {
        notify?.(result.error || '文件解析失败', 'error');
      }
    } catch (error) {
      console.error('[DocumentTranslator] Error:', error);
      notify?.(error.message, 'error');
    } finally {
      setIsLoading(false);
    }
  }, [filters, targetLang, notify]);

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
    
    console.log('[DocumentTranslator] File dropped:', e.dataTransfer.files);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      console.log('[DocumentTranslator] Loading dropped file:', file.name);
      await loadFile(file);
    }
  }, [loadFile]);

  // 选择文件
  const handleFileSelect = useCallback(async (e) => {
    console.log('[DocumentTranslator] File selected:', e.target.files);
    const file = e.target.files?.[0];
    if (file) {
      console.log('[DocumentTranslator] Loading file:', file.name, file.type, file.size);
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
      notify?.('翻译完成（全部来自缓存）', 'success');
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
      notify?.('翻译完成', 'success');
    }
  };

  // 批量翻译模式
  const translateBatchMode = async (toTranslate) => {
    // 获取术语表（如果启用）
    const glossary = useGlossary ? getGlossaryTerms() : [];
    if (glossary.length > 0) {
      console.log(`[DocumentTranslator] Using glossary with ${glossary.length} terms`);
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
        console.log(`[DocumentTranslator] Batch ${Math.floor(i/batchSize) + 1}: translating ${batch.length} segments`);
        
        const result = await translationService.translateBatch(batchTexts, {
          sourceLang,
          targetLang,
          maxBatchSize: batchSize,
          glossary,  // 传递术语表
        });
        
        if (result.success && result.results) {
          // 更新每个段落的状态
          result.results.forEach((r, idx) => {
            const segment = batch[idx];
            const cacheKey = `${segment.original}|${sourceLang}|${targetLang}`;
            
            if (r.success) {
              // 保存到缓存
              translationCache.current.set(cacheKey, r.text);
              
              setSegments(prev => prev.map(s => 
                s.id === segment.id ? { 
                  ...s, 
                  status: STATUS.COMPLETED, 
                  translated: r.text,
                } : s
              ));
            } else {
              setSegments(prev => prev.map(s => 
                s.id === segment.id ? { 
                  ...s, 
                  status: STATUS.ERROR, 
                  error: r.error || '翻译失败',
                } : s
              ));
            }
          });
        } else {
          // 批量翻译失败，标记所有为错误
          setSegments(prev => prev.map(s => 
            batchIds.includes(s.id) ? { 
              ...s, 
              status: STATUS.ERROR, 
              error: result.error || '批量翻译失败',
            } : s
          ));
        }
      } catch (error) {
        console.error('[DocumentTranslator] Batch translation error:', error);
        setSegments(prev => prev.map(s => 
          batchIds.includes(s.id) ? { 
            ...s, 
            status: STATUS.ERROR, 
            error: error.message,
          } : s
        ));
      }
      
      // 批次间小延迟
      if (i + batchSize < toTranslate.length) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }
  };

  // 单条翻译模式
  const translateSingleMode = async (toTranslate) => {
    for (let i = 0; i < toTranslate.length; i++) {
      if (abortRef.current) break;
      
      // 暂停检查
      while (pauseRef.current) {
        await new Promise(resolve => setTimeout(resolve, 100));
        if (abortRef.current) break;
      }
      if (abortRef.current) break;
      
      const segment = toTranslate[i];
      
      // 更新状态为翻译中
      setSegments(prev => prev.map(s => 
        s.id === segment.id ? { ...s, status: STATUS.TRANSLATING } : s
      ));
      
      try {
        const result = await translationService.translate(segment.original, {
          sourceLang,
          targetLang,
        });
        
        if (result.success) {
          const translatedText = result.text || result.translatedText || '';
          const cacheKey = `${segment.original}|${sourceLang}|${targetLang}`;
          translationCache.current.set(cacheKey, translatedText);
          
          setSegments(prev => prev.map(s => 
            s.id === segment.id ? { 
              ...s, 
              status: STATUS.COMPLETED, 
              translated: translatedText,
            } : s
          ));
        } else {
          throw new Error(result.error || '翻译失败');
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
      
      // 小延迟
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  };

  // 暂停翻译
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
        notify?.('重试成功', 'success');
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
      notify?.('重试失败: ' + error.message, 'error');
    }
  };

  // 重试所有失败
  const retryAllFailed = async () => {
    const failedIds = segments.filter(s => s.status === STATUS.ERROR).map(s => s.id);
    for (const id of failedIds) {
      await retrySegment(id);
    }
  };

  // 导出
  const handleExport = async (type) => {
    if (segments.length === 0) return;
    
    let content = '';
    let filename = document?.filename?.replace(/\.[^.]+$/, '') || 'translated';
    let ext = 'txt';
    let blob = null;
    
    try {
      switch (type) {
        case 'bilingual-txt':
          content = exportBilingual(segments, { style: 'below' });
          filename += '_双语';
          break;
        case 'bilingual-md':
          content = exportBilingual(segments, { style: 'below', format: 'md' });
          filename += '_双语';
          ext = 'md';
          break;
        case 'translated-only':
          content = exportTranslatedOnly(segments);
          filename += '_译文';
          break;
        case 'srt':
          content = exportSRT(segments);
          filename += '_translated';
          ext = 'srt';
          break;
        case 'vtt':
          content = exportVTT(segments);
          filename += '_translated';
          ext = 'vtt';
          break;
        case 'docx':
          blob = exportDOCX(segments, { 
            style: 'bilingual', 
            title: document?.filename || '翻译文档' 
          });
          filename += '_双语';
          ext = 'doc';
          break;
        case 'docx-translated':
          blob = exportDOCX(segments, { 
            style: 'translated-only', 
            title: document?.filename || '翻译文档' 
          });
          filename += '_译文';
          ext = 'doc';
          break;
        case 'pdf':
          // 生成 HTML 并打开打印对话框
          const pdfHtml = exportPDFHTML(segments, { 
            style: 'bilingual', 
            title: document?.filename || '翻译文档' 
          });
          const printWindow = window.open('', '_blank', 'width=800,height=600');
          printWindow.document.write(pdfHtml);
          printWindow.document.close();
          printWindow.onload = () => {
            printWindow.print();
          };
          setShowExport(false);
          notify?.('请在打印对话框中选择"保存为 PDF"', 'info');
          return;
        default:
          return;
      }
      
      // 下载文件
      if (!blob) {
        blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      }
      const url = URL.createObjectURL(blob);
      const a = window.document.createElement('a');
      a.href = url;
      a.download = `${filename}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
      
      setShowExport(false);
      notify?.('导出成功', 'success');
    } catch (error) {
      console.error('[DocumentTranslator] Export error:', error);
      notify?.(`导出失败: ${error.message}`, 'error');
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
    notify?.('翻译记忆缓存已清除', 'success');
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
          <span>文档翻译</span>
        </div>
        <div className="dt-actions">
          {document && (
            <>
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
                  <span>导出</span>
                  <ChevronDown size={14} />
                </button>
                {showExport && (
                  <div className="export-menu">
                    <div className="export-section-title">文本格式</div>
                    <button onClick={() => handleExport('bilingual-txt')}>
                      <FileDown size={14} /> 双语 TXT
                    </button>
                    <button onClick={() => handleExport('bilingual-md')}>
                      <FileDown size={14} /> 双语 Markdown
                    </button>
                    <button onClick={() => handleExport('translated-only')}>
                      <FileDown size={14} /> 仅译文 TXT
                    </button>
                    
                    <div className="export-divider" />
                    <div className="export-section-title">文档格式</div>
                    <button onClick={() => handleExport('docx')}>
                      <FileText size={14} /> 双语 Word (.doc)
                    </button>
                    <button onClick={() => handleExport('docx-translated')}>
                      <FileText size={14} /> 仅译文 Word (.doc)
                    </button>
                    <button onClick={() => handleExport('pdf')}>
                      <FileText size={14} /> 导出 PDF (打印)
                    </button>
                    
                    {segments[0]?.type === 'subtitle' && (
                      <>
                        <div className="export-divider" />
                        <div className="export-section-title">字幕格式</div>
                        <button onClick={() => handleExport('srt')}>
                          <FileDown size={14} /> SRT 字幕
                        </button>
                        <button onClick={() => handleExport('vtt')}>
                          <FileDown size={14} /> VTT 字幕
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
                <p>正在解析文件...</p>
              </div>
            ) : (
              <>
                <Upload size={48} />
                <h3>拖放文件到这里</h3>
                <p>或点击选择文件</p>
                <p className="format-hint">支持：{supportedExtensions}</p>
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
            {/* 文件信息栏 */}
            <div className="dt-file-info">
              <div className="file-details">
                <FileText size={18} />
                <span className="filename">{document.filename}</span>
                <span className="format-badge">{document.formatName}</span>
                <span 
                  className="stats clickable" 
                  onClick={() => setShowStats(!showStats)}
                  title="点击查看详细统计"
                >
                  {stats.total} 段 · {document.stats?.totalChars?.toLocaleString() || 0} 字 · ~{stats.totalTokens?.toLocaleString()} tokens
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
                  已完成 {stats.completed}/{stats.total - stats.skipped}
                  {stats.skipped > 0 && <span> · 跳过 {stats.skipped}</span>}
                  {stats.failed > 0 && <span className="failed"> · 失败 {stats.failed}</span>}
                  {stats.cacheHits > 0 && <span className="cache-hits"> · 缓存 {stats.cacheHits}</span>}
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
                    <span>大纲</span>
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
                    <span>📊 详细统计</span>
                    <button className="close-btn" onClick={() => setShowStats(false)}>
                      <X size={14} />
                    </button>
                  </div>
                  <div className="stats-popup-content">
                    <div className="stats-grid">
                      <div className="stat-card">
                        <span className="stat-number">{stats.total}</span>
                        <span className="stat-desc">总段落</span>
                      </div>
                      <div className="stat-card completed">
                        <span className="stat-number">{stats.completed}</span>
                        <span className="stat-desc">已翻译</span>
                      </div>
                      <div className="stat-card">
                        <span className="stat-number">{stats.pending}</span>
                        <span className="stat-desc">待翻译</span>
                      </div>
                      <div className="stat-card skipped">
                        <span className="stat-number">{stats.skipped}</span>
                        <span className="stat-desc">已跳过</span>
                      </div>
                      {stats.failed > 0 && (
                        <div className="stat-card error">
                          <span className="stat-number">{stats.failed}</span>
                          <span className="stat-desc">失败</span>
                        </div>
                      )}
                      {stats.cacheHits > 0 && (
                        <div className="stat-card cache">
                          <span className="stat-number">{stats.cacheHits}</span>
                          <span className="stat-desc">缓存命中</span>
                        </div>
                      )}
                    </div>
                    
                    <div className="stats-detail">
                      <div className="detail-row">
                        <span>总字符</span>
                        <span>{document.stats?.totalChars?.toLocaleString() || 0}</span>
                      </div>
                      <div className="detail-row">
                        <span>预估 Tokens</span>
                        <span>{stats.totalTokens?.toLocaleString()}</span>
                      </div>
                      <div className="detail-row">
                        <span>已用 Tokens</span>
                        <span>{stats.usedTokens?.toLocaleString()}</span>
                      </div>
                      {elapsedTime > 0 && (
                        <div className="detail-row">
                          <span>翻译用时</span>
                          <span>{formatTime(elapsedTime)}</span>
                        </div>
                      )}
                    </div>
                    
                    <div className="stats-footer">
                      <button className="cache-btn" onClick={clearCache}>
                        <Database size={12} /> 清除缓存 ({translationCache.current?.size || 0})
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
              <span>{sourceLang === 'auto' ? '自动' : sourceLang} → {targetLang}</span>
            </div>
            {/* 批量模式开关 */}
            <label className="batch-mode-toggle" title={batchMode ? `批量模式：每次翻译 ${batchSize} 段，速度更快` : '逐条模式：一段一段翻译，更稳定'}>
              <input 
                type="checkbox" 
                checked={batchMode}
                onChange={(e) => setBatchMode(e.target.checked)}
                disabled={isTranslating}
              />
              <Zap size={14} />
              <span>批量</span>
            </label>
            {/* 术语表开关 */}
            <label 
              className="batch-mode-toggle glossary-toggle" 
              title={useGlossary ? '术语表已启用' : '术语表已禁用'}
            >
              <input 
                type="checkbox" 
                checked={useGlossary}
                onChange={(e) => setUseGlossary(e.target.checked)}
                disabled={isTranslating}
              />
              <BookOpen size={14} />
              <span>术语</span>
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
                <span>开始翻译</span>
              </button>
            ) : (
              <>
                <button 
                  className={`btn-secondary ${isPaused ? 'paused' : ''}`}
                  onClick={togglePause}
                >
                  {isPaused ? <Play size={16} /> : <Pause size={16} />}
                  <span>{isPaused ? '继续' : '暂停'}</span>
                </button>
                <button 
                  className="btn-danger"
                  onClick={stopTranslation}
                >
                  <X size={16} />
                  <span>停止</span>
                </button>
              </>
            )}
            
            {stats.failed > 0 && !isTranslating && (
              <button 
                className="btn-secondary"
                onClick={retryAllFailed}
              >
                <RefreshCw size={16} />
                <span>重试失败 ({stats.failed})</span>
              </button>
            )}
          </div>
          
          <div className="control-right">
            {isTranslating && (
              <span className="translating-status">
                <Loader size={14} className="spinning" />
                翻译中 {stats.translating > 0 && `(${stats.completed + 1}/${stats.total - stats.skipped})`}
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
              <h3>文件已加密</h3>
            </div>
            <p className="password-modal-desc">
              文件 <strong>{pendingFile?.name}</strong> 需要密码才能打开
            </p>
            <div className="password-input-group">
              <Key size={18} />
              <input
                type="password"
                placeholder="请输入密码"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handlePasswordSubmit()}
                autoFocus
              />
            </div>
            <div className="password-modal-actions">
              <button className="btn-secondary" onClick={handlePasswordCancel}>
                取消
              </button>
              <button 
                className="btn-primary" 
                onClick={handlePasswordSubmit}
                disabled={!password}
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DocumentTranslator;
