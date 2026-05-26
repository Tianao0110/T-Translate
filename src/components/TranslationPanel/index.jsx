// Main translation panel. Thin shell: business logic lives in hooks/
// (useTTS, useTermCheck, useStyleRewrite, useSaveModal) and presentational
// pieces in components.jsx (StyleModal, SaveModal, etc.)

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Send, Camera, Image, FileText, Volume2, VolumeX, Copy,
  RotateCcw, Sparkles, Loader2, Clock, Zap, Shield, Eye, EyeOff, Lock,
  Lightbulb, Check, X, ArrowRight, Palette, ChevronUp, ChevronDown, AlertTriangle, BookOpen
} from 'lucide-react';

import useTranslationStore from '../../stores/translation-store';
import translationService from '../../services/translation.js';
import { TTS_STATUS } from '../../services/tts/index.js';
import createLogger from '../../utils/logger.js';
import { getShortErrorMessage } from '../../utils/error-handler.js';
import './styles.css';

import { PRIVACY_MODES, TRANSLATION_STATUS, getLanguageList } from '@config/defaults';

import { useTTS, useTermCheck, useStyleRewrite, useSaveModal } from './hooks';

import { StyleModal, SaveModal, LanguageSelector } from './components.jsx';

const logger = createLogger('TranslationPanel');

