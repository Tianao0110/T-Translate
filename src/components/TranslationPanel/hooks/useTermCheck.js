// Detects glossary terms in source/translation pairs and offers the saved
// canonical translation when the LLM picked a different rendering.

import { useState, useCallback } from 'react';
import createLogger from '../../../utils/logger.js';

const logger = createLogger('useTermCheck');

export default function useTermCheck(favorites, setTranslatedText, notify, t) {
  const [termSuggestions, setTermSuggestions] = useState([]);
  const [dismissedTerms, setDismissedTerms] = useState(new Set());

  const checkTermConsistency = useCallback((sourceText, translatedText) => {
    if (!favorites || favorites.length === 0) return;
    if (!sourceText || !translatedText) return;

    const suggestions = [];
    const sourceLower = sourceText.toLowerCase();
    const translatedLower = translatedText.toLowerCase();

    const glossaryItems = favorites.filter(fav => fav.folderId === 'glossary');

    glossaryItems.forEach(fav => {
      if (!fav.sourceText || !fav.translatedText) return;

      const favSourceLower = fav.sourceText.toLowerCase().trim();
      const favTranslatedLower = fav.translatedText.toLowerCase().trim();

      // Limit to short terms — multi-sentence glossary entries cause too many false positives
      if (favSourceLower.length <= 50 && favSourceLower.length >= 2) {
        if (sourceLower.includes(favSourceLower)) {
          // Surface only when the canonical translation is *missing* from the output
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

    const filtered = suggestions.filter(s => !dismissedTerms.has(s.id));
    setTermSuggestions(filtered);
  }, [favorites, dismissedTerms]);

  // Three-tier substitution: exact match -> word-of-term match -> manual via clipboard
  const applyTermSuggestion = useCallback((suggestion, currentTranslatedText) => {
    let newText = currentTranslatedText;
    let replaced = false;
    let replaceInfo = '';

    // Strategy 1: source term appears verbatim in translation (LLM left it untranslated)
    const termRegex = new RegExp(
      suggestion.originalTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'
    );
    if (termRegex.test(currentTranslatedText)) {
      newText = currentTranslatedText.replace(termRegex, suggestion.savedTranslation);
      replaced = true;
      replaceInfo = `"${suggestion.originalTerm}" → "${suggestion.savedTranslation}"`;
    }

    // Strategy 2: any individual word of the term appears (partial verbatim)
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

    // Strategy 3: copy canonical translation to clipboard so user pastes manually
    if (replaced) {
      setTranslatedText(newText);
      notify(t('translation.autoReplaced', { info: replaceInfo }), 'success');
    } else {
      navigator.clipboard.writeText(suggestion.savedTranslation);
      notify(t('translation.copiedForManualReplace', { text: suggestion.savedTranslation }), 'info');
    }

    setTermSuggestions(prev => prev.filter(s => s.id !== suggestion.id));
  }, [setTranslatedText, notify, t]);

  // permanent=true adds to the dismiss set; otherwise just hides for this translation
  const dismissTermSuggestion = useCallback((suggestion, permanent = false) => {
    setTermSuggestions(prev => prev.filter(s => s.id !== suggestion.id));
    if (permanent) {
      setDismissedTerms(prev => new Set([...prev, suggestion.id]));
    }
  }, []);

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
