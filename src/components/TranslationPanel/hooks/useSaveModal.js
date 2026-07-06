// Save-to-favorites modal: AI-generated tags/summary + persist action.

import { useState, useCallback, useRef } from 'react';
import translationService from '../../../services/stack-client.js';
import useTranslationStore from '../../../stores/translation-store';
import { getAnalysisPrompts, parseJsonReply } from '../../../utils/ai-prompts.js';
import createLogger from '../../../utils/logger.js';

const logger = createLogger('useSaveModal');

export default function useSaveModal(currentTranslation, addToFavorites, notify, t) {
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveAsStyleRef, setSaveAsStyleRef] = useState(false);

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState(null);
  const [editableTags, setEditableTags] = useState('');
  const [editableSummary, setEditableSummary] = useState('');

  // Generation counter: a slow LLM reply from a closed/superseded modal must
  // not overwrite the fields of a newer analysis (and then get saved).
  const analyzeReqRef = useRef(0);

  const analyzeContent = useCallback(async () => {
    const reqId = ++analyzeReqRef.current;
    setIsAnalyzing(true);

    try {
      const { sourceText, translatedText } = currentTranslation;
      const { systemPrompt, userPrompt } = getAnalysisPrompts(sourceText, translatedText);

      // Privacy fields no longer travel from call sites — the main-process
      // facade injects the live mode into every stack request.
      const result = await translationService.chatCompletion([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ]);
      if (reqId !== analyzeReqRef.current) return;

      if (result.success && result.content) {
        let parsed;
        try {
          parsed = parseJsonReply(result.content);
        } catch (parseError) {
          logger.error('JSON parse:', parseError);
          // Fallback: treat length-30+ text as worth offering style-ref by default
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
      if (reqId !== analyzeReqRef.current) return;
      setAiSuggestions({ tags: [], summary: '', isStyleSuggested: false });
      setEditableTags('');
      setEditableSummary('');
    } finally {
      if (reqId === analyzeReqRef.current) setIsAnalyzing(false);
    }
  }, [currentTranslation, t]);

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

    // Kick off analysis as soon as the modal opens so the user doesn't wait
    analyzeContent();
  }, [currentTranslation.translatedText, analyzeContent, notify, t]);

  const closeSaveModal = useCallback(() => {
    // Invalidate any in-flight analysis so it can't repopulate after close
    analyzeReqRef.current++;
    setShowSaveModal(false);
  }, []);

  const executeSave = useCallback(() => {
    // Accept both ASCII and fullwidth Chinese commas as separators
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
    closeSaveModal();
  }, [editableTags, editableSummary, saveAsStyleRef, currentTranslation, addToFavorites, notify, t, closeSaveModal]);

  return {
    showSaveModal,
    closeSaveModal,
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
