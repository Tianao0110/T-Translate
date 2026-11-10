// Service worker: keeps the offscreen document (which owns the companion
// client and the media pipeline) alive, relays the extension pages'
// COMPANION_* and MEDIA_* requests to it, does chrome.storage for it, keeps
// each tab's page evidence and carries commands to it (page-events.js),
// paints the badge and polls the channel once a minute.

import { MSG, TARGET_OFFSCREEN, request, handle, on, isExtensionSender } from '../shared/messages.js';
import { showBadge } from './badge.js';
import { createPageEvents } from './page-events.js';

const OFFSCREEN_PATH = 'offscreen.html';
const KEEPALIVE = 'companion-keepalive';

let creating = null;

async function ensureOffscreen() {
  if (creating) return creating;
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)],
  });
  if (contexts.length) return;
  creating ??= chrome.offscreen
    .createDocument({
      url: OFFSCREEN_PATH,
      reasons: ['BLOBS'],
      justification: 'Holds the long-lived connection to the local T-Translate app and decodes media audio for it.',
    })
    .catch((e) => {
      if (!/single offscreen/i.test(String(e?.message))) throw e;
    })
    .finally(() => {
      creating = null;
    });
  return creating;
}

// The offscreen script may still be starting right after createDocument
// ('no-reply' when only pages that never answer are listening).
async function toOffscreen(type, payload) {
  await ensureOffscreen();
  let reply;
  for (let attempt = 0; attempt < 10; attempt++) {
    reply = await request(type, payload, { target: TARGET_OFFSCREEN });
    if (reply.ok || !['no-receiver', 'no-reply'].includes(reply.error?.code)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!reply.ok) throw Object.assign(new Error(reply.error?.message || type), { code: reply.error?.code });
  return reply.result;
}

const relay = (type) => (payload) => toOffscreen(type, payload);
const fromExtension = (_msg, sender) => isExtensionSender(sender);

// For the orchestrator: getTabEvidence(tabId), onPageEvent(fn), command(tabId, command).
export const pageEvents = createPageEvents({ toOffscreen });

handle(
  {
    [MSG.COMPANION_LOAD]: relay(MSG.COMPANION_LOAD),
    [MSG.COMPANION_PAIR]: relay(MSG.COMPANION_PAIR),
    [MSG.COMPANION_CONNECT]: relay(MSG.COMPANION_CONNECT),
    [MSG.COMPANION_STATE]: relay(MSG.COMPANION_STATE),
    [MSG.COMPANION_FORGET]: relay(MSG.COMPANION_FORGET),
    [MSG.MEDIA_OPEN]: relay(MSG.MEDIA_OPEN),
    [MSG.MEDIA_PUSH]: relay(MSG.MEDIA_PUSH),
    [MSG.MEDIA_CLOSE]: relay(MSG.MEDIA_CLOSE),
    [MSG.COMPANION_STATE_CHANGED]: (state) => showBadge(state),
    [MSG.STORAGE_GET]: async ({ key }) => (await chrome.storage.local.get(key))[key] ?? null,
    [MSG.STORAGE_SET]: async ({ key, value }) => {
      if (value === null || value === undefined) await chrome.storage.local.remove(key);
      else await chrome.storage.local.set({ [key]: value });
    },
    ...pageEvents.extensionHandlers,
  },
  { accept: fromExtension }
);

// Content scripts: page events and MSE bytes from top frames on our hosts, and the liveness ping.
handle(pageEvents.contentHandlers, { accept: pageEvents.fromPage });
on(MSG.MEDIA_EVENT, pageEvents.onMediaEvent);
handle({
  [MSG.PING]: (_payload, sender) => {
    console.debug(`[T-Caption] ping from tab ${sender.tab?.id ?? '?'}`);
    return { pong: true };
  },
});

const wake = () => ensureOffscreen().catch((e) => console.warn(`[T-Caption] offscreen: ${e.message}`));

chrome.runtime.onInstalled.addListener(wake);
chrome.runtime.onStartup.addListener(wake);

// The app may come and go: one quiet hello a minute (the client's own retry rule).
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== KEEPALIVE) return;
  toOffscreen(MSG.COMPANION_CONNECT, { quiet: true }).catch((e) => console.warn(`[T-Caption] keepalive: ${e.message}`));
});
// create() with an existing name restarts the period, so only when missing.
chrome.alarms.get(KEEPALIVE).then((a) => a || chrome.alarms.create(KEEPALIVE, { periodInMinutes: 1 }));
