// Runtime message types between the extension's contexts and the
// { ok, result | error } envelope every reply uses.
//
// options / popup ──COMPANION_*──▶ service worker ──(target: offscreen)──▶ offscreen
// offscreen ──COMPANION_STATE_CHANGED──▶ everyone (badge, open pages)
// offscreen ──STORAGE_*──▶ service worker (offscreen pages only get chrome.runtime)
// extension pages ──MEDIA_OPEN/PUSH/CLOSE / LISTEN_OPEN/CLOSE / COMPANION_TRANSLATE──▶ service worker ──▶ offscreen
// offscreen ──MEDIA_EVENT { key, event }──▶ everyone (media pipeline and listen sessions alike)
// content scripts ──PAGE_EVENT / PAGE_MEDIA / PING──▶ service worker (only these)
// service worker ──PAGE_COMMAND──▶ a tab's top-frame content script (tabs.sendMessage)
// extension pages ──TAB_EVIDENCE / TAB_COMMAND / TAB_STATE──▶ service worker
// extension pages ──SITE_LIST / SITE_ALLOW / SITE_REVOKE──▶ service worker (sw/site-access.js)
// extension pages ──CACHE_*──▶ service worker (the subtitle cache, sw/cache-db.js)
// Firefox: no offscreen document; the worker's requests to it are direct
// calls in the background page, its broadcasts also go out by notifyLocal.
//
// Messages are JSON on the wire (an ArrayBuffer arrives as {}), so media
// bytes travel as base64: encodeBytes / decodeBytes.

export const MSG = {
  // Ensure the channel is loaded and re-check it with one hello; replies with the state.
  COMPANION_LOAD: 'companion/load',
  COMPANION_PAIR: 'companion/pair',
  // payload { quiet }: quiet skips when unpaired and swallows failures (keepalive).
  COMPANION_CONNECT: 'companion/connect',
  COMPANION_STATE: 'companion/state',
  COMPANION_FORGET: 'companion/forget',
  COMPANION_STATE_CHANGED: 'companion/state-changed',
  // payload { items: [{ id, text }], source?, target }: replies the client's translate result.
  COMPANION_TRANSLATE: 'companion/translate',
  STORAGE_GET: 'storage/get',
  STORAGE_SET: 'storage/set',
  // payload { key, lang, targetLang, source? }: a new media stream (replaces the one in progress);
  // source 'mse' (default: WebM / fragmented MP4 from a page) or 'direct' (a progressive MP4 the worker fetches).
  MEDIA_OPEN: 'media/open',
  // payload { key, bytes, offset? }: bytes is base64 of the stream's next bytes, cut anywhere;
  // offset is their file offset (direct streams only, required there). Replies { ended }.
  MEDIA_PUSH: 'media/push',
  // payload { key }: replies with the stream's stats once its session closed.
  MEDIA_CLOSE: 'media/close',
  MEDIA_EVENT: 'media/event',
  // payload { key, lang, targetLang, mediaStartS }: a listen session (the app captures system sound); events arrive as MEDIA_EVENT.
  LISTEN_OPEN: 'listen/open',
  // payload { key }: closes it; replies once it is closed.
  LISTEN_CLOSE: 'listen/close',
  // payload { docId, navSeq, event }: what the page did (shared/page-protocol.js); replies { boot }.
  PAGE_EVENT: 'page/event',
  // payload { streamId, seq, init, timeS, bytes }: MSE audio while capture is on; replies { accepted, ended?, reason? }.
  PAGE_MEDIA: 'page/media',
  // payload { cmd, ... }: mse-capture, cues (op set / upsert / translation / list), display, mode, size, site-captions, notice, yt-reload, yt-captions-on, query.
  PAGE_COMMAND: 'page/command',
  // payload { tabId }: the tab's evidence, or null.
  TAB_EVIDENCE: 'tab/evidence',
  // payload { tabId, command }: a PAGE_COMMAND for the tab (mse-capture / listen open and close the sessions too).
  TAB_COMMAND: 'tab/command',
  // payload { tabId }: what the orchestrator does in the tab (state, tier, why it is blocked), or null.
  TAB_STATE: 'tab/state',
  // Replies the host patterns of the sites T-Caption runs on beyond the manifest's.
  SITE_LIST: 'site/list',
  // payload { pattern, tabId?, pending? }: the browser granted pattern (permissions.request in the
  // user's click): scripts for it, injected into tabId at once; replies { pattern, sites, injected }.
  // pending: sent just before the request, finished here when the grant arrives (the popup may be gone).
  SITE_ALLOW: 'site/allow',
  // payload { pattern }: stops running there and gives the permission back; replies { pattern, removed, sites }.
  SITE_REVOKE: 'site/revoke',
  // Broadcast by the worker, payload { sites }: the list changed.
  SITES_CHANGED: 'site/changed',
  // Replies { count, bytes }.
  CACHE_STATS: 'cache/stats',
  // Empties the cache; replies { count, bytes } after.
  CACHE_CLEAR: 'cache/clear',
  // payload { key }: the record under `${site}:${mediaId}` (a hit counts as a use), or null.
  CACHE_GET: 'cache/get',
  // payload { key, record: { cues, tier, lang, target, sentences, url, title } }: stores it; replies its metadata.
  CACHE_PUT: 'cache/put',
  // Replies every record's metadata (no cues), newest first.
  CACHE_LIST: 'cache/list',
  // payload { key }: removes that record; replies { count, bytes } after.
  CACHE_DELETE: 'cache/delete',
  PING: 'ping',
};

