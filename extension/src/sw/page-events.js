// Service worker: what each tab's content script has reported (its
// "evidence": hooks, media elements, site subtitles, MSE streams, EME), kept
// per tab in memory and cleared when the tab closes or leaves the page, and
// the commands that go back to it. Only top frames on the manifest's
// content-script hosts may report. The orchestrator (S5) reads
// getTabEvidence and onPageEvent and decides; this module only carries out
// commands, including the glue to the offscreen document: while a tab has
// capture on, its PAGE_MEDIA bytes go to the media pipeline under the key
// tab:<tabId>:<gen>, a tab's listen session (the DRM fallback) runs under
// tab:<tabId>:l<gen>, and a directly played file the worker fetches itself
// (direct-fetch.js) under tab:<tabId>:d<gen>; their segments and
// translations come back to the tab as `cues` commands (ids prefixed m<gen>-
// / l<gen>- / d<gen>- so a reopened session cannot overwrite the last one's
// cues). Pages may report from the content-script hosts and the other hosts
// the manifest grants (scripts injected there, e.g. 127.0.0.1 for tests).

import { MSG } from '../shared/messages.js';
import { checkPageEvent, checkPageMedia } from '../shared/page-protocol.js';

const MAX_MEDIA = 16;
const MAX_SUBTITLES = 32;
const MAX_STREAMS = 16;
const MAX_PENDING_PARTS = 4;
const DEFAULT_LANG = 'en';
const DEFAULT_TARGET = 'zh';

const err = (code) => Object.assign(new Error(code), { code });

