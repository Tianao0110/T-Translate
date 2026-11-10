// Runtime message types between the extension's contexts and the
// { ok, result | error } envelope every reply uses.
//
// options / popup ──COMPANION_*──▶ service worker ──(target: offscreen)──▶ offscreen
// offscreen ──COMPANION_STATE_CHANGED──▶ everyone (badge, open pages)
// offscreen ──STORAGE_*──▶ service worker (offscreen pages only get chrome.runtime)
// content scripts ──PING──▶ service worker

export const MSG = {
  // Ensure the channel is loaded and re-check it with one hello; replies with the state.
  COMPANION_LOAD: 'companion/load',
  COMPANION_PAIR: 'companion/pair',
  // payload { quiet }: quiet skips when unpaired and swallows failures (keepalive).
  COMPANION_CONNECT: 'companion/connect',
  COMPANION_STATE: 'companion/state',
  COMPANION_FORGET: 'companion/forget',
  COMPANION_STATE_CHANGED: 'companion/state-changed',
  STORAGE_GET: 'storage/get',
  STORAGE_SET: 'storage/set',
  PING: 'ping',
};

export const TARGET_OFFSCREEN = 'offscreen';

export class MessageError extends Error {
  constructor(code, message = code) {
    super(message);
    this.code = code;
  }
}

const runtimeOf = (runtime) => runtime || globalThis.chrome?.runtime;

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
  return () => rt.onMessage.removeListener(listener);
}

// Listens for an untargeted broadcast without replying.
export function on(type, fn, { runtime } = {}) {
  const rt = runtimeOf(runtime);
  const listener = (msg) => {
    if (msg && msg.type === type && !msg.target) fn(msg.payload);
    return false;
  };
  rt.onMessage.addListener(listener);
  return () => rt.onMessage.removeListener(listener);
}

// Extension pages (service worker, offscreen, options, popup) — not content
// scripts, whose sender.url is the web page.
export function isExtensionSender(sender, runtime) {
  const rt = runtimeOf(runtime);
  return !!sender && sender.id === rt.id && typeof sender.url === 'string' && sender.url.startsWith(rt.getURL(''));
}
