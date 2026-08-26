// Onboarding state decides whether a user is interrupted. The failure that
// matters is not "a hint did not show" — it is showing the welcome dialog to
// someone on their hundredth launch, which they cannot stop and cannot
// explain. So every uncertain path here has to fall to "already seen".

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import useOnboarding from '../../src/hooks/use-onboarding.js';

let store;

beforeEach(() => {
  store = {};
  window.electron = {
    store: {
      get: vi.fn(async (key) => store[key]),
      set: vi.fn(async (key, value) => { store[key] = value; }),
    },
  };
});

const mounted = async () => {
  const view = renderHook(() => useOnboarding());
  await waitFor(() => expect(view.result.current.loaded).toBe(true));
  return view;
};

describe('useOnboarding', () => {
  it('shows the welcome dialog when nothing has been stored yet', async () => {
    const { result } = await mounted();
    expect(result.current.showWelcome).toBe(true);
  });

  it('does not show it again once seen', async () => {
    store.onboarding = { welcomeSeen: true, hints: {} };
    const { result } = await mounted();
    expect(result.current.showWelcome).toBe(false);
  });

  it('says nothing at all until the store answers', () => {
    const { result } = renderHook(() => useOnboarding());
    expect(result.current.loaded).toBe(false);
    expect(result.current.showWelcome).toBe(false);
  });

  // The asymmetry that matters: a broken store must not turn into a dialog
  // the user sees on every launch with no way to dismiss it permanently.
  it('assumes already-seen when the store cannot be read', async () => {
    window.electron.store.get = vi.fn().mockRejectedValue(new Error('no store'));
    const { result } = await mounted();
    expect(result.current.showWelcome).toBe(false);
    expect(result.current.hintSeen('styleRewrite')).toBe(true);
  });

  it('survives having no bridge at all', () => {
    window.electron = undefined;
    const { result } = renderHook(() => useOnboarding());
    expect(result.current.loaded).toBe(false);
    expect(() => result.current.dismissHint('favorite')).not.toThrow();
  });

  it('persists the welcome flag', async () => {
    const { result } = await mounted();
    act(() => result.current.markWelcomeSeen());

    expect(result.current.showWelcome).toBe(false);
    expect(store.onboarding).toMatchObject({ welcomeSeen: true });
  });

  it('dismisses one hint without touching the other', async () => {
    const { result } = await mounted();
    act(() => result.current.dismissHint('styleRewrite'));

    expect(result.current.hintSeen('styleRewrite')).toBe(true);
    expect(result.current.hintSeen('favorite')).toBe(false);
  });

  it('dismissing a hint does not un-see the welcome dialog', async () => {
    store.onboarding = { welcomeSeen: true, hints: {} };
    const { result } = await mounted();
    act(() => result.current.dismissHint('favorite'));

    expect(result.current.showWelcome).toBe(false);
    expect(store.onboarding.welcomeSeen).toBe(true);
  });

  it('reset brings back the dialog and both hints', async () => {
    store.onboarding = { welcomeSeen: true, hints: { styleRewrite: true, favorite: true } };
    const { result } = await mounted();
    act(() => result.current.reset());

    expect(result.current.showWelcome).toBe(true);
    expect(result.current.hintSeen('styleRewrite')).toBe(false);
    expect(store.onboarding).toEqual({ welcomeSeen: false, hints: {} });
  });
});
