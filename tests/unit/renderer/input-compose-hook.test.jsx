// The source box asks the built-in model for a word only after a typing
// pause, only when history has nothing, and shows an answer only for the
// exact text it was asked about.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const compose = vi.fn();
const composeWarm = vi.fn();
vi.mock('../../../src/translation/stack-client.js', () => ({
  default: { compose: (...a) => compose(...a), composeWarm: (...a) => composeWarm(...a) },
}));

const { default: useInputCompletion } = await import('../../../src/components/TranslationPanel/hooks/useInputCompletion.js');

const setup = (props) => {
  const textareaRef = { current: null };
  return renderHook((p) => useInputCompletion({ enabled: true, modelEnabled: true, history: [], favorites: [], textareaRef, onAccept: vi.fn(), ...p }), { initialProps: props });
};

beforeEach(() => {
  vi.useFakeTimers();
  compose.mockReset();
  composeWarm.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('model word suggestions in the source box', () => {
  it('asks after the pause and shows the answer; focus warms the model', async () => {
    compose.mockResolvedValue('sday');
    const { result } = setup({ text: 'moved to Thur' });
    act(() => result.current.handlers.onFocus());
    expect(composeWarm).toHaveBeenCalledTimes(1);
    expect(compose).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(compose).toHaveBeenCalledWith('moved to Thur');
    expect(result.current.suffix).toBe('sday');
  });

  it('history wins and the model is not asked', async () => {
    const { result } = setup({ text: 'hel', history: [{ sourceText: 'hello world' }] });
    act(() => result.current.handlers.onFocus());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(compose).not.toHaveBeenCalled();
    expect(result.current.suffix).toBe('lo world');
  });

  it('an answer for older text is never shown', async () => {
    compose.mockResolvedValue('sday');
    const { result, rerender } = setup({ text: 'moved to Thur' });
    act(() => result.current.handlers.onFocus());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    compose.mockResolvedValue('');
    rerender({ text: 'moved to Thurx' });
    expect(result.current.suffix).toBe('');
  });

  it('off means no request and no warm-up', async () => {
    const { result } = setup({ text: 'moved to Thur', modelEnabled: false });
    act(() => result.current.handlers.onFocus());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(compose).not.toHaveBeenCalled();
    expect(composeWarm).not.toHaveBeenCalled();
  });
});
