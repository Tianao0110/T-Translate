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
  };
  return client;
}

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
