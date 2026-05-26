// Memoized sub-components for TranslationPanel — split out to keep the main
// component's re-render footprint small.

import React, { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  X, Check, Lightbulb, ArrowRight, Palette, ChevronUp, ChevronDown,
  Sparkles, Loader2, Tag, FileEdit, Bot, RotateCcw
} from 'lucide-react';

export const TermSuggestionBar = memo(({
  suggestions,
  onApply,
  onDismiss,
  onAlwaysUse
}) => {
  const { t } = useTranslation();
  if (!suggestions || suggestions.length === 0) return null;

  return (
    <div className="term-suggestions-bar">
      <div className="term-suggestions-header">
        <Lightbulb size={14} />
        <span>{t('translation.termFound', '术语一致性提示')}</span>
        <span className="badge">{suggestions.length}</span>
      </div>
      <div className="term-suggestions-list">
        {suggestions.map(suggestion => (
          <div key={suggestion.id} className="term-suggestion-item">
            <div className="term-info">
              <span className="term-original">"{suggestion.originalTerm}"</span>
              <ArrowRight size={12} />
              <span className="term-saved">"{suggestion.savedTranslation}"</span>
              {suggestion.note && (
                <span className="term-note">({suggestion.note})</span>
              )}
            </div>
            <div className="term-actions">
              <button
                className="btn-apply"
                onClick={() => onApply(suggestion)}
                title={t('translation.applyTerm', '应用此术语')}
              >
                <Check size={12} /> {t('translation.apply', '应用')}
              </button>
              <button
                className="btn-always"
                onClick={() => onAlwaysUse(suggestion)}
                title={t('translation.alwaysUseTerm', '始终使用此术语')}
              >
                {t('translation.always', '始终')}
              </button>
              <button
                className="btn-dismiss"
                onClick={() => onDismiss(suggestion, false)}
                title={t('translation.ignoreTerm', '忽略（本次）')}
              >
                <X size={12} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});
TermSuggestionBar.displayName = 'TermSuggestionBar';

export const VersionMenu = memo(({
  versions,
  currentVersionId,
  onSwitch,
  onClose,
  getVersionName
}) => {
  if (!versions || versions.length === 0) return null;

  return (
    <div className="version-menu">
      <div className="version-menu-header">
        <span>译文版本</span>
        <button onClick={onClose}><X size={14} /></button>
      </div>
      <div className="version-list">
        {versions.map(version => (
          <div
            key={version.id}
            className={`version-item ${version.id === currentVersionId ? 'active' : ''}`}
            onClick={() => onSwitch(version.id)}
          >
            <div className="version-info">
              <span className="version-name">{getVersionName(version)}</span>
              <span className="version-time">
                {new Date(version.createdAt).toLocaleTimeString()}
              </span>
            </div>
            {version.id === currentVersionId && <Check size={14} />}
          </div>
        ))}
      </div>
    </div>
  );
});
VersionMenu.displayName = 'VersionMenu';

export const StyleModal = memo(({
  show,
  favorites,
  selectedStyle,
  styleStrength,
  onSelectStyle,
  onStrengthChange,
  onConfirm,
  onClose
}) => {
  const { t } = useTranslation();
  if (!show) return null;

  // Style library = favorites flagged as style references with a usable translation
  // (>= 5 chars filters out trivial one-word entries that yield poor rewrites)
  const styleLibrary = favorites?.filter(
    f => (f.isStyleReference || f.folderId === 'style_library') &&
         f.translatedText &&
         f.translatedText.length >= 5
  ) || [];

  return (
    <div className="style-modal-overlay" onClick={onClose}>
      <div className="style-modal" onClick={e => e.stopPropagation()}>
        <div className="style-modal-header">
          <Palette size={18} />
          <span>{t('translation.selectStyle', '选择参考风格')}</span>
          <button className="close-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="style-modal-body">
          <div className="style-list-section">
            <div className="section-title">{t('translation.fromStyleLib', '从风格库中选择')}</div>
            {styleLibrary.length > 0 ? (
              <div className="style-list">
                {styleLibrary.map(fav => (
                  <div
                    key={fav.id}
                    className={`style-item ${selectedStyle?.id === fav.id ? 'selected' : ''}`}
                    onClick={() => onSelectStyle(fav)}
                  >
                    <div className="style-item-content">
                      <div className="style-source">
                        "{fav.sourceText?.slice(0, 40)}{fav.sourceText?.length > 40 ? '...' : ''}"
                      </div>
                      <div className="style-translated">
                        "{fav.translatedText?.slice(0, 50)}{fav.translatedText?.length > 50 ? '...' : ''}"
                      </div>
                      {fav.tags && fav.tags.length > 0 && (
                        <div className="style-tags">
                          {fav.tags.slice(0, 3).map((tag, i) => (
                            <span key={i} className="style-tag">#{tag}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    {selectedStyle?.id === fav.id && (
                      <div className="style-check"><Check size={16} /></div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-styles">
                <Palette size={32} />
                <p>{t('translation.styleLibEmpty', '风格库为空')}</p>
                <span>{t('translation.styleLibHint', '收藏时勾选"标记为风格参考"添加到风格库')}</span>
              </div>
            )}
          </div>

          {selectedStyle && (
            <div className="style-strength-section">
              <div className="section-title">{t('translation.styleStrength', '风格强度')}</div>
              <div className="strength-slider">
                <span className="strength-label">{t('translation.strengthLight', '轻微')}</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={styleStrength}
                  onChange={(e) => onStrengthChange(Number(e.target.value))}
                />
                <span className="strength-label">{t('translation.strengthFull', '完全模仿')}</span>
              </div>
              <div className="strength-value">{styleStrength}%</div>
              <div className="strength-desc">
                {styleStrength <= 30 ? t('translation.strengthDescLight', '轻微调整，基本保持原译文风格') :
                 styleStrength <= 70 ? t('translation.strengthDescMedium', '中等程度模仿参考风格') :
                 t('translation.strengthDescHigh', '高度模仿，尽量贴近参考风格的语气和表达')}
              </div>
            </div>
          )}
        </div>

        <div className="style-modal-footer">
          <button className="btn-cancel" onClick={onClose}>{t('favorites.cancel', '取消')}</button>
          <button
            className="btn-rewrite"
            onClick={onConfirm}
            disabled={!selectedStyle}
          >
            <Palette size={14} /> {t('translation.startRewrite', '开始改写')}
          </button>
        </div>
      </div>
    </div>
  );
});
StyleModal.displayName = 'StyleModal';

export const SaveModal = memo(({
  show,
  sourceText,
  translatedText,
  isAnalyzing,
  aiSuggestions,
  editableTags,
  editableSummary,
  saveAsStyleRef,
  onTagsChange,
  onSummaryChange,
  onStyleRefChange,
  onAnalyze,
  onSave,
  onClose
}) => {
  const { t } = useTranslation();
  if (!show) return null;

  return (
    <div className="save-modal-overlay" onClick={onClose}>
      <div className="save-modal save-modal-with-ai" onClick={e => e.stopPropagation()}>
        <div className="save-modal-header">
          <Sparkles size={18} />
          <span>{t('translation.addToFavorites', '添加到收藏')}</span>
          <button className="close-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="save-modal-body">
          <div className="save-preview">
            <div className="preview-item">
              <label>{t('translation.source', '原文')}</label>
              <div className="preview-text">
                {sourceText?.slice(0, 100)}{sourceText?.length > 100 ? '...' : ''}
              </div>
            </div>
            <div className="preview-item">
              <label>{t('translation.target', '译文')}</label>
              <div className="preview-text">
                {translatedText?.slice(0, 100)}{translatedText?.length > 100 ? '...' : ''}
              </div>
            </div>
          </div>

          <div className="ai-suggestions-section">
            <div className="ai-section-header">
              <div className="ai-title">
                <Bot size={16} />
                <span>{t('translation.aiSuggestions', 'AI 建议')}</span>
              </div>
              <button
                className="btn-reanalyze"
                onClick={onAnalyze}
                disabled={isAnalyzing}
                title={t('translation.reanalyze', '重新分析')}
              >
                <RotateCcw size={14} className={isAnalyzing ? 'spinning' : ''} />
              </button>
            </div>

            {isAnalyzing ? (
              <div className="ai-analyzing">
                <Loader2 size={20} className="spinning" />
                <span>{t('translation.aiAnalyzing', 'AI 正在分析内容...')}</span>
              </div>
            ) : (
              <div className="ai-suggestions-content">
                <div className="suggestion-field">
                  <label><Tag size={12} /> {t('favorites.tags', '标签')}</label>
                  <input
                    type="text"
                    value={editableTags}
                    onChange={(e) => onTagsChange(e.target.value)}
                    placeholder={t('favorites.tagsPlaceholder', '标签（逗号分隔）')}
                  />
                </div>

                <div className="suggestion-field">
                  <label><FileEdit size={12} /> {t('translation.summaryNote', '摘要/笔记')}</label>
                  <input
                    type="text"
                    value={editableSummary}
                    onChange={(e) => onSummaryChange(e.target.value)}
                    placeholder={t('translation.shortDesc', '简短描述...')}
                  />
                </div>

                <div className="style-ref-suggestion">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={saveAsStyleRef}
                      onChange={(e) => onStyleRefChange(e.target.checked)}
                    />
                    <Palette size={14} />
                    <span>{t('favorites.markAsStyle', '标记为风格参考')}</span>
                    {aiSuggestions?.isStyleSuggested && (
                      <span className="ai-recommended">{t('translation.aiRecommended', 'AI 推荐')}</span>
                    )}
                  </label>
                  <div className="option-hint">
                    {saveAsStyleRef
                      ? t('translation.saveToStyleLib', '将保存到"风格库"，可用于风格改写')
                      : t('translation.saveAsNormal', '保存为普通收藏')}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="save-modal-footer">
          <button className="btn-cancel" onClick={onClose}>{t('favorites.cancel', '取消')}</button>
          <button className="btn-save" onClick={onSave} disabled={isAnalyzing}>
            <Sparkles size={14} /> {saveAsStyleRef ? t('translation.saveToStyleLibBtn', '保存到风格库') : t('translation.saveFavorite', '保存收藏')}
          </button>
        </div>
      </div>
    </div>
  );
});
SaveModal.displayName = 'SaveModal';

export const TemplateSelector = memo(({
  templates,
  selectedTemplate,
  onSelect
}) => {
  return (
    <div className="template-selector">
      {templates.map(template => {
        const Icon = template.icon;
        return (
          <button
            key={template.id}
            className={`template-btn ${selectedTemplate === template.id ? 'active' : ''}`}
            onClick={() => onSelect(template.id)}
            title={template.desc}
          >
            <Icon size={14} />
            <span>{template.name}</span>
          </button>
        );
      })}
    </div>
  );
});
TemplateSelector.displayName = 'TemplateSelector';

// Shared language selector across TranslationPanel, DocumentTranslator, etc.
// size: 'default' for hero selectors, 'compact' for toolbar usage.
export const LanguageSelector = memo(({
  value,
  options,
  onChange,
  size = 'default',
  showFlag = true,
  disabled = false,
  title,
}) => {
  const { t } = useTranslation();
  const handleChange = useCallback((e) => {
    onChange(e.target.value);
  }, [onChange]);

  const className = size === 'compact'
    ? 'language-select language-select-compact'
    : 'language-select';

  return (
    <select
      className={className}
      value={value}
      onChange={handleChange}
      disabled={disabled}
      title={title}
    >
      {options.map(lang => (
        <option key={lang.code} value={lang.code}>
          {showFlag && lang.flag ? `${lang.flag} ` : ''}
          {t(`languages.${lang.code}`, lang.nativeName || lang.name)}
        </option>
      ))}
    </select>
  );
});
LanguageSelector.displayName = 'LanguageSelector';

export default {
  TermSuggestionBar,
  VersionMenu,
  StyleModal,
  SaveModal,
  TemplateSelector,
  LanguageSelector
};
