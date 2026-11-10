// Isolated world controller for one page: takes the page world's reports
// (through the bridge), the media elements' state and the site's navigation,
// tells the service worker as PAGE_EVENTs, forwards MSE audio as PAGE_MEDIA
// while the worker has capture on, and runs the worker's PAGE_COMMANDs
// (captions into the renderer, display, site captions, page-world actions).
// Decides nothing by itself: when to capture or show is the worker's call.

import { MSG, request, handle } from '../shared/messages.js';
import { PAGE_EVENT_MAX_CHARS, MAX_CUES_PER_PART, sanitizeCue } from '../shared/page-protocol.js';
import { detectFormat, parseSubtitles } from './parsers/index.js';
import { createCaptionRenderer, MODES, DISPLAYS } from './caption-renderer.js';
import { createBridge } from './bridge.js';
import { createMediaWatch } from './media-watch.js';
import { createMseRelay } from './mse-relay.js';
import { siteFor } from './sites/index.js';

const MAX_SUBTITLES = 16;
const HOOKS_TIMEOUT_MS = 5000;
const PART_CHARS = PAGE_EVENT_MAX_CHARS - 8192; // room for the event's other fields

const err = (code) => Object.assign(new Error(code), { code });
const cleanUrl = (href) => String(href).split('#')[0];

