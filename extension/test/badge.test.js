// @vitest-environment node
//
// The per-tab badge over a fake chrome.action: a tab waiting for the video's
// host to be allowed shows an amber '!', other prompts the listen glyph.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { showTabBadge } from '../src/sw/badge.js';

let calls;
beforeEach(() => {
  calls = {};
  const set = (name) => async (o) => {
    calls[name] = o;
  };
  globalThis.chrome = { i18n: { getMessage: (k) => k }, action: { setBadgeBackgroundColor: set('color'), setBadgeText: set('text'), setTitle: set('title') } };
});
afterEach(() => {
  delete globalThis.chrome;
});

describe('showTabBadge', () => {
  it('permission prompt: amber !, its own title; other prompts and states as before', async () => {
    await showTabBadge(7, 'prompt', { status: 'ready' }, { why: 'permission', origin: 'http://localhost/*' });
    expect(calls).toEqual({ color: { tabId: 7, color: '#e8a400' }, text: { tabId: 7, text: '!' }, title: { tabId: 7, title: 'appName · titlePermission' } });
    await showTabBadge(7, 'prompt', { status: 'ready' }, { why: 'drm' });
    expect(calls).toEqual({ color: { tabId: 7, color: '#e8a400' }, text: { tabId: 7, text: 'badgeListening' }, title: { tabId: 7, title: 'appName · titlePrompt' } });
    await showTabBadge(7, 'captions', { status: 'ready' }, { tier: 2, kind: 'direct' });
    expect(calls.text).toEqual({ tabId: 7, text: 'badgeCaptions' });
    expect(calls.color).toEqual({ tabId: 7, color: '#1e8e3e' });
  });
});
