// @vitest-environment node
//
// The allowed sites over fake chrome.permissions / scripting / tabs: the
// manifest's own hosts are not on the list; granted ones share one
// registered script pair at document_start (the three built-in sites left
// out); allowing needs the grant first and injects into the tab at once
// (MAIN first) unless an agent is already there; a manifest host the user
// allowed stays until removed; removing gives the permission back; a click's
// grant that arrives after the popup is gone is finished here.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSiteAccess, SCRIPT_IDS } from '../src/sw/site-access.js';

const BUILT_IN = ['*://*.youtube.com/*', '*://*.bilibili.com/*', '*://*.tiktok.com/*'];
const MANIFEST = {
  host_permissions: ['http://127.0.0.1/*', ...BUILT_IN],
  content_scripts: [
    { matches: BUILT_IN, js: ['content-main.js'], world: 'MAIN' },
    { matches: BUILT_IN, js: ['content-isolated.js'] },
  ],
};
const tick = () => new Promise((r) => setTimeout(r, 0));
const flush = async () => {
  for (let i = 0; i < 10; i++) await tick();
};

function listenerSet() {
  const fns = [];
  return { addListener: (fn) => fns.push(fn), fire: (...a) => fns.forEach((fn) => fn(...a)) };
}

let permissions;
let scripting;
let tabs;
let changes;
let clock;
let pages;
let allowed;

beforeEach(() => {
  // The browser reports the manifest's hosts as granted too.
  const required = [...MANIFEST.host_permissions];
  permissions = {
    origins: [...required],
    getAll: async () => ({ permissions: [], origins: permissions.origins.slice() }),
    contains: async ({ origins: [o] }) => permissions.origins.includes(o) || permissions.origins.includes('<all_urls>'),
    remove: vi.fn(async ({ origins: [o] }) => {
      if (required.includes(o)) throw new Error('You cannot remove required permissions.');
      const had = permissions.origins.includes(o);
      permissions.origins = permissions.origins.filter((x) => x !== o);
      if (had) permissions.onRemoved.fire({ origins: [o] });
      return had;
    }),
    grant(o) {
      permissions.origins.push(o);
      permissions.onAdded.fire({ origins: [o] });
    },
    onAdded: listenerSet(),
    onRemoved: listenerSet(),
  };
  scripting = {
    regs: new Map(),
    agentAlive: false,
    injections: [],
    getRegisteredContentScripts: async ({ ids } = {}) => [...scripting.regs.values()].filter((r) => !ids || ids.includes(r.id)).map((r) => structuredClone(r)),
    registerContentScripts: vi.fn(async (list) => {
      for (const r of list) {
        if (scripting.regs.has(r.id)) throw new Error(`Duplicate script ID '${r.id}'`);
        scripting.regs.set(r.id, structuredClone(r));
      }
    }),
    unregisterContentScripts: vi.fn(async ({ ids }) => ids.forEach((id) => scripting.regs.delete(id))),
    executeScript: vi.fn(async (o) => {
      if (scripting.fail) throw new Error(scripting.fail);
      scripting.injections.push(o.func ? { probe: o.target.tabId } : { file: o.files[0], world: o.world ?? 'ISOLATED', tabId: o.target.tabId, now: o.injectImmediately });
      return [{ frameId: 0, result: o.func ? scripting.agentAlive : undefined }];
    }),
  };
  tabs = {
    urls: { 7: 'http://localhost:8123/watch.html', 8: 'http://other.test/page', 9: 'http://127.0.0.1:8123/watch.html', 10: 'https://www.youtube.com/watch?v=x' },
    get: async (id) => {
      if (!tabs.urls[id]) throw new Error(`No tab with id: ${id}.`);
      return { id, url: tabs.urls[id] };
    },
  };
  changes = [];
  clock = 1000;
  pages = new Set();
  allowed = [];
});

