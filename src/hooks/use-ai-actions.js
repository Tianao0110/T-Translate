// Shared wiring for the data-driven AI actions: which ones this surface may
// offer right now, running one, and holding its result so the surface can
// expand it in place. Generalizes the style-rewrite flow (result -> chatCompletion
// -> shown next to the translation) so a new action is a config entry rather
// than another copy of this hook.

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { BUILTIN_AI_ACTIONS } from '@config/ai-actions';
import {
  checkActionAvailability,
  getActionCapabilities,
  isAttachableResult,
  resolveActionLabel,
  resolveActionPath,
  runAiAction,
} from '../services/ai-action-runner.js';
import translationService from '../services/stack-client.js';
import createLogger from '../utils/logger.js';

const logger = createLogger('useAiActions');

// attachResult: how this window records a result onto the translation it came
// from. The main panel hands over the store action; the overlay windows hand
// over their IPC bridge, since only the main window owns the history.
export default function useAiActions(surface, attachResult) {
  const { i18n } = useTranslation();
  const [capabilities, setCapabilities] = useState({ text: false, vision: false });
  const [runningId, setRunningId] = useState(null);
  // One result per action, remembered with the text it was made from so a new
  // translation can never show the previous passage's summary.
  const [results, setResults] = useState({});
  const [expandedId, setExpandedId] = useState(null);

  // Re-probed whenever the stack reloads: adding an LLM provider in settings
  // must light the entry up without restarting the window.
  useEffect(() => {
    let cancelled = false;
    const probe = () => {
      getActionCapabilities()
        .then((caps) => { if (!cancelled) setCapabilities(caps); })
        .catch((e) => logger.error('Capability probe failed:', e));
    };
    probe();
    const off = translationService.onChanged?.(probe);
    return () => {
      cancelled = true;
      if (off) off();
    };
  }, []);

  // ctx: { displayMode, text, hasImage }
  const availableActions = useCallback((ctx = {}) => (
    BUILTIN_AI_ACTIONS.filter(
      action => checkActionAvailability(action, { ...ctx, surface, capabilities }).available
    )
  ), [surface, capabilities]);

  // Which pipeline an action would use, so a surface can say up front that the
  // capture itself is about to be sent — an image gives away far more than the
  // line of text path A would send.
  const pathFor = useCallback((action, hasImage) => (
    resolveActionPath(action, { capabilities, hasImage })
  ), [capabilities]);

  // What the surface should render right now, or null. Returns nothing once the
  // window has moved on to different text.
  const expandedFor = useCallback((sourceText) => {
    const entry = expandedId ? results[expandedId] : null;
    return entry && entry.sourceText === sourceText ? entry : null;
  }, [expandedId, results]);

  // For surfaces that share one slot between the source text and a result:
  // whatever opens there closes whatever was there before.
  const collapse = useCallback(() => setExpandedId(null), []);

  // First click runs the action, later clicks fold its result away and back —
  // same as the card's source toggle, and it means a result can never become
  // the input of another run.
  const toggle = useCallback(async (action, context) => {
    const cached = results[action.id];
    if (cached && cached.sourceText === context.sourceText) {
      setExpandedId(expandedId === action.id ? null : action.id);
      return { success: true, content: cached.content };
    }

    setRunningId(action.id);
    try {
      const result = await runAiAction(action, { ...context, capabilities });
      if (result.success) {
        setResults(prev => ({
          ...prev,
          [action.id]: {
            actionId: action.id,
            label: resolveActionLabel(action, i18n.language || 'zh'),
            sourceText: context.sourceText,
            content: result.content,
            path: result.path,
            provider: result.provider || '',
          },
        }));
        setExpandedId(action.id);
        // The store applies the secure-mode gate and decides which entry this
        // hangs on — nothing to hang it on means it stays a one-off.
        if (isAttachableResult(action) && attachResult) {
          attachResult({
            sourceText: context.sourceText,
            actionId: action.id,
            content: result.content,
            provider: result.provider || '',
            path: result.path,
          });
        }
      }
      return result;
    } finally {
      setRunningId(null);
    }
  }, [i18n.language, capabilities, attachResult, results, expandedId]);

  return { capabilities, availableActions, pathFor, runningId, toggle, expandedFor, collapse };
}
