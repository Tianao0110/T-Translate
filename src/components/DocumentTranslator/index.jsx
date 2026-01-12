// src/components/DocumentTranslator/index.jsx
// 文档翻译组件 - 沉浸式双语对照翻译

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  FileText, Upload, X, Play, Pause, RotateCcw, Download,
  ChevronDown, Settings, AlertCircle, CheckCircle, Clock,
  Loader, Eye, EyeOff, ArrowUp, Filter, FileDown, Trash2,
  SkipForward, RefreshCw, Languages, Zap
} from 'lucide-react';
import {
  parseDocument,
  batchSegments,
  estimateTokens,
  exportBilingual,
  exportTranslatedOnly,
  exportSRT,
  exportVTT,
  SUPPORTED_FORMATS,
} from '../../utils/document-parser.js';
import translationService from '../../services/translation.js';
import '../../styles/components/DocumentTranslator.css';

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
const SegmentItem = ({ segment, displayStyle, onRetry }) => {
  const statusIcon = {
    [STATUS.PENDING]: <Clock size={14} className="status-icon pending" />,
    [STATUS.TRANSLATING]: <Loader size={14} className="status-icon translating" />,
    [STATUS.COMPLETED]: <CheckCircle size={14} className="status-icon completed" />,
    [STATUS.ERROR]: <AlertCircle size={14} className="status-icon error" />,
    [STATUS.SKIPPED]: <SkipForward size={14} className="status-icon skipped" />,
  };

  const isSubtitle = segment.type === 'subtitle';

  return (
    <div className={`segment-item ${segment.status} ${displayStyle}`}>
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
  
  // 翻译状态
  const [isTranslating, setIsTranslating] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const pauseRef = useRef(false);
  const abortRef = useRef(false);
  
  // UI 状态
  const [displayStyle, setDisplayStyle] = useState('below');
  const [showFilters, setShowFilters] = useState(false);
  const [showExport, setShowExport] = useState(false);
  
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
  
  // 虚拟滚动
  const listRef = useRef(null);
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 50 });
  
  // 统计信息
  const stats = useMemo(() => {
    const total = segments.length;
    const completed = segments.filter(s => s.status === STATUS.COMPLETED).length;
    const failed = segments.filter(s => s.status === STATUS.ERROR).length;
    const skipped = segments.filter(s => s.status === STATUS.SKIPPED).length;
    const pending = segments.filter(s => s.status === STATUS.PENDING).length;
    const translating = segments.filter(s => s.status === STATUS.TRANSLATING).length;
    const totalTokens = segments.reduce((sum, s) => sum + (s.tokens || 0), 0);
    const progress = total > 0 ? Math.round((completed / (total - skipped)) * 100) : 0;
    
    return { total, completed, failed, skipped, pending, translating, totalTokens, progress };
  }, [segments]);

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
  const loadFile = useCallback(async (file) => {
    console.log('[DocumentTranslator] loadFile called:', file.name);
    setIsLoading(true);
    
    try {
      const result = await parseDocument(file, {
        maxCharsPerSegment: 800,
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
        });
        setSegments(result.segments);
        notify?.(`文件加载成功：${result.segments.length} 个段落`, 'success');
      } else if (result.needPassword) {
        notify?.('该文件需要密码，暂不支持', 'warning');
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
    
    const pendingSegments = segments.filter(s => s.status === STATUS.PENDING || s.status === STATUS.ERROR);
    
    for (let i = 0; i < pendingSegments.length; i++) {
      // 检查暂停/中止
      if (abortRef.current) break;
      while (pauseRef.current) {
        await new Promise(resolve => setTimeout(resolve, 100));
        if (abortRef.current) break;
      }
      if (abortRef.current) break;
      
      const segment = pendingSegments[i];
      
      // 更新状态为翻译中
      setSegments(prev => prev.map(s => 
        s.id === segment.id ? { ...s, status: STATUS.TRANSLATING } : s
      ));
      
      try {
        // 调用翻译服务 - 注意：translate(text, options) 第二个参数是对象
        const result = await translationService.translate(segment.original, {
          sourceLang,
          targetLang,
        });
        
        console.log('[DocumentTranslator] Translation result:', result);
        
        if (result.success) {
          // 翻译服务返回 result.text，不是 result.translatedText
          setSegments(prev => prev.map(s => 
            s.id === segment.id ? { 
              ...s, 
              status: STATUS.COMPLETED, 
              translated: result.text || result.translatedText || '',
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
      
      // 小延迟，避免请求过快
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    setIsTranslating(false);
    if (!abortRef.current) {
      notify?.('翻译完成', 'success');
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
  const handleExport = (type) => {
    if (segments.length === 0) return;
    
    let content = '';
    let filename = document?.filename?.replace(/\.[^.]+$/, '') || 'translated';
    let ext = 'txt';
    
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
    }
    
    // 下载文件
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = window.document.createElement('a');
    a.href = url;
    a.download = `${filename}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
    
    setShowExport(false);
    notify?.('导出成功', 'success');
  };

  // 清空文档
  const clearDocument = () => {
    if (isTranslating) {
      stopTranslation();
    }
    setDocument(null);
    setSegments([]);
  };

  // 滚动处理（虚拟滚动）
  const handleScroll = useCallback((e) => {
    const container = e.target;
    const scrollTop = container.scrollTop;
    const itemHeight = 120; // 估算每项高度
    const visibleCount = Math.ceil(container.clientHeight / itemHeight) + 10;
    const start = Math.max(0, Math.floor(scrollTop / itemHeight) - 5);
    const end = Math.min(segments.length, start + visibleCount);
    
    setVisibleRange({ start, end });
  }, [segments.length]);

  // 滚动到顶部
  const scrollToTop = () => {
    listRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
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
                    <button onClick={() => handleExport('bilingual-txt')}>
                      <FileDown size={14} /> 双语 TXT
                    </button>
                    <button onClick={() => handleExport('bilingual-md')}>
                      <FileDown size={14} /> 双语 Markdown
                    </button>
                    <button onClick={() => handleExport('translated-only')}>
                      <FileDown size={14} /> 仅译文
                    </button>
                    {segments[0]?.type === 'subtitle' && (
                      <>
                        <div className="export-divider" />
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
                  accept=".txt,.md,.srt,.vtt"
                  onChange={handleFileSelect}
                  style={{ display: 'none' }}
                />
              </>
            )}
          </div>
        )}

        {/* 有文件时显示翻译界面 */}
        {document && (
          <>
            {/* 文件信息栏 */}
            <div className="dt-file-info">
              <div className="file-details">
                <FileText size={18} />
                <span className="filename">{document.filename}</span>
                <span className="format-badge">{document.formatName}</span>
                <span className="stats">
                  {stats.total} 段 · {document.stats?.totalChars?.toLocaleString()} 字 · ~{stats.totalTokens.toLocaleString()} tokens
                </span>
              </div>
              <button className="clear-btn" onClick={clearDocument} title="清除文件">
                <Trash2 size={16} />
              </button>
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
                  {stats.skipped > 0 && ` · 跳过 ${stats.skipped}`}
                  {stats.failed > 0 && <span className="failed"> · 失败 {stats.failed}</span>}
                </span>
              </div>
            </div>

            {/* 段落列表 */}
            <div 
              className="dt-segments" 
              ref={listRef}
              onScroll={handleScroll}
            >
              {/* 虚拟滚动占位 */}
              <div style={{ height: visibleRange.start * 120 }} />
              
              {segments.slice(visibleRange.start, visibleRange.end).map(segment => (
                <SegmentItem
                  key={segment.id}
                  segment={segment}
                  displayStyle={displayStyle}
                  onRetry={retrySegment}
                />
              ))}
              
              {/* 虚拟滚动占位 */}
              <div style={{ height: (segments.length - visibleRange.end) * 120 }} />
            </div>

            {/* 滚动到顶部 */}
            {visibleRange.start > 5 && (
              <button className="scroll-top-btn" onClick={scrollToTop}>
                <ArrowUp size={18} />
              </button>
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
    </div>
  );
};

export default DocumentTranslator;