const make = () => createSiteAccess({ permissions, scripting, tabs, manifest: MANIFEST, hasPage: (id) => pages.has(id), onChange: (c) => changes.push(c), onAllowed: (p) => allowed.push(p), now: () => clock, logger: { warn() {}, debug() {} } });
const matchesOf = () => scripting.regs.get(SCRIPT_IDS.main)?.matches ?? null;

describe('the list', () => {
  it('the manifest’s own hosts are not on it; granted ones share one registered pair at document_start', async () => {
    permissions.origins.push('https://videos.example.org/*');
    const sa = make();
    expect(await sa.ready).toEqual(['https://videos.example.org/*']);
    expect(sa.granted()).toEqual(['https://videos.example.org/*']);
    expect([...scripting.regs.values()]).toEqual([
      { id: SCRIPT_IDS.main, js: ['content-main.js'], world: 'MAIN', matches: ['https://videos.example.org/*'], excludeMatches: BUILT_IN, runAt: 'document_start', allFrames: false, persistAcrossSessions: true },
      { id: SCRIPT_IDS.isolated, js: ['content-isolated.js'], world: 'ISOLATED', matches: ['https://videos.example.org/*'], excludeMatches: BUILT_IN, runAt: 'document_start', allFrames: false, persistAcrossSessions: true },
    ]);
    expect(changes).toEqual([{ sites: ['https://videos.example.org/*'], added: ['https://videos.example.org/*'], removed: [] }]);
    await sa.sync();
    expect(scripting.registerContentScripts).toHaveBeenCalledTimes(1);
    expect(changes).toHaveLength(1);
    expect(await sa.list()).toEqual(['https://videos.example.org/*']);
  });

  it('nothing granted: nothing registered; a stale pair from before is cleared', async () => {
    scripting.regs.set(SCRIPT_IDS.main, { id: SCRIPT_IDS.main, matches: ['http://gone.test/*'] });
    const sa = make();
    expect(await sa.ready).toEqual([]);
    expect(scripting.regs.size).toBe(0);
  });

  it('overlapping grants and <all_urls> from the browser’s settings: still one pair, the built-in sites left out', async () => {
    permissions.origins.push('https://www.example.com/*', 'https://*.example.com/*', '<all_urls>');
    const sa = make();
    await sa.ready;
    expect(matchesOf()).toEqual(['<all_urls>', 'https://*.example.com/*', 'https://www.example.com/*']);
    expect(scripting.regs.get(SCRIPT_IDS.isolated).excludeMatches).toEqual(BUILT_IN);
  });

  it('granted or taken back in the browser: the list follows', async () => {
    const sa = make();
    await sa.ready;
    permissions.grant('https://videos.example.org/*');
    await flush();
    expect(sa.granted()).toEqual(['https://videos.example.org/*']);
    await permissions.remove({ origins: ['https://videos.example.org/*'] });
    await flush();
    expect(sa.granted()).toEqual([]);
    expect(scripting.regs.size).toBe(0);
    expect(changes.map((c) => [c.added, c.removed])).toEqual([
      [['https://videos.example.org/*'], []],
      [[], ['https://videos.example.org/*']],
    ]);
  });
});

