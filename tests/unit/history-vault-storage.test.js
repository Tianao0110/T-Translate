// Storage adapter routing: encrypted vault when the bridge reports available,
// localStorage otherwise, and the one-time plaintext migration in between.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createThrottledJSONStorage } from '../../src/stores/translation-store.js';

const KEY = 'translation-store';
const BLOB = { state: { history: [{ id: 'h1', sourceText: 'hi' }] }, version: 0 };

function makeVaultApi({ available = true, stored = null } = {}) {
  const api = {
    stored,
    status: vi.fn(async () => ({ available, exists: api.stored != null, fileSize: 0 })),
    load: vi.fn(async () => api.stored),
    save: vi.fn(async (s) => {
      api.stored = s;
      return { success: true };
    }),
    clear: vi.fn(async () => {
      api.stored = null;
      return { success: true };
    }),
  };
  return api;
}

beforeEach(() => {
  localStorage.clear();
  delete window.electron;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  delete window.electron;
});

describe('createThrottledJSONStorage routing', () => {
  it('uses localStorage when no bridge exists', async () => {
    localStorage.setItem(KEY, JSON.stringify(BLOB));
    const storage = createThrottledJSONStorage(50);
    expect(await storage.getItem(KEY)).toEqual(BLOB);

    storage.setItem(KEY, { a: 1 });
    vi.advanceTimersByTime(60);
    expect(JSON.parse(localStorage.getItem(KEY))).toEqual({ a: 1 });
  });

  it('uses localStorage when the vault reports unavailable', async () => {
    window.electron = { historyVault: makeVaultApi({ available: false }) };
    localStorage.setItem(KEY, JSON.stringify(BLOB));
    const storage = createThrottledJSONStorage(50);
    expect(await storage.getItem(KEY)).toEqual(BLOB);
    expect(window.electron.historyVault.load).not.toHaveBeenCalled();

    storage.setItem(KEY, { a: 2 });
    vi.advanceTimersByTime(60);
    expect(window.electron.historyVault.save).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem(KEY))).toEqual({ a: 2 });
  });

  it('hydrates from the vault and routes writes there', async () => {
    const vault = makeVaultApi({ stored: JSON.stringify(BLOB) });
    window.electron = { historyVault: vault };
    const storage = createThrottledJSONStorage(50);

    expect(await storage.getItem(KEY)).toEqual(BLOB);

    storage.setItem(KEY, { b: 3 });
    vi.advanceTimersByTime(60);
    expect(vault.save).toHaveBeenCalledWith(JSON.stringify({ b: 3 }));
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('migrates legacy plaintext: vault save confirmed, then plaintext removed', async () => {
    const vault = makeVaultApi();
    window.electron = { historyVault: vault };
    const legacy = JSON.stringify(BLOB);
    localStorage.setItem(KEY, legacy);
    const storage = createThrottledJSONStorage(50);

    expect(await storage.getItem(KEY)).toEqual(BLOB);
    expect(vault.save).toHaveBeenCalledWith(legacy);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('keeps plaintext when the migration save is not confirmed', async () => {
    const vault = makeVaultApi();
    vault.save = vi.fn(async () => ({ success: false, reason: 'disk' }));
    window.electron = { historyVault: vault };
    const legacy = JSON.stringify(BLOB);
    localStorage.setItem(KEY, legacy);
    const storage = createThrottledJSONStorage(50);

    expect(await storage.getItem(KEY)).toEqual(BLOB); // data still served
    expect(localStorage.getItem(KEY)).toBe(legacy); // plaintext kept for retry
  });

  it('falls back to localStorage when status() throws', async () => {
    window.electron = {
      historyVault: {
        status: vi.fn(async () => {
          throw new Error('ipc dead');
        }),
      },
    };
    localStorage.setItem(KEY, JSON.stringify(BLOB));
    const storage = createThrottledJSONStorage(50);
    expect(await storage.getItem(KEY)).toEqual(BLOB);
  });

  it('removeItem clears both vault and localStorage', async () => {
    const vault = makeVaultApi({ stored: JSON.stringify(BLOB) });
    window.electron = { historyVault: vault };
    const storage = createThrottledJSONStorage(50);
    await storage.getItem(KEY); // arms the vault path
    localStorage.setItem(KEY, 'stale');

    storage.removeItem(KEY);
    expect(vault.clear).toHaveBeenCalled();
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});
