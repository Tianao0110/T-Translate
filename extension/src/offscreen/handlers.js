// What the offscreen side answers: the companion client, the media pipeline
// and listen sessions behind the worker's COMPANION_* / MEDIA_* / LISTEN_*
// requests. storage { get(key), set(key, value) } and notify(type, payload)
// are the host's: in Chrome the offscreen document reaches the worker by
// messages, in Firefox both live in the background page.

import { createCompanionClient } from './companion-client.js';
import { createMediaPipeline } from './media-pipeline.js';
import { createListenSessions } from './listen-session.js';
import { MSG, decodeBytes } from '../shared/messages.js';
import { VERSION } from '../shared/version.js';

// Resolves the map { [type]: async (payload) => result } for handle() or direct calls.
export function createOffscreenHandlers({ storage, notify }) {
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
  const listen = createListenSessions({ client, onEvent: (payload) => notify(MSG.MEDIA_EVENT, payload) });

  async function connected() {
    await ready();
    if (client.getState().status !== 'ready') await connectOnce();
  }

  return {
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
    [MSG.COMPANION_TRANSLATE]: async (payload) => {
      await connected();
      const items = Array.isArray(payload?.items) ? payload.items : [];
      return client.translate(items, { source: String(payload?.source || 'auto'), target: String(payload?.target ?? '') });
    },
    // Fails fast when the app is not reachable; the ASR session opens with the first decoded audio.
    [MSG.MEDIA_OPEN]: async (payload) => {
      await connected();
      return pipeline.open({ key: payload?.key, lang: String(payload?.lang ?? ''), targetLang: String(payload?.targetLang ?? ''), source: payload?.source ?? 'mse' });
    },
    [MSG.MEDIA_PUSH]: async (payload) => pipeline.push({ key: payload?.key, bytes: decodeBytes(payload?.bytes), offset: payload?.offset }),
    [MSG.MEDIA_CLOSE]: async (payload) => pipeline.close({ key: payload?.key, drain: payload?.drain !== false, handover: payload?.handover === true }),
    [MSG.LISTEN_OPEN]: async (payload) => {
      await connected();
      return listen.open({ key: payload?.key, lang: String(payload?.lang ?? ''), targetLang: String(payload?.targetLang ?? ''), mediaStartS: Number(payload?.mediaStartS) || 0 });
    },
    [MSG.LISTEN_CLOSE]: async (payload) => listen.close({ key: payload?.key, handover: payload?.handover === true }),
  };
}
