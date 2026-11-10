// Offscreen document: owns the companion client (long fetch streams outlive
// the service worker) and the media pipeline (WebCodecs), answers the
// worker's COMPANION_* and MEDIA_* requests and broadcasts state changes and
// media events (handlers.js). Its chrome.runtime is messaging only, so
// storage goes through the worker and the version comes from the build.

import { createOffscreenHandlers } from './handlers.js';
import { MSG, TARGET_OFFSCREEN, call, notify, handle, isExtensionSender } from '../shared/messages.js';

const storage = {
  get: (key) => call(MSG.STORAGE_GET, { key }),
  set: (key, value) => call(MSG.STORAGE_SET, { key, value }),
};

handle(createOffscreenHandlers({ storage, notify }), { target: TARGET_OFFSCREEN, accept: (_msg, sender) => isExtensionSender(sender) });