// Cue lists cut so each part's JSON stays under maxChars.
export function splitCues(cues, maxChars = PART_CHARS, maxCount = MAX_CUES_PER_PART) {
  const parts = [];
  let cur = [];
  let size = 0;
  for (const c of cues) {
    const n = JSON.stringify(c).length + 1;
    if (cur.length && (size + n > maxChars || cur.length >= maxCount)) {
      parts.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(c);
    size += n;
  }
  if (cur.length || !parts.length) parts.push(cur);
  return parts;
}

export function createPageAgent({
  win = window,
  doc = document,
  runtime = chrome.runtime,
  site = siteFor(win.location.hostname),
  makeBridge = createBridge,
  makeRenderer = createCaptionRenderer,
  now = () => Date.now(),
  statsMs = 1000,
  hooksTimeoutMs = HOOKS_TIMEOUT_MS,
} = {}) {
  const docId = crypto.randomUUID();
  let navSeq = 0;
  let pageUrl = cleanUrl(win.location.href);
  let mediaId = site.mediaId(pageUrl, null);
  let boot = null;
  let alive = true;
  let hooks = null;
  let dropped = null;
  let eme = null;
  let subSeq = 0;
  let subtitles = [];
  const view = { display: 'bilingual', mode: 'track', siteCaptions: 'show' };
  let renderer = null;
  let rendererEl = null;
  const statsAt = new Map();
  const statsTimers = new Map();

  // ---- to the service worker ----

  function send(event) {
    if (!alive) return Promise.resolve(null);
    return request(MSG.PAGE_EVENT, { docId, navSeq, event }, { runtime }).then(onReply);
  }

  // A new worker (the old one was stopped while idle) has forgotten the page: tell it again.
  function onReply(reply) {
    if (!reply?.ok) {
      if (!runtime?.id) shutdown(); // extension reloaded or removed
      return reply;
    }
    const b = reply.result?.boot;
    if (b && boot && b !== boot) {
      boot = b;
      reportAll(true);
    } else if (b) boot = b;
    return reply;
  }

  const primarySrc = () => {
    const v = media.primaryVideo();
    return v ? String(v.currentSrc || v.src || '') : '';
  };
  const mainStreamId = () => relay.mainStream(primarySrc());

  function reportStream(id) {
    if (statsTimers.has(id)) return;
    const wait = Math.max(0, (statsAt.get(id) ?? -Infinity) + statsMs - now());
    statsTimers.set(
      id,
      setTimeout(() => {
        statsTimers.delete(id);
        statsAt.set(id, now());
        const s = relay.stream(id);
        if (s) send({ type: 'mse-stream', stream: s, main: mainStreamId() === id });
      }, wait)
    );
  }

  function sendSubtitle(sub) {
    const parts = splitCues(sub.cues);
    const { cues: _all, at: _at, ...meta } = sub;
    parts.forEach((cues, part) => send({ type: 'subtitle-parsed', ...meta, part, parts: parts.length, cues }));
  }

  function reportHooks() {
    if (hooks) send({ type: 'hooks', hooks: dropped ? { ...hooks, dropped } : hooks });
  }

  function reportAll(resync = false) {
    send({ type: 'navigated', url: pageUrl, mediaId, navSeq, site: site.name, resync });
    reportHooks();
    const primary = media.primaryVideo();
    for (const m of media.list()) send({ type: 'media', reason: 'report', media: m, primary: !!primary && m.elId === media.idOf(primary) });
    for (const s of relay.streams()) send({ type: 'mse-stream', stream: s, main: mainStreamId() === s.streamId });
    for (const sub of subtitles) sendSubtitle(sub);
    if (eme) send({ type: 'eme', ...eme });
  }

  // ---- page world ----

  function onSubtitle(ev) {
    const format = detectFormat(ev.text, ev.contentType, ev.url);
    const cues = format ? parseSubtitles(ev.text, format) : [];
    const info = site.subtitleInfo(ev.url) || {};
    const sub = {
      subId: ++subSeq,
      url: ev.url,
      via: ev.via,
      status: ev.status,
      format,
      lang: info.lang || '',
      kind: info.kind || '',
      mediaId: info.mediaId ?? null,
      cueCount: cues.length,
      cues,
      at: now(),
    };
    subtitles = subtitles.filter((s) => s.url !== sub.url).concat(sub).slice(-MAX_SUBTITLES);
    sendSubtitle(sub);
  }

  function onMainEvent(ev) {
    switch (ev.k) {
      case 'hooks':
        hooks = { main: 'ok', ...ev.status };
        return reportHooks();
      case 'dropped':
        dropped = { chunks: ev.chunks, bytes: ev.bytes, subtitles: ev.subtitles, events: ev.events };
        return reportHooks();
      case 'subtitle':
        return onSubtitle(ev);
      case 'eme':
        eme = { via: ev.via, keySystem: ev.keySystem ?? null, initDataType: ev.initDataType ?? null, on: ev.on ?? null };
        return send({ type: 'eme', ...eme });
      default: {
        const s = relay.onMainEvent(ev);
        if (s) reportStream(s.sbId);
      }
    }
  }

  // ---- captions ----

  function destroyRenderer() {
    renderer?.destroy();
    renderer = null;
    rendererEl = null;
  }

  // The renderer follows the primary video; cues and translations move with it.
  function ensureRenderer() {
    const v = media.primaryVideo();
    if (!v) throw err('no-video');
    if (renderer && rendererEl === v) return renderer;
    const saved = renderer ? renderer.list() : [];
    destroyRenderer();
    renderer = makeRenderer({ video: v, mode: view.mode, display: view.display });
    rendererEl = v;
    if (saved.length) {
      renderer.setCues(saved);
      for (const e of saved) if (e.translation) renderer.setTranslation(e.id, e.translation, true);
    }
    return renderer;
  }

  const listOf = (many, one) => (Array.isArray(many) ? many : one ? [one] : []);

  function applyCues(c) {
    const r = ensureRenderer();
    if (c.op === 'set') r.setCues(listOf(c.cues).map(sanitizeCue).filter(Boolean));
    else if (c.op === 'upsert') for (const cue of listOf(c.cues, c.cue).map(sanitizeCue).filter(Boolean)) r.upsert(cue);
    else if (c.op === 'translation') {
      for (const t of listOf(c.translations, c)) if (t && (typeof t.id === 'string' || typeof t.id === 'number')) r.setTranslation(String(t.id), t.text, !!t.done);
    } else throw err('bad-command');
    return { cues: r.list().length, mode: r.mode, display: r.display };
  }

  function setSiteCaptions(hidden) {
    view.siteCaptions = hidden ? 'hide' : 'show';
    return site.hideSiteCaptions(doc, hidden);
  }

  function snapshot() {
    const primary = media.primaryVideo();
    return {
      docId,
      navSeq,
      url: pageUrl,
      site: site.name,
      mediaId,
      hooks: hooks ? { ...hooks, ...(dropped && { dropped }) } : null,
      bridge: bridge.connected,
      media: media.list(),
      primary: primary ? media.idOf(primary) : null,
      subtitles: subtitles.map(({ cues: _c, ...meta }) => meta),
      mse: relay.streams(),
      mainStream: mainStreamId(),
      capture: relay.capture(),
      eme,
      view: { ...view },
      renderer: renderer ? { cues: renderer.list().length, mode: renderer.mode, display: renderer.display } : null,
    };
  }

  async function runCommand(c) {
    switch (c?.cmd) {
      case 'mse-capture': {
        if (!c.on) return { on: false, ...(relay.stop('off') || {}) };
        const id = Number.isSafeInteger(c.streamId) ? c.streamId : mainStreamId();
        if (id === null) throw err('no-stream');
        return { on: true, ...relay.start(id) };
      }
      case 'cues':
        return applyCues(c);
      case 'display':
        if (!DISPLAYS.includes(c.value)) throw err('bad-command');
        view.display = c.value;
        renderer?.setDisplay(c.value);
        return { display: view.display };
      case 'mode':
        if (!MODES.includes(c.value)) throw err('bad-command');
        view.mode = c.value;
        renderer?.setMode(c.value);
        return { mode: view.mode };
      case 'site-captions': {
        if (c.value !== 'hide' && c.value !== 'show') throw err('bad-command');
        const applied = setSiteCaptions(c.value === 'hide');
        return { siteCaptions: view.siteCaptions, applied };
      }
      case 'yt-reload':
      case 'yt-captions-on':
        return bridge.command(c.cmd, c.args && typeof c.args === 'object' ? c.args : {}, 20000);
      case 'query':
        return snapshot();
      default:
        throw err('unknown-command');
    }
  }

  // ---- navigation ----

  function onNavigate() {
    const next = cleanUrl(win.location.href);
    if (!alive || next === pageUrl) return;
    pageUrl = next;
    navSeq++;
    mediaId = site.mediaId(pageUrl, media.primaryVideo());
    // A new video's captions and init segment can land before the navigation event.
    subtitles = subtitles.filter((s) => s.mediaId && s.mediaId === mediaId);
    relay.stop('navigated');
    relay.keepAttached(new Set(media.list().map((m) => m.src).filter(Boolean)));
    destroyRenderer();
    if (view.siteCaptions === 'hide') setSiteCaptions(false);
    reportAll();
  }

  function checkMediaId() {
    const id = site.mediaId(pageUrl, media.primaryVideo());
    if (id !== mediaId) {
      mediaId = id;
      send({ type: 'media-id', mediaId });
    }
  }

  // ---- wiring ----

  const relay = createMseRelay({
    send: (payload) => request(MSG.PAGE_MEDIA, payload, { runtime }),
    onStream: (s) => reportStream(s.streamId),
    onCaptureEnd: (r) => send({ type: 'capture', on: false, ...r }),
    now,
  });

  const media = createMediaWatch({
    doc,
    win,
    now,
    msIdOf: (src) => relay.msIdOf(src),
    onReport(m, reason) {
      const primary = media.primaryVideo();
      send({ type: 'media', reason, media: m, primary: !!primary && m.elId === media.idOf(primary) });
      if (reason === 'loadedmetadata' || reason === 'durationchange') checkMediaId();
      if (renderer && primary && primary !== rendererEl) {
        try {
          ensureRenderer();
        } catch {}
      }
    },
    onRemoved: (elId) => send({ type: 'media-removed', elId }),
  });

  const bridge = makeBridge({ win, onEvent: onMainEvent });
  const unwatchNav = site.watchNavigation({ doc, win }, onNavigate);
  const unhandle = handle({ [MSG.PAGE_COMMAND]: runCommand }, { runtime, accept: (_m, sender) => sender?.id === runtime.id && !sender.tab });

  const hooksTimer = setTimeout(() => {
    if (!bridge.connected && !hooks) {
      hooks = { main: 'missing' };
      reportHooks();
    }
  }, hooksTimeoutMs);

  function shutdown() {
    if (!alive) return;
    alive = false;
    clearTimeout(hooksTimer);
    statsTimers.forEach(clearTimeout);
    relay.stop('shutdown');
    media.stop();
    bridge.close();
    unwatchNav();
    try {
      unhandle();
    } catch {}
    destroyRenderer();
    if (view.siteCaptions === 'hide') setSiteCaptions(false);
  }

  send({ type: 'navigated', url: pageUrl, mediaId, navSeq, site: site.name, resync: false });
  media.start();
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', () => media.scan(), { once: true });

  return { runCommand, snapshot, shutdown, onNavigate, get docId() { return docId; } };
}
