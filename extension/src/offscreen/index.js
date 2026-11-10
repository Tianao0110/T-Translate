// Offscreen document: owns the companion client (long fetch streams outlive
// the service worker) and the media pipeline (WebCodecs), answers the
// worker's COMPANION_* and MEDIA_* requests and broadcasts state changes and
// media events. Its chrome.runtime is messaging only, so storage goes through
// the worker and the version comes from the build.

import { createCompanionClient } from './companion-client.js';
import { createMediaPipeline } from './media-pipeline.js';
import { MSG, TARGET_OFFSCREEN, call, notify, handle, isExtensionSender, decodeBytes } from '../shared/messages.js';
import { VERSION } from '../shared/version.js';

const storage = {
  get: (key) => call(MSG.STORAGE_GET, { key }),
  set: (key, value) => call(MSG.STORAGE_SET, { key, value }),
};

const client = createCompanionClient({
  version: VERSION,
  storage,
  onState: (state) => notify(MSG.COMPANION_STATE_CHANGED, state),
});

// One hello sweep at a time, however many callers.
let connecting = null;
function connectOnce() {
  connecting ??= client.connect().finally(() => {
    connecting = null;
  });
  return connecting;
}

// Pairing is read once; a failed read (worker gone mid-start) is retried on the next request.
const start = () =>
  client.load().then(() => {
    if (client.isPaired()) connectOnce().catch(() => {});
  });
let loading = start();
loading.catch(() => {});
const ready = () => (loading = loading.catch(start));

const pipeline = createMediaPipeline({ client, onEvent: (payload) => notify(MSG.MEDIA_EVENT, payload) });

handle(
  {
    [MSG.COMPANION_LOAD]: async () => {
      await ready();
      if (client.isPaired()) await connectOnce().catch(() => {});
      return client.getState();
    },
    [MSG.COMPANION_STATE]: async () => {
      await ready();
      return client.getState();
    },
    [MSG.COMPANION_PAIR]: async () => {
      await ready();
      await client.pair();
      return client.getState();
    },
    [MSG.COMPANION_CONNECT]: async (payload) => {
      await ready();
      if (payload?.quiet === true) {
        if (client.isPaired()) await connectOnce().catch(() => {});
      } else {
        await connectOnce();
      }
      return client.getState();
    },
    [MSG.COMPANION_FORGET]: async () => {
      await ready();
      await client.forget();
      return client.getState();
    },
    // Fails fast when the app is not reachable; the ASR session opens with the first decoded audio.
    [MSG.MEDIA_OPEN]: async (payload) => {
      await ready();
      if (client.getState().status !== 'ready') await connectOnce();
      return pipeline.open({ key: payload?.key, lang: String(payload?.lang ?? ''), targetLang: String(payload?.targetLang ?? '') });
    },
    [MSG.MEDIA_PUSH]: async (payload) => pipeline.push({ key: payload?.key, bytes: decodeBytes(payload?.bytes) }),
    [MSG.MEDIA_CLOSE]: async (payload) => pipeline.close({ key: payload?.key }),
  },
  { target: TARGET_OFFSCREEN, accept: (_msg, sender) => isExtensionSender(sender) }
);
