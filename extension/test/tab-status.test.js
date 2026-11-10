// The popup's status line: each orchestrator state and blocking reason to
// its message key, a page that reported nothing, the switched-off cases.

import { describe, it, expect } from 'vitest';
import { describeTab } from '../src/shared/tab-status.js';

const t = (k) => k;
const ev = { site: 'youtube', mediaId: 'x' };
const ready = { status: 'ready' };

describe('describeTab', () => {
  it('running states', () => {
    expect(describeTab({ tab: { state: 'captions', run: { tier: 1 } }, evidence: ev, channel: ready }, t)).toEqual({ tone: 'ok', text: 'tabCaptionsSite' });
    expect(describeTab({ tab: { state: 'captions', run: { tier: 2 } }, evidence: ev, channel: ready }, t)).toEqual({ tone: 'ok', text: 'tabCaptionsAudio' });
    expect(describeTab({ tab: { state: 'captions', run: null, cached: { count: 3, covered: true } }, evidence: ev, channel: { status: 'offline' } }, t)).toEqual({ tone: 'ok', text: 'tabCaptionsCached' });
    expect(describeTab({ tab: { state: 'listening' }, evidence: ev }, t).text).toBe('tabListening');
    expect(describeTab({ tab: { state: 'prompt' }, evidence: ev }, t)).toEqual({ tone: 'warn', text: 'tabPrompt' });
    expect(describeTab({ tab: { state: 'suspended' }, evidence: ev }, t).text).toBe('tabSuspended');
  });

  it('off: this site, or everything', () => {
    expect(describeTab({ tab: { state: 'off', block: 'off' }, evidence: ev, prefs: { enabled: true } }, t).text).toBe('tabOff');
    expect(describeTab({ tab: { state: 'off', block: 'off' }, evidence: ev, prefs: { enabled: false } }, t).text).toBe('tabDisabled');
  });

  it('idle: why it waits', () => {
    const idle = (block) => describeTab({ tab: { state: 'idle', block }, evidence: ev, channel: ready }, t).text;
    expect(['offline', 'no-media', 'hidden', 'paused', 'ended', 'other-tab', null].map(idle)).toEqual(['tabOffline', 'tabNoMedia', 'tabHidden', 'tabPaused', 'tabEnded', 'tabWaiting', 'tabWaiting']);
    expect(describeTab({ tab: null, evidence: ev, channel: { status: 'offline' } }, t)).toEqual({ tone: 'warn', text: 'tabOffline' });
    expect(describeTab({ tab: null, evidence: ev, channel: ready }, t).text).toBe('tabWaiting');
  });

  it('a page that reported nothing has no video for us', () => {
    expect(describeTab({ tab: null, evidence: null, channel: ready }, t)).toEqual({ tone: 'muted', text: 'tabNoVideo' });
    expect(describeTab({}, t).text).toBe('tabNoVideo');
  });
});
