// The AI action entry is a fold-open toggle, not a launcher: the first click
// runs the action, later clicks put its result away and back, and a result is
// dropped once the window moves on to different text. That last rule is what
// keeps a summary from being shown against the passage it was not made from.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const runAiAction = vi.fn();
vi.mock('../../src/services/ai-action-runner.js', async (importOriginal) => ({
  ...(await importOriginal()),
  runAiAction: (...args) => runAiAction(...args),
  getActionCapabilities: async () => ({ text: true, vision: false }),
}));

vi.mock('../../src/services/stack-client.js', () => ({
  default: { onChanged: () => () => {} },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k, fallback) => fallback || _k, i18n: { language: 'zh' } }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

const useAiActions = (await import('../../src/hooks/use-ai-actions.js')).default;
const { getAiAction } = await import('../../src/config/ai-actions.js');

const summarize = getAiAction('summarize');
const context = { sourceText: 'a long passage', targetLanguage: 'zh' };

beforeEach(() => {
  runAiAction.mockReset();
  runAiAction.mockResolvedValue({ success: true, content: 'three points', path: 'text' });
});

describe('AI action toggle', () => {
  it('runs on the first click and shows the result', async () => {
    const { result } = renderHook(() => useAiActions('selection'));

    await act(async () => { await result.current.toggle(summarize, context); });

    expect(runAiAction).toHaveBeenCalledTimes(1);
    expect(result.current.expandedFor('a long passage'))
      .toMatchObject({ actionId: 'summarize', content: 'three points' });
  });

  it('collapses on demand, so the shared panel can hand the slot to the source text', async () => {
    const { result } = renderHook(() => useAiActions('selection'));

    await act(async () => { await result.current.toggle(summarize, context); });
    act(() => { result.current.collapse(); });

    expect(result.current.expandedFor('a long passage')).toBeNull();
  });

  it('folds away on the second click without asking the model again', async () => {
    const { result } = renderHook(() => useAiActions('selection'));

    await act(async () => { await result.current.toggle(summarize, context); });
    await act(async () => { await result.current.toggle(summarize, context); });

    expect(runAiAction).toHaveBeenCalledTimes(1);
    expect(result.current.expandedFor('a long passage')).toBeNull();
  });

  it('folds back open from cache on the third click', async () => {
    const { result } = renderHook(() => useAiActions('selection'));

    await act(async () => { await result.current.toggle(summarize, context); });
    await act(async () => { await result.current.toggle(summarize, context); });
    await act(async () => { await result.current.toggle(summarize, context); });

    expect(runAiAction).toHaveBeenCalledTimes(1);
    expect(result.current.expandedFor('a long passage')).toMatchObject({ content: 'three points' });
  });

  it('shows nothing once the window holds different text', async () => {
    const { result } = renderHook(() => useAiActions('selection'));

    await act(async () => { await result.current.toggle(summarize, context); });

    expect(result.current.expandedFor('a different passage')).toBeNull();
  });

  it('re-runs for new text instead of reusing the previous answer', async () => {
    const { result } = renderHook(() => useAiActions('selection'));

    await act(async () => { await result.current.toggle(summarize, context); });
    runAiAction.mockResolvedValue({ success: true, content: 'other points', path: 'text' });
    await act(async () => {
      await result.current.toggle(summarize, { ...context, sourceText: 'a different passage' });
    });

    expect(runAiAction).toHaveBeenCalledTimes(2);
    expect(result.current.expandedFor('a different passage')).toMatchObject({ content: 'other points' });
  });

  it('keeps nothing when the action fails', async () => {
    runAiAction.mockResolvedValue({ success: false, error: 'no chat provider' });
    const { result } = renderHook(() => useAiActions('selection'));

    let outcome;
    await act(async () => { outcome = await result.current.toggle(summarize, context); });

    expect(outcome).toMatchObject({ success: false });
    expect(result.current.expandedFor('a long passage')).toBeNull();
  });

  it('records the result on the translation it came from', async () => {
    const attach = vi.fn();
    const { result } = renderHook(() => useAiActions('selection', attach));

    await act(async () => { await result.current.toggle(summarize, context); });

    expect(attach).toHaveBeenCalledWith(expect.objectContaining({
      sourceText: 'a long passage', actionId: 'summarize', content: 'three points',
    }));
  });
});
