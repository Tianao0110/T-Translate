// Companion Protocol v1: limits and pure helpers for the local channel that
// T-Caption talks to (server.js, session.js). Rules: docs/design/listen.md §11.

const crypto = require('crypto');

const PROTOCOL_VERSION = 1;
const HOST = '127.0.0.1';
const PORT_BASE = 38423;
const PORT_SPAN = 10;
const CLIENT_HEADER = 'x-tt-client';
const SAMPLE_RATE = 16000;
const MAX_FEED_BYTES = 1024 * 1024;
const MAX_JSON_BYTES = 64 * 1024;
const MAX_FEED_PER_SEC = 20;
const MAX_TRANSLATE_ITEMS = 50;
const MAX_TRANSLATE_CHARS = 2000;
const MAX_AHEAD_S = 60;
const HEARTBEAT_MS = 15000;
const PAIRING_WINDOW_MS = 60000;

const CLIENT_RE = /^t-caption\/(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?$/;
const CHROME_ORIGIN_RE = /^chrome-extension:\/\/[a-p]{32}$/;
const FIREFOX_ORIGIN_RE = /^moz-extension:\/\/[0-9a-f-]{36}$/;

// The x-tt-client header: "t-caption/<semver>" or null.
function parseClient(headerValue) {
  if (typeof headerValue !== 'string') return null;
  if (!CLIENT_RE.test(headerValue)) return null;
  return { name: 't-caption', version: headerValue.slice('t-caption/'.length) };
}

function isExtensionOrigin(origin) {
  return typeof origin === 'string' && (CHROME_ORIGIN_RE.test(origin) || FIREFOX_ORIGIN_RE.test(origin));
}

// No Origin at all (a non-browser client) or a browser extension; web pages
// and the opaque 'null' origin are refused.
function originAllowed(origin) {
  return origin === undefined || origin === '' || isExtensionOrigin(origin);
}

function tokenMatches(authorizationHeader, token) {
  if (typeof authorizationHeader !== 'string' || typeof token !== 'string' || !token) return false;
  if (!authorizationHeader.startsWith('Bearer ')) return false;
  const given = Buffer.from(authorizationHeader.slice('Bearer '.length));
  const want = Buffer.from(token);
  if (given.length !== want.length) return false;
  return crypto.timingSafeEqual(given, want);
}

function newToken() {
  return crypto.randomBytes(32).toString('hex');
}

const round3 = (x) => Math.round(x * 1000) / 1000;

// A final's place on the media timeline the client named at open.
function mediaTimeOf(rec, mediaStartS) {
  const start = mediaStartS + rec.segStartS;
  return { start: round3(start), end: round3(start + rec.segDurS) };
}

// How far fed audio may run ahead of the last final, in session seconds.
function createFeedBudget({ maxAheadS = MAX_AHEAD_S } = {}) {
  let fedS = 0;
  let lastFinalEndS = 0;
  return {
    fed(samples) {
      fedS += samples / SAMPLE_RATE;
    },
    finalAt(endS) {
      if (endS > lastFinalEndS) lastFinalEndS = endS;
    },
    canAccept(samples) {
      return fedS + samples / SAMPLE_RATE - lastFinalEndS <= maxAheadS;
    },
    aheadS: () => round3(fedS - lastFinalEndS),
    fedS: () => fedS,
  };
}

function ndjson(obj) {
  return JSON.stringify(obj) + '\n';
}

// The Host header must name this machine, and this port when it carries one;
// a page that reached 127.0.0.1 through DNS rebinding carries its own name.
function hostAllowed(host, port) {
  if (typeof host !== 'string') return false;
  const m = /^(127\.0\.0\.1|localhost)(?::(\d{1,5}))?$/.exec(host.trim());
  if (!m) return false;
  return !m[2] || !port || Number(m[2]) === port;
}

module.exports = {
  PROTOCOL_VERSION,
  HOST,
  PORT_BASE,
  PORT_SPAN,
  CLIENT_HEADER,
  SAMPLE_RATE,
  MAX_FEED_BYTES,
  MAX_JSON_BYTES,
  MAX_FEED_PER_SEC,
  MAX_TRANSLATE_ITEMS,
  MAX_TRANSLATE_CHARS,
  MAX_AHEAD_S,
  HEARTBEAT_MS,
  PAIRING_WINDOW_MS,
  parseClient,
  isExtensionOrigin,
  originAllowed,
  tokenMatches,
  newToken,
  mediaTimeOf,
  createFeedBudget,
  ndjson,
  hostAllowed,
};
