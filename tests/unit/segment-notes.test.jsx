// A document keeps many explanations alive at once, so it cannot use the
// shared hook's single-result store. What it must not lose in that trade is
// the fold contract — a second click puts the note away instead of paying for
// it again — and the rule that notes belong to the document they were made
// from: ids restart at 0, so a stale note would land on a different paragraph.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const runAiAction = vi.fn();
vi.mock('../../src/services/ai-action-runner.js', async (importOriginal) => ({
  ...(await importOriginal()),
  runAiAction: (...args) => runAiAction(...args),
}));

const useSegmentNotes = (await import('../../src/hooks/use-segment-notes.js')).default;

const seg = (id, original) => ({ id, original, translated: '' });
const options = { capabilities: { text: true }, sourceLang: 'en', targetLang: 'zh' };

beforeEach(() => {
  runAiAction.mockReset();
  runAiAction.mockResolvedValue({ success: true, content: '这段在说自注意力' });
});

describe('document segment notes', () => {
  it('explains a paragraph on the first click', async () => {
    const { result } = renderHook(() => useSegmentNotes(options));

    await act(async () => { await result.current.explain(seg(3, 'self-attention...')); });

    expect(runAiAction).toHaveBeenCalledTimes(1);
    expect(runAiAction.mock.calls[0][1]).toMatchObject({ sourceText: 'self-attention...' });
    expect(result.current.notes[3]).toBe('这段在说自注意力');
    expect(result.current.folded[3]).toBeFalsy();
  });

  it('folds the note away and back instead of running again', async () => {
    const { result } = renderHook(() => useSegmentNotes(options));
    const s = seg(3, 'self-attention...');

    await act(async () => { await result.current.explain(s); });
    await act(async () => { await result.current.explain(s); });

    expect(result.current.folded[3]).toBe(true);
    expect(result.current.notes[3]).toBe('这段在说自注意力');

    await act(async () => { await result.current.explain(s); });

    expect(result.current.folded[3]).toBe(false);
    expect(runAiAction).toHaveBeenCalledTimes(1);
  });

  it('keeps one note per paragraph', async () => {
    const { result } = renderHook(() => useSegmentNotes(options));

    await act(async () => { await result.current.explain(seg(0, 'first')); });
    runAiAction.mockResolvedValue({ success: true, content: '第二段' });
    await act(async () => { await result.current.explain(seg(1, 'second')); });

    expect(result.current.notes).toEqual({ 0: '这段在说自注意力', 1: '第二段' });
  });

  it('seeds restored notes but never clobbers one the reader just made', async () => {
    const { result } = renderHook(() => useSegmentNotes(options));

    await act(async () => { await result.current.explain(seg(0, 'first')); });
    act(() => { result.current.seed({ 0: '旧讲解', 2: '恢复的讲解' }); });

    expect(result.current.notes[0]).toBe('这段在说自注意力');
    expect(result.current.notes[2]).toBe('恢复的讲解');
  });

  it('drops non-string values while seeding (blob is hand-editable)', () => {
    const { result } = renderHook(() => useSegmentNotes(options));

    act(() => { result.current.seed({ 0: '好的', 1: { text: 'bad' }, 2: '', 3: 42 }); });

    expect(result.current.notes).toEqual({ 0: '好的' });
  });

  it('ignores a seed with nothing usable', () => {
    const { result } = renderHook(() => useSegmentNotes(options));

    act(() => { result.current.seed(null); });
    act(() => { result.current.seed('nope'); });
    act(() => { result.current.seed({}); });

    expect(result.current.notes).toEqual({});
  });

  it('drops every note on reset, folded ones included', async () => {
    const { result } = renderHook(() => useSegmentNotes(options));
    const s = seg(0, 'first');

    await act(async () => { await result.current.explain(s); });
    await act(async () => { await result.current.explain(s); });
    act(() => { result.current.reset(); });

    expect(result.current.notes).toEqual({});
    expect(result.current.folded).toEqual({});

    // A leftover fold would hide the new document's first explanation.
    await act(async () => { await result.current.explain(seg(0, 'a new document')); });
    expect(result.current.folded[0]).toBeFalsy();
    expect(runAiAction).toHaveBeenCalledTimes(2);
  });

  it('reports the failure and leaves nothing behind', async () => {
    const onError = vi.fn();
    runAiAction.mockResolvedValue({ success: false, error: '没有可用的大模型翻译源' });
    const { result } = renderHook(() => useSegmentNotes({ ...options, onError }));

    await act(async () => { await result.current.explain(seg(2, 'x')); });

    expect(onError).toHaveBeenCalledWith('没有可用的大模型翻译源');
    expect(result.current.notes[2]).toBeUndefined();
    expect(result.current.runningId).toBeNull();
  });

  describe('explainAll — the one-button pass over a document', () => {
    const doc = [seg(0, 'first'), seg(1, 'second'), seg(2, 'third')];

    it('explains every paragraph that has no note yet', async () => {
      const { result } = renderHook(() => useSegmentNotes(options));

      let outcome;
      await act(async () => { outcome = await result.current.explainAll(doc); });

      expect(runAiAction).toHaveBeenCalledTimes(3);
      expect(outcome).toMatchObject({ done: 3, failed: 0, stopped: false });
      expect(Object.keys(result.current.notes)).toHaveLength(3);
    });

    it('does not pay again for paragraphs already explained', async () => {
      const { result } = renderHook(() => useSegmentNotes(options));

      await act(async () => { await result.current.explain(doc[1]); });
      runAiAction.mockClear();
      await act(async () => { await result.current.explainAll(doc); });

      expect(runAiAction).toHaveBeenCalledTimes(2);
    });

    it('skips paragraphs with no text', async () => {
      const { result } = renderHook(() => useSegmentNotes(options));

      let outcome;
      await act(async () => {
        outcome = await result.current.explainAll([seg(0, 'real'), seg(1, '   '), seg(2, '')]);
      });

      expect(runAiAction).toHaveBeenCalledTimes(1);
      expect(outcome.skipped).toBe(2);
    });

    // The caller's next step is to summarize these notes, and React state has
    // not reached its closure yet — so the batch hands them back directly.
    it('returns the finished notes, not just the counts', async () => {
      const { result } = renderHook(() => useSegmentNotes(options));

      let outcome;
      await act(async () => { outcome = await result.current.explainAll(doc); });

      expect(outcome.notes[0]).toBe('这段在说自注意力');
      expect(Object.keys(outcome.notes)).toHaveLength(3);
    });

    it('gives up once the provider has failed three times running', async () => {
      runAiAction.mockResolvedValue({ success: false, error: '没有可用的大模型翻译源' });
      const onError = vi.fn();
      const { result } = renderHook(() => useSegmentNotes({ ...options, onError }));
      const long = Array.from({ length: 40 }, (_, i) => seg(i, `p${i}`));

      let outcome;
      await act(async () => { outcome = await result.current.explainAll(long, { concurrency: 1 }); });

      expect(runAiAction).toHaveBeenCalledTimes(3);
      expect(outcome).toMatchObject({ done: 0, failed: 3, stopped: true });
      // One report for the batch, not one per paragraph.
      expect(onError).toHaveBeenCalledTimes(1);
    });

    it('reports progress while it runs and clears it after', async () => {
      const seen = [];
      let release;
      runAiAction.mockImplementation(() => new Promise((r) => { release = r; }));
      const { result } = renderHook(() => useSegmentNotes(options));

      let pending;
      act(() => { pending = result.current.explainAll(doc, { concurrency: 1 }); });
      seen.push(result.current.batch);

      await act(async () => {
        for (let i = 0; i < 3; i++) {
          release({ success: true, content: 'x' });
          await Promise.resolve();
          await Promise.resolve();
        }
        await pending;
      });

      expect(seen[0]).toEqual({ done: 0, total: 3 });
      expect(result.current.batch).toBeNull();
    });

    it('stops on request and keeps what it already has', async () => {
      const { result } = renderHook(() => useSegmentNotes(options));
      const long = Array.from({ length: 20 }, (_, i) => seg(i, `p${i}`));

      runAiAction.mockImplementation(async () => {
        result.current.stopBatch();
        return { success: true, content: 'note' };
      });

      let outcome;
      await act(async () => { outcome = await result.current.explainAll(long, { concurrency: 1 }); });

      expect(outcome.stopped).toBe(true);
      expect(outcome.done).toBe(1);
      expect(result.current.notes[0]).toBe('note');
    });

    it('refuses to start while a single explanation is in flight', async () => {
      let release;
      runAiAction.mockReturnValue(new Promise((r) => { release = r; }));
      const { result } = renderHook(() => useSegmentNotes(options));

      let single;
      act(() => { single = result.current.explain(doc[0]); });
      let outcome;
      await act(async () => { outcome = await result.current.explainAll(doc); });

      expect(outcome).toBeNull();
      await act(async () => { release({ success: true, content: 'x' }); await single; });
    });
  });

  it('ignores a click while another paragraph is still running', async () => {
    let release;
    runAiAction.mockReturnValue(new Promise((r) => { release = r; }));
    const { result } = renderHook(() => useSegmentNotes(options));

    let first;
    act(() => { first = result.current.explain(seg(0, 'first')); });
    await act(async () => { await result.current.explain(seg(1, 'second')); });

    expect(runAiAction).toHaveBeenCalledTimes(1);

    await act(async () => { release({ success: true, content: '好了' }); await first; });
    expect(result.current.runningId).toBeNull();
  });
});
