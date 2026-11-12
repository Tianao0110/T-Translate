// Netflix: media id from /watch/<id>. In the page world, the playback
// manifest's text tracks are read where the player parses it (JSON.parse)
// and WebVTT is added where it writes the request (JSON.stringify); the
// tracks go to the isolated world as a subtitle list at LIST_URL (never
// fetched), whose body is the track in the playing audio's language. Pauses
// go through the player's own API ('player' action). SPA
// navigation through history; hiding the player's captions; where its
// control bar sits; whether an ad plays.

import { topOf } from './controls.js';
import { hookMethod, tryHook } from '../hooks/patch.js';

const WATCH = /^\/watch\/(\d{3,15})(?:[/?#]|$)/;
const LIST_HOST = 'www.netflix.com';
const LIST_PATH = '/t-caption/manifest/';
const WEBVTT = 'webvtt-lssdh-ios8';
const FORMATS = [WEBVTT, 'dfxp-ls-sdh', 'imsc1.1'];
const MAX_BODIES = 500;
const PLAYER_WAIT_MS = 15000;
const PLAYER_POLL_MS = 300;
// Rank of a track for the list: the audio's language first (plain, then
// CC), then the one the player shows, then CC, other subtitles, forced ones.
const RANK = { audio: 0, selected: 10, cc: 20, other: 30, forced: 40 };
const KIND_RANK = { '': 0, cc: 1, forced: 2 };
const PRIMARY = { cmn: 'zh', yue: 'zh', zho: 'zh' };

const kindOf = (k) => (typeof k === 'string' && Object.hasOwn(KIND_RANK, k) ? k : '');
const isHost = (host) => host === 'netflix.com' || host.endsWith('.netflix.com');
const parse = (href) => {
  try {
    return new URL(href);
  } catch {
    return null;
  }
};
const primary = (lang) => {
  const p = String(lang || '').split('-')[0].toLowerCase();
  return PRIMARY[p] || p;
};

function mediaId(href) {
  const u = parse(href);
  if (!u || !isHost(u.hostname)) return null;
  return WATCH.exec(u.pathname)?.[1] ?? null;
}

export const listUrl = (movieId, audio = '') => `https://${LIST_HOST}${LIST_PATH}${encodeURIComponent(movieId)}?audio=${encodeURIComponent(audio)}`;
const isList = (u) => !!u && u.hostname === LIST_HOST && u.pathname.startsWith(LIST_PATH);

// Track files the lists named (isolated world): url → { lang, kind, mediaId }.
const bodies = new Map();

function isSubtitleRequest(href) {
  const u = parse(href);
  return isList(u) || (!!u && bodies.has(u.href));
}

// Files no list named are strays: the player's own caption files included.
function subtitleInfo(href) {
  const u = parse(href);
  if (isList(u)) return { list: true };
  const b = u && bodies.get(u.href);
  return b ? { ...b } : { stray: true };
}

function rankOf(t, audio, selected) {
  if (t.kind === 'forced') return RANK.forced;
  if (audio && primary(t.lang) === primary(audio)) return RANK.audio + KIND_RANK[t.kind];
  if (selected && t.lang === selected.lang && t.kind === selected.kind) return RANK.selected;
  return t.kind === 'cc' ? RANK.cc : RANK.other;
}

// The list the page world sent: its tracks best first, each file noted as this title's.
function listSubtitles(text) {
  let data;
  try {
    data = typeof text === 'string' ? JSON.parse(text) : text;
  } catch {
    return [];
  }
  const movieId = data && (typeof data.movieId === 'string' || typeof data.movieId === 'number') ? String(data.movieId) : null;
  const audio = typeof data?.audio === 'string' ? data.audio : '';
  const selected = data?.selected && typeof data.selected.lang === 'string' ? { lang: data.selected.lang, kind: kindOf(data.selected.kind) } : null;
  const out = [];
  for (const t of Array.isArray(data?.tracks) ? data.tracks : []) {
    if (!t || typeof t.lang !== 'string' || !t.lang || typeof t.url !== 'string' || !/^https:\/\//.test(t.url)) continue;
    const kind = kindOf(t.kind);
    out.push({ url: t.url, lang: t.lang, kind, ai: false, rank: rankOf({ lang: t.lang, kind }, audio, selected) });
  }
  out.sort((a, b) => a.rank - b.rank);
  for (const s of out) {
    bodies.delete(s.url);
    bodies.set(s.url, { lang: s.lang, kind: s.kind, mediaId: movieId });
    if (bodies.size > MAX_BODIES) bodies.delete(bodies.keys().next().value);
  }
  return out.map(({ rank: _rank, ...s }) => s);
}

function watchNavigation({ win }, fn) {
  win.addEventListener('popstate', fn);
  win.navigation?.addEventListener('currententrychange', fn);
  return () => {
    win.removeEventListener('popstate', fn);
    win.navigation?.removeEventListener('currententrychange', fn);
  };
}

const hideStyles = new WeakMap();
function hideSiteCaptions(doc, on) {
  let style = hideStyles.get(doc);
  if (on && !style) {
    style = doc.createElement('style');
    style.textContent = '.player-timedtext { display: none !important; }';
    (doc.head || doc.documentElement).append(style);
    hideStyles.set(doc, style);
  } else if (!on && style) {
    style.remove();
    hideStyles.delete(doc);
  }
  return on;
}

const adShowing = (video) => !!video.ownerDocument?.querySelector('.watch-video--adsInfo-container');

function controlsTop(video) {
  return topOf(video, video.ownerDocument.querySelectorAll('.watch-video--bottom-controls-container'));
}

// ---- page world only ----

// The first downloadable URL of a track in each format.
function urlsOf(d) {
  const out = {};
  for (const f of FORMATS) {
    const x = d?.[f];
    if (!x || typeof x !== 'object') continue;
    const all = [...Object.values(x.urls && typeof x.urls === 'object' ? x.urls : {}).map((u) => (typeof u === 'string' ? u : u?.url)), ...Object.values(x.downloadUrls && typeof x.downloadUrls === 'object' ? x.downloadUrls : {})];
    const url = all.find((u) => typeof u === 'string' && /^https:\/\//.test(u));
    if (url) out[f] = url;
  }
  return out;
}

export function tracksOf(manifest) {
  const list = manifest?.textTracks ?? manifest?.timedtexttracks;
  const out = [];
  for (const t of Array.isArray(list) ? list : []) {
    if (!t || t.isNoneTrack || typeof t.language !== 'string') continue;
    const urls = urlsOf(t.downloadables ?? t.ttDownloadables);
    const url = FORMATS.map((f) => urls[f]).find(Boolean);
    if (!url) continue;
    out.push({ lang: t.language, kind: t.rawTrackType === 'closedcaptions' ? 'cc' : t.isForcedNarrative ? 'forced' : '', url });
  }
  return out;
}

// The watch player (its session id starts with "watch"), else the first one.
function playerOf(win) {
  try {
    const vp = win.netflix?.appContext?.state?.playerApp?.getAPI?.()?.videoPlayer;
    const ids = vp?.getAllPlayerSessionIds?.() || [];
    const id = ids.find((x) => String(x).startsWith('watch')) ?? ids[0];
    return id === undefined ? null : vp.getVideoPlayerBySessionId?.(id) || null;
  } catch {
    return null;
  }
}

const textKind = (t) => (/closedcaptions/i.test(String(t?.rawTrackType || '')) ? 'cc' : t?.isForcedNarrative ? 'forced' : '');

// What the player plays: the audio's language and the text track shown.
function playing(win) {
  const p = playerOf(win);
  if (!p || (typeof p.isReady === 'function' && !p.isReady())) return null;
  try {
    const a = p.getAudioTrack?.();
    const t = p.getTimedTextTrack?.();
    return { audio: String(a?.bcp47 || a?.language || ''), selected: t && !t.isNoneTrack && t.bcp47 ? { lang: String(t.bcp47), kind: textKind(t) } : null };
  } catch {
    return null;
  }
}

function sendList(win, emit, movieId, tracks) {
  const started = Date.now();
  const send = (now) => {
    const text = win.JSON.stringify({ movieId, audio: now?.audio || '', selected: now?.selected || null, tracks });
    emit({ k: 'subtitle', via: 'fetch', url: listUrl(movieId, now?.audio || ''), status: 200, contentType: 'application/json', text });
  };
  const poll = () => {
    const now = playing(win);
    if (now || Date.now() - started >= PLAYER_WAIT_MS) return send(now);
    win.setTimeout(poll, PLAYER_POLL_MS);
  };
  poll();
}

// WebVTT asked for in the manifest request; the tracks of each manifest read.
function installMain(win, { emit }) {
  const J = win.JSON;
  tryHook(() =>
    hookMethod(J, 'stringify', () => {}, {
      before(_self, args) {
        const v = args[0];
        const profiles = v && typeof v === 'object' ? v.params?.profiles : null;
        if (Array.isArray(profiles) && profiles.length && typeof profiles[0] === 'string' && !profiles.includes(WEBVTT)) args[0] = { ...v, params: { ...v.params, profiles: [...profiles, WEBVTT] } };
      },
    })
  );
  tryHook(() =>
    hookMethod(J, 'parse', (result) => {
      const m = result && typeof result === 'object' ? result.result : null;
      if (!m || typeof m !== 'object' || m.movieId === undefined || m.movieId === null || !(m.textTracks || m.timedtexttracks)) return;
      const tracks = tracksOf(m);
      if (tracks.length) sendList(win, emit, String(m.movieId), tracks);
    })
  );
}

// { op: 'pause' } on the watch player.
function player({ win, op }) {
  const p = playerOf(win);
  if (!p) throw Object.assign(new Error('no player'), { code: 'no-player' });
  if (op !== 'pause') throw Object.assign(new Error(String(op)), { code: 'bad-command' });
  p.pause();
  return { op };
}

export const netflix = {
  name: 'netflix',
  test: isHost,
  mediaId,
  isSubtitleRequest,
  subtitleInfo,
  listSubtitles,
  watchNavigation,
  hideSiteCaptions,
  controlsTop,
  adShowing,
  installMain,
  mainActions: { player },
};