const TranslationPanel = ({ showNotification, screenshotData, onScreenshotProcessed }) => {
  const { t } = useTranslation();
  const notify = showNotification || ((msg, type) => logger.debug(`[Notify] ${type}: ${msg}`));

  const [dragOver, setDragOver] = useState(false);
  const [isConnected, setIsConnected] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [isOcrProcessing, setIsOcrProcessing] = useState(false);
  const [isOcrSource, setIsOcrSource] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState('natural');

  useEffect(() => {
    const goOnline = () => setIsConnected(true);
    const goOffline = () => setIsConnected(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  const {
    currentTranslation,
    favorites,
    useStreamOutput,
    autoTranslate,
    autoTranslateDelay,
    ocrStatus,
    translationMode,
    setTranslationMode,
    setSourceText,
    setTranslatedText,
    setLanguages,
    translate,
    streamTranslate,
    recognizeImage,
    clearCurrent,
    swapLanguages,
    addToFavorites,
    copyToClipboard,
    pasteFromClipboard,
    addStyleVersion,
    switchVersion,
  } = useTranslationStore();

  const tts = useTTS(notify, t);
  const termCheck = useTermCheck(favorites, setTranslatedText, notify, t);
  const styleRewrite = useStyleRewrite(currentTranslation, addStyleVersion, notify, t);
  const saveModal = useSaveModal(currentTranslation, addToFavorites, notify, t);

  const sourceTextareaRef = useRef(null);
  const fileInputRef = useRef(null);

  const languages = useMemo(() => getLanguageList(true), []);

  // Tone templates. MT detection is handled in services/translation.js
  // — when a translation-only model is active, prompt structure auto-switches
  // (user-only message + simplified prompt) regardless of which tone is picked.
  const templates = [
    { id: 'natural', name: t('templates.natural'), desc: t('templates.naturalDesc') },
    { id: 'precise', name: t('templates.precise'), desc: t('templates.preciseDesc') },
    { id: 'formal', name: t('templates.formal'), desc: t('templates.formalDesc') },
  ];

  // Triggered when MainWindow passes screenshot data in via props (capture flow)
  useEffect(() => {
    if (!screenshotData?.dataURL) return;

    logger.debug('Received screenshot data via props, processing OCR...');

    const processScreenshot = async () => {
      notify(t('translation.ocrRecognizing'), 'info');
      setIsOcrProcessing(true);

      try {
        const engineToUse = ocrStatus?.engine || 'llm-vision';
        const result = await recognizeImage(screenshotData.dataURL, {
          engine: engineToUse,
          autoSetSource: true,
        });

        if (result.success && result.text) {
          setIsOcrSource(true);

          // LLM Vision -> local OCR fallback gets surfaced; ocrStatus.fallbackNotice
          // is set by recognizeImage in main-translation.js
          if (result.fallbackFrom === 'llm-vision') {
            const store = useTranslationStore.getState();
            const notice = store.ocrStatus?.fallbackNotice;
            notify(notice || t('ocr.visionFallback'), 'warning');
          } else {
            notify(t('translation.ocrSuccess', { engine: result.engine || engineToUse }), 'success');
          }

          if (autoTranslate) {
            // Floor at 300ms so the user sees the OCR result before translate kicks in
            const delay = Math.max(autoTranslateDelay || 500, 300);
            setTimeout(async () => {
              const currentText = useTranslationStore.getState().currentTranslation.sourceText;
              if (currentText?.trim()) {
                await handleTranslate();
              }
            }, delay);
          }
        } else {
          notify(result.error || t('translation.ocrFailed'), 'warning');
        }
      } catch (error) {
        logger.error('[OCR] Error:', error);
        notify(getShortErrorMessage(error, { context: 'ocr' }), 'error');
      } finally {
        setIsOcrProcessing(false);
        onScreenshotProcessed?.();
      }
    };

    processScreenshot();
  }, [screenshotData]);

  // Debounced auto-translate. Re-checks state inside the timer so a fast
  // edit-then-clear doesn't fire a stale translation.
  useEffect(() => {
    if (!autoTranslate) return;
    if (!currentTranslation.sourceText.trim()) return;
    if (currentTranslation.status === TRANSLATION_STATUS.TRANSLATING) return;

    const timer = setTimeout(() => {
      const state = useTranslationStore.getState();
      if (state.autoTranslate &&
          state.currentTranslation.sourceText.trim() &&
          state.currentTranslation.status !== TRANSLATION_STATUS.TRANSLATING) {
        handleTranslate();
      }
    }, autoTranslateDelay);

    return () => clearTimeout(timer);
  }, [currentTranslation.sourceText, autoTranslate, autoTranslateDelay]);

  const handleTranslate = async (overrideTemplate = null) => {
    if (!currentTranslation.sourceText.trim()) {
      notify(t('translation.enterText'), 'warning');
      return;
    }

    if (!isConnected && translationMode !== PRIVACY_MODES.OFFLINE) {
      notify(t('translation.notConnected'), 'error');
    }

    // OCR'd text gets the 'ocr' template (different prompt — better for fragments)
    const effectiveTemplate = isOcrSource ? 'ocr' : (overrideTemplate || selectedTemplate);

    const options = {
      template: effectiveTemplate,
      saveHistory: translationMode !== PRIVACY_MODES.SECURE,
    };

    const result = useStreamOutput
      ? await streamTranslate(options)
      : await translate(options);

    if (result.success) {
      const translatedText = result.translatedText || useTranslationStore.getState().currentTranslation.translatedText;
      termCheck.checkTermConsistency(currentTranslation.sourceText, translatedText);

      // Push result back to screenshot flow so the selection overlay can display it
      if (isOcrSource && window.electron?.screenshot?.notifyTranslationComplete) {
        const state = useTranslationStore.getState();
        if (translatedText) {
          window.electron.screenshot.notifyTranslationComplete({
            sourceText: currentTranslation.sourceText,
            translatedText,
            sourceLanguage: state.currentTranslation.sourceLanguage || 'auto',
            targetLanguage: state.currentTranslation.targetLanguage || 'zh',
          });
        }
      }

      if (isOcrSource) setIsOcrSource(false);
    } else {
      notify(getShortErrorMessage(result.error, {
        provider: result.provider,
        context: 'translation',
      }), 'error');
    }
  };

  const handleTemplateChange = (newTemplateId) => {
    if (newTemplateId === selectedTemplate) return;
    setSelectedTemplate(newTemplateId);
    if (currentTranslation.sourceText.trim()) {
      handleTranslate(newTemplateId);
    }
  };

  const handleDrop = useCallback(async (e) => {
    e.preventDefault();
    setDragOver(false);

    const file = Array.from(e.dataTransfer.files)[0];
    if (!file) return;

    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = async (event) => {
        notify(t('translation.imageOcrRecognizing'), 'info');
        const result = await recognizeImage(event.target.result);
        if (result.success) notify(t('translation.imageOcrSuccess'), 'success');
        else notify(getShortErrorMessage(result.error, { context: 'ocr' }), 'error');
      };
      reader.readAsDataURL(file);
    } else if (file.type === 'text/plain' || file.name.endsWith('.txt') || file.name.endsWith('.md')) {
      const text = await file.text();
      setSourceText(text);
      notify(t('translation.fileImportSuccess'), 'success');
    } else {
      notify(t('translation.unsupportedFileType'), 'warning');
    }
  }, [recognizeImage, setSourceText, notify, t]);

  const handleFileInputChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = async (event) => {
        notify(t('translation.ocrRecognizing'), 'info');
        const result = await recognizeImage(event.target.result);
        if (result.success) notify(t('translation.ocrSuccess'), 'success');
        else notify(getShortErrorMessage(result.error, { context: 'ocr' }), 'error');
      };
      reader.readAsDataURL(file);
    } else {
      const reader = new FileReader();
      reader.onload = (ev) => {
        setSourceText(ev.target.result);
        notify(t('translation.fileImportSuccess'), 'success');
      };
      reader.readAsText(file);
    }
    e.target.value = null;
  };

  const handlePaste = useCallback(async (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const blob = item.getAsFile();
        const reader = new FileReader();
        reader.onload = async (event) => {
          notify(t('translation.recognizingClipboard'), 'info');
          const result = await recognizeImage(event.target.result);
          if (result.success) notify(t('translation.ocrSuccess'), 'success');
        };
        reader.readAsDataURL(blob);
        break;
      }
    }
  }, [recognizeImage, notify, t]);

  return (
    <div className="translation-panel">

      <div className="language-selector-bar">
        <div className="language-select-group">
          <LanguageSelector
            value={currentTranslation.sourceLanguage || ''}
            options={languages}
            onChange={(code) => setLanguages(code, null)}
          />

          <button
            className="swap-button"
            onClick={swapLanguages}
            disabled={currentTranslation.sourceLanguage === 'auto'}
            title={t('translation.swap', '切换语言')}
          >
            <RotateCcw size={16} />
          </button>

          <LanguageSelector
            value={currentTranslation.targetLanguage}
            options={languages.filter(l => l.code !== 'auto')}
            onChange={(code) => setLanguages(null, code)}
          />
        </div>

        <div className="template-selector">
          {templates.map(tmpl => (
            <button
              key={tmpl.id}
              className={`template-btn ${selectedTemplate === tmpl.id ? 'active' : ''}`}
              onClick={() => handleTemplateChange(tmpl.id)}
              title={tmpl.desc}
            >
              {tmpl.name}
            </button>
          ))}
        </div>
      </div>

      <div className="translation-areas">

        <div
          className={`translation-box source-box ${dragOver ? 'drag-over' : ''}`}
          onDrop={handleDrop}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
        >
          <div className="box-toolbar">
            <span className="box-title">
              {isOcrProcessing ? (
                <>
                  <Loader2 size={14} className="animate-spin" style={{ marginRight: '6px', display: 'inline' }} />
                  {t('translation.recognizing')}
                </>
              ) : t('translation.source')}
            </span>
            <div className="box-actions">
              <button className="action-btn" onClick={() => window.electron?.screenshot?.capture()} disabled={isOcrProcessing} title={t('translation.screenshot')}>
                <Camera size={15} />
              </button>
              <button className="action-btn" onClick={() => fileInputRef.current?.click()} disabled={isOcrProcessing} title={t('translation.importImage')}>
                <Image size={15} />
              </button>
              <button className="action-btn" onClick={pasteFromClipboard} disabled={isOcrProcessing} title={t('translation.paste')}>
                <FileText size={15} />
              </button>
              <button className="action-btn" onClick={clearCurrent} disabled={isOcrProcessing} title={t('translation.clear')}>
                <RotateCcw size={15} />
              </button>
              {tts.ttsEnabled && (
                <button
                  className={`action-btn ${tts.ttsStatus === TTS_STATUS.SPEAKING && tts.ttsTarget === 'source' ? 'active' : ''}`}
                  onClick={() => tts.speakText(currentTranslation.sourceText, 'source', currentTranslation.sourceLang)}
                  disabled={!currentTranslation.sourceText || isOcrProcessing}
                  title={tts.ttsStatus === TTS_STATUS.SPEAKING && tts.ttsTarget === 'source' ? t('translation.stopSpeak') : t('translation.speakSource')}
                >
                  {tts.ttsStatus === TTS_STATUS.SPEAKING && tts.ttsTarget === 'source' ? <VolumeX size={15} /> : <Volume2 size={15} />}
                </button>
              )}
            </div>
          </div>

          <textarea
            ref={sourceTextareaRef}
            className="translation-textarea"
            value={currentTranslation.sourceText}
            onChange={(e) => {
              setSourceText(e.target.value);
              if (isOcrSource) setIsOcrSource(false);
            }}
            onPaste={handlePaste}
            placeholder={isOcrProcessing ? t('translation.ocrProcessing') : (dragOver ? t('translation.dropFile') : t('translation.inputPlaceholder'))}
            spellCheck={false}
            disabled={isOcrProcessing}
            onKeyDown={(e) => { if (e.ctrlKey && e.key === 'Enter') handleTranslate(); }}
          />

          <div className="box-footer">
            <span className="char-count">{(currentTranslation.sourceText || '').length} {t('translation.characters')}</span>
          </div>
        </div>

        <div className="translation-controls">
          <button
            className={`translate-btn ${currentTranslation.status === TRANSLATION_STATUS.TRANSLATING ? 'loading' : ''}`}
            onClick={() => handleTranslate()}
            disabled={!currentTranslation.sourceText.trim() || currentTranslation.status === TRANSLATION_STATUS.TRANSLATING || isOcrProcessing}
          >
            {currentTranslation.status === TRANSLATION_STATUS.TRANSLATING ? (
              <><Loader2 size={18} className="animate-spin" /><span>{t('translation.translating')}</span></>
            ) : (
              <><Send size={18} /><span>{t('translation.translate')}</span></>
            )}
          </button>
          <div className={`connection-indicator ${isConnected ? 'connected' : 'disconnected'}`}>
            <div className="indicator-dot"></div>
            <span>{isConnected ? t('status.online') : t('status.offline')}</span>
          </div>
        </div>

        <div className="translation-box target-box">
          <div className="box-toolbar">
            <div className="box-title-group">
              <span className="box-title">{t('translation.target')}</span>
              {currentTranslation.versions?.length > 1 && (
                <div className="version-selector">
                  <button className="version-btn" onClick={() => styleRewrite.setShowVersionMenu(!styleRewrite.showVersionMenu)}>
                    <span>{styleRewrite.getVersionName(styleRewrite.currentVersion)}</span>
                    {styleRewrite.showVersionMenu ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                  {styleRewrite.showVersionMenu && (
                    <div className="version-menu">
                      {currentTranslation.versions.map(v => (
                        <button
                          key={v.id}
                          className={`version-item ${v.id === currentTranslation.currentVersionId ? 'active' : ''}`}
                          onClick={() => { switchVersion(v.id); styleRewrite.setShowVersionMenu(false); }}
                        >
                          <span className="version-name">{styleRewrite.getVersionName(v)}</span>
                          {v.id === currentTranslation.currentVersionId && <Check size={14} />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="box-actions">
              <button className="action-btn" onClick={() => copyToClipboard('translated') && notify(t('translation.copied'), 'success')} disabled={!currentTranslation.translatedText} title={t('translation.copy', '复制')}>
                <Copy size={15} />
              </button>
              <button className="action-btn style-btn" onClick={styleRewrite.openStyleModal} disabled={!currentTranslation.translatedText || styleRewrite.isRewriting} title={t('translation.styleRewrite', '风格改写')}>
                {styleRewrite.isRewriting ? <Loader2 size={15} className="animate-spin" /> : <Palette size={15} />}
              </button>
              <button className="action-btn" onClick={saveModal.openSaveModal} disabled={!currentTranslation.translatedText} title={t('translation.favorite', '收藏')}>
                <Sparkles size={15} />
              </button>
              {tts.ttsEnabled && (
                <button
                  className={`action-btn ${tts.ttsStatus === TTS_STATUS.SPEAKING && tts.ttsTarget === 'target' ? 'active' : ''}`}
                  onClick={() => tts.speakText(currentTranslation.translatedText, 'target', currentTranslation.targetLang)}
                  disabled={!currentTranslation.translatedText}
                  title={tts.ttsStatus === TTS_STATUS.SPEAKING && tts.ttsTarget === 'target' ? t('translation.stopSpeak', '停止朗读') : t('translation.speakTarget', '朗读译文')}
                >
                  {tts.ttsStatus === TTS_STATUS.SPEAKING && tts.ttsTarget === 'target' ? <VolumeX size={15} /> : <Volume2 size={15} />}
                </button>
              )}
            </div>
          </div>

          <textarea
            className="translation-textarea"
            value={currentTranslation.translatedText}
            onChange={(e) => setTranslatedText(e.target.value)}
            placeholder={t('translation.outputPlaceholder')}
            spellCheck={false}
          />

          {currentTranslation.glossaryApplied && currentTranslation.glossaryApplied.replacements.length > 0 && (() => {
            const replacements = currentTranslation.glossaryApplied.replacements;
            const count = replacements.length;
            const first = `"${replacements[0].from}" → "${replacements[0].to}"`;

            return (
              <GlossaryNotice
                count={count}
                first={first}
                replacements={replacements}
                onUndo={() => {
                  setTranslatedText(currentTranslation.glossaryApplied.originalText);
                  useTranslationStore.setState((draft) => {
                    draft.currentTranslation.glossaryApplied = null;
                  });
                  notify(t('translation.glossaryUndone', '已撤销术语替换'), 'info');
                }}
                t={t}
              />
            );
          })()}

          {termCheck.termSuggestions.length > 0 && (
            <div className="term-suggestions">
              <div className="term-suggestions-header">
                <Lightbulb size={14} />
                <span>{t('translation.termFound', '发现可替换术语')}</span>
              </div>
              {termCheck.termSuggestions.map(suggestion => (
                <div key={suggestion.id} className="term-suggestion-item">
                  <div className="term-info">
                    <span className="term-original">"{suggestion.originalTerm}"</span>
                    <ArrowRight size={12} />
                    <span className="term-saved">"{suggestion.savedTranslation}"</span>
                    {suggestion.note && <span className="term-note">({suggestion.note})</span>}
                  </div>
                  <div className="term-actions">
                    <button className="term-btn apply" onClick={() => termCheck.applyTermSuggestion(suggestion, currentTranslation.translatedText)} title={t('translation.applyTerm', '应用此翻译')}>
                      <Check size={12} /> {t('translation.apply', '应用')}
                    </button>
                    <button className="term-btn ignore" onClick={() => termCheck.dismissTermSuggestion(suggestion)} title={t('translation.ignoreTerm', '忽略此次')}>
                      <X size={12} />
                    </button>
                    <button className="term-btn always" onClick={() => termCheck.alwaysUseTerm(suggestion)} title={t('translation.neverRemind', '不再提示此术语')}>
                      {t('translation.neverRemind', '不再提示')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="box-footer">
            {currentTranslation.translatedText && (
              <>
                <span className="char-count">{(currentTranslation.translatedText || '').length} 字符</span>
                {currentTranslation.metadata.duration && (
                  <span className="translation-time">
                    <Clock size={12} style={{ marginRight: 4 }} />
                    {(currentTranslation.metadata.duration / 1000).toFixed(2)}s
                  </span>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.txt,.md,.doc,.docx"
        onChange={handleFileInputChange}
        style={{ display: 'none' }}
      />

      <StyleModal
        show={styleRewrite.showStyleModal}
        favorites={favorites}
        selectedStyle={styleRewrite.selectedStyle}
        styleStrength={styleRewrite.styleStrength}
        onSelectStyle={styleRewrite.setSelectedStyle}
        onStrengthChange={styleRewrite.setStyleStrength}
        onConfirm={styleRewrite.executeStyleRewrite}
        onClose={() => styleRewrite.setShowStyleModal(false)}
      />

      <SaveModal
        show={saveModal.showSaveModal}
        sourceText={currentTranslation.sourceText}
        translatedText={currentTranslation.translatedText}
        isAnalyzing={saveModal.isAnalyzing}
        aiSuggestions={saveModal.aiSuggestions}
        editableTags={saveModal.editableTags}
        editableSummary={saveModal.editableSummary}
        saveAsStyleRef={saveModal.saveAsStyleRef}
        onTagsChange={saveModal.setEditableTags}
        onSummaryChange={saveModal.setEditableSummary}
        onStyleRefChange={saveModal.setSaveAsStyleRef}
        onAnalyze={saveModal.analyzeContent}
        onSave={saveModal.executeSave}
        onClose={() => saveModal.setShowSaveModal(false)}
      />
    </div>
  );
};

// Glossary auto-replacement toast. Dismisses on 5s timer; hover pauses the
// timer so the user can read multi-item lists at their own pace.
const GlossaryNotice = ({ count, first, replacements, onUndo, t }) => {
  const [visible, setVisible] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), 5000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (hovered) return;
    if (!visible) return;
    const timer = setTimeout(() => setVisible(false), 5000);
    return () => clearTimeout(timer);
  }, [hovered, visible]);

  if (!visible) return null;

  return (
    <div
      className="glossary-applied-notice"
      onMouseEnter={() => { setHovered(true); setVisible(true); }}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="glossary-notice-content">
        <BookOpen size={14} />
        {count === 1 ? (
          <span>{t('translation.glossaryApplied', '术语库已自动替换')}: {first}</span>
        ) : (
          <span
            className="glossary-notice-expandable"
            onClick={() => setExpanded(!expanded)}
          >
            {t('translation.glossaryApplied', '术语库已自动替换')} ({count} {t('translation.glossaryItems', '项')})
            {!expanded && `: ${first}...`}
          </span>
        )}
      </div>
      <button className="glossary-undo-btn" onClick={onUndo}>
        {t('translation.undo', '撤销')}
      </button>
      {expanded && count > 1 && (
        <div className="glossary-notice-details">
          {replacements.map((r, i) => (
            <div key={i} className="glossary-detail-item">
              "{r.from}" → "{r.to}"
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default TranslationPanel;
