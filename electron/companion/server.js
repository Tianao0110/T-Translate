// Companion Protocol v1 over HTTP on 127.0.0.1 for T-Caption. Every request
// passes the client header, the origin check and (except /v1/pair) the
// bearer token, then goes to the session (session.js) or the translation
// stack. Rules: docs/design/listen.md §11.

const http = require('http');
const P = require('./protocol');
const { LANG_RE } = require('./session');

const AUTH_WARNS_PER_MIN = 5;
const TRANSLATE_LANES = 2;
const MAX_ITEM_ID = 128;
const CORS_ALLOW_HEADERS = 'authorization, content-type, x-tt-client, x-session-id, x-seq';
const FEED_ERRORS = { 'unknown-session': 404, 'wrong-mode': 409, 'not-ready': 503 };
const OPEN_ERRORS = { 'no-model': 503, 'bad-request': 400 };

class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function sendJson(res, status, body, headers = {}) {
  if (res.headersSent) {
    if (!res.writableEnded) res.end();
    return;
  }
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data), ...headers });
  res.end(data);
}

function sendEmpty(res, status) {
  if (res.headersSent) return;
  res.writeHead(status);
  res.end();
}

function readBody(req, limit) {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > limit) return Promise.reject(new HttpError(413, 'too-large'));
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let over = false;
    req.on('data', (chunk) => {
      if (over) return;
      size += chunk.length;
      if (size > limit) {
        over = true;
        chunks.length = 0;
        reject(new HttpError(413, 'too-large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!over) resolve(Buffer.concat(chunks, size));
    });
    req.on('error', () => reject(new HttpError(400, 'aborted')));
  });
}

async function readJson(req) {
  const body = await readBody(req, P.MAX_JSON_BYTES);
  if (!body.length) return {};
  let value;
  try {
    value = JSON.parse(body.toString('utf8'));
  } catch {
    throw new HttpError(400, 'bad-json');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'bad-json');
  return value;
}

// Little-endian float32 PCM; non-finite samples become silence.
function toFloat32(buf) {
  const out = new Float32Array(buf.length / 4);
  for (let i = 0; i < out.length; i++) {
    const v = buf.readFloatLE(i * 4);
    out[i] = Number.isFinite(v) ? v : 0;
  }
  return out;
}

function validItems(items) {
  if (!Array.isArray(items) || !items.length || items.length > P.MAX_TRANSLATE_ITEMS) return false;
  return items.every(
    (it) =>
      it &&
      typeof it === 'object' &&
      ((typeof it.id === 'string' && it.id.length <= MAX_ITEM_ID) || Number.isSafeInteger(it.id)) &&
      typeof it.text === 'string' &&
      it.text.length <= P.MAX_TRANSLATE_CHARS
  );
}

