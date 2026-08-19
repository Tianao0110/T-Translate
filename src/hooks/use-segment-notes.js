import { useCallback, useState } from 'react';
import { getAiAction } from '../config/ai-actions.js';
import { runAiAction } from '../services/ai-action-runner.js';

/**
 * Per-paragraph explanations for a document.
 *
 * The shared use-ai-actions hook keeps one result per action and replaces it
 * when the source text changes; a document needs many notes alive at once, so
 * they are kept here keyed by segment. The fold contract is the same as the
 * shared one on purpose: the first click runs the action, later clicks put the
 * note away and back. Re-running would spend tokens to reproduce a note the
 * reader already has.
 *
 * reset() lives here because notes are keyed by segment id and ids restart at
 * 0 for every document — a load path that forgot to clear them would show the
 * previous document's explanations against the new one's paragraphs.
 */
export default function useSegmentNotes({ capabilities, sourceLang, targetLang, onError }) {
  const [notes, setNotes] = useState({});
  const [folded, setFolded] = useState({});
  const [runningId, setRunningId] = useState(null);

  const explain = useCallback(async (segment) => {
    if (notes[segment.id]) {
      setFolded((prev) => ({ ...prev, [segment.id]: !prev[segment.id] }));
      return;
    }
    const action = getAiAction('explain');
    if (!action || runningId !== null) return;

    setRunningId(segment.id);
    try {
      const result = await runAiAction(action, {
        sourceText: segment.original,
        translatedText: segment.translated || '',
        sourceLanguage: sourceLang,
        targetLanguage: targetLang,
        capabilities,
      });
      if (result.success) setNotes((prev) => ({ ...prev, [segment.id]: result.content }));
      else onError?.(result.error);
    } finally {
      setRunningId(null);
    }
  }, [notes, runningId, sourceLang, targetLang, capabilities, onError]);

  const reset = useCallback(() => {
    setNotes({});
    setFolded({});
  }, []);

  return { notes, folded, runningId, explain, reset };
}
