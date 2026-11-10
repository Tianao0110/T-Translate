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
//     media pipeline; cues come back by themselves)
//   3 DRM, no hooks, plain file or undecodable audio → a notice in the page;
//     the listen session opens when the user accepts (or autoListen is on)
// A running tier only changes upwards to tier 1, or to tier 3 when DRM
// shows up. Stops: paused over the grace, page hidden, tab left, navigation,
// channel gone; 60 s without a final (the pipeline's 'suspended') parks the
// video until it changes. States go to onState(tabId, state) for the badge.

import { MAX_TRANSLATE_ITEMS, MAX_TRANSLATE_CHARS } from '../shared/protocol.js';

export const TIER = { SITE: 1, AUDIO: 2, LISTEN: 3 };
export const STATES = ['idle', 'waiting', 'captions', 'listening', 'prompt', 'suspended', 'off'];

const PAUSE_GRACE_MS = 5000;
const DECIDE_GRACE_MS = 2000;
const RETRY_MS = 15000;
const TRANSLATE_RETRY_MS = 30000;
const MAX_FAILURES = 3;
const NEAR_S = 120;
const SEEK_JUMP_S = 3;
const CAPTURE_BACK_S = 5;
const MIN_DURATION_S = 10;
const MIN_WIDTH = 200;
const MIN_HEIGHT = 120;
const MAX_SITE_TRACKS = 8;
const MAX_CACHED_MEDIA = 20;
const MAX_REMEMBERED = 200;
const MAX_LOG = 30;
// The page stopped forwarding for a reason that is not going away by itself.
const PAGE_STOP_RETRY = new Set(['overflow', 'send-failed', 'refused', 'pipeline-ended']);

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

