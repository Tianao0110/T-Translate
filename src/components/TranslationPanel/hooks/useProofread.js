// Proofread button for the source box: the chat model fixes typos and
// grammar, and the fix goes in through the textarea's own editing so Ctrl+Z
// (or the toast's undo) brings the original back. Rules in
// docs/design/renderer.md.
import { useState, useCallback } from 'react';
import translationService from '../../../translation/stack-client.js';
import { getProofreadPrompts } from '../../../ai/ai-prompts.js';
import createLogger from '../../../core/logger.js';

const logger = createLogger('useProofread');

export const PROOFREAD_MAX_CHARS = 2000;
const UNDO_TOAST_MS = 6000;
const CJK = /[぀-ヿ㐀-鿿가-힯]/g;

// The model's answer cleaned up, or null when it does not look like the
// same text corrected (rewritten, translated, answered, cut short).
export function cleanProofread(reply, original) {
  if (typeof reply !== 'string' || typeof original !== 'string') return null;
  let s = reply.trim();
  s = s.replace(/^```[^\n]*\n([\s\S]*?)\n?```$/, '$1').trim();
  const quoted = /^["“「『'][\s\S]*["”」』']$/;
  if (quoted.test(s) && !quoted.test(original.trim())) s = s.slice(1, -1).trim();
  if (!/[ \t]\n/.test(original)) s = s.replace(/[ \t]+\n/g, '\n');
  if (!s) return null;

  const core = original.trim();
  const slack = Math.max(15, core.length * 0.4);
  if (Math.abs(s.length - core.length) > slack) return null;
  const cjk = (t) => (t.match(CJK) || []).length;
  if (cjk(s) > cjk(core) + 2) return null;

  const lead = original.match(/^\s*/)[0];
  const tail = original.match(/\s*$/)[0];
  return lead + s + tail;
}

// Whether the button applies: something to fix, in a script the model reads.
export function canProofread(text) {
  return typeof text === 'string' && !!text.trim() && /[A-Za-z]/.test(text) && text.length <= PROOFREAD_MAX_CHARS;
}

// Replaces the whole textarea through native editing; false when the
// browser refused, so the caller sets the text itself.
function replaceAll(ta, text) {
  ta.focus();
  ta.select();
  return document.execCommand('insertText', false, text);
}

export default function useProofread({ textareaRef, onReplace, notify, t }) {
  const [busy, setBusy] = useState(false);

  const run = useCallback(async () => {
    const ta = textareaRef.current;
    const original = ta?.value || '';
    if (busy || !ta || !canProofread(original)) return;
    setBusy(true);
    try {
      const { systemPrompt, userPrompt } = getProofreadPrompts(original);
      // Privacy fields are injected by the main-process facade.
      const result = await translationService.chatCompletion([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ], { requireChat: true });
      if (!result.success || !result.content) {
        notify(result.error || t('translation.proofreadFailed'), 'error');
        return;
      }
      const fixed = cleanProofread(result.content, original);
      if (fixed === null) {
        notify(t('translation.proofreadFailed'), 'error');
        return;
      }
      if (fixed === original) {
        notify(t('translation.proofreadClean'), 'success');
        return;
      }
      // Typed over while the model worked: keep what the user has now.
      if (ta.value !== original) return;
      const put = (text) => {
        if (!replaceAll(ta, text)) onReplace(text);
      };
      put(fixed);
      notify(t('translation.proofreadDone'), 'success', UNDO_TOAST_MS, {
        label: t('translation.proofreadUndo'),
        onClick: () => {
          if (ta.value === fixed) put(original);
        },
      });
    } catch (e) {
      logger.error('Proofread failed:', e);
      notify(t('translation.proofreadFailed'), 'error');
    } finally {
      setBusy(false);
    }
  }, [busy, textareaRef, onReplace, notify, t]);

  return { busy, run };
}
