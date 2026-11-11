// @vitest-environment node
//
// Listen sessions in the offscreen document over a fake companion client:
// events carried under the key, one session at a time, exactly one 'closed'
// per open (from the stream or from close()), and open failures.

import { describe, it, expect, vi } from 'vitest';
import { createListenSessions } from '../src/offscreen/listen-session.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

function fakeClient() {
  const subs = new Map();
  let n = 0;
  const client = {
    opened: [],
    closed: [],
    failOpen: null,
    listenOpen: vi.fn(async (opts) => {
      client.opened.push(opts);
      if (client.failOpen) throw Object.assign(new Error(client.failOpen), { code: client.failOpen });
      return { id: `s${++n}` };
    }),
    subscribe: vi.fn((id, onEvent) => {
      subs.set(id, onEvent);
      return { stop: () => subs.delete(id) };
    }),
    closeAsr: vi.fn(async (id) => {
      client.closed.push(id);
      // The server's stream ends with closed.
      setTimeout(() => subs.get(id)?.({ type: 'closed', reason: 'closed' }), 0);
      return true;
    }),
    push: (id, evt) => subs.get(id)?.(evt),
    canSeek: false,
    seekFail: null,
    getState: () => ({ capabilities: { listen: true, ...(client.canSeek && { seek: true }) } }),
    seekAsr: vi.fn(async (id) => {
      client.order.push(`seek ${id}`);
      if (client.seekFail) throw Object.assign(new Error(client.seekFail), { code: client.seekFail });
      return { atS: 4 };
    }),
    order: [],
  };
  const open = client.listenOpen;
  client.listenOpen = vi.fn(async (opts) => {
    client.order.push('open');
    return open(opts);
  });
  const close = client.closeAsr;
  client.closeAsr = vi.fn(async (id) => {
    client.order.push(`close ${id}`);
    return close(id);
  });
  return client;
}

describe('listen sessions: handing the session over at a seek', () => {
  const seekable = () => {
    const client = fakeClient();
    client.canSeek = true;
    const events = [];
    const ls = createListenSessions({ client, onEvent: (e) => events.push(e), leaseMs: 40 });
    return { client, events, ls };
  };
  const of = (events, key) => events.filter((e) => e.key === key).map((e) => [e.event.type, e.event.id ?? e.event.reason]);

  it('a close for a seek leases the app’s session; the next open takes it with a seek, translations follow their segments', async () => {
    const { client, events, ls } = seekable();
    await ls.open({ key: 'l1', lang: 'en', targetLang: 'zh', mediaStartS: 10 });
    client.push('s1', { type: 'segment', id: 1, start: 11, end: 12, text: 'a' });
    expect(await ls.close({ key: 'l1', handover: true })).toEqual({ key: 'l1', id: 's1', segments: 1, handedOver: true });
    client.push('s1', { type: 'segment', id: 2, start: 12, end: 13, text: 'flushed' });
    const r = await ls.open({ key: 'l2', lang: 'en', targetLang: 'zh', mediaStartS: 300 });
    expect(r).toEqual({ key: 'l2', id: 's1', adopted: true });
    expect(client.seekAsr).toHaveBeenCalledWith('s1', { mediaStartS: 300 });
    expect(client.order).toEqual(['open', 'seek s1']);
    client.push('s1', { type: 'translation', id: 2, text: 'T2', done: true });
    client.push('s1', { type: 'segment', id: 3, start: 300.5, end: 302, text: 'after' });
    client.push('s1', { type: 'translation', id: 3, text: 'T3', done: true });
    expect(of(events, 'l1')).toEqual([['segment', 1], ['closed', 'handover'], ['segment', 2], ['translation', 2]]);
    expect(of(events, 'l2')).toEqual([['segment', 3], ['translation', 3]]);
    expect(ls.current()).toBe('l2');
    await ls.close({ key: 'l2' });
    await tick();
    expect(client.closed).toEqual(['s1']);
    expect(of(events, 'l2').at(-1)).toEqual(['closed', 'closed']);
  });

  it('a lease nobody takes is closed after leaseMs', async () => {
    const { client, ls } = seekable();
    await ls.open({ key: 'l1', lang: 'en', targetLang: 'zh' });
    await ls.close({ key: 'l1', handover: true });
    expect(client.closed).toEqual([]);
    await vi.waitFor(() => expect(client.closed).toEqual(['s1']));
  });

  it('other languages, or a failed seek: the leased session is closed first, then a new one opened', async () => {
    const { client, ls } = seekable();
    await ls.open({ key: 'l1', lang: 'en', targetLang: 'zh' });
    await ls.close({ key: 'l1', handover: true });
    await ls.open({ key: 'l2', lang: 'en', targetLang: 'ja' });
    expect(client.order).toEqual(['open', 'close s1', 'open']);
    await ls.close({ key: 'l2', handover: true });
    client.seekFail = 'not-ready';
    expect(await ls.open({ key: 'l3', lang: 'en', targetLang: 'ja' })).toEqual({ key: 'l3', id: 's3' });
    expect(client.order.slice(3)).toEqual(['seek s2', 'close s2', 'open']);
  });

  it('an app that cannot seek: the close is an ordinary one', async () => {
    const client = fakeClient();
    const events = [];
    const ls = createListenSessions({ client, onEvent: (e) => events.push(e) });
    await ls.open({ key: 'l1' });
    await ls.close({ key: 'l1', handover: true });
    expect(client.closed).toEqual(['s1']);
    expect(events.at(-1).event).toEqual({ type: 'closed', reason: 'closed' });
  });
});

