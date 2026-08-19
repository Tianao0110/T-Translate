import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FileText, Upload, X, Play, Pause, RotateCcw, Download,
  ChevronUp, ChevronDown, ChevronRight, AlertCircle, CheckCircle, Clock,
  Loader, ArrowUp, FileDown,
  SkipForward, RefreshCw, Zap, Lock, Key,
  Database, BookOpen, BarChart3,
  Edit3, Check, Copy, Search, Rows2, Columns2, Lightbulb, ClipboardList
} from 'lucide-react';
import createLogger from '../../utils/logger.js';
import {
  parseDocument,
  exportBilingual,
  exportTranslatedOnly,
  exportSRT,
  exportVTT,
  exportDOCX,
  exportPDFHTML,
  SUPPORTED_FORMATS,
} from '../../utils/document-parser.js';
import translationService from '../../services/stack-client.js';
import useTranslationStore from '../../stores/translation-store';
import { LANGUAGES, PRIVACY_MODES } from '../../config/constants.js';
import useVisibleHotkey from '../../hooks/use-visible-hotkey.js';
import LanguagePicker from '../shared/LanguagePicker.jsx';
import useAiActions from '../../hooks/use-ai-actions.js';
import { runAiAction } from '../../services/ai-action-runner.js';
import { getAiAction } from '../../config/ai-actions.js';
import { mergeLanguages, customCodesOf } from '../../config/custom-languages.js';
import './styles.css';

// Segment status
const STATUS = {
  PENDING: 'pending',
  TRANSLATING: 'translating',
  COMPLETED: 'completed',
  ERROR: 'error',
  SKIPPED: 'skipped',
};

// Settings are read at action time (mount/parse/translate) rather than
// subscribed: the settings panel persists to electron-store, and a fresh
// read per action stays in sync without a remount or IPC listener.
const DOC_SETTINGS_DEFAULTS = {
  maxCharsPerSegment: 800,
  concurrency: 2,
  displayStyle: 'below',
  filters: { skipShort: true, minLength: 10, skipNumbers: true, skipCode: true, skipTargetLang: true },
};

async function readDocumentSettings() {
  let saved = null;
  try {
    if (window.electron?.store) {
      saved = await window.electron.store.get('settings.document');
    } else {
      saved = JSON.parse(localStorage.getItem('settings') || '{}')?.document;
    }
  } catch { /* fall back to defaults */ }

  const clampInt = (value, min, max, fallback) =>
    Number.isFinite(value) ? Math.min(Math.max(Math.round(value), min), max) : fallback;

  return {
    maxCharsPerSegment: clampInt(saved?.maxCharsPerSegment, 200, 2000, DOC_SETTINGS_DEFAULTS.maxCharsPerSegment),
    concurrency: clampInt(saved?.concurrency, 1, 6, DOC_SETTINGS_DEFAULTS.concurrency),
    displayStyle: ['below', 'side-by-side'].includes(saved?.displayStyle)
      ? saved.displayStyle
      : DOC_SETTINGS_DEFAULTS.displayStyle,
    filters: { ...DOC_SETTINGS_DEFAULTS.filters, ...(saved?.filters || {}) },
  };
}

// Progress persistence
const PROGRESS_KEY = 'dt_progress_';
const PROGRESS_TTL_MS = 7 * 86400000;

function getFileFingerprint(file) {
  return `${file.name}_${file.size}_${file.lastModified}`;
}

function saveProgress(fp, segments, sLang, tLang) {
  try {
    const data = { ts: Date.now(), sLang, tLang,
      segs: segments.filter(s => s.status === STATUS.COMPLETED).map(s => ({ id: s.id, t: s.translated }))
    };
    localStorage.setItem(PROGRESS_KEY + fp, JSON.stringify(data));
  } catch { /* localStorage full */ }
}

function loadProgress(fp) {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY + fp);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (Date.now() - data.ts > PROGRESS_TTL_MS) { localStorage.removeItem(PROGRESS_KEY + fp); return null; }
    return data;
  } catch { return null; }
}

// loadProgress only ever cleans the key of a file the user re-opens;
// abandoned files would pile up against the ~5MB localStorage quota until
// saveProgress starts failing silently.
function sweepExpiredProgress() {
  try {
    const now = Date.now();
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (!key?.startsWith(PROGRESS_KEY)) continue;
      try {
        const { ts } = JSON.parse(localStorage.getItem(key));
        if (!ts || now - ts > PROGRESS_TTL_MS) localStorage.removeItem(key);
      } catch {
        localStorage.removeItem(key);
      }
    }
  } catch { /* localStorage unavailable */ }
}