function createCompanionServer({
  store,
  session,
  translateStream = null,
  logger,
  version = '',
  getPrivacyMode = () => 'standard',
  modelsPresent = () => false,
  onChange = () => {},
  now = Date.now,
  portBase = P.PORT_BASE,
  portSpan = P.PORT_SPAN,
  heartbeatMs = P.HEARTBEAT_MS,
  pairingWindowMs = P.PAIRING_WINDOW_MS,
}) {
  let server = null;
  let boundPort = null;
  let starting = null;
  let token = null;
  let pairingUntil = 0;
  let pairingTimer = null;
  const streams = new Set(); // end() of each open events response
  let authWarns = { since: 0, count: 0 };
  let feedRate = { second: -1, count: 0 };
  let seq = { id: null, last: -1 }; // last accepted x-seq of the open session

  function currentToken() {
    if (!token) {
      const saved = store.get('companion.token');
      token = typeof saved === 'string' && /^[0-9a-f]{64}$/.test(saved) ? saved : null;
      if (!token) {
        token = P.newToken();
        store.set('companion.token', token);
      }
    }
    return token;
  }

  function endStreams() {
    for (const end of [...streams]) end();
  }

  function regenerateToken() {
    token = P.newToken();
    store.set('companion.token', token);
    endStreams();
    logger.info('companion token regenerated');
  }

  const pairingOpen = () => pairingUntil > 0 && now() < pairingUntil;

  function closePairing() {
    clearTimeout(pairingTimer);
    pairingTimer = null;
    const was = pairingUntil > 0;
    pairingUntil = 0;
    if (was) onChange();
  }

  function openPairing() {
    clearTimeout(pairingTimer);
    pairingUntil = now() + pairingWindowMs;
    pairingTimer = setTimeout(closePairing, pairingWindowMs);
    pairingTimer.unref?.();
    logger.info('companion pairing window open');
    onChange();
  }

  function refused(why, route) {
    const t = now();
    if (t - authWarns.since >= 60000) authWarns = { since: t, count: 0 };
    authWarns.count += 1;
    if (authWarns.count <= AUTH_WARNS_PER_MIN) logger.warn(`companion request refused (${why}): ${route}`);
  }

  function hello() {
    let asr = false;
    try {
      asr = !!modelsPresent();
    } catch {
      asr = false;
    }
    return {
      app: 'T-Translate',
      version,
      protocol: P.PROTOCOL_VERSION,
      privacyMode: getPrivacyMode(),
      capabilities: { asr, translate: !!translateStream, listen: true },
    };
  }

  function pair(reply) {
    if (!pairingOpen()) return reply(403, { error: 'pairing-closed' });
    closePairing();
    logger.info('companion client paired');
    return reply(200, { token: currentToken(), port: boundPort, protocol: P.PROTOCOL_VERSION });
  }

  async function translate(req, res, reply) {
    const { items, source, target } = await readJson(req);
    if (!validItems(items)) throw new HttpError(400, 'bad-items');
    if (typeof target !== 'string' || !target || !LANG_RE.test(target)) throw new HttpError(400, 'bad-target');
    if (source != null && (typeof source !== 'string' || !LANG_RE.test(source))) throw new HttpError(400, 'bad-source');
    if (!translateStream) return reply(503, { error: 'no-translator' });

    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });
    const out = new Array(items.length);
    let next = 0;
    let failed = 0;
    const one = async (it) => {
      if (!it.text.trim()) return { id: it.id, text: '' };
      try {
        const r = await translateStream(it.text, { sourceLang: source || 'auto', targetLang: target }, () => {}, { noCache: false, signal: controller.signal });
        if (r && r.success && typeof r.text === 'string') return { id: it.id, text: r.text };
      } catch {
        // counted as a failed item
      }
      failed += 1;
      return { id: it.id, error: 'translate-failed' };
    };
    const lane = async () => {
      while (next < items.length && !controller.signal.aborted) {
        const i = next++;
        out[i] = await one(items[i]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(TRANSLATE_LANES, items.length) }, lane));
    if (controller.signal.aborted) return undefined;
    if (failed) logger.warn(`companion translate: ${failed}/${items.length} items failed`);
    return reply(200, { items: out });
  }

  async function openSession(req, reply, forcedMode) {
    const body = await readJson(req);
    const r = session.open({
      mode: forcedMode || body.mode,
      lang: body.lang ?? '',
      targetLang: body.targetLang ?? '',
      mediaStartS: body.mediaStartS ?? 0,
    });
    if (r.id) {
      seq = { id: r.id, last: -1 };
      return reply(200, { id: r.id });
    }
    if (r.error === 'busy') return reply(409, { error: 'busy', owner: r.owner });
    return reply(OPEN_ERRORS[r.error] || 500, { error: r.error });
  }

  async function feed(req, res, reply) {
    const second = Math.floor(now() / 1000);
    if (feedRate.second !== second) feedRate = { second, count: 0 };
    feedRate.count += 1;
    if (feedRate.count > P.MAX_FEED_PER_SEC) return reply(429, { error: 'rate' }, { 'Retry-After': '1' });

    const id = req.headers['x-session-id'];
    if (typeof id !== 'string' || !id) return reply(400, { error: 'bad-session-id' });
    const seqHeader = req.headers['x-seq'];
    let seqNum = null;
    if (seqHeader !== undefined) {
      if (typeof seqHeader !== 'string' || !/^\d{1,15}$/.test(seqHeader)) return reply(400, { error: 'bad-seq' });
      seqNum = Number(seqHeader);
    }
    const body = await readBody(req, P.MAX_FEED_BYTES);
    if (!body.length || body.length % 4) return reply(400, { error: 'bad-pcm' });
    const sameSession = seqNum !== null && seq.id === id;
    if (sameSession && seqNum <= seq.last) return reply(409, { error: 'stale-seq', expected: seq.last + 1 });

    const r = session.feed(id, toFloat32(body));
    if (r.ok) {
      if (sameSession) seq.last = seqNum;
      return sendEmpty(res, 204);
    }
    if (r.error === 'backpressure') return reply(429, { error: 'backpressure', retryAfterMs: r.retryAfterMs }, { 'Retry-After': '1' });
    return reply(FEED_ERRORS[r.error] || 500, { error: r.error });
  }

  async function closeSession(req, res, reply) {
    const { id } = await readJson(req);
    const r = session.close(typeof id === 'string' ? id : '');
    if (r.ok) return sendEmpty(res, 204);
    return reply(404, { error: r.error });
  }

  // NDJSON: the backlog, then live events, a '{}' heartbeat, and the end
  // of the response after 'closed'.
  function events(res, url, reply) {
    const id = url.searchParams.get('id') || '';
    if (!session.has(id)) return reply(404, { error: 'unknown-session' });
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
    res.flushHeaders();
    res.socket?.setNoDelay(true);
    let ended = false;
    let unsub = null;
    const heartbeat = setInterval(() => res.write('{}\n'), heartbeatMs);
    const end = () => {
      if (ended) return;
      ended = true;
      clearInterval(heartbeat);
      streams.delete(end);
      if (unsub) unsub();
      if (!res.writableEnded) res.end();
    };
    streams.add(end);
    res.on('close', end);
    unsub = session.subscribe(id, (evt) => {
      if (ended) return;
      res.write(P.ndjson(evt));
      if (evt.type === 'closed') end();
    });
    if (ended && unsub) unsub();
    return undefined;
  }

  async function handle(req, res) {
    const t0 = now();
    let url;
    try {
      url = new URL(req.url || '/', `http://${P.HOST}`);
    } catch {
      throw new HttpError(400, 'bad-url');
    }
    const route = `${req.method} ${url.pathname.slice(0, 64)}`;
    res.once('close', () => logger.debug(`companion ${route} -> ${res.statusCode} (${now() - t0} ms)`));
    // Anything not read before replying is drained so the client sees the reply.
    const reply = (status, body, headers) => {
      if (!req.complete) req.resume();
      sendJson(res, status, body, headers);
    };

    res.setHeader('Cache-Control', 'no-store');
    const origin = req.headers.origin;
    const extension = P.isExtensionOrigin(origin);
    if (extension) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', CORS_ALLOW_HEADERS);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }
    if (req.method === 'OPTIONS') {
      if (!extension) {
        refused('preflight', route);
        return reply(403, { error: 'origin' });
      }
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
      if (!req.complete) req.resume();
      return sendEmpty(res, 204);
    }

    if (!P.parseClient(req.headers[P.CLIENT_HEADER])) {
      refused('unknown-client', route);
      return reply(403, { error: 'unknown-client' });
    }
    if (!P.originAllowed(origin)) {
      refused('origin', route);
      return reply(403, { error: 'origin' });
    }
    if (route !== 'POST /v1/pair' && !P.tokenMatches(req.headers.authorization, currentToken())) {
      refused('token', route);
      return reply(401, { error: 'unauthorized' });
    }

    switch (route) {
      case 'GET /v1/hello':
        return reply(200, hello());
      case 'POST /v1/pair':
        return pair(reply);
      case 'POST /v1/translate':
        return translate(req, res, reply);
      case 'POST /v1/asr/open':
        return openSession(req, reply, null);
      case 'POST /v1/listen/open':
        return openSession(req, reply, 'system');
      case 'POST /v1/asr/feed':
        return feed(req, res, reply);
      case 'POST /v1/asr/close':
        return closeSession(req, res, reply);
      case 'GET /v1/asr/events':
        return events(res, url, reply);
      default:
        return reply(404, { error: 'not-found' });
    }
  }

  function onRequest(req, res) {
    handle(req, res).catch((e) => {
      if (e instanceof HttpError) {
        if (!req.complete) req.resume();
        return sendJson(res, e.status, { error: e.code });
      }
      logger.error(`companion request failed: ${e.message}`);
      return sendJson(res, 500, { error: 'internal' });
    });
  }

  function listenOn(port) {
    return new Promise((resolve, reject) => {
      const srv = http.createServer(onRequest);
      const onError = (e) => {
        srv.removeListener('listening', onListening);
        reject(e);
      };
      const onListening = () => {
        srv.removeListener('error', onError);
        resolve(srv);
      };
      srv.once('error', onError);
      srv.once('listening', onListening);
      srv.listen({ port, host: P.HOST, exclusive: true });
    });
  }

  async function bind() {
    currentToken();
    const tries = portBase === 0 ? 1 : Math.max(1, portSpan);
    for (let i = 0; i < tries; i++) {
      const port = portBase === 0 ? 0 : portBase + i;
      try {
        const srv = await listenOn(port);
        srv.on('clientError', (err, socket) => socket.destroy());
        srv.on('error', (e) => logger.warn(`companion server error: ${e.code || e.message}`));
        server = srv;
        boundPort = srv.address().port;
        logger.info(`companion channel listening on ${P.HOST}:${boundPort}`);
        onChange();
        return boundPort;
      } catch (e) {
        // Windows reports ports in an excluded range as EACCES.
        if (e.code !== 'EADDRINUSE' && e.code !== 'EACCES') throw e;
        logger.debug(`companion port ${port} unavailable (${e.code})`);
      }
    }
    throw new Error(`no free port in ${portBase}-${portBase + tries - 1}`);
  }

  function start() {
    if (server) return Promise.resolve(boundPort);
    if (!starting) starting = bind().finally(() => (starting = null));
    return starting;
  }

  async function stop() {
    if (starting) await starting.catch(() => {});
    closePairing();
    endStreams();
    const srv = server;
    server = null;
    boundPort = null;
    if (!srv) return;
    await new Promise((resolve) => {
      srv.close(() => resolve());
      srv.closeAllConnections();
    });
    logger.info('companion channel stopped');
    onChange();
  }

  return {
    start,
    stop,
    port: () => boundPort,
    running: () => !!server,
    openPairing,
    pairingOpen,
    regenerateToken,
  };
}

module.exports = { createCompanionServer };
