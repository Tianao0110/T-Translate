// Service worker: the sites T-Caption runs on beyond the manifest's three.
// A site is allowed once the browser grants its host pattern: the popup asks
// in the user's own click (permissions.request has to be called there), the
// browser's extension settings can grant one too. Allowed sites get the two
// content scripts at document_start through one registered pair (one pair,
// so overlapping patterns never inject twice), and the tab the user allowed
// from gets them at once. Removing a site unregisters it and gives the
// permission back (a host the manifest itself grants keeps its permission).
//
// granted() is the list as last synced, for the worker's synchronous checks;
// ready settles after the first sync. onChange({ sites, added, removed });
// onAllowed(pattern) after each allowSite, the deferred one included.

import { MessageError } from '../shared/messages.js';
import { matchPattern, isHostPattern } from '../shared/match-pattern.js';

export const SCRIPT_IDS = { main: 'tc-sites-main', isolated: 'tc-sites-isolated' };
const PENDING_MS = 120000; // a click's grant may arrive this late (the dialog left open)
const MAX_SITES = 500;

// What the registered scripts may match: granted patterns of any shape.
const registrable = (p) => p === '<all_urls>' || (typeof p === 'string' && /^(\*|https?):\/\/(\*|(\*\.)?[^/*:\s]+)\/.*$/.test(p));

// Runs in the page's isolated world: the agent already there reports afresh.
function resyncAgent() {
  const agent = globalThis.__tcAgent;
  if (!agent || !agent.alive) return false;
  agent.resync();
  return true;
}

export function createSiteAccess({
  permissions = globalThis.chrome?.permissions,
  scripting = globalThis.chrome?.scripting,
  tabs = globalThis.chrome?.tabs,
  manifest = globalThis.chrome?.runtime?.getManifest?.(),
  hasPage = () => false, // the worker already has this tab's reports
  onChange = () => {},
  onAllowed = () => {},
  logger = console,
  now = () => Date.now(),
} = {}) {
  const builtIn = [...new Set((manifest?.content_scripts || []).flatMap((c) => c.matches || []))];
  const onBuiltIn = builtIn.map(matchPattern);
  const fixed = new Set([...builtIn, ...(manifest?.host_permissions || [])]);
  let sites = [];
  let chain = Promise.resolve();
  let pending = null; // { pattern, tabId, at }: asked for in a click, granted later

  const same = (a = [], b = []) => [...a].sort().join('\n') === [...b].sort().join('\n');

  function scripts(matches) {
    const common = { matches, runAt: 'document_start', allFrames: false, persistAcrossSessions: true, ...(builtIn.length && { excludeMatches: builtIn }) };
    return [
      { id: SCRIPT_IDS.main, js: ['content-main.js'], world: 'MAIN', ...common },
      { id: SCRIPT_IDS.isolated, js: ['content-isolated.js'], world: 'ISOLATED', ...common },
    ];
  }

  // The registered pair matches want, whatever was there before.
  async function apply(regs, want) {
    if (regs.length === 2 && regs.every((r) => same(r.matches, want))) return;
    if (regs.length) await scripting.unregisterContentScripts({ ids: regs.map((r) => r.id) });
    if (want.length) await scripting.registerContentScripts(scripts(want));
  }

  // Granted patterns outside the manifest, plus the registered ones still
  // permitted (a manifest host the user allowed), plus add; less drop.
  function sync({ add = [], drop = [] } = {}) {
    const run = chain.then(async () => {
      const origins = (await permissions.getAll())?.origins || [];
      const regs = await scripting.getRegisteredContentScripts({ ids: Object.values(SCRIPT_IDS) });
      const current = regs.find((r) => r.id === SCRIPT_IDS.main)?.matches || [];
      const keep = [];
      for (const p of current) if (origins.includes(p) || (await permissions.contains({ origins: [p] }).catch(() => false))) keep.push(p);
      const want = [...new Set([...origins.filter((o) => !fixed.has(o)), ...keep, ...add])].filter((p) => registrable(p) && !drop.includes(p)).sort().slice(0, MAX_SITES);
      await apply(regs, want);
      const before = sites;
      sites = want;
      const added = want.filter((p) => !before.includes(p));
      const removed = before.filter((p) => !want.includes(p));
      if (added.length || removed.length) {
        try {
          onChange({ sites: want.slice(), added, removed });
        } catch (e) {
          logger.warn?.(`[T-Caption] sites listener: ${e.message}`);
        }
      }
      return want.slice();
    });
    chain = run.catch((e) => logger.warn?.(`[T-Caption] sites sync: ${e.message}`));
    return run;
  }

  // The page the user allowed from: an agent already there reports again,
  // else both scripts go in now (MAIN first, as at document_start).
  async function injectInto(tabId, pattern) {
    if (hasPage(tabId)) return 'present';
    let url = '';
    try {
      url = (await tabs.get(tabId))?.url || '';
    } catch {
      return 'no-tab';
    }
    if (!matchPattern(pattern)(url) || onBuiltIn.some((m) => m(url))) return 'other-page';
    try {
      const [probe] = await scripting.executeScript({ target: { tabId }, func: resyncAgent });
      if (probe?.result === true) return 'resynced';
      await scripting.executeScript({ target: { tabId }, files: ['content-main.js'], world: 'MAIN', injectImmediately: true });
      await scripting.executeScript({ target: { tabId }, files: ['content-isolated.js'], injectImmediately: true });
      return 'injected';
    } catch (e) {
      logger.warn?.(`[T-Caption] inject into tab ${tabId}: ${e.message}`);
      return 'failed';
    }
  }

  // After the browser granted pattern (the page asked in the user's click).
  async function allowSite(pattern, { tabId = null } = {}) {
    if (!isHostPattern(pattern)) throw new MessageError('bad-request', 'pattern');
    if (!(await permissions.contains({ origins: [pattern] }))) throw new MessageError('no-permission', pattern);
    if (pending?.pattern === pattern) pending = null;
    const list = await sync({ add: [pattern] });
    const injected = Number.isSafeInteger(tabId) ? await injectInto(tabId, pattern) : null;
    try {
      onAllowed(pattern);
    } catch (e) {
      logger.warn?.(`[T-Caption] allowed listener: ${e.message}`);
    }
    return { pattern, sites: list, injected };
  }

  // A click is about to ask for pattern: if its dialog closes the popup, the
  // grant still finishes here once it arrives.
  function expect(pattern, { tabId = null } = {}) {
    if (!isHostPattern(pattern)) throw new MessageError('bad-request', 'pattern');
    pending = { pattern, tabId: Number.isSafeInteger(tabId) ? tabId : null, at: now() };
    return { pattern, pending: true };
  }

  async function revokeSite(pattern) {
    if (typeof pattern !== 'string' || !registrable(pattern)) throw new MessageError('bad-request', 'pattern');
    let removed = false;
    try {
      removed = await permissions.remove({ origins: [pattern] });
    } catch (e) {
      // A host the manifest asks for cannot be given back; it only stops running there.
      logger.debug?.(`[T-Caption] keep permission ${pattern}: ${e.message}`);
    }
    const list = await sync({ drop: [pattern] });
    return { pattern, removed, sites: list };
  }

  async function onAdded() {
    await sync();
    const p = pending;
    if (!p || now() - p.at > PENDING_MS) return;
    if (!(await permissions.contains({ origins: [p.pattern] }).catch(() => false))) return;
    pending = null;
    await allowSite(p.pattern, { tabId: p.tabId }).catch((e) => logger.warn?.(`[T-Caption] allow ${p.pattern}: ${e.message}`));
  }

  permissions?.onAdded?.addListener(() => {
    onAdded();
  });
  permissions?.onRemoved?.addListener(() => {
    sync();
  });

  const ready = sync().catch(() => []);

  return {
    ready,
    granted: () => sites.slice(),
    list: () => ready.then(() => chain).then(() => sites.slice()),
    sync,
    allowSite,
    expect,
    revokeSite,
  };
}