describe('listen sessions', () => {
  it('opens, relays events under the key, closes once', async () => {
    const client = fakeClient();
    const events = [];
    const ls = createListenSessions({ client, onEvent: (e) => events.push(e) });
    const r = await ls.open({ key: 'tab:1:l1', lang: 'auto', targetLang: 'zh', mediaStartS: 12.5 });
    expect(r).toEqual({ key: 'tab:1:l1', id: 's1' });
    expect(client.opened[0]).toEqual({ lang: 'auto', targetLang: 'zh', mediaStartS: 12.5 });
    expect(ls.current()).toBe('tab:1:l1');
    client.push('s1', { type: 'status', state: 'listening' });
    client.push('s1', { type: 'segment', id: 1, start: 13, end: 15, text: 'hi' });
    const stats = await ls.close({ key: 'tab:1:l1' });
    await tick();
    expect(stats).toEqual({ key: 'tab:1:l1', id: 's1', segments: 1 });
    expect(events.map((e) => [e.key, e.event.type])).toEqual([
      ['tab:1:l1', 'status'],
      ['tab:1:l1', 'segment'],
      ['tab:1:l1', 'closed'],
    ]);
    expect(ls.current()).toBeNull();
    // A repeated close gets the same answer; an unknown key is refused.
    expect(await ls.close({ key: 'tab:1:l1' })).toEqual(stats);
    expect(() => ls.close({ key: 'nope' })).toThrow(expect.objectContaining({ code: 'no-session' }));
  });

  it('the stream ending by itself counts as the close; a new open closes the old one first', async () => {
    const client = fakeClient();
    const events = [];
    const ls = createListenSessions({ client, onEvent: (e) => events.push(e) });
    await ls.open({ key: 'a' });
    client.push('s1', { type: 'closed', reason: 'preempted' });
    expect(ls.current()).toBeNull();
    await ls.open({ key: 'b' });
    expect(client.closed).toEqual([]);
    await ls.open({ key: 'c' });
    await tick();
    expect(client.closed).toEqual(['s2']);
    expect(events.filter((e) => e.event.type === 'closed').map((e) => [e.key, e.event.reason])).toEqual([
      ['a', 'preempted'],
      ['b', 'closed'],
    ]);
    expect(ls.current()).toBe('c');
  });

  it('a failed open rejects with the client’s code and leaves nothing behind', async () => {
    const client = fakeClient();
    client.failOpen = 'busy';
    const ls = createListenSessions({ client });
    await expect(ls.open({ key: 'x' })).rejects.toMatchObject({ code: 'busy' });
    expect(ls.current()).toBeNull();
    await expect(ls.open({})).rejects.toMatchObject({ code: 'bad-request' });
  });
});