const SegmentItem = React.memo(({ segment, displayStyle, onRetry, onRetranslate, onEdit, onCopy, searchQuery, t,
  onExplain, aiNote, aiRunning, canExplain }) => {
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

  // Highlight search matches. split() with a capture group puts matches at
  // odd indices — testing parts against a /g regex would skip alternate
  // matches via its persisting lastIndex.
  const highlightText = (text) => {
    if (!searchQuery || !text) return text;
    try {
      const escaped = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
      return parts.map((part, i) => i % 2 === 1 ? <mark key={i} className="search-highlight">{part}</mark> : part);
    } catch { return text; }
  };

  return (
    <div 
      className={`segment-item ${segment.status} ${displayStyle} ${segment.edited ? 'edited' : ''}`}
      data-segment-id={segment.id}
    >
      {/* index + status */}
      <div className="segment-header">
        <span className="segment-index">#{segment.id + 1}</span>
        {statusIcon[segment.status]}
        {segment.edited && <span className="edited-badge" title={t('documentTranslator.segment.edited')}><Edit3 size={11} /></span>}
        {segment.status === STATUS.SKIPPED && segment.filterReason && (
          <span className="skip-reason">{segment.filterReason}</span>
        )}
        {isSubtitle && <span className="timecode">{segment.timecode}</span>}
        
        {/* per-segment actions */}
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

            </>
          )}
          {/* Outside the status branches on purpose: an explanation is built
              from the source paragraph, so needing one has nothing to do with
              whether the translation has arrived. */}
          {canExplain && segment.status !== STATUS.SKIPPED && (
            <button
              className={`seg-btn ${aiNote ? 'has-note' : ''}`}
              onClick={() => onExplain(segment)}
              disabled={aiRunning}
              title={t('documentTranslator.segment.explain', '讲解这一段')}
            >
              {aiRunning ? <Loader size={12} className="spinning" /> : <Lightbulb size={12} />}
            </button>
          )}
        </div>
      </div>

      {/* source */}
      <div className="segment-original">
        {highlightText(segment.original)}
      </div>

      {/* An explanation stays with the paragraph it belongs to. */}
      {aiNote && (
        <div className="segment-ai-note">
          <div className="segment-ai-label">
            <Lightbulb size={11} />
            {t('aiActions.explain.name')}
          </div>
          <div className="segment-ai-body">{aiNote}</div>
        </div>
      )}

      {/* translation */}
      {segment.status !== STATUS.SKIPPED && (
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

const logger = createLogger('DocTranslator');

const DocumentTranslator = ({ 
  notify,
  sourceLang: initialSourceLang = 'auto',
  targetLang: initialTargetLang = 'zh',
}) => {
  const { t } = useTranslation();
  
  // Document-translator keeps its own language state, seeded from the
  // main UI but free to diverge.
  const [sourceLang, setSourceLang] = useState(initialSourceLang);
  const [targetLang, setTargetLang] = useState(initialTargetLang);
  
  const customLanguages = useTranslationStore(state => state.customLanguages);
  const languagePicker = useTranslationStore(state => state.languagePicker);
  const recordLanguageUse = useTranslationStore(state => state.recordLanguageUse);
  const recordLanguageBrowse = useTranslationStore(state => state.recordLanguageBrowse);

  // Source allows auto; target does not.
  // Same catalogue as the main panel, custom entries included — a language the
  // user added is a language they expect to see everywhere.
  const allLanguages = useMemo(() => mergeLanguages(LANGUAGES, customLanguages), [customLanguages]);
  const targetLanguages = useMemo(() => allLanguages.filter(l => l.code !== 'auto'), [allLanguages]);
  const sourceLanguages = allLanguages;
  const customCodes = useMemo(() => customCodesOf(customLanguages), [customLanguages]);
  
  const DISPLAY_STYLES = useMemo(() => [
    { id: 'below', name: t('documentTranslator.displayStyles.below'), icon: Rows2 },
    { id: 'side-by-side', name: t('documentTranslator.displayStyles.sideBySide'), icon: Columns2 },
  ], [t]);
  
  // File state
  const [document, setDocument] = useState(null);
  const [segments, setSegments] = useState([]);

  // ===== AI actions on a document =====
  //
  // The shared hook is built around one active passage: it keeps a single
  // result per action and replaces it when the source text changes. A document
  // needs many notes alive at once, so only the capability probe and the
  // availability filter come from the hook — the notes are kept here, keyed by
  // segment.
  const { capabilities, availableActions } = useAiActions('document', null);
  const [aiNotes, setAiNotes] = useState({});
  const [aiRunningId, setAiRunningId] = useState(null);
  const [digest, setDigest] = useState(null);
  const [digestRunning, setDigestRunning] = useState(false);

  // The document surface has no understanding switch — asking about a
  // paragraph IS the request, so it opts in on the action's behalf.
  const documentActions = useMemo(
    () => availableActions({ understandMode: true, text: 'x' }),
    [availableActions]
  );
  const canExplain = documentActions.some((a) => a.id === 'explain');
  const noteCount = Object.keys(aiNotes).length;

  const explainSegment = useCallback(async (segment) => {
    const action = getAiAction('explain');
    if (!action || aiRunningId) return;
    setAiRunningId(segment.id);
    try {
      const result = await runAiAction(action, {
        sourceText: segment.original,
        translatedText: segment.translated || '',
        sourceLanguage: sourceLang,
        targetLanguage: targetLang,
        capabilities,
      });
      if (result.success) {
        setAiNotes((prev) => ({ ...prev, [segment.id]: result.content }));
      } else {
        notify(result.error || t('aiActions.failed'), 'error');
      }
    } finally {
      setAiRunningId(null);
    }
  }, [aiRunningId, sourceLang, targetLang, capabilities, notify, t]);

  const runDigest = useCallback(async () => {
    const action = getAiAction('digest');
    if (!action || digestRunning) return;
    // Document order, not the order they were opened — a note reads as a walk
    // through the document.
    const ordered = segments
      .filter((seg) => aiNotes[seg.id])
      .map((seg, i) => `${i + 1}. ${aiNotes[seg.id]}`)
      .join('\n\n');
    if (!ordered) return;

    setDigestRunning(true);
    try {
      const result = await runAiAction(action, {
        sourceText: ordered,
        sourceLanguage: sourceLang,
        targetLanguage: targetLang,
        capabilities,
      });
      if (result.success) setDigest(result.content);
      else notify(result.error || t('aiActions.failed'), 'error');
    } finally {
      setDigestRunning(false);
    }
  }, [digestRunning, segments, aiNotes, sourceLang, targetLang, capabilities, notify, t]);

  const [isLoading, setIsLoading] = useState(false);
  // { page, total, ocr } during PDF parse — OCR pages are slow enough to need feedback.
  const [parseProgress, setParseProgress] = useState(null);
  
  // Fingerprint used to key progress in localStorage.
  const fileFingerprint = useRef(null);
  
  // Outline navigation
  const [outline, setOutline] = useState([]);
  
  // In-memory translation memory for this session.
  const translationCache = useRef(new Map());
  
  // Translation lifecycle flags
  const [isTranslating, setIsTranslating] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const pauseRef = useRef(false);
  const abortRef = useRef(false);
  
  const [parallelMode, setParallelMode] = useState(true);
  // Wired to settings.document.concurrency in loadDocumentSettings below.
  const [concurrency, setConcurrency] = useState(2);
  const [useGlossary, setUseGlossary] = useState(true);
  
  const getGlossaryTerms = useTranslationStore(state => state.getGlossaryTerms);
  const translationMode = useTranslationStore(state => state.translationMode);

  // privacyMode/useCache no longer travel from here — the main-process stack
  // facade injects the live mode into every request (renderer values are
  // discarded by design). translationMode stays for the OCR allowlist below.
  const buildTranslateOptions = () => ({
    glossaryTerms: useGlossary ? getGlossaryTerms() : [],
  });
  
  const [startTime, setStartTime] = useState(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  
  // UI state
  const [displayStyle, setDisplayStyle] = useState('below');
  const [showExport, setShowExport] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  
  // Search & replace
  // -1 in matchIndex means "not yet positioned" — Enter / Next moves to 0,
  // Prev moves to last. matchIds is derived from query+segments via useMemo
  // (see below), so it stays in sync without resetting the cursor when
  // segments stream in during translation.
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMatchIndex, setSearchMatchIndex] = useState(-1);
  
  // Progress restore prompt
  const [pendingRestore, setPendingRestore] = useState(null);
  
  // Password modal
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [pendingFile, setPendingFile] = useState(null);
  const [password, setPassword] = useState('');
  
  // Seed concurrency + display style from settings once per mount; parse-time
  // and translate-time values are re-read fresh in loadFile/startTranslation.
  useEffect(() => {
    let alive = true;
    readDocumentSettings().then((ds) => {
      if (!alive) return;
      setConcurrency(ds.concurrency);
      setDisplayStyle(ds.displayStyle);
    });
    return () => { alive = false; };
  }, []);


  // Drop-zone refs
  const dropZoneRef = useRef(null);
  const fileInputRef = useRef(null);
  const [isDragOver, setIsDragOver] = useState(false);
  
  // Root + segment list refs (root drives the hidden-tab visibility check)
  const rootRef = useRef(null);
  const listRef = useRef(null);
  
  // Stats
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
    const translatable = total - skipped;
    const progress = translatable > 0 ? Math.round((completed / translatable) * 100) : 0;
    
    return { 
      total, completed, failed, skipped, pending, translating,
      totalTokens, usedTokens, cacheHits, edited, progress 
    };
  }, [segments]);

  // Timer effect
  useEffect(() => {
    let timer;
    if (isTranslating && startTime && !isPaused) {
      timer = setInterval(() => {
        setElapsedTime(Date.now() - startTime);
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [isTranslating, startTime, isPaused]);

  // Pure derivation so live segment updates (mid-translation) don't fight the
  // cursor — recomputes ids without touching searchMatchIndex.
  const searchMatchIds = useMemo(() => {
    if (!searchQuery) return [];
    const query = searchQuery.toLowerCase();
    return segments
      .filter(s => s.status === STATUS.COMPLETED && s.translated && s.translated.toLowerCase().includes(query))
      .map(s => s.id);
  }, [searchQuery, segments]);
  const searchMatchCount = searchMatchIds.length;

  // Only reset the cursor when the query itself changes. Streaming segment
  // updates leave the cursor where the user put it.
  useEffect(() => {
    setSearchMatchIndex(-1);
  }, [searchQuery]);

  // Latest segments for synchronous handlers (beforeunload).
  const segmentsRef = useRef(segments);
  useEffect(() => { segmentsRef.current = segments; }, [segments]);

  // Persist progress as it accumulates. Pre-0.2.9 this only fired after a
  // run finished, so a crash or quit mid-translation lost the whole run
  // (the L2 disk cache holds ~200 entries — no safety net for big docs).
  // Throttled so fast providers don't stringify the list per completion.
  const lastSaveRef = useRef(0);
  useEffect(() => {
    if (!fileFingerprint.current) return;
    if (stats.completed === 0 && stats.edited === 0) return;
    const now = Date.now();
    if (isTranslating && now - lastSaveRef.current < 3000) return;
    lastSaveRef.current = now;
    saveProgress(fileFingerprint.current, segments, sourceLang, targetLang);
  }, [stats.completed, stats.edited, isTranslating, segments, sourceLang, targetLang]);

  // Crash/quit safety net — synchronous flush of whatever completed.
  useEffect(() => {
    const flush = () => {
      if (fileFingerprint.current && segmentsRef.current.some(s => s.status === STATUS.COMPLETED)) {
        saveProgress(fileFingerprint.current, segmentsRef.current, sourceLang, targetLang);
      }
    };
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
  }, [sourceLang, targetLang]);

  // One-time cleanup of expired progress blobs.
  useEffect(() => { sweepExpiredProgress(); }, []);

  // Ctrl+F toggles in-document search (visibility-guarded: the component
  // stays mounted behind other tabs).
  useVisibleHotkey(
    rootRef,
    (e) => (e.ctrlKey || e.metaKey) && e.key === 'f',
    (e) => {
      if (!document) return;
      e.preventDefault();
      setShowSearch(prev => !prev);
    }
  );

  // Format elapsed time
  const formatTime = (ms) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}:${String(minutes % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    }
    return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
  };

  // Drag-drop handlers
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

  // Load file
  const loadFile = useCallback(async (file, filePassword = null) => {
    logger.debug('Loading file:', file.name, file.type, file.size);
    setIsLoading(true);
    
    try {
      const docSettings = await readDocumentSettings();
      const result = await parseDocument(file, {
        maxCharsPerSegment: docSettings.maxCharsPerSegment,
        password: filePassword,
        filters: {
          ...docSettings.filters,
          targetLang,
        },
        ocrRecognize: async (imageData) => {
          try {
            // Scanned-page OCR runs in the main-process stack; the privacy
            // mode's engine allowlist is injected there, not passed from here.
            return await translationService.ocr.recognize(imageData);
          } catch {
            return { success: false, error: 'OCR unavailable' };
          }
        },
        onProgress: setParseProgress,
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
        // Reset timer
        setStartTime(null);
        setElapsedTime(0);
        
        // Check for resumable progress
        const saved = loadProgress(fingerprint);
        if (saved && saved.segs.length > 0 && saved.sLang === sourceLang && saved.tLang === targetLang) {
          setPendingRestore(saved);
        } else {
          setPendingRestore(null);
        }
        
        // Notify user
        if (result.warning === 'scanned_no_ocr') {
          notify?.(t('documentTranslator.notify.scannedNoOcr'), 'warning');
        } else {
          const ocrNote = result.usedOcr ? ' (OCR)' : '';
          const message = result.pageCount
            ? t('documentTranslator.notify.fileLoadedWithPages', { count: result.segments.length, pages: result.pageCount }) + ocrNote
            : t('documentTranslator.notify.fileLoaded', { count: result.segments.length }) + ocrNote;
          notify?.(message, 'success');
          // PDF hint
          if (result.isPdf) {
            setTimeout(() => {
              notify?.(t('documentTranslator.notify.pdfHint'), 'info');
            }, 1500);
          }
        }
      } else if (result.needPassword) {
        // PDF requires a password — open the password modal.
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
      setParseProgress(null);
    }
  }, [sourceLang, targetLang, translationMode, notify, t]);

  // Submit password
  const handlePasswordSubmit = useCallback(async () => {
    if (!pendingFile || !password) return;
    await loadFile(pendingFile, password);
  }, [pendingFile, password, loadFile]);

  // Cancel password input
  const handlePasswordCancel = useCallback(() => {
    setShowPasswordModal(false);
    setPendingFile(null);
    setPassword('');
  }, []);

  // Drop file
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

  // Pick file
  const handleFileSelect = useCallback(async (e) => {
    logger.debug('File selected:', e.target.files);
    const file = e.target.files?.[0];
    if (file) {
      logger.debug('Loading file:', file.name, file.type, file.size);
      await loadFile(file);
    }
    e.target.value = null;
  }, [loadFile]);

  // Start translation
  const startTranslation = async () => {
    if (isTranslating) return;
    
    setIsTranslating(true);
    setIsPaused(false);
    pauseRef.current = false;
    abortRef.current = false;
    setStartTime(Date.now());
    
    // Collect pending segments
    let pendingSegments = segments.filter(s => s.status === STATUS.PENDING || s.status === STATUS.ERROR);
    
    // Fill in any cached translations up front — saves a round trip.
    const toTranslate = [];
    for (const segment of pendingSegments) {
      const cacheKey = `${segment.original}|${sourceLang}|${targetLang}`;
      const cachedTranslation = translationCache.current.get(cacheKey);
      
      if (cachedTranslation) {
        // Cache hit
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
    
    // Re-read so a settings change applies to the next run without remount.
    const docSettings = await readDocumentSettings();
    setConcurrency(docSettings.concurrency);
    await translateWithPool(toTranslate, parallelMode ? docSettings.concurrency : 1);

    setIsTranslating(false);
    if (!abortRef.current) {
      notify?.(t('documentTranslator.notify.translationComplete'), 'success');
    }
  };

  // Worker pool over single-segment translation. Each segment gets its own
  // success/error state, so a failed item can't masquerade as completed the
  // way joined-batch responses could. Concurrency stays low by default:
  // local LLMs serialize on the GPU, so more in-flight calls only add
  // queueing (same calibration as pipeline.js scattered mode).
  const translateWithPool = async (toTranslate, poolSize) => {
    let cursor = 0;
    const worker = async () => {
      for (;;) {
        while (pauseRef.current && !abortRef.current) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        if (abortRef.current) return;
        const index = cursor++;
        if (index >= toTranslate.length) return;
        await translateSingleSegment(toTranslate[index]);
      }
    };
    await Promise.all(
      Array.from({ length: Math.max(1, poolSize) }, () => worker())
    );
  };

  const translateSingleSegment = async (segment) => {
    setSegments(prev => prev.map(s => 
      s.id === segment.id ? { ...s, status: STATUS.TRANSLATING } : s
    ));
    
    try {
      const result = await translationService.translate(segment.original, {
        sourceLang,
        targetLang,
        ...buildTranslateOptions(),
      });

      const translated = result.success ? (result.text || result.translatedText || '') : '';
      if (!translated) {
        throw new Error(result.error || 'Empty translation result');
      }
      const cacheKey = `${segment.original}|${sourceLang}|${targetLang}`;
      translationCache.current.set(cacheKey, translated);

      setSegments(prev => prev.map(s =>
        s.id === segment.id ? {
          ...s,
          status: STATUS.COMPLETED,
          translated,
        } : s
      ));
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

  // Pause / resume. The elapsed timer derives from startTime, so resuming
  // shifts the epoch forward by the paused span — otherwise pause time
  // counts as translation time.
  const pausedAtRef = useRef(null);
  const togglePause = () => {
    const next = !pauseRef.current;
    pauseRef.current = next;
    setIsPaused(next);
    if (next) {
      pausedAtRef.current = Date.now();
    } else if (pausedAtRef.current) {
      setStartTime(prev => prev + (Date.now() - pausedAtRef.current));
      pausedAtRef.current = null;
    }
  };

  // Stop translation
  const stopTranslation = () => {
    abortRef.current = true;
    pauseRef.current = false;
    pausedAtRef.current = null;
    setIsPaused(false);
    setIsTranslating(false);
  };

  // Retry one segment
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
        ...buildTranslateOptions(),
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

  // Retry all failed
  const retryAllFailed = async () => {
    const failedIds = segments.filter(s => s.status === STATUS.ERROR).map(s => s.id);
    for (const id of failedIds) {
      await retrySegment(id);
    }
  };

  // Re-translate a completed segment
  const retranslateSegment = async (segmentId) => {
    const segment = segments.find(s => s.id === segmentId);
    if (!segment || segment.status !== STATUS.COMPLETED) return;
    const cacheKey = `${segment.original}|${sourceLang}|${targetLang}`;
    translationCache.current.delete(cacheKey);
    setSegments(prev => prev.map(s => s.id === segmentId ? { ...s, status: STATUS.TRANSLATING, edited: false } : s));
    try {
      const result = await translationService.translate(segment.original, { sourceLang, targetLang, ...buildTranslateOptions() });
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

  // Edit segment translation
  const editSegment = useCallback((segmentId, newText) => {
    setSegments(prev => prev.map(s => s.id === segmentId ? { ...s, translated: newText, edited: true } : s));
    const segment = segments.find(s => s.id === segmentId);
    if (segment) {
      const cacheKey = `${segment.original}|${sourceLang}|${targetLang}`;
      translationCache.current.set(cacheKey, newText);
    }
  }, [segments, sourceLang, targetLang]);

  // Copy translation
  const copySegmentText = useCallback((text) => {
    if (text) { navigator.clipboard.writeText(text); notify?.(t('documentTranslator.notify.copied'), 'success'); }
  }, [notify, t]);


  // Restore progress
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

  // Dismiss the restore banner
  const dismissRestore = useCallback(() => {
    setPendingRestore(null);
    if (fileFingerprint.current) localStorage.removeItem(PROGRESS_KEY + fileFingerprint.current);
  }, []);

  const handleExport = async (type) => {
    if (segments.length === 0) return;
    
    let content = '';
    let filename = document?.filename?.replace(/\.[^.]+$/, '') || 'translated';
    let ext = 'txt';
    let filterName = 'Text';
    
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
        case 'pdf-translated':
          content = exportPDFHTML(segments, {
            style: 'translated-only',
            title: document?.filename || t('documentTranslator.defaultDocTitle')
          });
          filename += t('documentTranslator.fileSuffix.translatedOnly');
          ext = 'html';
          filterName = 'HTML (Print to PDF)';
          break;
        default:
          return;
      }
      
      // Electron save dialog
      const saveFile = window.electron?.dialog?.saveFile;
      if (saveFile) {
        const result = await saveFile({
          defaultPath: `${filename}.${ext}`,
          filters: [
            { name: filterName, extensions: [ext] },
            { name: 'All Files', extensions: ['*'] },
          ],
          data: content,
          encoding: 'utf8',
        });
        
        if (result.success) {
          setShowExport(false);
          notify?.(t('documentTranslator.notify.exportSuccess'), 'success');
        } else if (!result.canceled) {
          throw new Error(result.error || 'Save failed');
        }
      } else {
        // Fallback: browser blob download (preload unavailable).
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

  // Clear current document
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
    
    fileFingerprint.current = null;
  };

  // Scroll handler — only used to toggle the scroll-to-top button.
  const lastScrollTopState = useRef(false);
  
  const handleScroll = useCallback((e) => {
    const scrollTop = e.target.scrollTop;
    const shouldShow = scrollTop > 400;
    
    if (shouldShow !== lastScrollTopState.current) {
      lastScrollTopState.current = shouldShow;
      setShowScrollTop(shouldShow);
    }
  }, []);

  // Scroll to top
  const scrollToTop = () => {
    listRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Jump to a segment by querying its DOM node.
  const scrollToSegment = (segmentId) => {
    const element = listRef.current?.querySelector(`[data-segment-id="${segmentId}"]`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  // Cycle through search matches. From the unpositioned (-1) state or any
  // out-of-bounds index, jump to the first (next) or last (prev) match.
  const navigateSearch = (direction) => {
    if (searchMatchIds.length === 0) return;
    const cur = searchMatchIndex;
    const unpositioned = cur < 0 || cur >= searchMatchIds.length;
    let nextIndex;
    if (unpositioned) {
      nextIndex = direction === 'next' ? 0 : searchMatchIds.length - 1;
    } else {
      nextIndex = direction === 'next'
        ? (cur + 1) % searchMatchIds.length
        : (cur - 1 + searchMatchIds.length) % searchMatchIds.length;
    }
    setSearchMatchIndex(nextIndex);
    scrollToSegment(searchMatchIds[nextIndex]);
  };

  // Clear in-memory translation cache
  const clearCache = () => {
    translationCache.current.clear();
    notify?.(t('documentTranslator.notify.cacheCleared'), 'success');
  };

  // Supported extensions, for the file picker hint
  const supportedExtensions = Object.keys(SUPPORTED_FORMATS)
    .map(ext => `.${ext}`)
    .join(', ');

  return (
    <div className="document-translator" ref={rootRef}>
      {/* Header */}
      <div className="dt-header">
        <div className="dt-title">
          <FileText size={20} />
          <span>{t('documentTranslator.title')}</span>
        </div>
        
        {/* Language selectors */}
        <div className="dt-lang-selector">
          <LanguagePicker
            value={sourceLang}
            options={sourceLanguages}
            onChange={setSourceLang}
            recent={languagePicker.recent}
            lastLetter={languagePicker.lastLetter}
            letterLang={languagePicker.letterLang}
            onBrowse={recordLanguageBrowse}
            customCodes={customCodes}
            size="compact"
            disabled={isTranslating}
            title={t('documentTranslator.sourceLang')}
          />
          <span className="dt-lang-arrow">→</span>
          <LanguagePicker
            value={targetLang}
            options={targetLanguages}
            onChange={(code) => { setTargetLang(code); recordLanguageUse(code); }}
            recent={languagePicker.recent}
            lastLetter={languagePicker.lastLetter}
            letterLang={languagePicker.letterLang}
            onBrowse={recordLanguageBrowse}
            customCodes={customCodes}
            size="compact"
            disabled={isTranslating}
            title={t('documentTranslator.targetLang')}
          />
        </div>
        
        <div className="dt-actions">
          {document && (
            <>
              {/* New document — clears the current file. */}
              <button 
                className="dt-btn"
                onClick={clearDocument}
                title={t('documentTranslator.newDocument')}
                disabled={isTranslating}
              >
                <RotateCcw size={16} />
                <span>{t('documentTranslator.newDocument')}</span>
              </button>
              
              {/* Consolidate the explanations collected so far. Two is where
                  it starts being worth a round trip — one note IS the note. */}
              {noteCount >= 2 && (
                <button
                  className="dt-btn"
                  onClick={runDigest}
                  disabled={digestRunning}
                  title={t('documentTranslator.digestHint', '把已讲解的段落整理成一份笔记')}
                >
                  {digestRunning ? <Loader size={16} className="spinning" /> : <ClipboardList size={16} />}
                  <span>{t('aiActions.digest.name')} ({noteCount})</span>
                </button>
              )}

              {/* Search toggle */}
              <button 
                className={`dt-btn icon-only ${showSearch ? 'active' : ''}`}
                onClick={() => { const next = !showSearch; setShowSearch(next); if (!next) { setSearchQuery(''); setSearchMatchIndex(-1); } }}
                title={t('documentTranslator.search.title') + ' (Ctrl+F)'}
              >
                <Search size={16} />
              </button>

              {/* Display style toggle */}
              <div className="style-selector">
                {DISPLAY_STYLES.map(style => (
                  <button
                    key={style.id}
                    className={displayStyle === style.id ? 'active' : ''}
                    onClick={() => setDisplayStyle(style.id)}
                    title={style.name}
                  >
                    <style.icon size={15} />
                  </button>
                ))}
              </div>
              
              {/* Export menu */}
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
                      <FileText size={14} /> {t('documentTranslator.export.bilingualPdf')}
                    </button>
                    <button onClick={() => handleExport('pdf-translated')}>
                      <FileText size={14} /> {t('documentTranslator.export.translatedOnlyPdf')}
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
        </div>
      </div>

      {/* Search bar */}
      {showSearch && document && (
        <div className="dt-search-bar">
          <div className="search-row">
            <input type="text" placeholder={t('documentTranslator.search.searchPlaceholder')} value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)} autoFocus className="search-input"
              onKeyDown={e => { if (e.key === 'Enter') navigateSearch(e.shiftKey ? 'prev' : 'next'); }}
            />
            {searchQuery && (
              <span className="search-count">
                {searchMatchCount === 0
                  ? `0 ${t('documentTranslator.search.matches')}`
                  : searchMatchIndex < 0
                    ? `${searchMatchCount} ${t('documentTranslator.search.matches')}`
                    : `${searchMatchIndex + 1}/${searchMatchCount}`}
              </span>
            )}
            <button className="search-nav-btn" onClick={() => navigateSearch('prev')} disabled={searchMatchCount === 0} title={t('documentTranslator.search.prev')}>
              <ChevronUp size={14} />
            </button>
            <button className="search-nav-btn" onClick={() => navigateSearch('next')} disabled={searchMatchCount === 0} title={t('documentTranslator.search.next')}>
              <ChevronDown size={14} />
            </button>
          </div>

        </div>
      )}

      {/* Body */}
      <div className="dt-body">
        {/* Upload zone when no document is loaded */}
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
                <p>
                  {parseProgress?.ocr
                    ? t('documentTranslator.upload.ocrProgress', { page: parseProgress.page, total: parseProgress.total })
                    : t('documentTranslator.upload.parsing')}
                </p>
              </div>
            ) : (
              <>
                <div className="dropzone-icon">
                  <Upload size={32} />
                </div>
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

        {/* Translation UI when a document is loaded */}
        {document && stats && (
          <>
            {/* Progress restore banner */}
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

            {/* File info bar */}
            <div className="dt-file-info">
              <div className="file-details">
                <FileText size={18} />
                <span className="filename">{document.filename}</span>
                <span className="format-badge">{t(`documentTranslator.formats.${document.formatName}`, document.formatName)}</span>
                <span 
                  className="stats clickable" 
                  onClick={() => setShowStats(!showStats)}
                  title={t('documentTranslator.stats.title')}
                >
                  {stats.total} {t('documentTranslator.stats.totalSegments')} · {document.stats?.totalChars?.toLocaleString() || 0} {t('documentTranslator.stats.totalChars')} · ~{stats.totalTokens?.toLocaleString()} tokens
                </span>
              </div>
            </div>

            {/* Progress bar */}
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
                  {stats.edited > 0 && (
                    <button
                      className="edited-count edited-locate-btn"
                      onClick={() => {
                        // `document` is shadowed by component state here
                        const el = listRef.current?.querySelector('.segment-item.edited');
                        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      }}
                      title={t('documentTranslator.progress.editedHint')}
                    >
                       · {t('documentTranslator.progress.edited')} {stats.edited}
                    </button>
                  )}
                </span>
                {isTranslating && (
                  <span className="elapsed-time">
                    <Clock size={12} /> {formatTime(elapsedTime)}
                  </span>
                )}
              </div>
            </div>

            {/* Main content area with optional outline sidebar */}
            <div className="dt-main-content">
              {/* Outline sidebar */}
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

              {/* Segment list — CSS content-visibility keeps rendering cheap */}
              <div 
                className={`dt-segments ${outline?.length > 0 ? 'with-outline' : ''}`}
                ref={listRef}
                onScroll={handleScroll}
              >
                {digest && (
                  <div className="dt-digest">
                    <div className="dt-digest-head">
                      <ClipboardList size={13} />
                      <span>{t('aiActions.digest.name')}</span>
                      {/* Say plainly what this covers — it is a note on the
                          paragraphs the reader opened, not on the document. */}
                      <span className="dt-digest-scope">
                        {t('documentTranslator.digestScope', { count: noteCount })}
                      </span>
                      <button className="dt-digest-close" onClick={() => setDigest(null)}>
                        <X size={13} />
                      </button>
                    </div>
                    <div className="dt-digest-body">{digest}</div>
                  </div>
                )}

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
                    onExplain={explainSegment}
                    aiNote={aiNotes[segment.id]}
                    aiRunning={aiRunningId === segment.id}
                    canExplain={canExplain}
                    t={t}
                  />
                ))}
              </div>
            </div>

            {/* Scroll-to-top */}
            <button 
              className={`scroll-top-btn ${showScrollTop ? 'visible' : ''}`} 
              onClick={scrollToTop}
              aria-hidden={!showScrollTop}
            >
              <ArrowUp size={18} />
            </button>

            {/* Stats popover */}
            {showStats && (
              <>
                <div className="stats-overlay" onClick={() => setShowStats(false)} />
                <div className="stats-popup">
                  <div className="stats-popup-header">
                    <span className="stats-popup-title"><BarChart3 size={15} /> {t('documentTranslator.stats.title')}</span>
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

      {/* Footer controls */}
      {document && (
        <div className="dt-footer">
          <div className="control-left">
            {/* Parallel mode toggle */}
            <label className="batch-mode-toggle" title={parallelMode ? t('documentTranslator.footer.parallelOnHint', { count: concurrency }) : t('documentTranslator.footer.parallelOffHint')}>
              <input
                type="checkbox"
                checked={parallelMode}
                onChange={(e) => setParallelMode(e.target.checked)}
                disabled={isTranslating}
              />
              <Zap size={14} />
              <span>{t('documentTranslator.footer.parallel')}</span>
            </label>
            {/* Glossary toggle */}
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
      
      {/* Password prompt modal */}
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
