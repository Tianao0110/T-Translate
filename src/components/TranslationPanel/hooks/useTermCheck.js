// src/components/TranslationPanel/hooks/useTermCheck.js
// 术语一致性检测逻辑 - 从 TranslationPanel 抽出
//
// 检测译文中是否使用了术语库中的推荐翻译

import { useState, useCallback } from 'react';
import createLogger from '../../../utils/logger.js';

const logger = createLogger('useTermCheck');

/**
 * 术语一致性检测 Hook
 * @param {Array} favorites - 收藏列表（包含术语库）
 * @param {Function} setTranslatedText - 设置译文的函数
 * @param {Function} notify - 通知函数
 * @param {Function} t - i18n 翻译函数
 * @returns {Object} 术语检测状态和操作方法
 */
export default function useTermCheck(favorites, setTranslatedText, notify, t) {
  const [termSuggestions, setTermSuggestions] = useState([]);
  const [dismissedTerms, setDismissedTerms] = useState(new Set());

  // 检测术语一致性
  const checkTermConsistency = useCallback((sourceText, translatedText) => {
    if (!favorites || favorites.length === 0) return;
    if (!sourceText || !translatedText) return;

    const suggestions = [];
    const sourceLower = sourceText.toLowerCase();
    const translatedLower = translatedText.toLowerCase();

    // 只检测术语库中的内容
    const glossaryItems = favorites.filter(fav => fav.folderId === 'glossary');

    glossaryItems.forEach(fav => {
      if (!fav.sourceText || !fav.translatedText) return;

      const favSourceLower = fav.sourceText.toLowerCase().trim();
      const favTranslatedLower = fav.translatedText.toLowerCase().trim();

      // 只检测短术语（2-50字符）
      if (favSourceLower.length <= 50 && favSourceLower.length >= 2) {
        if (sourceLower.includes(favSourceLower)) {
          if (!translatedLower.includes(favTranslatedLower)) {
            suggestions.push({
              id: fav.id,
              originalTerm: fav.sourceText,
              savedTranslation: fav.translatedText,
              note: fav.note,
            });
          }
        }
      }
    });

    // 过滤已忽略的
    const filtered = suggestions.filter(s => !dismissedTerms.has(s.id));
    setTermSuggestions(filtered);
  }, [favorites, dismissedTerms]);

  // 应用术语 - 尝试自动替换，失败则复制到剪贴板
  const applyTermSuggestion = useCallback((suggestion, currentTranslatedText) => {
    let newText = currentTranslatedText;
    let replaced = false;
    let replaceInfo = '';

    // 策略1：原术语直接出现在译文中
    const termRegex = new RegExp(
      suggestion.originalTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'
    );
    if (termRegex.test(currentTranslatedText)) {
      newText = currentTranslatedText.replace(termRegex, suggestion.savedTranslation);
      replaced = true;
      replaceInfo = `"${suggestion.originalTerm}" → "${suggestion.savedTranslation}"`;
    }

    // 策略2：术语的单词出现在译文中
    if (!replaced) {
      const termWords = suggestion.originalTerm.split(/\s+/);
      for (const word of termWords) {
        if (word.length >= 2 && currentTranslatedText.includes(word)) {
          const wordRegex = new RegExp(
            word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'
          );
          newText = newText.replace(wordRegex, suggestion.savedTranslation);
          replaced = true;
          replaceInfo = `"${word}" → "${suggestion.savedTranslation}"`;
          break;
        }
      }
    }

    // 策略3：无法自动替换，复制到剪贴板
    if (replaced) {
      setTranslatedText(newText);
      notify(t('translation.autoReplaced', { info: replaceInfo }), 'success');
    } else {
      navigator.clipboard.writeText(suggestion.savedTranslation);
      notify(t('translation.copiedForManualReplace', { text: suggestion.savedTranslation }), 'info');
    }

    setTermSuggestions(prev => prev.filter(s => s.id !== suggestion.id));
  }, [setTranslatedText, notify, t]);

  // 忽略术语建议
  const dismissTermSuggestion = useCallback((suggestion, permanent = false) => {
    setTermSuggestions(prev => prev.filter(s => s.id !== suggestion.id));
    if (permanent) {
      setDismissedTerms(prev => new Set([...prev, suggestion.id]));
    }
  }, []);

  // 始终使用此术语
  const alwaysUseTerm = useCallback((suggestion) => {
    notify(
      t('translation.termSet') + `: "${suggestion.originalTerm}" → "${suggestion.savedTranslation}"`,
      'success'
    );
    setTermSuggestions(prev => prev.filter(s => s.id !== suggestion.id));
  }, [notify, t]);

  return {
    termSuggestions,
    checkTermConsistency,
    applyTermSuggestion,
    dismissTermSuggestion,
    alwaysUseTerm,
  };
}
