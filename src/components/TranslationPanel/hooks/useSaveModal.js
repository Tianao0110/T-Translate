// src/components/TranslationPanel/hooks/useSaveModal.js
// 收藏弹窗逻辑（含 AI 分析）- 从 TranslationPanel 抽出
//
// 管理收藏弹窗状态、AI 标签/摘要生成、保存操作

import { useState, useCallback } from 'react';
import i18n from 'i18next';
import translationService from '../../../services/translation.js';
import createLogger from '../../../utils/logger.js';

const logger = createLogger('useSaveModal');

/**
 * 根据界面语言生成 AI 分析 prompt
 */
function getAnalysisPrompts(sourceText, translatedText) {
  const lang = i18n.language || 'zh';
  const isZh = lang.startsWith('zh');
  
  const systemPrompt = isZh
    ? `你是一个智能标签和摘要生成助手。根据用户提供的原文和译文，生成合适的标签和摘要。

请严格按照以下 JSON 格式返回，不要包含任何其他内容：
{
  "tags": ["标签1", "标签2", "标签3"],
  "summary": "简短摘要（20字以内）",
  "isStyleSuggested": true/false
}

标签规则：
- 生成 3-5 个相关标签
- 标签应该反映内容的主题、领域、风格等
- 使用中文标签

摘要规则：
- 20字以内的简短描述
- 概括内容的核心特点

风格参考判断规则（isStyleSuggested）：
- 如果文本具有独特的文学风格、修辞手法、或值得模仿的表达方式，返回 true
- 如果只是普通的术语、短语、或日常表达，返回 false
- 长度超过 30 字且有明显风格特点的文本更适合作为风格参考`
    : `You are a smart tag and summary generator. Based on the source text and translation provided, generate appropriate tags and a summary.

Return STRICTLY in the following JSON format with no other content:
{
  "tags": ["tag1", "tag2", "tag3"],
  "summary": "Brief summary (under 10 words)",
  "isStyleSuggested": true/false
}

Tag rules:
- Generate 3-5 relevant tags
- Tags should reflect the topic, domain, and style of the content
- Use English tags

Summary rules:
- A brief description under 10 words
- Capture the core meaning of the content

Style reference rules (isStyleSuggested):
- Return true if the text has a distinctive literary style, rhetorical devices, or expressions worth imitating
- Return false if it is just common terms, phrases, or everyday expressions
- Texts longer than 30 words with clear stylistic features are more suitable as style references`;

  const userPrompt = isZh
    ? `原文：${sourceText}\n译文：${translatedText}\n\n请分析并返回 JSON 格式的标签、摘要和风格建议。`
    : `Source: ${sourceText}\nTranslation: ${translatedText}\n\nAnalyze and return tags, summary, and style suggestion in JSON format.`;

  return { systemPrompt, userPrompt };
}

/**
 * 收藏弹窗 Hook
 * @param {Object} currentTranslation - 当前翻译状态
 * @param {Function} addToFavorites - store 方法：添加收藏
 * @param {Function} notify - 通知函数
 * @param {Function} t - i18n 翻译函数
 * @returns {Object} 收藏弹窗状态和操作方法
 */
export default function useSaveModal(currentTranslation, addToFavorites, notify, t) {
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveAsStyleRef, setSaveAsStyleRef] = useState(false);

  // AI 分析状态
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState(null);
  const [editableTags, setEditableTags] = useState('');
  const [editableSummary, setEditableSummary] = useState('');

  // AI 分析内容
  const analyzeContent = useCallback(async () => {
    setIsAnalyzing(true);

    try {
      const { sourceText, translatedText } = currentTranslation;
      const { systemPrompt, userPrompt } = getAnalysisPrompts(sourceText, translatedText);

      const result = await translationService.chatCompletion([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ]);

      if (result.success && result.content) {
        let parsed;
        try {
          let content = result.content.trim();
          content = content.replace(/^```json\s*/, '').replace(/```\s*$/, '');
          content = content.replace(/^```\s*/, '').replace(/```\s*$/, '');
          parsed = JSON.parse(content);
        } catch (parseError) {
          logger.error('JSON parse:', parseError);
          parsed = {
            tags: [t ? t('favorites.uncategorized', '未分类') : '未分类'],
            summary: '',
            isStyleSuggested: translatedText.length > 30,
          };
        }

        setAiSuggestions(parsed);
        setEditableTags(parsed.tags?.join(', ') || '');
        setEditableSummary(parsed.summary || '');
        setSaveAsStyleRef(parsed.isStyleSuggested || false);
      } else {
        throw new Error(result.error || (t ? t('translation.analysisFailed', '分析失败') : 'Analysis failed'));
      }
    } catch (error) {
      logger.error('AI analysis:', error);
      setAiSuggestions({ tags: [], summary: '', isStyleSuggested: false });
      setEditableTags('');
      setEditableSummary('');
    } finally {
      setIsAnalyzing(false);
    }
  }, [currentTranslation]);

  // 打开收藏弹窗
  const openSaveModal = useCallback(() => {
    if (!currentTranslation.translatedText) {
      notify(t('translation.translateFirst'), 'warning');
      return;
    }
    setSaveAsStyleRef(false);
    setAiSuggestions(null);
    setEditableTags('');
    setEditableSummary('');
    setShowSaveModal(true);

    // 自动触发 AI 分析
    analyzeContent();
  }, [currentTranslation.translatedText, analyzeContent, notify, t]);

  // 执行保存
  const executeSave = useCallback(() => {
    const tags = editableTags
      .split(/[,，]/)
      .map(tag => tag.trim())
      .filter(tag => tag.length > 0);

    const favoriteItem = {
      id: `fav_${Date.now()}`,
      sourceText: currentTranslation.sourceText,
      translatedText: currentTranslation.translatedText,
      sourceLanguage: currentTranslation.sourceLanguage,
      targetLanguage: currentTranslation.targetLanguage,
      timestamp: Date.now(),
      tags,
      note: editableSummary || null,
      folderId: saveAsStyleRef ? 'style_library' : null,
      isStyleReference: saveAsStyleRef,
    };

    addToFavorites(favoriteItem, saveAsStyleRef);
    notify(
      saveAsStyleRef ? t('translation.savedToStyle') : t('translation.saved'),
      'success'
    );
    setShowSaveModal(false);
  }, [editableTags, editableSummary, saveAsStyleRef, currentTranslation, addToFavorites, notify, t]);

  return {
    showSaveModal,
    setShowSaveModal,
    saveAsStyleRef,
    setSaveAsStyleRef,
    isAnalyzing,
    aiSuggestions,
    editableTags,
    setEditableTags,
    editableSummary,
    setEditableSummary,
    openSaveModal,
    analyzeContent,
    executeSave,
  };
}
