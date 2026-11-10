// The runtime message envelope: request/call against a fake chrome.runtime,
// handle()'s routing (type, target, accept) and error wrapping; notifyLocal.

import { describe, it, expect, vi } from 'vitest';
import { MSG, request, call, handle, on, notifyLocal, isExtensionSender } from '../src/shared/messages.js';

const EXT_URL = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/';

// One fake runtime shared by every "context": sendMessage reaches every
// listener the way Chrome does, the first sendResponse wins.
function fakeRuntime() {
  const listeners = new Set();
  return {
    id: 'abcdefghijklmnopabcdefghijklmnop',
    getURL: (p) => `${EXT_URL}${p}`,
    onMessage: {
      addListener: (fn) => listeners.add(fn),
      removeListener: (fn) => listeners.delete(fn),
    },
    sender: { id: 'abcdefghijklmnopabcdefghijklmnop', url: `${EXT_URL}options.html` },
    sendMessage(msg) {
      return new Promise((resolve, reject) => {
        let answered = false;
        let pending = false;
        const respond = (r) => {
          if (!answered) {
            answered = true;
            resolve(r);
          }
        };
        for (const fn of [...listeners]) if (fn(msg, this.sender, respond) === true) pending = true;
        if (!answered && !pending) reject(new Error('Could not establish connection. Receiving end does not exist.'));
      });
    },
  };
}

describe('request / call', () => {
  it('wraps a reply, an error reply and no receiver', async () => {
    const runtime = fakeRuntime();
    handle({ [MSG.COMPANION_STATE]: async () => ({ status: 'ready' }) }, { runtime });
    handle({ [MSG.COMPANION_PAIR]: async () => { throw Object.assign(new Error('nope'), { code: 'pairing-failed' }); } }, { runtime });

    expect(await request(MSG.COMPANION_STATE, null, { runtime })).toEqual({ ok: true, result: { status: 'ready' } });
    expect(await request(MSG.COMPANION_PAIR, null, { runtime })).toEqual({ ok: false, error: { code: 'pairing-failed', message: 'nope' } });
    const none = await request(MSG.COMPANION_FORGET, null, { runtime });
    expect(none.ok).toBe(false);
    expect(none.error.code).toBe('no-receiver');

    expect(await call(MSG.COMPANION_STATE, null, { runtime })).toEqual({ status: 'ready' });
    await expect(call(MSG.COMPANION_PAIR, null, { runtime })).rejects.toMatchObject({ code: 'pairing-failed' });
  });

  it('a thrown value without a code becomes code "error"', async () => {
    const runtime = fakeRuntime();
    handle({ [MSG.PING]: () => { throw new Error('boom'); } }, { runtime });
    expect(await request(MSG.PING, null, { runtime })).toEqual({ ok: false, error: { code: 'error', message: 'boom' } });
  });
});

describe('handle', () => {
  it('only answers messages for its target, and leaves the rest alone', async () => {
    const runtime = fakeRuntime();
    handle({ [MSG.COMPANION_STATE]: () => 'worker' }, { runtime });
    handle({ [MSG.COMPANION_STATE]: () => 'offscreen' }, { runtime, target: 'offscreen' });
    expect(await call(MSG.COMPANION_STATE, null, { runtime })).toBe('worker');
    expect(await call(MSG.COMPANION_STATE, null, { runtime, target: 'offscreen' })).toBe('offscreen');
  });

  it('refuses senders accept() turns down', async () => {
    const runtime = fakeRuntime();
    handle({ [MSG.STORAGE_GET]: () => 'token' }, { runtime, accept: (_m, s) => isExtensionSender(s, runtime) });
    expect(await call(MSG.STORAGE_GET, { key: 'pairing' }, { runtime })).toBe('token');
    runtime.sender = { id: runtime.id, url: 'https://www.youtube.com/watch?v=x', tab: { id: 3 } };
    expect(await request(MSG.STORAGE_GET, { key: 'pairing' }, { runtime })).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });

  it('on() hears broadcasts without replying; unsubscribe stops both', async () => {
    const runtime = fakeRuntime();
    const heard = [];
    const off = on(MSG.COMPANION_STATE_CHANGED, (s) => heard.push(s), { runtime });
    const stop = handle({ [MSG.COMPANION_STATE_CHANGED]: () => null }, { runtime });
    await call(MSG.COMPANION_STATE_CHANGED, { status: 'offline' }, { runtime });
    off();
    stop();
    expect(heard).toEqual([{ status: 'offline' }]);
    expect((await request(MSG.COMPANION_STATE_CHANGED, {}, { runtime })).error.code).toBe('no-receiver');
  });
});

describe('notifyLocal (one background page for worker and offscreen, Firefox)', () => {
  it('reaches this runtime’s handle() and on() listeners, not the wire, not another runtime; unsubscribe stops it', () => {
    const runtime = fakeRuntime();
    const other = fakeRuntime();
    const sendMessage = vi.spyOn(runtime, 'sendMessage');
    const heard = [];
    const handled = [];
    const off = on(MSG.MEDIA_EVENT, (p) => heard.push(p), { runtime });
    const stop = handle({ [MSG.COMPANION_STATE_CHANGED]: (p, sender) => handled.push([p, sender.id]) }, { runtime });
    on(MSG.MEDIA_EVENT, () => heard.push('other runtime'), { runtime: other });

    notifyLocal(MSG.MEDIA_EVENT, { key: 'k', event: { type: 'segment' } }, { runtime });
    notifyLocal(MSG.COMPANION_STATE_CHANGED, { status: 'ready' }, { runtime });
    return Promise.resolve().then(() => {
      expect(heard).toEqual([{ key: 'k', event: { type: 'segment' } }]);
      expect(handled).toEqual([[{ status: 'ready' }, runtime.id]]);
      expect(sendMessage).not.toHaveBeenCalled();
      off();
      stop();
      notifyLocal(MSG.MEDIA_EVENT, { key: 'k2' }, { runtime });
      notifyLocal(MSG.COMPANION_STATE_CHANGED, { status: 'offline' }, { runtime });
      return Promise.resolve().then(() => {
        expect(heard).toHaveLength(1);
        expect(handled).toHaveLength(1);
      });
    });
  });
});
