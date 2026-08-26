import { useCallback, useRef, useState } from 'react';
import { getAiAction } from '../config/ai-actions.js';
import { runAiAction } from '../services/ai-action-runner.js';

// Give up on a batch once the provider has clearly stopped answering, rather
// than firing one doomed request per paragraph through a whole document.
const MAX_CONSECUTIVE_FAILURES = 3;

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
 * Notes live in a ref as well as state so that `explain` does not change
 * identity every time one lands. It is passed to every memoized SegmentItem,
 * and a batch over a long document would otherwise re-render all of them once
 * per completed note.
 *
 * reset() lives here because notes are keyed by segment id and ids restart at
 * 0 for every document — a load path that forgot to clear them would show the
 * previous document's explanations against the new one's paragraphs.
 */
export default function useSegmentNotes({ capabilities, sourceLang, targetLang, onError }) {
  const [notes, setNotes] = useState({});
  const [folded, setFolded] = useState({});
  const [runningId, setRunningId] = useState(null);
  // { done, total } while a batch is walking the document, else null.
  const [batch, setBatch] = useState(null);

  const notesRef = useRef({});
  const busyRef = useRef(false);
  const stopRef = useRef(false);

  const putNote = useCallback((id, content) => {
    notesRef.current = { ...notesRef.current, [id]: content };
    setNotes(notesRef.current);
  }, []);

  // Returns the error string, or null on success.
  const runOne = useCallback(async (segment) => {
    const action = getAiAction('explain');
    if (!action) return 'no action';
    const result = await runAiAction(action, {
      sourceText: segment.original,
      translatedText: segment.translated || '',
      sourceLanguage: sourceLang,
      targetLanguage: targetLang,
      capabilities,
    });
    if (result.success) {
      putNote(segment.id, result.content);
      return null;
    }
    return result.error || 'failed';
  }, [sourceLang, targetLang, capabilities, putNote]);

  const explain = useCallback(async (segment) => {
    if (notesRef.current[segment.id]) {
      setFolded((prev) => ({ ...prev, [segment.id]: !prev[segment.id] }));
      return;
    }
    if (busyRef.current) return;

    busyRef.current = true;
    setRunningId(segment.id);
    try {
      const error = await runOne(segment);
      if (error) onError?.(error);
    } finally {
      busyRef.current = false;
      setRunningId(null);
    }
  }, [runOne, onError]);

  /**
   * Explain every paragraph that has no note yet. Same worker-pool shape as the
   * document's translation pass, for the same reason: local models serialize on
   * the GPU, so a low concurrency is not a limitation.
   *
   * Resolves with the finished note map as well as the counts: React state has
   * not propagated to the caller's closure yet, and the caller's next step is
   * to summarize exactly these notes.
   *
   * @returns {{done: number, failed: number, skipped: number, stopped: boolean, notes: object}}
   */
  const explainAll = useCallback(async (segments, { concurrency = 2 } = {}) => {
    if (busyRef.current) return null;

    const pending = (segments || []).filter(
      (s) => !notesRef.current[s.id] && String(s.original || '').trim()
    );
    const skipped = (segments || []).length - pending.length;
    if (!pending.length) {
      return { done: 0, failed: 0, skipped, stopped: false, notes: notesRef.current };
    }

    busyRef.current = true;
    stopRef.current = false;
    setBatch({ done: 0, total: pending.length });

    let cursor = 0;
    let done = 0;
    let failed = 0;
    let streak = 0;
    let firstError = null;

    const worker = async () => {
      for (;;) {
        if (stopRef.current) return;
        const index = cursor++;
        if (index >= pending.length) return;

        const error = await runOne(pending[index]);
        if (error) {
          failed += 1;
          streak += 1;
          if (!firstError) firstError = error;
          if (streak >= MAX_CONSECUTIVE_FAILURES) stopRef.current = true;
        } else {
          done += 1;
          streak = 0;
        }
        setBatch({ done: done + failed, total: pending.length });
      }
    };

    try {
      await Promise.all(
        Array.from({ length: Math.max(1, concurrency) }, () => worker())
      );
    } finally {
      busyRef.current = false;
      setBatch(null);
    }

    // One report for the batch — a dead provider must not raise a toast per
    // paragraph.
    if (firstError) onError?.(firstError);
    return { done, failed, skipped, stopped: stopRef.current, notes: notesRef.current };
  }, [runOne, onError]);

  const stopBatch = useCallback(() => { stopRef.current = true; }, []);

  // Restore path: re-seat notes saved with the document's progress blob.
  // Existing notes win — one the reader just made must not be clobbered by
  // an old blob arriving late. Non-string values are dropped (the blob is
  // hand-editable localStorage).
  const seed = useCallback((map) => {
    if (!map || typeof map !== 'object') return;
    const clean = {};
    for (const [id, content] of Object.entries(map)) {
      if (typeof content === 'string' && content) clean[id] = content;
    }
    if (!Object.keys(clean).length) return;
    notesRef.current = { ...clean, ...notesRef.current };
    setNotes(notesRef.current);
  }, []);

  const reset = useCallback(() => {
    notesRef.current = {};
    setNotes({});
    setFolded({});
  }, []);

  return { notes, folded, runningId, batch, explain, explainAll, stopBatch, seed, reset };
}
