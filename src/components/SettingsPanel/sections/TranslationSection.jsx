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

  // Custom-language removal lives here, not in the picker.
  const handleRemoveLanguage = async (lang) => {
    if (!(await confirm(t('translationSettings.customLangRemoveConfirm', { name: lang.name })))) return;
    removeCustomLanguage(lang.code);
    notify(t('translationSettings.customLangRemoved', { name: lang.name }), 'success');
  };

  const handleClearCache = async () => {
    if (!(await confirm(t('translationSettings.clearCacheConfirm')))) return;
    // The cache lives in the main-process stack.
    await window.electron?.stack?.clearCache?.('all');
    notify(t('translationSettings.cacheCleared'), 'success');
  };

  const sameLangBehavior = settings.translation?.sameLanguageBehavior || 'original';

  // Applies immediately (silent state update + own persistence).
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
                {/* The prompt name is shown when it differs. */}
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
