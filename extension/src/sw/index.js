// Service worker (Chrome): keeps the offscreen document (which owns the
// companion client, the media pipeline and listen sessions) alive and talks
// to it by targeted messages; the rest is worker.js.

import { TARGET_OFFSCREEN, request } from '../shared/messages.js';
import { startWorker } from './worker.js';

const OFFSCREEN_PATH = 'offscreen.html';

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

export const { siteAccess, pageEvents, prefs, arbiter, subtitleCache, orchestrator } = startWorker({ toOffscreen, wake: ensureOffscreen });
