// Background page (Firefox build): Firefox has no offscreen documents, and
// its MV3 background is an event page with a DOM and WebCodecs, so the
// offscreen side runs here too. The worker's requests to it are direct
// calls; its broadcasts go to the other extension pages by message and to
// this page's own listeners by notifyLocal; storage is chrome.storage here.

import { createOffscreenHandlers } from '../offscreen/handlers.js';
import { notify, notifyLocal, errorOf } from '../shared/messages.js';
import { startWorker } from '../sw/worker.js';

const storage = {
  get: async (key) => (await chrome.storage.local.get(key))[key] ?? null,
  set: async (key, value) => {
    if (value === null || value === undefined) await chrome.storage.local.remove(key);
    else await chrome.storage.local.set({ [key]: value });
  },
};

const handlers = createOffscreenHandlers({
  storage,
  notify: (type, payload) => {
    notify(type, payload);
    notifyLocal(type, payload);
  },
});

// As over messages: the result as JSON, errors keep their code.
async function toOffscreen(type, payload) {
  const fn = Object.hasOwn(handlers, type) ? handlers[type] : null;
  if (!fn) throw Object.assign(new Error(type), { code: 'no-receiver' });
  try {
    const result = await fn(payload);
    return result === undefined ? null : JSON.parse(JSON.stringify(result));
  } catch (e) {
    const { code, message } = errorOf(e);
    throw Object.assign(new Error(message), { code });
  }
}

startWorker({ toOffscreen });