export const TARGET_OFFSCREEN = 'offscreen';
export const MAX_MEDIA_PUSH_BYTES = 256 * 1024;
const MAX_MEDIA_PUSH_CHARS = Math.ceil(MAX_MEDIA_PUSH_BYTES / 3) * 4;

export class MessageError extends Error {
  constructor(code, message = code) {
    super(message);
    this.code = code;
  }
}

const runtimeOf = (runtime) => runtime || globalThis.chrome?.runtime;

// Same-page delivery: a Firefox build runs the worker's and the offscreen's
// code in one background page, where runtime.sendMessage never reaches the
// page that sent it, so their broadcasts also go through notifyLocal. Kept
// per runtime; nothing in a Chrome build calls notifyLocal.
const localListeners = new WeakMap();
const localOf = (rt) => {
  let set = localListeners.get(rt);
  if (!set) localListeners.set(rt, (set = new Set()));
  return set;
};

export function encodeBytes(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}

// Throws MessageError 'bad-bytes' / 'too-large' (over MAX_MEDIA_PUSH_BYTES).
export function decodeBytes(b64) {
  if (typeof b64 !== 'string') throw new MessageError('bad-bytes');
  if (b64.length > MAX_MEDIA_PUSH_CHARS) throw new MessageError('too-large');
  let s;
  try {
    s = atob(b64);
  } catch {
    throw new MessageError('bad-bytes');
  }
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function errorOf(e) {
  return { code: (e && typeof e.code === 'string' && e.code) || 'error', message: String(e?.message ?? e) };
}

// Sends one message. Resolves to the reply envelope; never rejects.
export async function request(type, payload, { target, runtime } = {}) {
  const msg = { type, payload };
  if (target) msg.target = target;
  let reply;
  try {
    reply = await runtimeOf(runtime).sendMessage(msg);
  } catch (e) {
    return { ok: false, error: { code: 'no-receiver', message: String(e?.message ?? e) } };
  }
  if (!reply || typeof reply.ok !== 'boolean') return { ok: false, error: { code: 'no-reply', message: type } };
  return reply;
}

// request(), unwrapped: the result, or a MessageError carrying the remote code.
export async function call(type, payload, opts) {
  const reply = await request(type, payload, opts);
  if (!reply.ok) throw new MessageError(reply.error?.code || 'error', reply.error?.message);
  return reply.result;
}

// Fire and forget (broadcasts): nobody listening is fine.
export function notify(type, payload, { runtime } = {}) {
  try {
    const p = runtimeOf(runtime).sendMessage({ type, payload });
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch {}
}

// A broadcast to this page's own handle() / on() listeners, as if it came
// from another extension page (replies are dropped).
export function notifyLocal(type, payload, { runtime } = {}) {
  const rt = runtimeOf(runtime);
  const sender = { id: rt.id, url: globalThis.location?.href ?? '' };
  for (const fn of [...localOf(rt)]) {
    try {
      fn({ type, payload }, sender, () => {});
    } catch {}
  }
}

// Answers the types in map ({ [type]: async (payload, sender) => result }) that
// are addressed to `target` (null: untargeted) and pass accept(msg, sender).
// Other messages are left to other listeners. Returns the unsubscribe.
export function handle(map, { target = null, accept = () => true, runtime } = {}) {
  const rt = runtimeOf(runtime);
  const listener = (msg, sender, sendResponse) => {
    if (!msg || typeof msg.type !== 'string' || (msg.target ?? null) !== target) return false;
    const fn = Object.hasOwn(map, msg.type) ? map[msg.type] : null;
    if (!fn) return false;
    if (!accept(msg, sender)) {
      sendResponse({ ok: false, error: { code: 'forbidden', message: msg.type } });
      return false;
    }
    Promise.resolve()
      .then(() => fn(msg.payload, sender))
      .then(
        (result) => sendResponse({ ok: true, result: result ?? null }),
        (e) => sendResponse({ ok: false, error: errorOf(e) })
      );
    return true; // the reply is async
  };
  rt.onMessage.addListener(listener);
  localOf(rt).add(listener);
  return () => {
    rt.onMessage.removeListener(listener);
    localOf(rt).delete(listener);
  };
}

// Listens for an untargeted broadcast without replying.
export function on(type, fn, { runtime } = {}) {
  const rt = runtimeOf(runtime);
  const listener = (msg) => {
    if (msg && msg.type === type && !msg.target) fn(msg.payload);
    return false;
  };
  rt.onMessage.addListener(listener);
  localOf(rt).add(listener);
  return () => {
    rt.onMessage.removeListener(listener);
    localOf(rt).delete(listener);
  };
}

// Extension pages (service worker, offscreen, options, popup) — not content
// scripts, whose sender.url is the web page.
export function isExtensionSender(sender, runtime) {
  const rt = runtimeOf(runtime);
  return !!sender && sender.id === rt.id && typeof sender.url === 'string' && sender.url.startsWith(rt.getURL(''));
}
