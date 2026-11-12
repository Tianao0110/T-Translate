// The worker's side, whatever hosts it: relays the extension pages'
// COMPANION_* / MEDIA_* / LISTEN_* requests to the offscreen side
// (toOffscreen), does chrome.storage for it, keeps each tab's page evidence
// and carries commands to it (page-events.js), fetches files pages play by
// URL (direct-fetch.js), keeps the sites the user allowed (site-access.js),
// decides per tab what runs (session-orchestrator.js), holds the subtitle
// cache (cache-db.js), paints the badge, polls the channel once a minute and
// turns the shortcut keys into commands for the tab.
// Chrome: a service worker with an offscreen document (index.js); Firefox:
// one background page for both (firefox/background.js).
//
// startWorker({ toOffscreen(type, payload), wake() }) registers the
// listeners synchronously; wake() starts the offscreen side early.

import { MSG, handle, on, notify, isExtensionSender } from '../shared/messages.js';
import { showBadge, showTabBadge } from './badge.js';
import { createPageEvents } from './page-events.js';
import { createDirectFetch } from './direct-fetch.js';
import { createSiteAccess } from './site-access.js';
import { createPrefs } from './prefs.js';
import { createTabArbiter } from './tab-arbiter.js';
import { createOrchestrator } from './session-orchestrator.js';
import { createSubtitleCache, openIndexedDbStore, createMemoryStore, cacheHandlers } from './cache-db.js';

const KEEPALIVE = 'companion-keepalive';
const OFFSET_STEP_S = 0.5;

