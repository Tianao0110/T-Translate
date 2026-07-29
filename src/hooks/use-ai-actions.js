// Shared wiring for the data-driven AI actions: which ones this surface may
// offer right now, and running one into its own result window. Generalizes the
// style-rewrite flow (result -> popup -> chatCompletion) so a new action is a
// config entry rather than another copy of this hook.

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

  // Resolves to the runner's result; the caller surfaces failures in whatever
  // notification channel its window owns.
  const run = useCallback(async (action, context, theme) => {
    setRunningId(action.id);
    try {
      const result = await runAiAction(action, { ...context, capabilities });
      if (result.success) {
        await window.electron?.aiResult?.open?.({
          actionId: action.id,
          title: resolveActionLabel(action, i18n.language || 'zh'),
          content: result.content,
          provider: result.provider || '',
          theme: theme || 'light',
        });
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
  }, [i18n.language, capabilities, attachResult]);

  return { capabilities, availableActions, pathFor, runningId, run };
}
