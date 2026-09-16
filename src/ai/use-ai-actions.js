// Shared wiring for the data-driven AI actions: which ones this surface may
// offer right now, running one, and holding its result.

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { BUILTIN_AI_ACTIONS, longFormGate } from '../config/ai-actions.js';
import {
  checkActionAvailability,
  getActionCapabilities,
  isAttachableResult,
  resolveActionLabel,
  resolveActionPath,
  runAiAction,
} from './ai-action-runner.js';
import { ensureImportedActions, refreshImportedActions } from './ai-action-store.js';
import translationService from '../translation/stack-client.js';
import createLogger from '../core/logger.js';

const logger = createLogger('useAiActions');

// Read at use time, not at mount; cached on the raw string.
let _settingsRaw = null;
let _longFormCache;
function userLongFormGate() {
  try {
    const raw = localStorage.getItem('settings');
    if (raw !== _settingsRaw) {
      _settingsRaw = raw;
      const chars = JSON.parse(raw || '{}')?.aiActions?.longFormChars;
      _longFormCache = chars ? longFormGate(chars) : undefined;
    }
    return _longFormCache;
  } catch {
    return undefined;
  }
}

// attachResult: how this window records a result onto the translation it came
// from. The main panel hands over the store action; the overlay windows hand
// over their IPC bridge, since only the main window owns the history.
export default function useAiActions(surface, attachResult) {
  const { i18n } = useTranslation();
  const [capabilities, setCapabilities] = useState({ text: false, vision: false });
  const [runningId, setRunningId] = useState(null);
  // One result per action, remembered with the text it was made from.
  const [results, setResults] = useState({});
  const [expandedId, setExpandedId] = useState(null);
  // User-imported action configs, alongside the built-ins.
  const [imported, setImported] = useState([]);

  // Re-probed whenever the stack reloads.
  useEffect(() => {
    let cancelled = false;
    const probe = () => {
      getActionCapabilities()
        .then((caps) => { if (!cancelled) setCapabilities(caps); })
        .catch((e) => logger.error('Capability probe failed:', e));
      refreshImportedActions()
        .then((actions) => { if (!cancelled) setImported(actions); })
        .catch((e) => logger.error('Imported action load failed:', e));
    };
    ensureImportedActions()
      .then((actions) => { if (!cancelled) setImported(actions); })
      .catch(() => {});
    probe();
    const off = translationService.onChanged?.(probe);
    return () => {
      cancelled = true;
      if (off) off();
    };
  }, []);

  // ctx: { displayMode, text, hasImage }
  const availableActions = useCallback((ctx = {}) => {
    const gate = userLongFormGate();
    return [...BUILTIN_AI_ACTIONS, ...imported].filter(
      action => checkActionAvailability(
        action, { longFormGate: gate, ...ctx, surface, capabilities }
      ).available
    );
  }, [surface, capabilities, imported]);

  // Which pipeline an action would use, so a surface can say up front that
  // the capture itself is about to be sent.
  const pathFor = useCallback((action, hasImage) => (
    resolveActionPath(action, { capabilities, hasImage })
  ), [capabilities]);

  // What the surface should render right now, or null once the window has
  // moved on to different text or a different reading language.
  const expandedFor = useCallback((sourceText, targetLanguage) => {
    const entry = expandedId ? results[expandedId] : null;
    if (!entry || entry.sourceText !== sourceText) return null;
    if (targetLanguage !== undefined && entry.targetLanguage !== targetLanguage) return null;
    return entry;
  }, [expandedId, results]);

  // Surfaces that share one slot between the source text and a result.
  const collapse = useCallback(() => setExpandedId(null), []);

  // First click runs the action, later clicks fold its result away and back.
  const toggle = useCallback(async (action, context) => {
    const cached = results[action.id];
    // Identity is the passage and the language it was answered in.
    if (cached && cached.sourceText === context.sourceText
        && cached.targetLanguage === context.targetLanguage) {
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
            targetLanguage: context.targetLanguage,
            content: result.content,
            path: result.path,
            provider: result.provider || '',
          },
        }));
        setExpandedId(action.id);
        // The store applies the secure-mode gate and decides which entry this
        // hangs on.
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

  return { capabilities, imported, availableActions, pathFor, runningId, toggle, expandedFor, collapse };
}
