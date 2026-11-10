// Isolated world controller for one page: takes the page world's reports
// (through the bridge), the media elements' state and the site's navigation,
// tells the service worker as PAGE_EVENTs, forwards MSE audio as PAGE_MEDIA
// while the worker has capture on, and runs the worker's PAGE_COMMANDs
// (captions into the renderer, display, site captions, the tier-3 notice,
// page-world actions). Decides nothing by itself: when to capture or show is
// the worker's call. Its only requests of its own are a subtitle body a
// site's subtitle list points at (Bilibili) and the files the primary
// video's <track> elements point at (any site).

import { MSG, request, handle } from '../shared/messages.js';
import { PAGE_EVENT_MAX_CHARS, MAX_CUES_PER_PART, sanitizeCue } from '../shared/page-protocol.js';
import { detectFormat, parseSubtitles } from './parsers/index.js';
import { createCaptionRenderer, MODES, DISPLAYS } from './caption-renderer.js';
import { createBridge } from './bridge.js';
import { createMediaWatch } from './media-watch.js';
import { createMseRelay } from './mse-relay.js';
import { createNotice } from './notice.js';
import { siteFor } from './sites/index.js';
import { LIMITS } from './bridge-protocol.js';

const MAX_SUBTITLES = 16;
const MAX_LISTS = 8;
const MAX_TRACK_FILES = 8; // per navigation
const HOOKS_TIMEOUT_MS = 5000;
const BODY_TIMEOUT_MS = 15000;
// Bilibili asks for the next part's subtitle list on the click, up to ~0.6 s
// before its URL changes: what came this shortly before a navigation is the new page's.
const CARRY_MS = 3000;
const PART_CHARS = PAGE_EVENT_MAX_CHARS - 8192; // room for the event's other fields