function remember(set, key) {
  set.add(key);
  if (set.size > MAX_REMEMBERED) set.delete(set.values().next().value);
}

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
  translateRetryMs = TRANSLATE_RETRY_MS,
}) {
  const byTab = new Map();
  let active = null;
  let companion = { status: 'unpaired' };
  let scheduled = false;
  const noSpeech = new Set(); // media keys parked after 60 s without a final
  const listenOk = new Set(); // media keys the user accepted listening for
  const dismissed = new Set(); // media keys whose notice was dismissed
  const cache = new Map(); // `${mediaKey}:${target}` → Map cueId → translation

  // ---- per tab ----

  function ensure(tabId) {
    let r = byTab.get(tabId);
    if (!r) {
      r = { tabId, ev: null, media: null, mediaAt: 0, mediaKey: null, run: null, gen: 0, held: false, playingSince: 0, failures: 0, state: null, log: [], siteCues: new Map(), emptySubtitle: false, promptedFor: null, view: null, timers: {}, translateError: null };
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
    if (r.state === state && !detail) return;
    r.state = state;
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
    let m = cache.get(key);
    if (!m) {
      m = new Map();
      cache.set(key, m);
      if (cache.size > MAX_CACHED_MEDIA) cache.delete(cache.keys().next().value);
    }
    return m;
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
        setState(old, old.block === 'off' ? 'off' : 'idle');
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
        if (!r.run && !r.held) setState(r, reason === 'off' ? 'off' : 'idle');
      }
    }
  }

  function decideTier(r) {
    const ev = r.ev;
    const site = pickSiteTrack(r);
    if (site) return { tier: TIER.SITE, site };
    if (ev.eme) return { tier: TIER.LISTEN, why: 'drm' };
    const hooksOk = ev.hooks?.main === 'ok' && ev.hooks.mse === 'ok';
    const viaMse = String(r.media?.src || '').startsWith('blob:') || (ev.mse?.streams?.length ?? 0) > 0;
    // Site captions (and the audio stream) usually show up within a moment of
    // play; waiting for them saves opening a recognition session for nothing.
    if (hooksOk && viaMse && !r.emptySubtitle && r.playingSince && now() - r.playingSince < decideGraceMs) return { wait: true };
    const audio = ev.mse?.audio;
    if (audio?.forward) return noSpeech.has(r.mediaKey) ? { suspended: true } : { tier: TIER.AUDIO, audio };
    if (audio) return { tier: TIER.LISTEN, why: 'unsupported-audio' };
    if (!hooksOk || !ev.hooks) return { tier: TIER.LISTEN, why: 'no-hooks' };
    return { tier: TIER.LISTEN, why: viaMse ? 'no-audio' : 'plain-src' };
  }

  function drive(r, p) {
    const d = decideTier(r);
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
      sendView(r, p);
      if (r.promptedFor) hideNotice(r);
      quiet(cmd(r, { cmd: 'site-captions', value: 'hide' }));
      quiet(cmd(r, { cmd: 'cues', op: 'set', cues: d.site.cues }));
      setState(r, 'captions', { tier: 1 });
      if (!sameLang(d.site.lang, p.targetLang)) translateLoop(r, gen, d.site, p);
      return;
    }
    if (d.tier === TIER.AUDIO) {
      r.run = { tier: TIER.AUDIO, kind: 'capture', gen, startedAt: now() };
      sendView(r, p);
      if (r.promptedFor) hideNotice(r);
      setState(r, 'captions', { tier: 2 });
      cmd(r, { cmd: 'mse-capture', on: true, streamId: d.audio.streamId, lang: p.sourceLang, targetLang: p.targetLang, fromS: Math.max(0, t - CAPTURE_BACK_S) }).then(
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

  function fail(r, gen, e) {
    if (!r.run || r.run.gen !== gen) return;
    const code = e?.code || e?.message || 'error';
    logger.warn?.(`tab ${r.tabId}: ${r.run.kind} failed: ${code}`);
    r.run = null;
    r.failures++;
    setState(r, 'idle', { error: code });
    if (r.failures < MAX_FAILURES) scheduleRetry(r);
  }

  function stopRun(r, reason) {
    const run = r.run;
    clearTimerOf(r, 'pause');
    r.held = false;
    if (!run) return;
    r.run = null;
    r.gen++;
    if (run.kind === 'capture') quiet(cmd(r, { cmd: 'mse-capture', on: false }));
    else if (run.kind === 'listen') quiet(cmd(r, { cmd: 'listen', on: false, reason }));
    logger.debug?.(`tab ${r.tabId}: ${run.kind} stopped (${reason})`);
  }

  // Everything about the old document is gone with it; nothing to tell the page.
  function resetNav(r) {
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

  async function translateLoop(r, gen, site, p) {
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
    const live = () => r.run?.gen === gen;
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
          if (live()) translateLoop(r, gen, { ...site, cues: [...pending.values()] }, p);
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
    const mine = r.run && ((r.run.kind === 'capture' && event.kind === 'capture') || (r.run.kind === 'listen' && event.kind === 'listen')) && (r.run.key ? event.key === r.run.key : e.type === 'segment');
    if (e.type === 'segment') r.failures = 0;
    if (!mine) return;
    if (e.type === 'suspended') {
      remember(noSpeech, r.mediaKey);
      stopRun(r, 'no-speech');
      setState(r, 'suspended');
    } else if (e.type === 'closed') {
      r.run = null;
      r.gen++;
      if (e.reason === 'preempted' || e.reason === 'busy') scheduleRetry(r);
      else if (e.reason && e.reason !== 'closed') {
        r.failures++;
        if (r.failures < MAX_FAILURES) scheduleRetry(r);
      }
      setState(r, 'idle', { closed: e.reason });
    } else if (e.type === 'error') {
      r.run = null;
      r.gen++;
      r.failures++;
      if (r.failures < MAX_FAILURES) scheduleRetry(r);
      setState(r, 'idle', { error: e.code });
    }
  }

  function onPageEvent({ tabId, event }) {
    if (event.type === 'forgotten') {
      const r = byTab.get(tabId);
      if (!r) return;
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
          r.run = null;
          r.gen++;
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
      return { tabId, state: r.state, run: r.run ? { tier: r.run.tier, kind: r.run.kind, key: r.run.key ?? null, startedAt: r.run.startedAt } : null, block: r.block ?? null, active: active === tabId, mediaKey: r.mediaKey, noSpeech: noSpeech.has(r.mediaKey), translateError: r.translateError, failures: r.failures, history: r.log.slice() };
    },
    active: () => active,
    // Forgets a parked video so it is tried again.
    unpark(mediaKey) {
      noSpeech.delete(mediaKey);
      schedule();
    },
  };
}
