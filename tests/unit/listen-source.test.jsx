// Sound-source selection for listen mode (v0.4.1). What matters here is not
// "the dropdown works" — it is that a pid can never reach the native capture
// layer in a shape that means something other than what the user picked, and
// that switching source mid-session actually restarts capture instead of
// silently listening to the old one.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import useListenSession from '../../src/components/FloatingWindow/useListenSession.js';

let audioEngine;
let startCalls;

beforeEach(() => {
  startCalls = [];
  audioEngine = {
    getInfo: vi.fn(async () => ({ modelName: 'test-model', secureBlocked: false })),
    start: vi.fn((opts) => startCalls.push(opts)),
    stop: vi.fn(),
    listSources: vi.fn(async () => ({
      supported: true,
      processLoopback: true,
      sessions: [{ pid: 4242, name: 'chrome.exe', state: 'active', peak: 0.3, audible: true }],
    })),
    onStatus: vi.fn(() => () => {}),
    onSegment: vi.fn(() => () => {}),
    onPartial: vi.fn(() => () => {}),
    onLevel: vi.fn(() => () => {}),
  };
  window.electron = { audioEngine, stack: { translate: vi.fn() }, logs: { write: vi.fn() } };
});

const mounted = async () => {
  const view = renderHook(() => useListenSession({ active: true }));
  await waitFor(() => expect(view.result.current.available).toBe(true));
  return view;
};

describe('listen source selection', () => {
  it('starts on the whole system so a first session never depends on a stale pid', async () => {
    const { result } = await mounted();
    expect(result.current.source).toEqual({ mode: 'system', pid: 0, name: '' });

    act(() => result.current.toggle());
    expect(startCalls[0].source).toEqual({ mode: 'system', pid: 0, name: '' });
  });

  it('sends the picked program to the engine', async () => {
    const { result } = await mounted();
    act(() => result.current.setSource({ mode: 'include', pid: 4242, name: 'chrome.exe' }));
    act(() => result.current.toggle());
    expect(startCalls[0].source).toMatchObject({ mode: 'include', pid: 4242 });
  });

  it('refuses a program mode without a pid — that would silently mean "everything"', async () => {
    const { result } = await mounted();
    act(() => result.current.setSource({ mode: 'include', pid: 0, name: 'gone.exe' }));
    expect(result.current.source.mode).toBe('system');
    act(() => result.current.setSource({ mode: 'exclude', pid: -1, name: 'x' }));
    expect(result.current.source.mode).toBe('system');
  });

  it('falls back to the whole system for an unknown mode', async () => {
    const { result } = await mounted();
    act(() => result.current.setSource({ mode: 'everything-please', pid: 4242 }));
    expect(result.current.source).toEqual({ mode: 'system', pid: 0, name: '' });
  });

  it('restarts the session when the source changes mid-run', async () => {
    const { result } = await mounted();
    act(() => result.current.toggle());
    expect(result.current.running).toBe(true);

    act(() => result.current.setSource({ mode: 'exclude', pid: 4242, name: 'chrome.exe' }));
    // Stop is how a restart begins: the manager re-starts on the 'stopped'
    // status with the new source attached.
    expect(audioEngine.stop).toHaveBeenCalled();
    expect(result.current.sessionState).toBe('loading');
  });

  it('lists the programs that are making sound while the user is choosing', async () => {
    const { result } = await mounted();
    await waitFor(() => expect(result.current.sources.sessions.length).toBe(1));
    expect(result.current.sources.processLoopback).toBe(true);
    expect(result.current.sources.sessions[0]).toMatchObject({ pid: 4242, audible: true });
  });

  it('stops polling for programs once the session runs', async () => {
    const { result } = await mounted();
    await waitFor(() => expect(audioEngine.listSources).toHaveBeenCalled());
    const before = audioEngine.listSources.mock.calls.length;
    act(() => result.current.toggle());
    await new Promise((r) => setTimeout(r, 50));
    expect(audioEngine.listSources.mock.calls.length).toBe(before);
  });
});
