import React from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2, X } from 'lucide-react';
import useTranslationStore from '../../../stores/translation-store';

const TranslationSection = ({
  settings,
  updateSetting,
  notify,
  confirm,
  autoTranslate,
  setAutoTranslate,
  autoTranslateDelay,
  setAutoTranslateDelay,
  useStreamOutput,
  setUseStreamOutput
}) => {
  const { t } = useTranslation();
  const customLanguages = useTranslationStore((s) => s.customLanguages);
  const removeCustomLanguage = useTranslationStore((s) => s.removeCustomLanguage);

  // Removal lives here rather than in the picker: it is rare and destructive,
  // and the panel people open every day should not carry a delete control.
  const handleRemoveLanguage = async (lang) => {
    if (!(await confirm(t('translationSettings.customLangRemoveConfirm', { name: lang.name })))) return;
    removeCustomLanguage(lang.code);
    notify(t('translationSettings.customLangRemoved', { name: lang.name }), 'success');
  };

  const handleClearCache = async () => {
    if (!(await confirm(t('translationSettings.clearCacheConfirm')))) return;
    // Cache lives in the main-process stack since v0.3.1 (the old
    // localStorage key is retired at boot by App.jsx).
    await window.electron?.stack?.clearCache?.('all');
    notify(t('translationSettings.cacheCleared'), 'success');
  };

  const sameLangBehavior = settings.translation?.sameLanguageBehavior || 'original';

  // Applies immediately (silent state update + own persistence), like the
  // theme/language controls — the selection window re-reads the store on every
  // trigger and the floating window reloads on the notify broadcast.
  const setSameLangBehavior = async (value) => {
    updateSetting('translation', 'sameLanguageBehavior', value, true);
    try {
      await window.electron?.store?.set?.('settings.translation.sameLanguageBehavior', value);
      await window.electron?.floatingWindow?.notifySettingsChanged?.();
    } catch (e) {
      console.warn('Failed to save sameLanguageBehavior:', e);
    }
    notify(t('translationSettings.sameLangSaved'), 'success');
  };

  return (
    <div className="setting-content">
      <h3>{t('translationSettings.title')}</h3>
      <p className="setting-description">{t('translationSettings.description')}</p>

      <div className="setting-group">
        <label className="setting-switch">
          <input
            type="checkbox"
            checked={autoTranslate}
            onChange={(e) => setAutoTranslate(e.target.checked)}
          />
          <span className="switch-slider"></span>
          <span className="switch-label">{t('translationSettings.autoTranslate')}</span>
        </label>
        <p className="setting-hint">{t('translationSettings.autoTranslateHint')}</p>
      </div>

      {autoTranslate && (
        <div className="setting-group">
          <label className="setting-label">{t('translationSettings.autoDelay')}: {autoTranslateDelay}ms</label>
          <input
            type="range"
            className="setting-range"
            min="300"
            max="2000"
            step="100"
            value={autoTranslateDelay}
            onChange={(e) => setAutoTranslateDelay(parseInt(e.target.value))}
          />
          <p className="setting-hint">{t('translationSettings.autoDelayHint')}</p>
        </div>
      )}

      <div className="setting-group">
        <label className="setting-switch">
          <input
            type="checkbox"
            checked={useStreamOutput}
            onChange={(e) => setUseStreamOutput(e.target.checked)}
          />
          <span className="switch-slider"></span>
          <span className="switch-label">{t('translationSettings.streamOutput')}</span>
        </label>
        <p className="setting-hint">{t('translationSettings.streamOutputHint')}</p>
      </div>

      <div className="setting-group">
        <label className="setting-label">{t('translationSettings.sameLangTitle')}</label>
        <div className="toggle-wrapper">
          <button
            className={`toggle-button ${sameLangBehavior === 'original' ? 'active' : ''}`}
            onClick={() => setSameLangBehavior('original')}
          >
            {t('translationSettings.sameLangOriginal')}
          </button>
          <button
            className={`toggle-button ${sameLangBehavior === 'swap' ? 'active' : ''}`}
            onClick={() => setSameLangBehavior('swap')}
            style={{marginLeft: '8px'}}
          >
            {t('translationSettings.sameLangSwap')}
          </button>
        </div>
        <p className="setting-hint">{t('translationSettings.sameLangHint')}</p>
      </div>

      <div className="setting-group" style={{marginTop: '24px', paddingTop: '16px', borderTop: '1px solid var(--border-primary)'}}>
        <h4 style={{marginBottom: '12px', color: 'var(--text-secondary)'}}>
          {t('translationSettings.customLangs')}
        </h4>
        <p className="setting-hint" style={{marginBottom: '12px'}}>
          {t('translationSettings.customLangsHint')}
        </p>
        {customLanguages.length === 0 ? (
          <p className="setting-hint" style={{opacity: 0.7}}>
            {t('translationSettings.customLangsEmpty')}
          </p>
        ) : (
          <div className="custom-lang-list">
            {customLanguages.map((lang) => (
              <div key={lang.code} className="custom-lang-item">
                <span className="custom-lang-name">{lang.name}</span>
                {/* The prompt name is the thing that actually decides whether a
                    model understands the request, so it is worth showing. */}
                {lang.promptName !== lang.name && (
                  <span className="custom-lang-prompt">
                    {t('translationSettings.customLangPrompt', { name: lang.promptName })}
                  </span>
                )}
                <button
                  className="custom-lang-remove"
                  onClick={() => handleRemoveLanguage(lang)}
                  title={t('common.delete')}
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="setting-group" style={{marginTop: '24px', paddingTop: '16px', borderTop: '1px solid var(--border-primary)'}}>
        <h4 style={{marginBottom: '12px', color: 'var(--text-secondary)'}}>{t('translationSettings.cache')}</h4>
        <p className="setting-hint" style={{marginBottom: '12px'}}>
          {t('translationSettings.cacheHint')}
        </p>
        <button className="danger-button" onClick={handleClearCache}>
          <Trash2 size={16} /> {t('translationSettings.clearCache')}
        </button>
      </div>
    </div>
  );
};

export default TranslationSection;
