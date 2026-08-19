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
