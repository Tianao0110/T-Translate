// src/components/TranslationPanel/index.jsx
// 翻译面板组件 - 重构版
//
// 业务逻辑已拆分到 hooks/ 目录：
//   useTTS.js        - TTS 朗读
//   useTermCheck.js  - 术语一致性检测
//   useStyleRewrite.js - 风格改写
//   useSaveModal.js  - 收藏弹窗 + AI 分析
//
// UI 子组件在 components.jsx：
//   StyleModal, SaveModal, TemplateSelector, LanguageSelector

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Send, Camera, Image, FileText, Volume2, VolumeX, Copy,
  RotateCcw, Sparkles, Loader2, Clock, Zap, Shield, Eye, EyeOff, Lock,
  Lightbulb, Check, X, ArrowRight, Palette, ChevronUp, ChevronDown, AlertTriangle
} from 'lucide-react';

import useTranslationStore from '../../stores/translation-store';
import translationService from '../../services/translation.js';
import { TTS_STATUS } from '../../services/tts/index.js';
import createLogger from '../../utils/logger.js';
import { getShortErrorMessage } from '../../utils/error-handler.js';
import './styles.css';

// 配置常量
import { PRIVACY_MODES, TRANSLATION_STATUS, getLanguageList } from '@config/defaults';

// 自定义 Hooks
import { useTTS, useTermCheck, useStyleRewrite, useSaveModal } from './hooks';

// 子组件
import { StyleModal, SaveModal } from './components.jsx';

const logger = createLogger('TranslationPanel');

/**
 * 翻译面板组件
 */
