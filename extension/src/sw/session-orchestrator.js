// Decides, per tab, whether captions run and through which tier, and drives
// page-events accordingly. One tab is served at a time: the focused window's
// active tab when it qualifies, else the tab already running, else any
// visible one. A tab qualifies while its main <video> plays with sound on a
// visible page, the channel is ready and the site is not switched off.
//
// Tiers, re-decided whenever the evidence changes:
//   1 site captions with cues for this video → cues to the page, translated
//     around the playhead first (cached per video and target language)
//   2 decodable MSE audio and no DRM → mse-capture (page-events feeds the
//     media pipeline; cues come back by themselves); a plain http(s) src
//     with no MSE → direct (the worker fetches the file itself by Range,
//     once the site's origin is permitted: until then the tab prompts)
//   3 DRM, no hooks, plain file or undecodable audio → a notice in the page;
//     the listen session opens when the user accepts (or autoListen is on)
// A running tier only changes upwards to tier 1, or to tier 3 when DRM
// shows up. Stops: paused over the grace, page hidden, tab left, navigation,
// channel gone; 60 s without a final (the pipeline's 'suspended') parks the
// video until it changes. States go to onState(tabId, state) for the badge.
//
// The subtitle cache (cache-db, injected): a video's record goes to the page
// as soon as its key is known, channel or not; recognition runs only where
// no cue covers the playhead and starts at the covered edge; what runs is
// written back (site cues replace the record, recognized ones add to it).
// Secure mode and incognito tabs use the in-memory cache instead.

import { MAX_TRANSLATE_ITEMS, MAX_TRANSLATE_CHARS } from '../shared/protocol.js';

export const TIER = { SITE: 1, AUDIO: 2, LISTEN: 3 };
export const STATES = ['idle', 'waiting', 'captions', 'listening', 'prompt', 'suspended', 'off'];

const PAUSE_GRACE_MS = 5000;
const DECIDE_GRACE_MS = 2000;
const RETRY_MS = 15000;
const BUSY_RETRY_MS = 3000; // the app's previous session is still closing
const TRANSLATE_RETRY_MS = 30000;
const MAX_FAILURES = 3;
const NEAR_S = 120;
const SEEK_JUMP_S = 3;
const CAPTURE_BACK_S = 5;
const MIN_DURATION_S = 5; // short-video sites speak in 6-second clips
const MIN_WIDTH = 200;
const MIN_HEIGHT = 120;
const MAX_SITE_TRACKS = 8;
const MAX_CACHED_MEDIA = 20;
const MAX_REMEMBERED = 200;
const MAX_LOG = 30;
// The page stopped forwarding for a reason that is not going away by itself.
const PAGE_STOP_RETRY = new Set(['overflow', 'send-failed', 'refused', 'pipeline-ended']);
// direct open errors that say the file itself is no good (direct-fetch.js).
const DIRECT_FATAL = new Set(['no-moov', 'moov-too-large', 'no-audio', 'bad-moov', 'unsupported', 'not-page-media', 'bad-request']);
const CACHE_FLUSH_MS = 30000;
const COVER_GAP_S = 15; // cues this close together make one covered stretch
const COVER_TAIL_S = 2; // a stretch is left this long before its end
const MAX_CACHE_KEY = 512;

const err = (code) => Object.assign(new Error(code), { code });

// The key a site's on/off switch is stored under: the adapter's name, or the host.
export function siteKeyOf(ev) {
  if (ev?.site && ev.site !== 'generic') return ev.site;
  try {
    return new URL(ev?.url || '').hostname.replace(/^www\./, '') || 'generic';
  } catch {
    return 'generic';
  }
}

// A main video worth captioning: playing with sound, shown, not a jingle.
export function mediaEligible(m) {
  if (!m || m.tag !== 'video') return false;
  if (m.state !== 'playing' && m.state !== 'seeking') return false;
  if (m.muted || !(m.volume > 0) || m.readyState < 2) return false;
  if (!m.live && !(m.duration > MIN_DURATION_S)) return false;
  return !!m.pageVisible && m.width >= MIN_WIDTH && m.height >= MIN_HEIGHT;
}

const primaryTag = (lang) => {
  const [p, r] = String(lang || '').split('-');
  const primary = p.toLowerCase();
  if (primary === 'zh' && /^(tw|hk|mo|hant)$/i.test(r || '')) return 'zh-TW';
  return primary;
};
export const sameLang = (a, b) => !!a && !!b && primaryTag(a) === primaryTag(b);
const isDirectUrl = (src) => /^https?:\/\//i.test(String(src || ''));