const err = (code) => Object.assign(new Error(code), { code });
const cleanUrl = (href) => String(href).split('#')[0];
// A <track>'s kind: subtitles when the attribute is missing, metadata when it is not a known one.
const trackKind = (t) => {
  const k = t.getAttribute('kind');
  return k === null ? 'subtitles' : ['subtitles', 'captions', 'descriptions', 'chapters'].includes(k.toLowerCase()) ? k.toLowerCase() : 'metadata';
};

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
  i18n = globalThis.chrome?.i18n,
  site = siteFor(win.location.hostname),
  makeBridge = createBridge,
  makeRenderer = createCaptionRenderer,
  makeNotice = createNotice,
  fetchFn = (...a) => fetch(...a),
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
  let lists = []; // subtitle lists read this navigation: { url, entries, picked, status }
  let listsSeen = new Set(); // list and body URLs already handled this navigation
  const view = { display: 'bilingual', mode: 'track', siteCaptions: 'show' };
  let feedEl = null; // feeds: the primary video the media id was last checked against
  let renderer = null;
  let rendererEl = null;
  let notice = null;
  let noticeEl = null;
  let trackEl = null; // the video whose <track> children are watched
  let trackObserver = null;
  let tracksSeen = new Set(); // track file URLs fetched this navigation
  const t = (key) => {
    try {
      return i18n?.getMessage?.(key) || '';
    } catch {
      return '';
    }
  };
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

  // extra: what a subtitle list said about the body (its language and kind).
  function onSubtitle(ev, extra = null) {
    const info = site.subtitleInfo(ev.url) || {};
    if (info.list) return onSubtitleList(ev);
    // Item data saying whose each subtitle file is (TikTok); a file no item claims is dropped.
    if (info.catalog) return site.readCatalog?.(ev.text);
    if (info.stray) return;
    const format = detectFormat(ev.text, ev.contentType, ev.url);
    const cues = format ? parseSubtitles(ev.text, format) : [];
    const sub = {
      subId: ++subSeq,
      url: ev.url,
      via: ev.via,
      status: ev.status,
      format,
      lang: extra?.lang ?? info.lang ?? '',
      kind: extra?.kind ?? info.kind ?? '',
      mediaId: info.mediaId ?? null,
      cueCount: cues.length,
      cues,
      at: now(),
    };
    listsSeen.add(sub.url);
    subtitles = subtitles.filter((s) => s.url !== sub.url).concat(sub).slice(-MAX_SUBTITLES);
    sendSubtitle(sub);
  }

  // A site's subtitle list (Bilibili's player API): one body is fetched,
  // human-made before AI, once per list and body URL in a navigation. Only
  // URLs the adapter itself calls subtitle bodies are fetched, without
  // cookies. A list that came just before a navigation goes with it (see
  // CARRY_MS); a body whose list stayed behind is dropped.
  function onSubtitleList(ev) {
    if (listsSeen.has(ev.url) || typeof site.listSubtitles !== 'function') return;
    listsSeen.add(ev.url);
    const all = site.listSubtitles(ev.text);
    const pick = all.find((s) => !s.ai) || all.find((s) => s.ai) || null;
    const entry = { url: ev.url.split('?')[0], entries: all.length, picked: pick?.url ?? null, status: 'none', src: ev.url, at: now(), nav: navSeq };
    lists = lists.concat(entry).slice(-MAX_LISTS);
    if (!pick) return;
    let target;
    try {
      target = new URL(pick.url);
    } catch {}
    if (!target || target.protocol !== 'https:' || !site.isSubtitleRequest(target.href) || site.subtitleInfo(target.href).list) {
      entry.status = 'refused';
      return;
    }
    if (listsSeen.has(target.href)) {
      entry.status = 'had';
      return;
    }
    listsSeen.add(target.href);
    entry.status = 'fetching';
    fetchBody(target.href).then(
      ({ status, contentType, text }) => {
        entry.status = 'ok';
        if (!alive || entry.nav !== navSeq) return;
        onSubtitle({ via: 'fetch', url: target.href, status, contentType, text }, { lang: pick.lang.replace(/^ai-/, ''), kind: pick.ai ? 'asr' : '' });
      },
      (e) => {
        entry.status = 'failed';
        console.debug(`[T-Caption] subtitle body: ${e?.message ?? e}`);
      }
    );
  }

  async function fetchBody(url, credentials = 'omit') {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), BODY_TIMEOUT_MS);
    try {
      const res = await fetchFn(url, { credentials, signal: ctl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (Number(res.headers.get('content-length')) > LIMITS.subtitleBytes) throw new Error('too large');
      const text = await res.text();
      if (text.length > LIMITS.subtitleBytes) throw new Error('too large');
      return { status: res.status, contentType: res.headers.get('content-type') || '', text };
    } finally {
      clearTimeout(timer);
    }
  }

  // ---- <track> files (any site) ----

  // Follows the primary video: its subtitles / captions tracks now and as they change.
  function watchTracks() {
    const v = media.primaryVideo();
    if (v === trackEl) return;
    trackObserver?.disconnect();
    trackObserver = null;
    trackEl = v;
    if (!v) return;
    trackObserver = new MutationObserver(scanTracks);
    trackObserver.observe(v, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'kind', 'srclang'] });
    scanTracks();
  }

  // Each file once a navigation, the default track first, read like a
  // subtitle the page fetched (via 'track'). Cross-origin files without CORS
  // cannot be read here; those are let go.
  function scanTracks() {
    if (!alive || !trackEl) return;
    const tracks = [...trackEl.querySelectorAll('track')].filter((x) => ['subtitles', 'captions'].includes(trackKind(x)) && x.getAttribute('src'));
    tracks.sort((a, b) => b.hasAttribute('default') - a.hasAttribute('default'));
    for (const x of tracks) {
      let url;
      try {
        url = new URL(x.getAttribute('src'), doc.baseURI).href;
      } catch {
        continue;
      }
      if (!/^(?:https?|data|blob):/.test(url) || tracksSeen.has(url) || tracksSeen.size >= MAX_TRACK_FILES) continue;
      tracksSeen.add(url);
      const nav = navSeq;
      const lang = String(x.getAttribute('srclang') || '').slice(0, 32);
      fetchBody(url, 'same-origin').then(
        ({ status, contentType, text }) => {
          if (alive && nav === navSeq) onSubtitle({ via: 'track', url, status, contentType, text }, { lang, kind: '' });
        },
        (e) => console.debug(`[T-Caption] track file: ${e?.message ?? e}`)
      );
    }
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

  // A video kept transparent while a canvas draws its picture (TikTok) shows
  // no native track: its captions go over it instead.
  const transparent = (v) => typeof v?.checkVisibility === 'function' && v.checkVisibility() && !v.checkVisibility({ opacityProperty: true, visibilityProperty: true });
  const modeFor = (v) => (view.mode === 'track' && transparent(v) ? 'overlay' : view.mode);

  // The renderer follows the primary video; cues and translations move with it.
  function ensureRenderer() {
    const v = media.primaryVideo();
    if (!v) throw err('no-video');
    if (renderer && rendererEl === v) return renderer;
    const saved = renderer ? renderer.list() : [];
    destroyRenderer();
    renderer = makeRenderer({ video: v, mode: modeFor(v), display: view.display });
    rendererEl = v;
    if (saved.length) {
      renderer.setCues(saved);
      for (const e of saved) if (e.translation) renderer.setTranslation(e.id, e.translation, true);
    }
    return renderer;
  }

  const listOf = (many, one) => (Array.isArray(many) ? many : one ? [one] : []);

  function applyCues(c) {
    if (c.op === 'list') return { cues: renderer ? renderer.list() : [] };
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

  // ---- the tier-3 notice ----

  function destroyNotice() {
    notice?.destroy();
    notice = null;
    noticeEl = null;
  }

  // 'listen': a sentence and a button; 'permission': the worker may not read
  // the video's host yet, granted from the toolbar popup (only a dismiss here).
  const NOTICES = {
    listen: () => ({ text: t('noticeListen') || 'This video’s audio can’t be read. T-Translate can listen to it instead.', button: t('noticeListenButton') || 'Listen' }),
    permission: () => ({ text: t('noticePermission') || 'T-Translate needs access to this site’s video: click the T-Caption icon in the toolbar.', button: null }),
  };

  function showNotice(kind) {
    if (kind === null) {
      notice?.hide();
      return { kind: null };
    }
    if (!Object.hasOwn(NOTICES, kind)) throw err('bad-command');
    const v = media.primaryVideo();
    if (!v) throw err('no-video');
    if (!notice || noticeEl !== v) {
      destroyNotice();
      notice = makeNotice({
        video: v,
        onAccept: (k) => send({ type: 'notice-action', kind: k, action: 'accept' }),
        onDismiss: (k) => send({ type: 'notice-action', kind: k, action: 'dismiss' }),
      });
      noticeEl = v;
    }
    notice.show({ kind, ...NOTICES[kind](), dismissTitle: t('noticeDismiss') || 'Dismiss' });
    return { kind };
  }

  // The site was taken off T-Caption's list: nothing of ours stays on the page.
  function reset() {
    destroyRenderer();
    destroyNotice();
    if (view.siteCaptions === 'hide') setSiteCaptions(false);
    return { reset: true };
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
      lists: lists.map(({ url, entries, picked, status }) => ({ url, entries, picked, status })),
      mse: relay.streams(),
      mainStream: mainStreamId(),
      capture: relay.capture(),
      eme,
      view: { ...view },
      renderer: renderer ? { cues: renderer.list().length, mode: renderer.mode, display: renderer.display } : null,
      notice: notice?.visible ? notice.kind : null,
    };
  }

  async function runCommand(c) {
    switch (c?.cmd) {
      case 'mse-capture': {
        if (!c.on) return { on: false, ...(relay.stop('off') || {}) };
        const id = Number.isSafeInteger(c.streamId) ? c.streamId : mainStreamId();
        if (id === null) throw err('no-stream');
        return { on: true, ...relay.start(id, { fromS: Number.isFinite(c.fromS) ? c.fromS : null }) };
      }
      case 'notice':
        return showNotice(c.kind ?? null);
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
        renderer?.setMode(modeFor(rendererEl));
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
      case 'reset':
        return reset();
      default:
        throw err('unknown-command');
    }
  }

  // ---- navigation ----

  function onNavigate() {
    const next = cleanUrl(win.location.href);
    if (!alive || next === pageUrl) return;
    pageUrl = next;
    newPage(site.mediaId(pageUrl, media.primaryVideo()));
  }

  // Another page, or in a feed another video under the same URL.
  function newPage(id) {
    navSeq++;
    mediaId = id;
    // A new video's captions and init segment can land before the navigation event.
    // Subtitles without a media id, and lists, belong to the new page when they came just before it.
    const recent = (x) => now() - x.at <= CARRY_MS;
    subtitles = subtitles.filter((s) => (s.mediaId ? s.mediaId === mediaId : recent(s)));
    lists = lists.filter(recent);
    for (const l of lists) l.nav = navSeq;
    listsSeen = new Set([...subtitles.map((s) => s.url), ...lists.flatMap((l) => [l.src, l.picked])]);
    relay.stop('navigated');
    relay.keepAttached(new Set(media.list().map((m) => m.src).filter(Boolean)));
    destroyRenderer();
    destroyNotice();
    if (view.siteCaptions === 'hide') setSiteCaptions(false);
    reportAll();
    tracksSeen = new Set();
    scanTracks();
  }

  // The tab going hidden or shown is a media report too (timeupdate stops with it).
  function onVisibility() {
    const v = media.primaryVideo();
    if (v) send({ type: 'media', reason: 'visibility', media: media.snapshot(v), primary: true });
  }

  // True when it made a new page. In a feed another video's id is another
  // page; with no id (between videos) the last one's stays.
  function checkMediaId() {
    const id = site.mediaId(pageUrl, media.primaryVideo());
    if (id === mediaId || (site.feed && !id)) return false;
    if (site.feed && mediaId) {
      newPage(id);
      return true;
    }
    mediaId = id;
    send({ type: 'media-id', mediaId });
    return false;
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
      // Feeds: checked before the report, so the next video's reports go with its own page.
      if (site.feed && primary !== feedEl) {
        feedEl = primary;
        if (checkMediaId()) return;
      }
      send({ type: 'media', reason, media: m, primary: !!primary && m.elId === media.idOf(primary) });
      if (reason === 'loadedmetadata' || reason === 'durationchange') checkMediaId();
      if (primary !== trackEl) watchTracks();
      if (renderer && primary && primary !== rendererEl) {
        try {
          ensureRenderer();
        } catch {}
      }
      if (renderer && renderer.mode !== modeFor(rendererEl)) renderer.setMode(modeFor(rendererEl));
    },
    onRemoved: (elId) => send({ type: 'media-removed', elId }),
  });

  const bridge = makeBridge({ win, onEvent: onMainEvent });
  const unwatchNav = site.watchNavigation({ doc, win }, onNavigate);
  doc.addEventListener('visibilitychange', onVisibility);
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
    trackObserver?.disconnect();
    bridge.close();
    unwatchNav();
    doc.removeEventListener('visibilitychange', onVisibility);
    try {
      unhandle();
    } catch {}
    destroyRenderer();
    destroyNotice();
    if (view.siteCaptions === 'hide') setSiteCaptions(false);
  }

  send({ type: 'navigated', url: pageUrl, mediaId, navSeq, site: site.name, resync: false });
  media.start();
  const onParsed = () => {
    media.scan();
    site.readPage?.(doc);
  };
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', onParsed, { once: true });
  else site.readPage?.(doc);

  return {
    runCommand,
    snapshot,
    shutdown,
    onNavigate,
    // Everything told again (the worker forgot the page: its site was removed, then allowed).
    resync: () => reportAll(true),
    get alive() {
      return alive;
    },
    get docId() {
      return docId;
    },
  };
}
