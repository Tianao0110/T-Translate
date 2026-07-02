// Style rewrite: takes a "style reference" from favorites and rewrites the
// current translation to imitate its tone and register.

import { useState, useCallback } from 'react';
import translationService from '../../../services/translation.js';
import useTranslationStore from '../../../stores/translation-store';
import { getStyleRewritePrompts } from '../../../utils/ai-prompts.js';
import createLogger from '../../../utils/logger.js';
import { getShortErrorMessage } from '../../../utils/error-handler.js';

const logger = createLogger('useStyleRewrite');

export default function useStyleRewrite(currentTranslation, addStyleVersion, notify, t) {
  const [showStyleModal, setShowStyleModal] = useState(false);
  const [selectedStyle, setSelectedStyle] = useState(null);
  const [styleStrength, setStyleStrength] = useState(50);
  const [isRewriting, setIsRewriting] = useState(false);
  const [showVersionMenu, setShowVersionMenu] = useState(false);

  const openStyleModal = useCallback(() => {
    if (!currentTranslation.translatedText) {
      notify(t('translation.translateFirst'), 'warning');
      return;
    }
    setShowStyleModal(true);
    setSelectedStyle(null);
    setStyleStrength(50);
  }, [currentTranslation.translatedText, notify, t]);

  const executeStyleRewrite = useCallback(async () => {
    if (!selectedStyle) {
      notify(t('translation.selectStylePrompt'), 'warning');
      return;
    }

    setIsRewriting(true);
    setShowStyleModal(false);

    try {
      const { systemPrompt, userPrompt } = getStyleRewritePrompts(
        selectedStyle.translatedText,
        currentTranslation.translatedText,
        styleStrength
      );

      const result = await translationService.chatCompletion(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        useTranslationStore.getState().getPrivacyOptions()
      );

      if (result.success && result.content) {
        let rewrittenText = result.content.trim();
        // LLM tends to wrap output in quotes despite being told not to
        rewrittenText = rewrittenText.replace(/^["「『]|["」』]$/g, '').trim();

        addStyleVersion(
          rewrittenText,
          selectedStyle.id,
          selectedStyle.sourceText.slice(0, 20) + (selectedStyle.sourceText.length > 20 ? '...' : ''),
          styleStrength
        );

        notify(t('translation.styleRewriteComplete'), 'success');
      } else {
        throw new Error(result.error || (t ? t('translation.rewriteFailed', '改写失败') : 'Rewrite failed'));
      }
    } catch (error) {
      logger.error('Style rewrite:', error);
      const errorMsg = getShortErrorMessage(error, { context: 'translation' });
      notify(t('translation.styleRewriteFailed') + ': ' + errorMsg, 'error');
    } finally {
      setIsRewriting(false);
    }
  }, [selectedStyle, styleStrength, currentTranslation.translatedText, addStyleVersion, notify, t]);

  const getVersionName = useCallback((version) => {
    if (!version) return t ? t('translation.versionOriginal', '原始') : 'Original';
    switch (version.type) {
      case 'original': return t ? t('translation.versionOriginalFull', '原始翻译') : 'Original Translation';
      case 'style_rewrite': return t ? t('translation.versionStyleRewrite', '风格改写') + ` (${version.styleName})` : `Style Rewrite (${version.styleName})`;
      case 'user_edit': return t ? t('translation.versionUserEdit', '用户编辑') : 'User Edit';
      default: return t ? t('translation.versionUnknown', '未知') : 'Unknown';
    }
  }, [t]);

  const currentVersion = currentTranslation.versions?.find(
    v => v.id === currentTranslation.currentVersionId
  );

  return {
    showStyleModal,
    setShowStyleModal,
    selectedStyle,
    setSelectedStyle,
    styleStrength,
    setStyleStrength,
    openStyleModal,
    executeStyleRewrite,
    isRewriting,
    showVersionMenu,
    setShowVersionMenu,
    getVersionName,
    currentVersion,
  };
}
