// The source box asks the main process for a word only after a typing
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
  return renderHook((p) => useInputCompletion({ enabled: true, history: [], favorites: [], textareaRef, onAccept: vi.fn(), ...p }), { initialProps: props });
};

beforeEach(() => {
  vi.useFakeTimers();
  compose.mockReset();
  composeWarm.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('word completion in the source box', () => {
  it('inside a word asks after a short pause; focus warms the main process', async () => {
    compose.mockResolvedValue('sday');
    const { result } = setup({ text: 'moved to Thur' });
    act(() => result.current.handlers.onFocus());
    expect(composeWarm).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(140);
    });
    expect(compose).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(compose).toHaveBeenCalledWith('moved to Thur');
    expect(result.current.suffix).toBe('sday');
  });

  it('after a space waits longer before asking', async () => {
    compose.mockResolvedValue('you');
    const { result } = setup({ text: 'Let me know if ' });
    act(() => result.current.handlers.onFocus());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(compose).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120);
    });
    expect(result.current.suffix).toBe('you');
  });

  it('history wins and nothing is asked', async () => {
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
      await vi.advanceTimersByTimeAsync(200);
    });
    compose.mockResolvedValue('');
    rerender({ text: 'moved to Thurx' });
    expect(result.current.suffix).toBe('');
  });

  it('off means no request and no warm-up', async () => {
    const { result } = setup({ text: 'moved to Thur', enabled: false });
    act(() => result.current.handlers.onFocus());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(compose).not.toHaveBeenCalled();
    expect(composeWarm).not.toHaveBeenCalled();
  });
});
