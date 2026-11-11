// YouTube: media id from the URL, the player's own timedtext requests (the
// pot token they carry is why they are copied, not rebuilt), SPA navigation
// through yt-navigate-finish, hiding the player's caption layer, where its
// control bar sits, and two page-world actions on the player element.

import { topOf } from './controls.js';

const VIDEO_ID = /^[\w-]{11}$/;
const PATH_ID = /^\/(?:shorts|embed|live|v)\/([\w-]{11})(?:[/?#]|$)/;

const isHost = (host) => host === 'youtube.com' || host.endsWith('.youtube.com');
const parse = (href) => {
  try {
    return new URL(href);
  } catch {
    return null;
  }
};

function mediaId(href) {
  const u = parse(href);
  if (!u || !isHost(u.hostname)) return null;
  if (u.pathname === '/watch') {
    const v = u.searchParams.get('v');
    return v && VIDEO_ID.test(v) ? v : null;
  }
  return PATH_ID.exec(u.pathname)?.[1] ?? null;
}

function isSubtitleRequest(href) {
  const u = parse(href);
  return !!u && isHost(u.hostname) && u.pathname === '/api/timedtext';
}

// Language (the translated one when the player asked for tlang), auto
// captions ('asr') and the video the request belongs to.
function subtitleInfo(href) {
  const u = parse(href);
  if (!u || !isSubtitleRequest(href)) return {};
  const q = u.searchParams;
  const v = q.get('v');
  return { lang: q.get('tlang') || q.get('lang') || '', kind: q.get('kind') || '', mediaId: v && VIDEO_ID.test(v) ? v : null };
}

function watchNavigation({ doc, win }, fn) {
  doc.addEventListener('yt-navigate-finish', fn);
  win.addEventListener('popstate', fn);
  return () => {
    doc.removeEventListener('yt-navigate-finish', fn);
    win.removeEventListener('popstate', fn);
  };
}

const hideStyles = new WeakMap();
function hideSiteCaptions(doc, on) {
  let style = hideStyles.get(doc);
  if (on && !style) {
    style = doc.createElement('style');
    style.textContent = '.ytp-caption-window-container { display: none !important; }';
    (doc.head || doc.documentElement).append(style);
    hideStyles.set(doc, style);
  } else if (!on && style) {
    style.remove();
    hideStyles.delete(doc);
  }
  return on;
}

// The control bar with its progress bar, while it is shown.
function controlsTop(video) {
  const player = video.closest?.('.html5-video-player');
  if (!player) return null;
  return topOf(video, [player.querySelector('.ytp-chrome-bottom'), player.querySelector('.ytp-progress-bar-container')], player);
}

// ---- page world only: the player element's methods live there ----

function player(doc) {
  const p = doc.getElementById('movie_player') || doc.querySelector('.html5-video-player');
  if (!p) throw Object.assign(new Error('no player'), { code: 'no-player' });
  return p;
}

// Rebuilds the media pipeline at the current position, so the hooks see the
// init segment of a player that started before them.
function reload({ doc }) {
  const p = player(doc);
  const id = p.getVideoData?.()?.video_id;
  if (typeof p.loadVideoById !== 'function' || !id) throw Object.assign(new Error('no player api'), { code: 'no-player-api' });
  const at = Number(p.getCurrentTime?.()) || 0;
  p.loadVideoById(id, at);
  return { videoId: id, at };
}

function captionTracks(p) {
  try {
    p.loadModule?.('captions');
  } catch {}
  try {
    const list = p.getOption?.('captions', 'tracklist');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

// The track on screen, else the video's default caption track, else auto
// captions, else the first one.
function pickTrack(p, tracks) {
  const same = (a, b) => a && b && a.languageCode === b.languageCode && (a.kind || '') === (b.kind || '');
  let cur = null;
  try {
    cur = p.getOption?.('captions', 'track');
  } catch {}
  if (cur?.languageCode) return tracks.find((t) => same(t, cur)) || cur;
  const r = p.getPlayerResponse?.()?.captions?.playerCaptionsTracklistRenderer;
  const idx = r?.audioTracks?.[r.defaultAudioTrackIndex ?? 0]?.defaultCaptionTrackIndex;
  const def = Number.isInteger(idx) ? r.captionTracks?.[idx] : null;
  return tracks.find((t) => same(t, def)) || tracks.find((t) => t.kind === 'asr') || tracks[0] || null;
}

// Gets the player to fetch a caption track itself; each way is tried in turn
// until a timedtext response turns up. Reports which way worked. Captions
// stay on afterwards (the player may remember that for the user).
async function captionsOn({ doc, waitSubtitle, waitMs = 4000 }) {
  const p = player(doc);
  const on = () => !!p.isSubtitlesOn?.();
  const turnOn = () => {
    if (typeof p.toggleSubtitlesOn === 'function') p.toggleSubtitlesOn();
    else if (typeof p.toggleSubtitles === 'function') p.toggleSubtitles();
    else return false;
    return true;
  };
  const tried = [];
  const ways = [
    ['api-toggle', () => !on() && turnOn()],
    [
      'api-track',
      () => {
        const track = pickTrack(p, captionTracks(p));
        if (!track || typeof p.setOption !== 'function') return false;
        p.setOption('captions', 'track', track);
        return true;
      },
    ],
    // Already on with the response cached: off and on again makes the player fetch.
    ['api-retoggle', () => on() && typeof p.toggleSubtitles === 'function' && (p.toggleSubtitles(), turnOn())],
    [
      'button',
      () => {
        const b = doc.querySelector('.ytp-subtitles-button');
        if (!b || b.getAttribute('aria-pressed') === 'true') return false;
        b.click();
        return true;
      },
    ],
  ];
  for (const [name, run] of ways) {
    let ran = false;
    try {
      ran = !!run();
    } catch {}
    tried.push(`${name}:${ran ? 'ran' : 'skipped'}`);
    if (ran && (await waitSubtitle(waitMs))) return { method: name, tried, on: on() };
  }
  return { method: null, tried, on: on() };
}

export const youtube = {
  name: 'youtube',
  test: isHost,
  mediaId,
  isSubtitleRequest,
  subtitleInfo,
  watchNavigation,
  hideSiteCaptions,
  controlsTop,
  mainActions: { 'yt-reload': reload, 'yt-captions-on': captionsOn },
};
