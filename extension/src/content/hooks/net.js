// Page world: copies subtitle responses the page fetched itself (fetch and
// XMLHttpRequest), so signed URLs such as YouTube's timedtext (with its pot
// token) never need a second request. Only matching responses are cloned,
// at most LIMITS.subtitleBytes each.

import { hookMethod, tryHook } from './patch.js';
import { LIMITS } from '../bridge-protocol.js';

const SUBTITLE_TYPE = /\b(?:text\/vtt|application\/ttml\+xml|application\/x-subrip)\b/i;
const SUBTITLE_EXT = /\.(?:vtt|srt|ttml|dfxp)$/i;

// The rules every site shares; site adapters add their own on top.
export function isGenericSubtitle(url, contentType = '') {
  if (SUBTITLE_TYPE.test(String(contentType))) return true;
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  return u.pathname.endsWith('/api/timedtext') || SUBTITLE_EXT.test(u.pathname);
}

const urlOf = (input, base) => {
  try {
    return new URL(typeof input === 'string' ? input : input?.url ?? String(input), base).href;
  } catch {
    return '';
  }
};

// The body as text, or null past the cap (the rest is not read).
async function readCapped(res, cap) {
  if (!res.body) return res.text();
  const reader = res.body.getReader();
  const parts = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > cap) {
      reader.cancel().catch(() => {});
      return null;
    }
    parts.push(value);
  }
  const all = new Uint8Array(n);
  let at = 0;
  for (const p of parts) {
    all.set(p, at);
    at += p.byteLength;
  }
  return new TextDecoder().decode(all);
}

export function installNetHooks(win, { isSubtitle = () => false, emit, cap = LIMITS.subtitleBytes }) {
  const matches = (url, type) => {
    try {
      return !!url && (isGenericSubtitle(url, type) || !!isSubtitle(url, type));
    } catch {
      return false;
    }
  };
  const base = () => win.location?.href;

  function fromFetch(res, requestUrl) {
    if (!res || typeof res.clone !== 'function' || res.type === 'opaque' || res.type === 'opaqueredirect') return;
    const url = res.url || requestUrl;
    const contentType = res.headers.get('content-type') || '';
    if (!matches(url, contentType)) return;
    if (Number(res.headers.get('content-length')) > cap) return;
    const copy = res.clone();
    readCapped(copy, cap).then(
      (text) => {
        if (typeof text === 'string') emit({ k: 'subtitle', via: 'fetch', url, status: res.status, contentType, text });
      },
      () => {}
    );
  }

  const fetchState = tryHook(() =>
    hookMethod(win, 'fetch', (promise, _self, args) => {
      const requestUrl = urlOf(args[0], base());
      // The first reaction on the page's promise, so the clone happens before the page reads the body.
      if (promise && typeof promise.then === 'function') {
        promise.then(
          (res) => {
            try {
              fromFetch(res, requestUrl);
            } catch {}
          },
          () => {}
        );
      }
    })
  );

  const opened = new WeakMap();
  function onXhrLoad() {
    try {
      const xhr = this;
      if (xhr.responseType !== '' && xhr.responseType !== 'text') return;
      const url = xhr.responseURL || opened.get(xhr)?.url || '';
      const contentType = xhr.getResponseHeader('content-type') || '';
      if (!matches(url, contentType)) return;
      const text = xhr.responseText;
      if (typeof text !== 'string' || text.length > cap) return;
      emit({ k: 'subtitle', via: 'xhr', url, status: xhr.status, contentType, text });
    } catch {}
  }

  const proto = win.XMLHttpRequest?.prototype;
  const xhrState = tryHook(() => {
    const open = hookMethod(proto, 'open', (_r, self, args) => {
      const m = opened.get(self) || {};
      m.url = urlOf(args[1], base());
      opened.set(self, m);
    });
    const send = hookMethod(
      proto,
      'send',
      () => {},
      {
        before(self) {
          const m = opened.get(self);
          if (m && !m.listening) {
            m.listening = true;
            self.addEventListener('load', onXhrLoad);
          }
        },
      }
    );
    return open && send;
  });

  return { fetch: fetchState, xhr: xhrState };
}
