// The supportsChat column in the provider catalog is a claim the UI shows and
// the AI-action gate reads. This checks it against the classes themselves, so
// it cannot drift: a provider that says it chats must have chat(), and one
// that says it does not must not (or the entry is simply stale).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PROVIDER_METADATA } from '../../src/stack/providers/metadata.js';
import { createProvider } from '../../src/stack/registry.js';
import { configureRuntime } from '../../src/stack/runtime.js';

beforeEach(() => {
  configureRuntime({ fetch: vi.fn(), getLanguage: () => 'zh' });
});

describe('supportsChat matches the implementations', () => {
  for (const [id, meta] of Object.entries(PROVIDER_METADATA)) {
    it(`${id}: metadata says ${meta.supportsChat ? 'chat' : 'translate only'}`, () => {
      const provider = createProvider(id, {});
      expect(provider, `${id} has no class`).toBeTruthy();
      expect(typeof provider.chat === 'function').toBe(!!meta.supportsChat);
    });
  }

  it('every provider declares the column — a missing one must not read as false by accident', () => {
    for (const [id, meta] of Object.entries(PROVIDER_METADATA)) {
      expect(typeof meta.supportsChat, `${id}`).toBe('boolean');
    }
  });

  it('at least one of each kind exists, so the check is not vacuous', () => {
    const values = Object.values(PROVIDER_METADATA).map(m => m.supportsChat);
    expect(values).toContain(true);
    expect(values).toContain(false);
  });
});
