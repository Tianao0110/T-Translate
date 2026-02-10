// src/components/TranslationPanel/hooks/useStyleRewrite.js
// 风格改写逻辑 - 从 TranslationPanel 抽出
//
// 管理风格选择弹窗、强度控制、LLM 改写调用

import { useState, useCallback } from 'react';
import translationService from '../../../services/translation.js';
import createLogger from '../../../utils/logger.js';
import { getShortErrorMessage } from '../../../utils/error-handler.js';

const logger = createLogger('useStyleRewrite');

/**
 * 风格改写 Hook
 * @param {Object} currentTranslation - 当前翻译状态
 * @param {Function} addStyleVersion - store 方法：添加风格版本
 * @param {Function} notify - 通知函数
 * @param {Function} t - i18n 翻译函数
 * @returns {Object} 风格改写状态和操作方法
 */
export default function useStyleRewrite(currentTranslation, addStyleVersion, notify, t) {
  const [showStyleModal, setShowStyleModal] = useState(false);
  const [selectedStyle, setSelectedStyle] = useState(null);
  const [styleStrength, setStyleStrength] = useState(50);
  const [isRewriting, setIsRewriting] = useState(false);
  const [showVersionMenu, setShowVersionMenu] = useState(false);

  // 打开风格选择弹窗
  const openStyleModal = useCallback(() => {
    if (!currentTranslation.translatedText) {
      notify(t('translation.translateFirst'), 'warning');
      return;
    }
    setShowStyleModal(true);
    setSelectedStyle(null);
    setStyleStrength(50);
  }, [currentTranslation.translatedText, notify, t]);

  // 执行风格改写
  const executeStyleRewrite = useCallback(async () => {
    if (!selectedStyle) {
      notify(t('translation.selectStyle'), 'warning');
      return;
    }

    setIsRewriting(true);
    setShowStyleModal(false);

    try {
      const strengthDesc = styleStrength <= 30
        ? '轻微调整，保持原意'
        : styleStrength <= 70
          ? '中等程度模仿风格'
          : '高度模仿，尽量贴近参考风格';

      const systemPrompt = `你是一个专业的翻译润色助手。你的任务是将译文改写成指定的风格，同时保持原文含义不变。只输出改写后的文本，不要任何解释或额外内容。`;

      const userPrompt = `请将以下译文改写成参考风格的语气和表达方式。

参考风格示例：
"${selectedStyle.translatedText}"

需要改写的译文：
"${currentTranslation.translatedText}"

改写要求：
- ${strengthDesc}
- 保持原文的核心意思不变
- 模仿参考风格的语气、用词和句式

改写后的译文：`;

      const result = await translationService.chatCompletion([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ]);

      if (result.success && result.content) {
        let rewrittenText = result.content.trim();
        rewrittenText = rewrittenText.replace(/^["「『]|["」』]$/g, '').trim();

        addStyleVersion(
          rewrittenText,
          selectedStyle.id,
          selectedStyle.sourceText.slice(0, 20) + (selectedStyle.sourceText.length > 20 ? '...' : ''),
          styleStrength
        );

        notify(t('translation.styleRewriteComplete'), 'success');
      } else {
        throw new Error(result.error || '改写失败');
      }
    } catch (error) {
      logger.error('Style rewrite:', error);
      const errorMsg = getShortErrorMessage(error, { context: 'translation' });
      notify(t('translation.styleRewriteFailed') + ': ' + errorMsg, 'error');
    } finally {
      setIsRewriting(false);
    }
  }, [selectedStyle, styleStrength, currentTranslation.translatedText, addStyleVersion, notify, t]);

  // 获取版本显示名称
  const getVersionName = useCallback((version) => {
    if (!version) return '原始';
    switch (version.type) {
      case 'original': return '原始翻译';
      case 'style_rewrite': return `风格改写 (${version.styleName})`;
      case 'user_edit': return '用户编辑';
      default: return '未知';
    }
  }, []);

  // 当前版本信息
  const currentVersion = currentTranslation.versions?.find(
    v => v.id === currentTranslation.currentVersionId
  );

  return {
    // 风格弹窗
    showStyleModal,
    setShowStyleModal,
    selectedStyle,
    setSelectedStyle,
    styleStrength,
    setStyleStrength,
    openStyleModal,
    executeStyleRewrite,
    isRewriting,
    // 版本管理
    showVersionMenu,
    setShowVersionMenu,
    getVersionName,
    currentVersion,
  };
}
