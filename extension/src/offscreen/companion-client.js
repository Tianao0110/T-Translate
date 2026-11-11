// The extension's side of Companion Protocol v1: pairing, hello, translate,
// ASR sessions (open / feed / seek / events / close) and the system-listen fallback,
// against the T-Translate companion server on 127.0.0.1. Runs in the
// offscreen document (long-lived fetch streams, WebCodecs next door); only
// fetch, storage and timers are used, so it also runs under Node for tests.
// Rules: docs/design/listen.md §11.

import {
  PROTOCOL_VERSION,
  CLIENT_NAME,
  CLIENT_STATUS,
  STREAM_SILENCE_MS,
  portRange,
  baseUrl,
  createLineSplitter,
  backoffMs,
  batches,
} from '../shared/protocol.js';

const PAIRING_KEY = 'pairing';

export class ClientError extends Error {
  constructor(code, status = 0, detail = null) {
    super(code);
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isObject = (v) => v && typeof v === 'object';

async function jsonOf(res) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

// storage: { get(key) -> Promise<value>, set(key, value) -> Promise }.
export function createCompanionClient({
  version,
  storage,
  fetch: fetchImpl = globalThis.fetch,
  logger = console,
  onState = () => {},
  streamSilenceMs = STREAM_SILENCE_MS,
  reconnectDelay = backoffMs,
} = {}) {
  if (!version) throw new Error('companion client needs the extension version');
  let pairing = null; // { port, token, protocol }
  let state = {
    status: CLIENT_STATUS.UNPAIRED,
    port: null,
    protocol: null,
    privacyMode: null,
    capabilities: null,
    app: null,
    appVersion: null,
    lastError: null,
  };

  function setState(patch) {
    state = { ...state, ...patch };
    try {
      onState(state);
    } catch (e) {
      logger.warn?.(`companion state listener failed: ${e.message}`);
    }
  }

  function headers(extra = {}) {
    const h = { 'x-tt-client': `${CLIENT_NAME}/${version}`, ...extra };
    if (pairing?.token) h.authorization = `Bearer ${pairing.token}`;
    return h;
  }

  async function forget() {
    pairing = null;
    await storage.set(PAIRING_KEY, null);
    setState({ status: CLIENT_STATUS.UNPAIRED, port: null, capabilities: null, privacyMode: null });
  }

  async function load() {
    const saved = await storage.get(PAIRING_KEY);
    pairing = isObject(saved) && typeof saved.token === 'string' && Number.isInteger(saved.port) ? saved : null;
    setState(pairing ? { status: CLIENT_STATUS.OFFLINE, port: pairing.port, protocol: pairing.protocol ?? null } : { status: CLIENT_STATUS.UNPAIRED });
    return state;
  }

  // A request on the paired port; 401 means the token died (regenerated).
  async function request(method, path, { json, body, headers: extra, signal, port = pairing?.port } = {}) {
    if (!port) throw new ClientError('unpaired');
    const init = { method, headers: headers(extra), signal };
    if (json !== undefined) {
      init.headers['content-type'] = 'application/json';
      init.body = JSON.stringify(json);
    } else if (body !== undefined) {
      init.body = body;
    }
    const res = await fetchImpl(`${baseUrl(port)}${path}`, init);
    if (res.status === 401) {
      await forget();
      throw new ClientError('unauthorized', 401);
    }
    return res;
  }

  // The user opened the pairing window in the app's settings: the first port
  // that answers hands out the token.
  async function pair({ ports = portRange(pairing?.port) } = {}) {
    for (const port of ports) {
      let res;
      try {
        res = await fetchImpl(`${baseUrl(port)}/v1/pair`, { method: 'POST', headers: headers() });
      } catch {
        continue; // nothing listening here
      }
      if (res.status !== 200) continue; // 403: window closed, or not our app
      const j = await jsonOf(res);
      if (typeof j.token !== 'string' || !j.token) continue;
      pairing = { port: Number.isInteger(j.port) ? j.port : port, token: j.token, protocol: j.protocol ?? null };
      await storage.set(PAIRING_KEY, pairing);
      setState({ status: CLIENT_STATUS.OFFLINE, port: pairing.port, protocol: pairing.protocol, lastError: null });
      return hello();
    }
    setState({ lastError: 'pairing-failed' });
    throw new ClientError('pairing-failed');
  }

  async function hello({ port = pairing?.port } = {}) {
    if (!pairing) throw new ClientError('unpaired');
    let res;
    try {
      res = await request('GET', '/v1/hello', { port });
    } catch (e) {
      if (e instanceof ClientError) throw e;
      setState({ status: CLIENT_STATUS.OFFLINE, lastError: 'unreachable' });
      throw new ClientError('unreachable', 0, e.message);
    }
    if (!res.ok) {
      setState({ status: CLIENT_STATUS.OFFLINE, lastError: `hello-${res.status}` });
      throw new ClientError('hello-failed', res.status);
    }
    const j = await jsonOf(res);
    if (j.protocol !== PROTOCOL_VERSION) {
      setState({ status: CLIENT_STATUS.OFFLINE, protocol: j.protocol ?? null, lastError: 'protocol-mismatch' });
      throw new ClientError('protocol-mismatch', res.status, j.protocol);
    }
    setState({
      status: CLIENT_STATUS.READY,
      port,
      protocol: j.protocol,
      privacyMode: j.privacyMode ?? null,
      capabilities: j.capabilities ?? null,
      app: j.app ?? null,
      appVersion: j.version ?? null,
      lastError: null,
    });
    return j;
  }

  // hello on the paired port, else the same token on the other ports (the
  // app came back on a different one). Resolves with the hello payload.
  async function connect() {
    if (!pairing) throw new ClientError('unpaired');
    try {
      return await hello();
    } catch (e) {
      if (e.code !== 'unreachable' && e.code !== 'hello-failed') throw e;
    }
    for (const port of portRange(pairing.port)) {
      if (port === pairing.port) continue;
      try {
        const j = await hello({ port });
        pairing = { ...pairing, port };
        await storage.set(PAIRING_KEY, pairing);
        return j;
      } catch (e) {
        if (e.code === 'unauthorized' || e.code === 'protocol-mismatch') throw e;
      }
    }
    setState({ status: CLIENT_STATUS.OFFLINE, lastError: 'unreachable' });
    throw new ClientError('unreachable');
  }

  // items: [{ id, text }]; resolves to [{ id, text }] or [{ id, error }] in input order.
  async function translate(items, { source = 'auto', target } = {}) {
    if (!target) throw new ClientError('bad-request', 0, 'target');
    const out = [];
    for (const batch of batches(items)) {
      const res = await request('POST', '/v1/translate', { json: { items: batch, source, target } });
      if (res.status === 503) throw new ClientError('no-translator', 503);
      if (!res.ok) throw new ClientError('translate-failed', res.status, await jsonOf(res));
      const j = await jsonOf(res);
      out.push(...(Array.isArray(j.items) ? j.items : []));
    }
    return out;
  }

  async function openSession(path, { mode, lang = '', targetLang = '', mediaStartS = 0 } = {}) {
    const res = await request('POST', path, { json: { mode, lang, targetLang, mediaStartS } });
    const j = await jsonOf(res);
    if (res.status === 200 && typeof j.id === 'string') return { id: j.id };
    if (res.status === 409) throw new ClientError('busy', 409, j.owner || null);
    if (res.status === 503) throw new ClientError(j.error || 'no-model', 503);
    throw new ClientError(j.error || 'open-failed', res.status);
  }

  // mode 'feed': the extension posts PCM; 'system': the app captures the
  // system's sound (DRM fallback).
  const openAsr = (opts) => openSession('/v1/asr/open', { mode: 'feed', ...opts });
  const listenOpen = (opts) => openSession('/v1/listen/open', { ...opts, mode: 'system' });

  // pcm: Float32Array at 16 kHz mono. Resolves { ok } | { wait, reason }.
  async function feed(id, pcm, seq) {
    const extra = { 'content-type': 'application/octet-stream', 'x-session-id': id };
    if (Number.isInteger(seq)) extra['x-seq'] = String(seq);
    const body = pcm.buffer.byteLength === pcm.byteLength ? pcm.buffer : pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength);
    const res = await request('POST', '/v1/asr/feed', { body, headers: extra });
    if (res.status === 204) return { ok: true };
    const j = await jsonOf(res);
    if (res.status === 429) {
      const retry = Number(res.headers.get('retry-after')) || 1;
      return { wait: j.retryAfterMs || retry * 1000, reason: j.error || 'rate' };
    }
    if (res.status === 503) return { wait: 300, reason: 'not-ready' };
    if (res.status === 409 && j.error === 'stale-seq') return { ok: true, stale: true, expected: j.expected };
    throw new ClientError(j.error || 'feed-failed', res.status, j);
  }

  // The media jumped: the same session goes on from mediaStartS. Resolves { atS }.
  async function seekAsr(id, { mediaStartS = 0 } = {}) {
    const res = await request('POST', '/v1/asr/seek', { json: { id, mediaStartS } });
    const j = await jsonOf(res);
    if (res.status === 200 && Number.isFinite(j.atS)) return { atS: j.atS };
    throw new ClientError(j.error || 'seek-failed', res.status);
  }

  async function closeAsr(id) {
    const res = await request('POST', '/v1/asr/close', { json: { id } });
    return res.status === 204 || res.status === 404;
  }

  // Reads the NDJSON event stream, reconnecting until 'closed' (or stop()).
  // Heartbeat lines ({}) only feed the silence watchdog.
  function subscribe(id, onEvent) {
    let stopped = false;
    let controller = null;
    let attempt = 0;
    const deliver = (evt) => {
      try {
        onEvent(evt);
      } catch (e) {
        logger.warn?.(`companion event listener failed: ${e.message}`);
      }
    };
    const readOnce = async () => {
      controller = new AbortController();
      const res = await request('GET', `/v1/asr/events?id=${encodeURIComponent(id)}`, { signal: controller.signal });
      if (res.status === 404) {
        deliver({ type: 'closed', reason: 'unknown-session' });
        return true;
      }
      if (!res.ok || !res.body) throw new ClientError('events-failed', res.status);
      attempt = 0;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const lines = createLineSplitter();
      const handle = (line) => {
        let evt;
        try {
          evt = JSON.parse(line);
        } catch {
          return false;
        }
        if (!isObject(evt) || !evt.type) return false; // heartbeat
        deliver(evt);
        return evt.type === 'closed';
      };
      for (;;) {
        let timer;
        const silence = new Promise((_, reject) => {
          timer = setTimeout(() => reject(new ClientError('stream-silent')), streamSilenceMs);
        });
        let chunk;
        try {
          chunk = await Promise.race([reader.read(), silence]);
        } finally {
          clearTimeout(timer);
        }
        if (chunk.done) {
          for (const line of lines.flush()) if (handle(line)) return true;
          return false; // server ended the stream without 'closed': reconnect
        }
        for (const line of lines.push(decoder.decode(chunk.value, { stream: true }))) {
          if (handle(line)) {
            await reader.cancel().catch(() => {});
            return true;
          }
        }
      }
    };
    (async () => {
      while (!stopped) {
        try {
          if (await readOnce()) return;
        } catch (e) {
          if (stopped) return;
          if (e.code === 'unauthorized' || e.code === 'unpaired') {
            deliver({ type: 'closed', reason: e.code });
            return;
          }
          logger.debug?.(`companion events reconnect (${e.code || e.message})`);
        }
        if (stopped) return;
        await sleep(reconnectDelay(attempt++));
      }
    })();
    return {
      stop() {
        stopped = true;
        controller?.abort();
      },
    };
  }

  return {
    load,
    pair,
    hello,
    connect,
    translate,
    openAsr,
    listenOpen,
    feed,
    seekAsr,
    closeAsr,
    subscribe,
    forget,
    getState: () => state,
    isPaired: () => !!pairing,
  };
}
