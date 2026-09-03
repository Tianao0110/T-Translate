import React from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2, X } from 'lucide-react';
import useTranslationStore from '../../../stores/translation-store';
import { Seg, Switch, Slider } from './shared';

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

      <div className="setting-group">
        <Switch
          checked={autoTranslate}
          onChange={setAutoTranslate}
          label={t('translationSettings.autoTranslate')}
        />
        {autoTranslate && (
          <div className="sliders solo" style={{ marginTop: '12px' }}>
            <Slider
              label={t('translationSettings.autoDelay')}
              display={`${autoTranslateDelay}ms`}
              min={300}
              max={2000}
              step={100}
              value={autoTranslateDelay}
              onChange={(v) => setAutoTranslateDelay(Math.round(v))}
            />
          </div>
        )}
      </div>

      <div className="setting-group">
        <Switch
          checked={useStreamOutput}
          onChange={setUseStreamOutput}
          label={t('translationSettings.streamOutput')}
        />
      </div>

      <div className="setting-group">
        <label className="setting-label">{t('translationSettings.sameLangTitle')}</label>
        <Seg
          value={sameLangBehavior}
          onChange={setSameLangBehavior}
          options={[
            { value: 'original', label: t('translationSettings.sameLangOriginal') },
            { value: 'swap', label: t('translationSettings.sameLangSwap') },
          ]}
        />
      </div>

      <div className="setting-group">
        <label className="setting-label">{t('translationSettings.customLangs')}</label>
        {customLanguages.length === 0 ? (
          <div className="setting-hint-inline">{t('translationSettings.customLangsEmpty')}</div>
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

      <div className="setting-group">
        <label className="setting-label">{t('translationSettings.cache')}</label>
        <button className="danger-button" onClick={handleClearCache}>
          <Trash2 size={16} /> {t('translationSettings.clearCache')}
        </button>
      </div>
    </div>
  );
};

export default TranslationSection;