const TranslationPanel = ({ showNotification, screenshotData, onScreenshotProcessed }) => {
  const { t } = useTranslation();
  const notify = showNotification || ((msg, type) => logger.debug(`[Notify] ${type}: ${msg}`));

  // ========== 本地 UI 状态 ==========
  const [dragOver, setDragOver] = useState(false);
  const [isConnected, setIsConnected] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [isOcrProcessing, setIsOcrProcessing] = useState(false);
  const [isOcrSource, setIsOcrSource] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState('natural');

  // ========== 网络状态监听 ==========
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

  // ========== Zustand Store ==========
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

  // ========== 自定义 Hooks ==========
  const tts = useTTS(notify, t);
  const termCheck = useTermCheck(favorites, setTranslatedText, notify, t);
  const styleRewrite = useStyleRewrite(currentTranslation, addStyleVersion, notify, t);
  const saveModal = useSaveModal(currentTranslation, addToFavorites, notify, t);

  // Refs
  const sourceTextareaRef = useRef(null);
  const fileInputRef = useRef(null);

  // 语言选项
  const languages = useMemo(() => getLanguageList(true), []);

  // 翻译模板
  const templates = [
    { id: 'natural', name: t('templates.natural'), icon: FileText, desc: t('templates.naturalDesc') },
    { id: 'precise', name: t('templates.precise'), icon: Zap, desc: t('templates.preciseDesc') },
    { id: 'formal', name: t('templates.formal'), icon: Sparkles, desc: t('templates.formalDesc') },
  ];

  // ========== 截图 OCR 处理 ==========
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
          notify(t('translation.ocrSuccess', { engine: result.engine || engineToUse }), 'success');

          if (autoTranslate) {
            const delay = Math.max(autoTranslateDelay || 500, 300);
            setTimeout(async () => {
              const currentText = useTranslationStore.getState().currentTranslation.sourceText;
              if (currentText?.trim()) {
                await handleTranslate();
              }
            }, delay);
          }
        } else {
          notify(t('translation.ocrFailed'), 'warning');
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

  // ========== 自动翻译防抖 ==========
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

  // 语言同步到主进程: 已由 stores/sync-to-electron.js 统一处理

  // ========== 核心操作 ==========

  const handleTranslate = async (overrideTemplate = null) => {
    if (!currentTranslation.sourceText.trim()) {
      notify(t('translation.enterText'), 'warning');
      return;
    }

    if (!isConnected && translationMode !== PRIVACY_MODES.OFFLINE) {
      notify(t('translation.notConnected'), 'error');
    }

    const effectiveTemplate = isOcrSource ? 'ocr' : (overrideTemplate || selectedTemplate);

    const options = {
      template: effectiveTemplate,
      saveHistory: translationMode !== PRIVACY_MODES.SECURE,
    };

    const result = useStreamOutput
      ? await streamTranslate(options)
      : await translate(options);

    if (result.success) {
      // 检测术语一致性
      const translatedText = result.translatedText || useTranslationStore.getState().currentTranslation.translatedText;
      termCheck.checkTermConsistency(currentTranslation.sourceText, translatedText);

      // OCR 截图联动
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

  // ========== 文件处理 ==========

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

  // ========== 渲染 ==========

  return (
    <div className="translation-panel">

      {/* 顶部工具栏 */}
      <div className="language-selector-bar">
        <div className="language-select-group">
          <select
            value={currentTranslation.sourceLanguage || ''}
            onChange={(e) => setLanguages(e.target.value, null)}
            className="language-select"
          >
            {languages.map(lang => (
              <option key={lang.code} value={lang.code}>{lang.flag} {lang.name}</option>
            ))}
          </select>

          <button
            className="swap-button"
            onClick={swapLanguages}
            disabled={currentTranslation.sourceLanguage === 'auto'}
            title="切换语言"
          >
            <RotateCcw size={16} />
          </button>

          <select
            value={currentTranslation.targetLanguage}
            onChange={(e) => setLanguages(null, e.target.value)}
            className="language-select"
          >
            {languages.filter(l => l.code !== 'auto').map(lang => (
              <option key={lang.code} value={lang.code}>{lang.flag} {lang.name}</option>
            ))}
          </select>
        </div>

        {/* 模板选择器 */}
        <div className="template-selector">
          {templates.map(tmpl => (
            <button
              key={tmpl.id}
              className={`template-btn ${selectedTemplate === tmpl.id ? 'active' : ''}`}
              onClick={() => handleTemplateChange(tmpl.id)}
              title={tmpl.name}
            >
              <tmpl.icon size={14} />
            </button>
          ))}
        </div>
      </div>

      {/* 翻译主区域 */}
      <div className="translation-areas">

        {/* 左侧：原文 */}
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

        {/* 中间：翻译按钮 */}
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

        {/* 右侧：译文 */}
        <div className="translation-box target-box">
          <div className="box-toolbar">
            <div className="box-title-group">
              <span className="box-title">{t('translation.target')}</span>
              {/* 版本切换 */}
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
              <button className="action-btn" onClick={() => copyToClipboard('translated') && notify(t('translation.copied'), 'success')} disabled={!currentTranslation.translatedText} title="复制">
                <Copy size={15} />
              </button>
              <button className="action-btn style-btn" onClick={styleRewrite.openStyleModal} disabled={!currentTranslation.translatedText || styleRewrite.isRewriting} title="风格改写">
                {styleRewrite.isRewriting ? <Loader2 size={15} className="animate-spin" /> : <Palette size={15} />}
              </button>
              <button className="action-btn" onClick={saveModal.openSaveModal} disabled={!currentTranslation.translatedText} title="收藏">
                <Sparkles size={15} />
              </button>
              {tts.ttsEnabled && (
                <button
                  className={`action-btn ${tts.ttsStatus === TTS_STATUS.SPEAKING && tts.ttsTarget === 'target' ? 'active' : ''}`}
                  onClick={() => tts.speakText(currentTranslation.translatedText, 'target', currentTranslation.targetLang)}
                  disabled={!currentTranslation.translatedText}
                  title={tts.ttsStatus === TTS_STATUS.SPEAKING && tts.ttsTarget === 'target' ? '停止朗读' : '朗读译文'}
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

          {/* 术语一致性提示 */}
          {termCheck.termSuggestions.length > 0 && (
            <div className="term-suggestions">
              <div className="term-suggestions-header">
                <Lightbulb size={14} />
                <span>发现可替换术语</span>
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
                    <button className="term-btn apply" onClick={() => termCheck.applyTermSuggestion(suggestion, currentTranslation.translatedText)} title="应用此翻译">
                      <Check size={12} /> 应用
                    </button>
                    <button className="term-btn ignore" onClick={() => termCheck.dismissTermSuggestion(suggestion)} title="忽略此次">
                      <X size={12} />
                    </button>
                    <button className="term-btn always" onClick={() => termCheck.alwaysUseTerm(suggestion)} title="不再提示此术语">
                      不再提示
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

      {/* 隐藏的文件 Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.txt,.md,.doc,.docx"
        onChange={handleFileInputChange}
        style={{ display: 'none' }}
      />

      {/* 风格改写弹窗 */}
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

      {/* 收藏弹窗 */}
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

export default TranslationPanel;