// A content-script match pattern (scheme://host/path with *) as a URL test.
export function matchPattern(pattern) {
  const m = /^(\*|https?):\/\/(\*|(?:\*\.)?[^/*]+)(\/.*)$/.exec(pattern);
  if (!m) return () => false;
  const [, scheme, host, path] = m;
  const esc = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const hostRe = host === '*' ? '[^/]+' : host.startsWith('*.') ? `(?:[^/]+\\.)?${esc(host.slice(2))}` : esc(host);
  const re = new RegExp(`^${scheme === '*' ? 'https?' : scheme}://${hostRe}(?::\\d+)?${esc(path).replace(/\*/g, '.*')}$`, 'i');
  return (url) => typeof url === 'string' && re.test(url);
}

function freshEvidence(tabId, docId) {
  return {
    tabId,
    docId,
    incognito: false,
    url: '',
    site: 'generic',
    mediaId: null,
    navSeq: 0,
    hooks: null,
    media: [],
    primaryElId: null,
    subtitles: [],
    mse: { audio: null, streams: [] },
    eme: null,
    capture: null,
    listen: null,
    direct: null,
    updatedAt: 0,
  };
}

// Navigation keeps what belongs to the document (hooks, EME) and drops the rest.
function resetForNavigation(ev) {
  ev.media = [];
  ev.primaryElId = null;
  ev.subtitles = [];
  ev.mse = { audio: null, streams: [] };
}

function upsert(list, item, key, max) {
  const i = list.findIndex((x) => x[key] === item[key]);
  if (i >= 0) list[i] = item;
  else {
    list.push(item);
    if (list.length > max) list.shift();
  }
}

export function createPageEvents({
  runtime = globalThis.chrome?.runtime,
  tabs = globalThis.chrome?.tabs,
  toOffscreen,
  direct = null, // direct-fetch.js
  manifest = runtime?.getManifest?.(),
  now = () => Date.now(),
  bootId = crypto.randomUUID(),
}) {
  const matchers = [...(manifest?.content_scripts || []).flatMap((c) => c.matches || []), ...(manifest?.host_permissions || [])].map(matchPattern);
  const byTab = new Map();
  const listeners = new Set();
  const parts = new Map(); // `${tabId}:${subId}` → { parts: [], got }
  const keys = new Map(); // media key → { tabId, gen, kind? }
  const sendChains = new Map(); // tabId → promise, so commands reach a tab in order
  let gen = 0;

  const emit = (tabId, event) => {
    for (const fn of listeners) {
      try {
        fn({ tabId, event });
      } catch (e) {
        console.warn(`[T-Caption] page event listener: ${e.message}`);
      }
    }
  };

  // Top frame of a tab on one of the manifest's content-script hosts.
  function fromPage(_msg, sender) {
    return !!sender && sender.id === runtime.id && !!sender.tab && Number.isSafeInteger(sender.tab.id) && sender.frameId === 0 && matchers.some((m) => m(sender.url));
  }

  function sendToTab(tabId, command) {
    const prev = sendChains.get(tabId) || Promise.resolve();
    const run = prev.then(async () => {
      const reply = await tabs.sendMessage(tabId, { type: MSG.PAGE_COMMAND, payload: command }, { frameId: 0 });
      if (!reply || typeof reply.ok !== 'boolean') throw err('no-reply');
      if (!reply.ok) throw err(reply.error?.code || 'error');
      return reply.result;
    });
    sendChains.set(
      tabId,
      run.catch(() => {})
    );
    return run;
  }

  function evidenceOf(tabId, docId) {
    let ev = byTab.get(tabId);
    if (!ev || ev.docId !== docId) {
      if (ev?.capture?.on) closeCapture(ev, 'new-document', { tellTab: false });
      if (ev?.listen?.on) closeListen(ev, 'new-document');
      if (ev?.direct?.on) closeDirect(ev, 'new-document');
      ev = freshEvidence(tabId, docId);
      byTab.set(tabId, ev);
    }
    return ev;
  }

  function pickAudio(ev) {
    const audio = ev.mse.streams.filter((s) => s.kind === 'audio' && s.alive);
    const s = audio.find((x) => x.main) || audio.filter((x) => x.forward).sort((a, b) => b.bytes - a.bytes)[0] || audio[0] || null;
    ev.mse.audio = s ? { streamId: s.streamId, mime: s.mime, codec: s.codec, forward: s.forward, init: s.init, chunks: s.chunks, bytes: s.bytes, firstTimeS: s.firstTimeS, lastTimeS: s.lastTimeS } : null;
  }

  // Applies one checked event; returns the event listeners should see (null: none yet).
  function apply(ev, event) {
    switch (event.type) {
      case 'navigated':
        if (ev.capture?.on) closeCapture(ev, 'navigated', { tellTab: false });
        if (ev.listen?.on) closeListen(ev, 'navigated');
        if (ev.direct?.on) closeDirect(ev, 'navigated');
        ev.capture = null;
        ev.listen = null;
        ev.direct = null;
        resetForNavigation(ev);
        Object.assign(ev, { url: event.url, site: event.site, mediaId: event.mediaId, navSeq: event.navSeq });
        return event;
      case 'hooks':
        ev.hooks = event.hooks;
        return event;
      case 'media':
        upsert(ev.media, event.media, 'elId', MAX_MEDIA);
        if (event.primary) ev.primaryElId = event.media.elId;
        return event;
      case 'media-removed':
        ev.media = ev.media.filter((m) => m.elId !== event.elId);
        if (ev.primaryElId === event.elId) ev.primaryElId = null;
        return event;
      case 'media-id':
        ev.mediaId = event.mediaId;
        return event;
      case 'subtitle-parsed': {
        const { part, parts: total, cues, ...meta } = event;
        // The player refetching a track replaces its entry.
        upsert(ev.subtitles, { ...meta, at: now() }, 'url', MAX_SUBTITLES);
        if (total === 1) return { ...meta, cues };
        const key = `${ev.tabId}:${event.subId}`;
        let p = parts.get(key);
        if (!p) {
          for (const k of [...parts.keys()].filter((k) => k.startsWith(`${ev.tabId}:`)).slice(0, -MAX_PENDING_PARTS + 1)) parts.delete(k);
          p = { list: new Array(total), got: 0 };
          parts.set(key, p);
        }
        if (p.list.length !== total || p.list[part]) return null;
        p.list[part] = cues;
        if (++p.got < total) return null;
        parts.delete(key);
        return { ...meta, cues: p.list.flat() };
      }
      case 'mse-stream':
        upsert(ev.mse.streams, { ...event.stream, main: event.main }, 'streamId', MAX_STREAMS);
        if (event.main) for (const s of ev.mse.streams) if (s.streamId !== event.stream.streamId) s.main = false;
        pickAudio(ev);
        return event;
      case 'eme': {
        // The first key system asked for, every one asked for, and how EME showed up.
        const prev = ev.eme;
        const keySystems = prev ? prev.keySystems.slice() : [];
        if (event.keySystem && !keySystems.includes(event.keySystem) && keySystems.length < 8) keySystems.push(event.keySystem);
        const seen = prev ? prev.seen.slice() : [];
        if (!seen.includes(event.via)) seen.push(event.via);
        ev.eme = { keySystem: keySystems[0] ?? null, keySystems, seen, at: prev?.at ?? now(), count: (prev?.count ?? 0) + 1 };
        return event;
      }
      case 'capture':
        // The page stopped forwarding (overflow, stream gone): close our end too.
        if (ev.capture?.on && !event.on) closeCapture(ev, event.reason || 'page-stopped', { tellTab: false });
        return event;
      case 'notice-action':
        return event;
      default:
        return null;
    }
  }

  function onPageEvent(payload, sender) {
    const checked = checkPageEvent(payload);
    if (!checked) throw err('bad-event');
    const tabId = sender.tab.id;
    const ev = evidenceOf(tabId, checked.docId);
    const { event } = checked;
    if (event.type === 'navigated' ? event.navSeq < ev.navSeq : checked.navSeq !== ev.navSeq) return { boot: bootId, stale: true };
    ev.url ||= sender.url;
    ev.incognito = !!sender.tab.incognito;
    const out = apply(ev, event);
    ev.updatedAt = now();
    if (out) emit(tabId, out);
    return { boot: bootId };
  }

  const keepKey = (key, owner) => {
    keys.set(key, owner);
    if (keys.size > 8) keys.delete(keys.keys().next().value);
  };

  // ---- capture ----

  async function openCapture(tabId, c) {
    const ev = byTab.get(tabId);
    if (!ev) throw err('no-page');
    if (ev.capture?.on) await closeCapture(ev, 'restart');
    const g = ++gen;
    const key = `tab:${tabId}:${g}`;
    const lang = typeof c.lang === 'string' && c.lang ? c.lang : DEFAULT_LANG;
    const targetLang = typeof c.targetLang === 'string' && c.targetLang ? c.targetLang : DEFAULT_TARGET;
    await toOffscreen(MSG.MEDIA_OPEN, { key, lang, targetLang });
    keepKey(key, { tabId, gen: g });
    const cap = { on: true, key, gen: g, streamId: null, lang, targetLang, startedAt: now(), pushes: 0, bytes: 0, segments: 0, translations: 0, firstSegmentAt: null, reason: null, chain: Promise.resolve() };
    ev.capture = cap;
    try {
      const r = await sendToTab(tabId, {
        cmd: 'mse-capture',
        on: true,
        ...(Number.isSafeInteger(c.streamId) && { streamId: c.streamId }),
        ...(Number.isFinite(c.fromS) && { fromS: c.fromS }),
      });
      cap.streamId ??= r?.streamId ?? null;
      return { key, ...r };
    } catch (e) {
      await closeCapture(ev, 'page-refused');
      throw e;
    }
  }

  // tellTab false: the page already stopped, or is gone.
  function closeCapture(ev, reason, { tellTab = true } = {}) {
    const cap = ev.capture;
    if (!cap || !cap.on) return Promise.resolve(cap ? publicCapture(cap) : null);
    cap.on = false;
    cap.reason = reason;
    if (tellTab) sendToTab(ev.tabId, { cmd: 'mse-capture', on: false }).catch(() => {});
    cap.closing = cap.chain.then(() => toOffscreen(MSG.MEDIA_CLOSE, { key: cap.key })).then(
      (stats) => {
        cap.stats = stats;
        return publicCapture(cap);
      },
      (e) => {
        cap.closeError = e.code || e.message;
        return publicCapture(cap);
      }
    );
    return cap.closing;
  }

  function publicCapture(cap) {
    const { chain: _c, closing: _x, ...rest } = cap;
    return rest;
  }

  // ---- listen (the app captures system sound; nothing comes from the page) ----

  async function openListen(tabId, c) {
    const ev = byTab.get(tabId);
    if (!ev) throw err('no-page');
    if (ev.listen?.on) await closeListen(ev, 'restart');
    const g = ++gen;
    const key = `tab:${tabId}:l${g}`;
    const lang = typeof c.lang === 'string' && c.lang ? c.lang : DEFAULT_LANG;
    const targetLang = typeof c.targetLang === 'string' && c.targetLang ? c.targetLang : DEFAULT_TARGET;
    const mediaStartS = Number.isFinite(c.mediaStartS) && c.mediaStartS > 0 ? c.mediaStartS : 0;
    const l = { on: true, key, gen: g, lang, targetLang, mediaStartS, startedAt: now(), segments: 0, translations: 0, firstSegmentAt: null, reason: null, lastStatus: null };
    ev.listen = l;
    keepKey(key, { tabId, gen: g, kind: 'listen' });
    try {
      await toOffscreen(MSG.LISTEN_OPEN, { key, lang, targetLang, mediaStartS });
    } catch (e) {
      l.on = false;
      l.reason = e.code || 'open-failed';
      throw e;
    }
    return { key, lang, targetLang, mediaStartS };
  }

  function closeListen(ev, reason) {
    const l = ev.listen;
    if (!l || !l.on) return Promise.resolve(l || null);
    l.on = false;
    l.reason = reason;
    l.closing = toOffscreen(MSG.LISTEN_CLOSE, { key: l.key }).then(
      (r) => {
        l.stats = r;
        return publicListen(l);
      },
      (e) => {
        l.closeError = e.code || e.message;
        return publicListen(l);
      }
    );
    return l.closing;
  }

  function publicListen(l) {
    const { closing: _x, ...rest } = l;
    return rest;
  }

  // ---- direct (the worker fetches the file the page plays by URL) ----

  // Only a URL one of the tab's media elements plays, over http(s).
  async function openDirect(tabId, c) {
    const ev = byTab.get(tabId);
    if (!ev) throw err('no-page');
    if (!direct) throw err('unsupported');
    const url = typeof c.url === 'string' ? c.url : '';
    if (!/^https?:[/][/]/i.test(url) || !ev.media.some((m) => m.src === url)) throw err('not-page-media');
    if (ev.direct?.on) await closeDirect(ev, 'restart');
    const g = ++gen;
    const key = `tab:${tabId}:d${g}`;
    const lang = typeof c.lang === 'string' && c.lang ? c.lang : DEFAULT_LANG;
    const targetLang = typeof c.targetLang === 'string' && c.targetLang ? c.targetLang : DEFAULT_TARGET;
    const fromS = Number.isFinite(c.fromS) && c.fromS > 0 ? c.fromS : 0;
    const d = { on: true, key, gen: g, url, fromS, lang, targetLang, startedAt: now(), bytes: 0, requests: 0, aheadS: null, segments: 0, translations: 0, firstSegmentAt: null, reason: null, lastStatus: null };
    ev.direct = d;
    keepKey(key, { tabId, gen: g, kind: 'direct' });
    try {
      const r = await direct.open({ key, url, fromS, lang, targetLang });
      Object.assign(d, { startS: r.startS, durationS: r.durationS, moovAt: r.moovAt });
      return { ...r, lang, targetLang };
    } catch (e) {
      if (ev.direct === d && d.on) {
        d.on = false;
        d.reason = e.code || 'open-failed';
      }
      throw e;
    }
  }

  // The fetcher's counters as evidence fields.
  function syncDirect(d, f) {
    if (!f) return;
    Object.assign(d, { bytes: f.bytes, requests: f.requests, aheadS: f.aheadS, maxAheadS: f.maxAheadS, fetchedToS: f.fetchedToS, playS: f.playS, done: f.done, fetchError: f.error });
  }

  function closeDirect(ev, reason) {
    const d = ev.direct;
    if (!d || !d.on) return d ? (d.closing ?? Promise.resolve(publicDirect(d))) : Promise.resolve(null);
    d.on = false;
    d.reason = reason;
    d.closing = direct.close({ key: d.key }).then(
      (r) => {
        if (r) {
          const { fetch, ...stats } = r;
          d.stats = stats;
          syncDirect(d, fetch);
        }
        return publicDirect(d);
      },
      (e) => {
        d.closeError = e.code || e.message;
        return publicDirect(d);
      }
    );
    return d.closing;
  }

  function publicDirect(d) {
    const { closing: _x, ...rest } = d;
    return rest;
  }

  function positionDirect(ev, timeS) {
    const d = ev.direct;
    if (!d?.on) return null;
    syncDirect(d, direct.position(d.key, timeS));
    return publicDirect(d);
  }

  async function onPageMedia(payload, sender) {
    const ev = byTab.get(sender.tab.id);
    const cap = ev?.capture;
    if (!cap?.on) return { accepted: false, reason: 'not-capturing' };
    const p = checkPageMedia(payload);
    if (!p) throw err('bad-media');
    if (cap.streamId !== null && p.streamId !== cap.streamId) return { accepted: false, reason: 'other-stream' };
    cap.streamId = p.streamId;
    const run = cap.chain.then(() => toOffscreen(MSG.MEDIA_PUSH, { key: cap.key, bytes: p.bytes }));
    cap.chain = run.catch(() => {});
    try {
      const r = await run;
      cap.pushes++;
      cap.bytes += Math.floor((p.bytes.length * 3) / 4);
      cap.lastTimeS = p.timeS ?? cap.lastTimeS ?? null;
      return { accepted: true, ended: !!r?.ended };
    } catch (e) {
      // 'no-stream': another tab's capture replaced this one in the pipeline.
      if (cap.on && ev.capture === cap) {
        cap.on = false;
        cap.reason = e.code || 'push-failed';
      }
      return { accepted: false, reason: e.code || 'push-failed' };
    }
  }

  // MEDIA_EVENT broadcasts from the offscreen pipeline and listen sessions.
  function onMediaEvent(payload) {
    const owner = keys.get(payload?.key);
    const event = payload?.event;
    if (!owner || !event) return;
    const ev = byTab.get(owner.tabId);
    if (owner.kind === 'listen') return onListenEvent(owner, ev, payload.key, event);
    if (owner.kind === 'direct') return onDirectEvent(owner, ev, payload.key, event);
    const cap = ev?.capture?.gen === owner.gen ? ev.capture : null;
    const id = event.id !== undefined ? `m${owner.gen}-${event.id}` : null;
    if (event.type === 'segment') {
      if (cap) {
        cap.segments++;
        cap.firstSegmentAt ??= now();
      }
      sendToTab(owner.tabId, { cmd: 'cues', op: 'upsert', cue: { id, start: event.start, end: event.end, text: event.text } }).catch(() => {});
    } else if (event.type === 'translation') {
      if (cap) cap.translations++;
      sendToTab(owner.tabId, { cmd: 'cues', op: 'translation', id, text: event.text, done: !!event.done }).catch(() => {});
    } else if (event.type === 'closed' && cap?.on) {
      cap.on = false;
      cap.reason = event.reason || 'closed';
      sendToTab(owner.tabId, { cmd: 'mse-capture', on: false }).catch(() => {});
    } else if (cap && (event.type === 'status' || event.type === 'error' || event.type === 'suspended')) {
      cap.lastStatus = event.state || event.type;
    }
    emit(owner.tabId, { type: 'capture-event', kind: 'capture', key: payload.key, event: id ? { ...event, id } : event });
  }

  function onListenEvent(owner, ev, key, event) {
    const l = ev?.listen?.gen === owner.gen ? ev.listen : null;
    const id = event.id !== undefined ? `l${owner.gen}-${event.id}` : null;
    if (event.type === 'segment') {
      if (l) {
        l.segments++;
        l.firstSegmentAt ??= now();
      }
      sendToTab(owner.tabId, { cmd: 'cues', op: 'upsert', cue: { id, start: event.start, end: event.end, text: event.text } }).catch(() => {});
    } else if (event.type === 'translation') {
      if (l) l.translations++;
      sendToTab(owner.tabId, { cmd: 'cues', op: 'translation', id, text: event.text, done: !!event.done }).catch(() => {});
    } else if (event.type === 'closed' && l?.on) {
      l.on = false;
      l.reason = event.reason || 'closed';
    } else if (l && (event.type === 'status' || event.type === 'error')) {
      l.lastStatus = event.state || event.type;
    }
    emit(owner.tabId, { type: 'capture-event', kind: 'listen', key, event: id ? { ...event, id } : event });
  }

  function onDirectEvent(owner, ev, key, event) {
    const d = ev?.direct?.gen === owner.gen ? ev.direct : null;
    const id = event.id !== undefined ? `d${owner.gen}-${event.id}` : null;
    if (event.type === 'segment') {
      if (d) {
        d.segments++;
        d.firstSegmentAt ??= now();
      }
      sendToTab(owner.tabId, { cmd: 'cues', op: 'upsert', cue: { id, start: event.start, end: event.end, text: event.text } }).catch(() => {});
    } else if (event.type === 'translation') {
      if (d) d.translations++;
      sendToTab(owner.tabId, { cmd: 'cues', op: 'translation', id, text: event.text, done: !!event.done }).catch(() => {});
    } else if (event.type === 'closed' && d?.on) {
      // The stream ended by itself (unsupported, the app went away): stop fetching too.
      closeDirect(ev, event.reason || 'closed');
    } else if (d && (event.type === 'status' || event.type === 'error' || event.type === 'suspended')) {
      d.lastStatus = event.type === 'error' ? event.code || 'error' : event.state || event.type;
    }
    emit(owner.tabId, { type: 'capture-event', kind: 'direct', key, event: id ? { ...event, id } : event });
  }

  // ---- extension pages ----

  async function tabCommand({ tabId, command } = {}) {
    if (!Number.isSafeInteger(tabId)) throw err('bad-request');
    if (!command || typeof command.cmd !== 'string') throw err('bad-request');
    if (command.cmd === 'mse-capture') {
      if (command.on) return openCapture(tabId, command);
      const ev = byTab.get(tabId);
      return ev ? closeCapture(ev, 'command') : null;
    }
    if (command.cmd === 'listen') {
      if (command.on) return openListen(tabId, command);
      const ev = byTab.get(tabId);
      return ev ? closeListen(ev, command.reason || 'command') : null;
    }
    // { on: true, url, fromS, lang, targetLang } / { on: false, reason } / { position: timeS }
    if (command.cmd === 'direct') {
      if (command.on === true) return openDirect(tabId, command);
      const ev = byTab.get(tabId);
      if (command.on === false) return ev ? closeDirect(ev, command.reason || 'command') : null;
      if (Number.isFinite(command.position)) return ev ? positionDirect(ev, command.position) : null;
      throw err('bad-request');
    }
    return sendToTab(tabId, command);
  }

  function getTabEvidence(tabId) {
    const ev = byTab.get(tabId);
    if (!ev) return null;
    if (ev.direct?.on) syncDirect(ev.direct, direct.stats(ev.direct.key));
    return JSON.parse(JSON.stringify({ ...ev, capture: ev.capture ? publicCapture(ev.capture) : null, listen: ev.listen ? publicListen(ev.listen) : null, direct: ev.direct ? publicDirect(ev.direct) : null }));
  }

  function forget(tabId, reason) {
    const ev = byTab.get(tabId);
    if (!ev) return;
    if (ev.capture?.on) closeCapture(ev, reason, { tellTab: false });
    if (ev.listen?.on) closeListen(ev, reason);
    if (ev.direct?.on) closeDirect(ev, reason);
    byTab.delete(tabId);
    sendChains.delete(tabId);
    for (const k of [...parts.keys()]) if (k.startsWith(`${tabId}:`)) parts.delete(k);
    emit(tabId, { type: 'forgotten', reason });
  }

  tabs?.onRemoved?.addListener((tabId) => forget(tabId, 'tab-closed'));
  // Left for a page without our content scripts: nothing will report there.
  tabs?.onUpdated?.addListener((tabId, info) => {
    if (info.url && !matchers.some((m) => m(info.url))) forget(tabId, 'left');
  });

  return {
    bootId,
    fromPage,
    contentHandlers: {
      [MSG.PAGE_EVENT]: onPageEvent,
      [MSG.PAGE_MEDIA]: onPageMedia,
    },
    extensionHandlers: {
      [MSG.TAB_EVIDENCE]: ({ tabId } = {}) => getTabEvidence(tabId),
      [MSG.TAB_COMMAND]: tabCommand,
    },
    onMediaEvent,
    getTabEvidence,
    command: (tabId, command) => tabCommand({ tabId, command }),
    onPageEvent(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