describe('allowing a site', () => {
  it('needs the grant first; then registered and injected into the tab, MAIN first, at once', async () => {
    const sa = make();
    await sa.ready;
    await expect(sa.allowSite('http://localhost/*', { tabId: 7 })).rejects.toMatchObject({ code: 'no-permission', message: 'http://localhost/*' });
    for (const bad of ['<all_urls>', '*://*/*', 'https://*.example.com/*', 'http://localhost:8123/*', 'https://a.test/path/*', 'file:///*', null]) {
      await expect(sa.allowSite(bad, { tabId: 7 })).rejects.toMatchObject({ code: 'bad-request' });
    }
    expect(scripting.regs.size).toBe(0);
    permissions.origins.push('http://localhost/*');
    expect(await sa.allowSite('http://localhost/*', { tabId: 7 })).toEqual({ pattern: 'http://localhost/*', sites: ['http://localhost/*'], injected: 'injected' });
    expect(matchesOf()).toEqual(['http://localhost/*']);
    expect(scripting.injections).toEqual([
      { probe: 7 },
      { file: 'content-main.js', world: 'MAIN', tabId: 7, now: true },
      { file: 'content-isolated.js', world: 'ISOLATED', tabId: 7, now: true },
    ]);
    expect(allowed).toEqual(['http://localhost/*']);
  });

  it('an agent already on the page reports again instead; the worker having the page skips it all; other pages are left alone', async () => {
    permissions.origins.push('http://localhost/*');
    const sa = make();
    await sa.ready;
    scripting.agentAlive = true;
    expect((await sa.allowSite('http://localhost/*', { tabId: 7 })).injected).toBe('resynced');
    expect(scripting.injections).toEqual([{ probe: 7 }]);
    pages.add(7);
    expect((await sa.allowSite('http://localhost/*', { tabId: 7 })).injected).toBe('present');
    expect((await sa.allowSite('http://localhost/*', { tabId: 8 })).injected).toBe('other-page');
    expect((await sa.allowSite('http://localhost/*', { tabId: 99 })).injected).toBe('no-tab');
    expect((await sa.allowSite('http://localhost/*')).injected).toBe(null);
    scripting.fail = 'Cannot access contents of the page.';
    pages.clear();
    expect((await sa.allowSite('http://localhost/*', { tabId: 7 })).injected).toBe('failed');
    expect(scripting.registerContentScripts).toHaveBeenCalledTimes(1);
  });

  it('a host the manifest grants (127.0.0.1): allowed until removed; removing it keeps the permission', async () => {
    const sa = make();
    await sa.ready;
    expect(await sa.allowSite('http://127.0.0.1/*', { tabId: 9 })).toMatchObject({ sites: ['http://127.0.0.1/*'], injected: 'injected' });
    expect(await sa.sync()).toEqual(['http://127.0.0.1/*']);
    expect(await make().ready).toEqual(['http://127.0.0.1/*']); // a new worker reads it back from the registration
    expect(await sa.revokeSite('http://127.0.0.1/*')).toEqual({ pattern: 'http://127.0.0.1/*', removed: false, sites: [] });
    expect(permissions.origins).toContain('http://127.0.0.1/*');
    expect(scripting.regs.size).toBe(0);
    expect(await sa.sync()).toEqual([]);
  });

  it('removing a granted site gives the permission back and unregisters it', async () => {
    permissions.origins.push('http://localhost/*', 'https://videos.example.org/*');
    const sa = make();
    await sa.ready;
    expect(await sa.revokeSite('http://localhost/*')).toEqual({ pattern: 'http://localhost/*', removed: true, sites: ['https://videos.example.org/*'] });
    expect(permissions.remove).toHaveBeenCalledWith({ origins: ['http://localhost/*'] });
    expect(matchesOf()).toEqual(['https://videos.example.org/*']);
    await expect(sa.revokeSite('javascript:alert(1)')).rejects.toMatchObject({ code: 'bad-request' });
  });

  it('a click’s grant finished here when the popup is gone; a stale one is not', async () => {
    const sa = make();
    await sa.ready;
    expect(sa.expect('http://localhost/*', { tabId: 7 })).toEqual({ pattern: 'http://localhost/*', pending: true });
    permissions.grant('http://localhost/*');
    await flush();
    expect(sa.granted()).toEqual(['http://localhost/*']);
    expect(scripting.injections.map((i) => i.file ?? 'probe')).toEqual(['probe', 'content-main.js', 'content-isolated.js']);
    expect(allowed).toEqual(['http://localhost/*']);

    sa.expect('http://other.test/*', { tabId: 8 });
    clock += 3 * 60 * 1000;
    permissions.grant('http://other.test/*');
    await flush();
    expect(sa.granted()).toEqual(['http://localhost/*', 'http://other.test/*']);
    expect(scripting.injections).toHaveLength(3);
    expect(allowed).toEqual(['http://localhost/*']);
    expect(() => sa.expect('<all_urls>')).toThrow(expect.objectContaining({ code: 'bad-request' }));
  });
});