function remember(set, key) {
  set.add(key);
  if (set.size > MAX_REMEMBERED) set.delete(set.values().next().value);
}

// The stretches of a video its cues cover, gaps up to COVER_GAP_S bridged
// (a quiet head of the video included).
export function coverageOf(cues) {
  const out = [];
  const sorted = cues.filter((c) => Number.isFinite(c.start) && Number.isFinite(c.end)).sort((a, b) => a.start - b.start);
  for (const c of sorted) {
    const last = out[out.length - 1];
    if (last && c.start - last.end <= COVER_GAP_S) last.end = Math.max(last.end, c.end);
    else out.push({ start: c.start, end: Math.max(c.end, c.start) });
  }
  if (out.length && out[0].start <= COVER_GAP_S) out[0].start = 0;
  return out;
}

// The stretch the playhead is in, or null; its last COVER_TAIL_S do not count.
export const coveredAt = (stretches, t) => stretches.find((s) => t >= s.start - 1 && t < s.end - COVER_TAIL_S) ?? null;

// Where the covered stretch the playhead is leaving (or just left) ends.
export const coveredEdge = (stretches, t) => Math.max(0, ...stretches.filter((s) => s.start <= t + 1).map((s) => s.end));

export function createOrchestrator({
  pageEvents,
  arbiter,
  prefs,
  translate,
  onState = () => {},
  logger = console,
  now = Date.now,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (t) => clearTimeout(t),
  pauseGraceMs = PAUSE_GRACE_MS,
  decideGraceMs = DECIDE_GRACE_MS,
  retryMs = RETRY_MS,
  busyRetryMs = BUSY_RETRY_MS,
  translateRetryMs = TRANSLATE_RETRY_MS,
  cache = null,
  memoryCache = null,
}) {
  const byTab = new Map();
  let active = null;
  let companion = { status: 'unpaired' };
  let scheduled = false;
  const noSpeech = new Set(); // media keys parked after 60 s without a final
  const listenOk = new Set(); // media keys the user accepted listening for
  const dismissed = new Set(); // media keys whose notice was dismissed
  const translations = new Map(); // `${mediaKey}:${target}` → Map cueId → translation

  // ---- per tab ----

  function ensure(tabId) {
    let r = byTab.get(tabId);
    if (!r) {
      r = { tabId, ev: null, media: null, mediaAt: 0, mediaKey: null, run: null, gen: 0, held: false, playingSince: 0, failures: 0, state: null, stateDetail: null, log: [], siteCues: new Map(), emptySubtitle: false, promptedFor: null, view: null, timers: {}, translateError: null, cacheKey: null, cached: null, cacheLoad: 0, newCues: new Map(), idAlias: new Map(), cacheTier: null, cacheLang: '', cacheDirty: false, shown: null, cover: null, lastRun: null, needsOrigin: null, directFailed: false };
      byTab.set(tabId, r);
    }
    return r;
  }

  function clearTimerOf(r, name) {
    if (r.timers[name]) {
      clearTimer(r.timers[name]);
      r.timers[name] = null;
    }
  }

  function setState(r, state, detail = null) {
    if (r.state === state && (!detail || JSON.stringify(detail) === JSON.stringify(r.stateDetail))) return;
    r.state = state;
    r.stateDetail = detail;
    r.log.push({ at: now(), state, ...(detail && { detail }) });
    if (r.log.length > MAX_LOG) r.log.shift();
    try {
      onState(r.tabId, state, detail);
    } catch (e) {
      logger.warn?.(`state listener: ${e.message}`);
    }
  }

  const cmd = (r, command) => pageEvents.command(r.tabId, command);
  const quiet = (p) => p.catch((e) => logger.debug?.(`command: ${e.code || e.message}`));

  const currentTime = (r) => (r.media ? r.media.currentTime + (r.media.state === 'playing' ? Math.max(0, now() - r.mediaAt) / 1000 : 0) : 0);

  function mediaKeyOf(r) {
    const ev = r.ev;
    if (!ev) return null;
    return `${ev.site}:${ev.mediaId ?? ev.url ?? ''}`;
  }

  // Site cues for the current video: the newest track with cues.
  function pickSiteTrack(r) {
    let best = null;
    for (const s of r.siteCues.values()) if ((!s.mediaId || s.mediaId === r.ev?.mediaId) && (!best || s.at > best.at)) best = s;
    return best;
  }

  function cacheFor(key) {
    let m = translations.get(key);
    if (!m) {
      m = new Map();
      translations.set(key, m);
      if (translations.size > MAX_CACHED_MEDIA) translations.delete(translations.keys().next().value);
    }
    return m;
  }

  // ---- the subtitle cache ----

  const cacheOf = (r) => (companion.privacyMode === 'secure' || r.ev?.incognito ? memoryCache : cache);

  // Covered stretches of the tab's video: the record plus what ran since,
  // less the cues of the session in exceptGen (a session runs ahead of the
  // playhead, so its own cues must not stop it).
  function coverage(r, exceptGen = null) {
    const stamp = `${r.cacheKey}:${r.cached?.cues.length ?? 0}:${r.newCues.size}:${exceptGen}`;
    if (r.cover?.stamp !== stamp) r.cover = { stamp, stretches: coverageOf([...(r.cached?.cues ?? []), ...r.newCues.values()].filter((c) => exceptGen === null || c.runGen !== exceptGen)) };
    return r.cover.stretches;
  }
  const covered = (r) => !!coveredAt(coverage(r), currentTime(r));

  // When the video changes: what ran for the old one is written, the new
  // one's record is looked up (evaluateAll shows it once it is here).
  function syncCache(r) {
    if (r.mediaKey === r.cacheKey) return;
    flushCache(r);
    r.cacheKey = r.mediaKey;
    r.cached = null;
    r.lastRun = null;
    r.newCues = new Map();
    r.idAlias = new Map();
    r.cacheTier = null;
    r.cacheLang = '';
    r.shown = null;
    const store = cacheOf(r);
    const key = r.cacheKey;
    if (!store || !key || key.length > MAX_CACHE_KEY) return;
    const load = ++r.cacheLoad;
    Promise.resolve()
      .then(() => store.get(key))
      .then(
        (rec) => {
          if (r.cacheLoad !== load || r.cacheKey !== key || !Array.isArray(rec?.cues) || !rec.cues.length) return;
          r.cached = rec;
          schedule();
        },
        (e) => logger.debug?.(`cache get: ${e.code || e.message}`)
      );
  }

  // The record's cues go to the page once; stored translations for the same
  // target seed the translate store, so translateCached sends them at once.
  function showCached(r, p) {
    if (!r.cached || r.shown) return;
    r.shown = { key: r.cacheKey, count: r.cached.cues.length, translating: false };
    sendView(r, p);
    quiet(cmd(r, { cmd: 'site-captions', value: 'hide' }));
    quiet(cmd(r, { cmd: 'cues', op: 'set', cues: r.cached.cues.map(({ id, start, end, text }) => ({ id, start, end, text })) }));
    if (sameLang(r.cached.target, p.targetLang)) {
      const store = cacheFor(`${r.cacheKey}:${p.targetLang}`);
      for (const c of r.cached.cues) if (c.translation) store.set(c.id, c.translation);
    }
  }

  // Once the tab is served: the stored translations, then the missing ones.
  function translateCached(r, p) {
    const s = r.shown;
    if (!s || s.translating || !r.cached) return;
    s.translating = true;
    if (sameLang(r.cached.lang, p.targetLang)) return;
    translateLoop(r, () => r.shown === s, { url: 'cache', lang: r.cached.lang, cues: r.cached.cues }, p);
  }

  function markDirty(r) {
    r.cacheDirty = true;
    if (!r.timers.flush) r.timers.flush = setTimer(() => {
      r.timers.flush = null;
      flushCache(r);
    }, CACHE_FLUSH_MS);
  }

  function noteSiteCues(r, site, p) {
    const store = cacheFor(`${r.cacheKey}:${p.targetLang}`);
    r.newCues = new Map(site.cues.map((c) => [c.id, { id: c.id, start: c.start, end: c.end, text: c.text, translation: store.get(c.id) ?? null }]));
    r.cacheTier = TIER.SITE;
    r.cacheLang = site.lang || '';
    markDirty(r);
  }

  function noteLiveCue(r, tier, gen, e) {
    const old = r.newCues.get(e.id);
    r.newCues.set(e.id, { id: e.id, start: e.start, end: e.end, text: e.text, translation: old?.translation ?? null, runGen: gen });
    r.cacheTier = tier;
    const source = prefs.get().sourceLang;
    r.cacheLang = source && source !== 'auto' ? source : '';
    markDirty(r);
  }

  function noteTranslation(r, id, text) {
    const c = r.newCues.get(id) ?? r.cached?.cues.find((x) => x.id === (r.idAlias.get(id) ?? id));
    if (!c || c.translation === text) return;
    c.translation = text;
    markDirty(r);
  }

  // What ran goes into the video's record: site cues replace it, recognized
  // ones add to it under ids no later run can reuse.
  function flushCache(r) {
    clearTimerOf(r, 'flush');
    if (!r.cacheDirty) return;
    r.cacheDirty = false;
    const store = cacheOf(r);
    const key = r.cacheKey;
    const fresh = [...r.newCues.values()];
    r.newCues = new Map();
    if (!key) return;
    const merged = new Map();
    if (!(r.cacheTier === TIER.SITE && fresh.length)) for (const c of r.cached?.cues ?? []) merged.set(c.id, c);
    const stamp = now().toString(36);
    for (const c of fresh) {
      const id = r.cacheTier === TIER.SITE ? c.id : `c${stamp}-${c.id}`;
      if (id !== c.id) r.idAlias.set(c.id, id);
      merged.set(id, { ...c, id });
    }
    const cues = [...merged.values()].sort((a, b) => a.start - b.start);
    const record = { cues, tier: r.cacheTier ?? r.cached?.tier ?? null, lang: r.cacheLang || r.cached?.lang || '', target: prefs.get().targetLang };
    r.cached = record;
    // The page already has these cues (they ran here); only a new document shows the record again.
    r.shown ??= { key, count: cues.length, translating: true };
    // Without a store the record still lives in memory (coverage, resume).
    if (store) Promise.resolve()
      .then(() => store.put(key, record))
      .catch((e) => logger.debug?.(`cache put: ${e.code || e.message}`));
  }

  // ---- scheduling ----

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      try {
        evaluateAll();
      } catch (e) {
        logger.warn?.(`orchestrator: ${e.message}`);
      }
    });
  }

  function scheduleRetry(r, ms = retryMs) {
    if (r.timers.retry) return;
    r.timers.retry = setTimer(() => {
      r.timers.retry = null;
      schedule();
    }, ms);
  }

  // ---- the decision ----

  function blockedBy(r, p) {
    if (companion.status !== 'ready') return 'offline';
    if (!p.enabled || p.siteOff[siteKeyOf(r.ev)]) return 'off';
    if (!r.media) return 'no-media';
    if (!r.media.pageVisible) return 'hidden';
    if (!arbiter.isVisible(r.tabId)) return 'hidden';
    if (r.media.state === 'ended') return 'ended';
    if (!mediaEligible(r.media)) return 'paused';
    return null;
  }

  function evaluateAll() {
    const p = prefs.get();
    const candidates = [];
    for (const r of byTab.values()) {
      r.ev = pageEvents.getTabEvidence(r.tabId);
      if (!r.ev) continue;
      r.mediaKey = mediaKeyOf(r);
      syncCache(r);
      // Once the page has its video (the renderer needs it), not switched off.
      if (r.cached && !r.shown && r.media && p.enabled && !p.siteOff[siteKeyOf(r.ev)]) showCached(r, p);
      r.block = blockedBy(r, p);
      if (!r.block || (r.block === 'paused' && r.held)) candidates.push(r.tabId);
    }
    const focused = arbiter.focused();
    const visible = arbiter.visible();
    const next = candidates.includes(focused) ? focused : candidates.includes(active) ? active : (visible.find((t) => candidates.includes(t)) ?? candidates[0] ?? null);
    if (active !== null && active !== next) {
      const old = byTab.get(active);
      if (old) {
        stopRun(old, 'other-tab');
        restState(old, old.block);
      }
    }
    active = next;
    for (const r of byTab.values()) {
      if (!r.ev) continue;
      if (r.tabId === active) {
        if (r.block === 'paused') continue; // the pause timer decides
        drive(r, p);
      } else {
        const reason = r.block || 'other-tab';
        if (r.run && !(reason === 'paused' && r.held)) stopRun(r, reason);
        if (!r.run && !r.held) restState(r, reason);
      }
    }
  }

  // Nothing runs in the tab: off; captions when the viewer is still on it
  // (only the channel or a pause in the way) and cached cues cover the
  // playhead; else idle.
  function restState(r, reason) {
    if (reason === 'off') setState(r, 'off');
    else if ((reason === 'offline' || reason === 'paused') && covered(r)) setState(r, 'captions', { cached: true });
    else setState(r, 'idle');
  }

  function decideTier(r) {
    const ev = r.ev;
    const site = pickSiteTrack(r);
    if (site) return { tier: TIER.SITE, site };
    const stretches = coverage(r, r.run?.gen ?? null);
    const t = currentTime(r);
    if (coveredAt(stretches, t)) return { cached: true };
    if (ev.eme) return { tier: TIER.LISTEN, why: 'drm' };
    const hooksOk = ev.hooks?.main === 'ok' && ev.hooks.mse === 'ok';
    const viaMse = String(r.media?.src || '').startsWith('blob:') || (ev.mse?.streams?.length ?? 0) > 0;
    // Site captions (and the audio stream) usually show up within a moment of
    // play; waiting for them saves opening a recognition session for nothing.
    if (hooksOk && viaMse && !r.emptySubtitle && r.playingSince && now() - r.playingSince < decideGraceMs) return { wait: true };
    const audio = ev.mse?.audio;
    if (audio?.forward) return noSpeech.has(r.mediaKey) ? { suspended: true } : { tier: TIER.AUDIO, audio, edge: coveredEdge(stretches, t) };
    if (audio) return { tier: TIER.LISTEN, why: 'unsupported-audio' };
    // A plain file: the worker fetches it itself (no hooks needed).
    if (!viaMse && isDirectUrl(r.media?.src)) {
      if (r.directFailed) return { tier: TIER.LISTEN, why: 'direct-failed' };
      if (r.needsOrigin) return { permission: r.needsOrigin };
      return noSpeech.has(r.mediaKey) ? { suspended: true } : { tier: TIER.AUDIO, kind: 'direct', url: r.media.src, edge: coveredEdge(stretches, t) };
    }
    if (!hooksOk || !ev.hooks) return { tier: TIER.LISTEN, why: 'no-hooks' };
    return { tier: TIER.LISTEN, why: viaMse ? 'no-audio' : 'plain-src' };
  }

  function drive(r, p) {
    translateCached(r, p);
    const d = decideTier(r);
    if (d.cached) {
      if (r.run) stopRun(r, 'covered');
      setState(r, 'captions', { cached: true });
      return;
    }
    if (d.wait) {
      setState(r, 'waiting');
      if (!r.timers.decide) r.timers.decide = setTimer(() => {
        r.timers.decide = null;
        schedule();
      }, decideGraceMs);
      return;
    }
    if (d.suspended) {
      if (r.run) stopRun(r, 'no-speech');
      setState(r, 'suspended');
      return;
    }
    if (d.permission) {
      if (r.run) stopRun(r, 'permission');
      if (r.promptedFor !== `${r.mediaKey}:permission`) {
        r.promptedFor = `${r.mediaKey}:permission`;
        quiet(cmd(r, { cmd: 'notice', kind: 'permission', origin: d.permission }));
      }
      setState(r, 'prompt', { why: 'permission', origin: d.permission });
      return;
    }
    if (r.run) {
      if (d.tier === r.run.tier) return;
      if (d.tier === TIER.SITE || (d.tier === TIER.LISTEN && d.why === 'drm')) {
        stopRun(r, d.tier === TIER.SITE ? 'upgrade' : 'drm');
        start(r, d, p);
      }
      return;
    }
    if (r.timers.retry) return;
    start(r, d, p);
  }

  // ---- running ----

  function sendView(r, p) {
    if (r.view && r.view.display === p.display && r.view.mode === p.mode) return;
    r.view = { display: p.display, mode: p.mode };
    quiet(cmd(r, { cmd: 'display', value: p.display }));
    quiet(cmd(r, { cmd: 'mode', value: p.mode }));
  }

  function start(r, d, p) {
    const gen = ++r.gen;
    const t = currentTime(r);
    if (d.tier === TIER.SITE) {
      r.run = { tier: TIER.SITE, kind: 'site', gen, url: d.site.url, startedAt: now() };
      noteSiteCues(r, d.site, p);
      sendView(r, p);
      if (r.promptedFor) hideNotice(r);
      quiet(cmd(r, { cmd: 'site-captions', value: 'hide' }));
      quiet(cmd(r, { cmd: 'cues', op: 'set', cues: d.site.cues }));
      setState(r, 'captions', { tier: 1 });
      if (!sameLang(d.site.lang, p.targetLang)) translateLoop(r, () => r.run?.gen === gen, d.site, p);
      return;
    }
    if (d.tier === TIER.AUDIO && d.kind === 'direct') {
      r.run = { tier: TIER.AUDIO, kind: 'direct', gen, url: d.url, startedAt: now() };
      sendView(r, p);
      if (r.promptedFor) hideNotice(r);
      setState(r, 'captions', { tier: 2, kind: 'direct' });
      cmd(r, { cmd: 'direct', on: true, url: d.url, lang: p.sourceLang, targetLang: p.targetLang, fromS: Math.max(0, t - CAPTURE_BACK_S, d.edge || 0) }).then(
        (res) => opened(r, gen, res),
        (e) => fail(r, gen, e)
      );
      return;
    }
    if (d.tier === TIER.AUDIO) {
      r.run = { tier: TIER.AUDIO, kind: 'capture', gen, startedAt: now() };
      sendView(r, p);
      if (r.promptedFor) hideNotice(r);
      setState(r, 'captions', { tier: 2 });
      cmd(r, { cmd: 'mse-capture', on: true, streamId: d.audio.streamId, lang: p.sourceLang, targetLang: p.targetLang, fromS: Math.max(0, t - CAPTURE_BACK_S, d.edge || 0) }).then(
        (res) => opened(r, gen, res),
        (e) => fail(r, gen, e)
      );
      return;
    }
    // Tier 3
    if (listenOk.has(r.mediaKey) || p.autoListen) {
      r.run = { tier: TIER.LISTEN, kind: 'listen', gen, startedAt: now() };
      sendView(r, p);
      if (r.promptedFor) hideNotice(r);
      setState(r, 'listening', { why: d.why });
      cmd(r, { cmd: 'listen', on: true, lang: p.sourceLang, targetLang: p.targetLang, mediaStartS: t }).then(
        (res) => opened(r, gen, res),
        (e) => fail(r, gen, e)
      );
      return;
    }
    if (dismissed.has(r.mediaKey)) {
      setState(r, 'idle', { why: d.why });
      return;
    }
    if (r.promptedFor !== r.mediaKey) {
      r.promptedFor = r.mediaKey;
      quiet(cmd(r, { cmd: 'notice', kind: 'listen' }));
    }
    setState(r, 'prompt', { why: d.why });
  }

  function hideNotice(r) {
    r.promptedFor = null;
    quiet(cmd(r, { cmd: 'notice', kind: null }));
  }

  // The session's key, so events of an earlier session under this tab are told apart.
  function opened(r, gen, res) {
    if (r.run && r.run.gen === gen && typeof res?.key === 'string') r.run.key = res.key;
  }

  // The run is over; finals the pipeline still flushes under its key are kept for the record.
  function endRun(r) {
    const run = r.run;
    if (run) r.lastRun = { key: run.key ?? null, kind: run.kind, tier: run.tier, gen: run.gen };
    r.run = null;
    r.gen++;
  }

  function fail(r, gen, e) {
    if (!r.run || r.run.gen !== gen) return;
    const code = e?.code || e?.message || 'error';
    logger.warn?.(`tab ${r.tabId}: ${r.run.kind} failed: ${code}`);
    endRun(r);
    // The site's origin is not permitted yet: the tab prompts until permissionGranted.
    if (code === 'no-permission') {
      r.needsOrigin = e?.origin || (e?.message && e.message !== code ? e.message : 'unknown');
      schedule();
      return;
    }
    r.failures++;
    setState(r, 'idle', { error: code });
    // A file the fetcher cannot use will not change on retry: straight to the fallback.
    if (r.lastRun?.kind === 'direct' && DIRECT_FATAL.has(code)) gaveUp(r);
    else if (r.failures < MAX_FAILURES) scheduleRetry(r, code === 'busy' ? busyRetryMs : retryMs);
    else gaveUp(r);
  }

  // Out of retries: a direct file that keeps failing falls back to the notice.
  function gaveUp(r) {
    if (r.lastRun?.kind === 'direct') {
      r.directFailed = true;
      schedule();
    }
  }

  function stopRun(r, reason) {
    const run = r.run;
    clearTimerOf(r, 'pause');
    r.held = false;
    if (!run) return;
    endRun(r);
    flushCache(r);
    if (run.kind === 'capture') quiet(cmd(r, { cmd: 'mse-capture', on: false }));
    else if (run.kind === 'direct') quiet(cmd(r, { cmd: 'direct', on: false, reason }));
    else if (run.kind === 'listen') quiet(cmd(r, { cmd: 'listen', on: false, reason }));
    logger.debug?.(`tab ${r.tabId}: ${run.kind} stopped (${reason})`);
  }

  // Everything about the old document is gone with it; nothing to tell the page.
  function resetNav(r) {
    flushCache(r);
    r.shown = null;
    r.lastRun = null;
    r.needsOrigin = null;
    r.directFailed = false;
    r.run = null;
    r.gen++;
    r.held = false;
    for (const name of Object.keys(r.timers)) clearTimerOf(r, name);
    r.siteCues.clear();
    r.emptySubtitle = false;
    r.promptedFor = null;
    r.view = null;
    r.failures = 0;
    r.playingSince = 0;
    r.media = null;
    r.translateError = null;
  }

  // ---- tier 1 translation: around the playhead first, then onwards, cached ----

  // live() says whether the cues are still the page's; site is { cues, lang }.
  async function translateLoop(r, live, site, p) {
    const target = p.targetLang;
    const store = cacheFor(`${r.mediaKey}:${target}`);
    const pending = new Map();
    const cached = [];
    for (const c of site.cues) {
      if (!c.text || !c.text.trim()) continue;
      if (store.has(c.id)) cached.push({ id: c.id, text: store.get(c.id), done: true });
      else pending.set(c.id, c);
    }
    if (cached.length) quiet(cmd(r, { cmd: 'cues', op: 'translation', translations: cached }));
    while (pending.size && live()) {
      const t = currentTime(r);
      const all = [...pending.values()];
      const byStart = (a, b) => a.start - b.start;
      let batch = all.filter((c) => c.end >= t - NEAR_S && c.start <= t + NEAR_S).sort(byStart);
      if (!batch.length) batch = all.filter((c) => c.start >= t).sort(byStart);
      if (!batch.length) batch = all.sort(byStart);
      batch = batch.slice(0, MAX_TRANSLATE_ITEMS);
      let res;
      try {
        res = await translate(
          batch.map((c) => ({ id: c.id, text: c.text.slice(0, MAX_TRANSLATE_CHARS) })),
          { source: site.lang || 'auto', target }
        );
      } catch (e) {
        r.translateError = e?.code || 'translate-failed';
        logger.warn?.(`tab ${r.tabId}: translate failed: ${r.translateError}`);
        setTimer(() => {
          if (live()) translateLoop(r, live, { ...site, cues: [...pending.values()] }, p);
        }, translateRetryMs);
        return;
      }
      if (!live()) return;
      r.translateError = null;
      const out = [];
      for (const item of Array.isArray(res) ? res : []) {
        const c = pending.get(String(item?.id));
        if (!c) continue;
        if (typeof item.text === 'string' && item.text) {
          store.set(c.id, item.text);
          noteTranslation(r, c.id, item.text);
          out.push({ id: c.id, text: item.text, done: true });
        }
      }
      for (const c of batch) pending.delete(c.id);
      if (out.length) quiet(cmd(r, { cmd: 'cues', op: 'translation', translations: out }));
    }
  }

  // ---- inputs ----

  function onMedia(r, event) {
    if (!event.primary) return;
    const prev = r.media;
    const prevAt = r.mediaAt;
    const m = event.media;
    r.media = m;
    r.mediaAt = now();
    if (m.state === 'playing' || m.state === 'seeking') {
      if (!r.playingSince || prev?.state === 'ended') r.playingSince = r.mediaAt;
      clearTimerOf(r, 'pause');
      r.held = false;
      // The direct fetcher stays this far ahead of the playhead.
      if (r.run?.kind === 'direct' && r.run.key) quiet(cmd(r, { cmd: 'direct', position: m.currentTime }));
    } else if (m.state === 'ended') {
      r.playingSince = 0;
      stopRun(r, 'ended');
    } else if (r.run) {
      // paused / idle: listen follows the wall clock and stops now; the others get the grace
      if (r.run.kind === 'listen') stopRun(r, 'paused');
      else if (!r.timers.pause) {
        r.held = true;
        r.timers.pause = setTimer(() => {
          r.timers.pause = null;
          r.held = false;
          stopRun(r, 'paused');
          schedule();
        }, pauseGraceMs);
      }
    }
    if (event.reason === 'seeked' && r.run && r.run.kind !== 'site' && prev) {
      const expected = prev.currentTime + (prev.state === 'playing' ? (r.mediaAt - prevAt) / 1000 : 0);
      if (Math.abs(m.currentTime - expected) > SEEK_JUMP_S) stopRun(r, 'seek');
    }
  }

  function onCaptureEvent(r, event) {
    const e = event.event;
    const mine = r.run && r.run.kind === event.kind && r.run.kind !== 'site' && (r.run.key ? event.key === r.run.key : e.type === 'segment');
    if (e.type === 'segment') r.failures = 0;
    const owner = mine ? r.run : r.lastRun && event.key && event.key === r.lastRun.key && event.kind === r.lastRun.kind ? r.lastRun : null;
    if (!mine && (e.type === 'segment' || e.type === 'translation')) logger.debug?.(`tab ${r.tabId}: ${e.type} ${e.id ?? ''} ${owner ? 'after the stop' : 'stray'} (${event.key})`);
    if (owner) {
      if (e.type === 'segment' && e.id) noteLiveCue(r, owner.tier, owner.gen, e);
      else if (e.type === 'translation' && e.id && typeof e.text === 'string' && e.text) noteTranslation(r, e.id, e.text);
    }
    if (!mine) return;
    if (e.type === 'suspended') {
      remember(noSpeech, r.mediaKey);
      stopRun(r, 'no-speech');
      setState(r, 'suspended');
    } else if (e.type === 'closed') {
      endRun(r);
      if (e.reason === 'preempted' || e.reason === 'busy') scheduleRetry(r, busyRetryMs);
      else if (e.reason && e.reason !== 'closed') {
        r.failures++;
        if (r.failures < MAX_FAILURES) scheduleRetry(r);
        else gaveUp(r);
      }
      setState(r, 'idle', { closed: e.reason });
    } else if (e.type === 'error') {
      endRun(r);
      r.failures++;
      if (r.failures < MAX_FAILURES) scheduleRetry(r);
      else gaveUp(r);
      setState(r, 'idle', { error: e.code });
    }
  }

  function onPageEvent({ tabId, event }) {
    if (event.type === 'forgotten') {
      const r = byTab.get(tabId);
      if (!r) return;
      flushCache(r);
      for (const name of Object.keys(r.timers)) clearTimerOf(r, name);
      byTab.delete(tabId);
      if (active === tabId) active = null;
      onState(tabId, null);
      schedule();
      return;
    }
    const r = ensure(tabId);
    switch (event.type) {
      case 'navigated':
        resetNav(r);
        break;
      case 'media':
        onMedia(r, event);
        break;
      case 'subtitle-parsed':
        if (event.cueCount > 0 && event.cues?.length) {
          r.siteCues.set(event.url, { url: event.url, cues: event.cues, lang: event.lang, kind: event.kind, mediaId: event.mediaId, at: now() });
          if (r.siteCues.size > MAX_SITE_TRACKS) r.siteCues.delete(r.siteCues.keys().next().value);
        } else r.emptySubtitle = true;
        break;
      case 'capture':
        // The page stopped forwarding: the stream went away (a new one is
        // decided on at once) or the page could not keep up (tried again later).
        if (!event.on && r.run?.kind === 'capture') {
          endRun(r);
          if (PAGE_STOP_RETRY.has(event.reason)) scheduleRetry(r);
          setState(r, 'idle', { capture: event.reason });
        }
        break;
      case 'capture-event':
        onCaptureEvent(r, event);
        break;
      case 'notice-action':
        if (event.kind !== 'listen') break;
        r.promptedFor = null;
        if (event.action === 'accept') remember(listenOk, r.mediaKey || mediaKeyOf(r) || '');
        else remember(dismissed, r.mediaKey || mediaKeyOf(r) || '');
        break;
      default:
        break;
    }
    schedule();
  }

  pageEvents.onPageEvent(onPageEvent);
  prefs.onChange((p) => {
    for (const r of byTab.values()) if (r.run) sendView(r, p);
    schedule();
  });

  return {
    setCompanion(state) {
      companion = state || { status: 'unpaired' };
      schedule();
    },
    evaluate: schedule,
    // For the popup and tests: the tab's state, run and why it is blocked.
    stateOf(tabId) {
      const r = byTab.get(tabId);
      if (!r) return null;
      return { tabId, state: r.state, run: r.run ? { tier: r.run.tier, kind: r.run.kind, key: r.run.key ?? null, startedAt: r.run.startedAt } : null, block: r.block ?? null, active: active === tabId, mediaKey: r.mediaKey, noSpeech: noSpeech.has(r.mediaKey), translateError: r.translateError, failures: r.failures, needs: r.needsOrigin ? { origin: r.needsOrigin } : null, cached: r.cached ? { count: r.cached.cues.length, tier: r.cached.tier ?? null, shown: !!r.shown, covered: covered(r) } : null, history: r.log.slice() };
    },
    active: () => active,
    // The user allowed a site's origin (the popup): tabs waiting on it try again.
    permissionGranted(origin) {
      for (const r of byTab.values()) if (r.needsOrigin && (!origin || r.needsOrigin === origin)) r.needsOrigin = null;
      schedule();
    },
    // Forgets a parked video so it is tried again.
    unpark(mediaKey) {
      noSpeech.delete(mediaKey);
      schedule();
    },
  };
}