export function startWorker({ toOffscreen, wake = async () => {} }) {
  const relay = (type) => (payload) => toOffscreen(type, payload);
  const fromExtension = (_msg, sender) => isExtensionSender(sender);

  // Files pages play by URL, fetched here by range; its fetch errors come back like the pipeline's events.
  const directFetch = createDirectFetch({ toOffscreen, onEvent: (payload) => pageEvents.onMediaEvent(payload) });
  // The sites allowed beyond the manifest's: their pages may report, tabs waiting on a host try again.
  const siteAccess = createSiteAccess({
    hasPage: (tabId) => pageEvents.has(tabId),
    onAllowed: (pattern) => orchestrator.permissionGranted(pattern),
    onChange: ({ sites, added }) => {
      pageEvents.refreshSites();
      if (added.length) orchestrator.permissionGranted();
      notify(MSG.SITES_CHANGED, { sites });
    },
  });
  // For the orchestrator: getTabEvidence(tabId), onPageEvent(fn), command(tabId, command).
  const pageEvents = createPageEvents({ toOffscreen, direct: directFetch, sites: siteAccess });

  let channel = { status: 'unpaired' };
  const prefs = createPrefs();
  const arbiter = createTabArbiter({ onChange: () => orchestrator.evaluate() });
  // Subtitles kept per media in IndexedDB (extension pages reach it through
  // CACHE_*); only in memory for secure mode and incognito tabs.
  const subtitleCache = createSubtitleCache({ store: openIndexedDbStore() });
  const memoryCache = createSubtitleCache({ store: createMemoryStore() });
  const orchestrator = createOrchestrator({
    pageEvents,
    arbiter,
    prefs,
    translate: (items, { source, target }) => toOffscreen(MSG.COMPANION_TRANSLATE, { items, source, target }),
    onState: (tabId, state, detail) => showTabBadge(tabId, state, channel, detail),
    cache: subtitleCache,
    memoryCache,
  });

  function channelChanged(state) {
    channel = state || { status: 'unpaired' };
    showBadge(channel);
    orchestrator.setCompanion(channel);
  }

  handle(
    {
      [MSG.COMPANION_LOAD]: relay(MSG.COMPANION_LOAD),
      [MSG.COMPANION_PAIR]: relay(MSG.COMPANION_PAIR),
      [MSG.COMPANION_CONNECT]: relay(MSG.COMPANION_CONNECT),
      [MSG.COMPANION_STATE]: relay(MSG.COMPANION_STATE),
      [MSG.COMPANION_FORGET]: relay(MSG.COMPANION_FORGET),
      [MSG.COMPANION_TRANSLATE]: relay(MSG.COMPANION_TRANSLATE),
      [MSG.MEDIA_OPEN]: relay(MSG.MEDIA_OPEN),
      [MSG.MEDIA_PUSH]: relay(MSG.MEDIA_PUSH),
      [MSG.MEDIA_CLOSE]: relay(MSG.MEDIA_CLOSE),
      [MSG.LISTEN_OPEN]: relay(MSG.LISTEN_OPEN),
      [MSG.LISTEN_CLOSE]: relay(MSG.LISTEN_CLOSE),
      [MSG.COMPANION_STATE_CHANGED]: (state) => channelChanged(state),
      [MSG.STORAGE_GET]: async ({ key }) => (await chrome.storage.local.get(key))[key] ?? null,
      [MSG.STORAGE_SET]: async ({ key, value }) => {
        if (value === null || value === undefined) await chrome.storage.local.remove(key);
        else await chrome.storage.local.set({ [key]: value });
      },
      [MSG.TAB_STATE]: ({ tabId } = {}) => orchestrator.stateOf(tabId),
      [MSG.SITE_LIST]: () => siteAccess.list(),
      // Waiting tabs try again through onAllowed.
      [MSG.SITE_ALLOW]: ({ pattern, tabId, pending } = {}) => (pending ? siteAccess.expect(pattern, { tabId }) : siteAccess.allowSite(pattern, { tabId })),
      [MSG.SITE_REVOKE]: ({ pattern } = {}) => siteAccess.revokeSite(pattern),
      ...pageEvents.extensionHandlers,
      ...cacheHandlers(subtitleCache),
    },
    { accept: fromExtension }
  );

  // Content scripts: page events and MSE bytes from top frames on our hosts and allowed sites, and the liveness ping.
  handle(pageEvents.contentHandlers, { accept: pageEvents.fromTopFrame });
  on(MSG.MEDIA_EVENT, pageEvents.onMediaEvent);
  handle({
    [MSG.PING]: (_payload, sender) => {
      console.debug(`[T-Caption] ping from tab ${sender.tab?.id ?? '?'}`);
      return { pong: true };
    },
  });

  // The shortcut keys (manifest commands, rebound at chrome://extensions/shortcuts)
  // act on the tab they were pressed in.
  const SENTENCE = { 'prev-sentence': 'prev', 'next-sentence': 'next', 'repeat-sentence': 'repeat' };
  const OFFSET_STEP = { 'subs-earlier': -OFFSET_STEP_S, 'subs-later': OFFSET_STEP_S };
  chrome.commands?.onCommand?.addListener(async (name, tab) => {
    const tabId = tab?.id ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
    if (!Number.isSafeInteger(tabId)) return;
    let command = null;
    if (SENTENCE[name]) command = { cmd: 'sentence', action: SENTENCE[name] };
    else if (OFFSET_STEP[name]) command = { cmd: 'offset', delta: OFFSET_STEP[name], announce: true };
    else if (name === 'toggle-auto-pause') {
      await prefs.load();
      const on = !prefs.get().autoPause;
      await prefs.set({ autoPause: on });
      command = { cmd: 'auto-pause', value: on, announce: true };
    }
    if (command) pageEvents.command(tabId, command).catch(() => {}); // no page of ours there
  });

  const wakeUp = () => Promise.resolve(wake()).catch((e) => console.warn(`[T-Caption] offscreen: ${e.message}`));
  chrome.runtime.onInstalled.addListener(wakeUp);
  chrome.runtime.onStartup.addListener(wakeUp);

  // The app may come and go: one quiet hello a minute (the client's own retry rule).
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== KEEPALIVE) return;
    toOffscreen(MSG.COMPANION_CONNECT, { quiet: true }).catch((e) => console.warn(`[T-Caption] keepalive: ${e.message}`));
  });
  // create() with an existing name restarts the period, so only when missing.
  chrome.alarms.get(KEEPALIVE).then((a) => a || chrome.alarms.create(KEEPALIVE, { periodInMinutes: 1 }));

  // A fresh worker: prefs, the tabs on screen and the channel state, then decide.
  prefs.load().then(() => orchestrator.evaluate());
  arbiter.init();
  toOffscreen(MSG.COMPANION_LOAD).then(channelChanged, (e) => console.warn(`[T-Caption] channel: ${e.message}`));

  return { siteAccess, pageEvents, prefs, arbiter, subtitleCache, orchestrator };
}
