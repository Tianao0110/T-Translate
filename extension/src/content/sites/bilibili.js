// Bilibili: media id from the URL (BV / av with its part, bangumi ep / ss),
// subtitle bodies on hdslb.com and the player API's subtitle list (the page
// agent fetches the body the list points at), SPA navigation through
// history (part switches use pushState) and hiding the player's subtitle
// layer. Live rooms are left to the generic adapter.

// Paths may start with a locale (/zh-Hans/video/…, seen outside mainland China).
const LOCALE = '(?:/[a-z]{2}(?:-[A-Za-z]{2,4})?)?';
const BV = new RegExp(`^${LOCALE}/video/(BV[0-9A-Za-z]{10})(?:[/?#]|$)`);
const AV = new RegExp(`^${LOCALE}/video/av(\\d+)(?:[/?#]|$)`, 'i');
const BANGUMI = new RegExp(`^${LOCALE}/bangumi/play/((?:ep|ss)\\d+)(?:[/?#]|$)`, 'i');
const SUBTITLE_PATH = /\/bfs\/(?:ai_)?subtitle\//;
const LIST_PATHS = new Set(['/x/player/wbi/v2', '/x/player/v2']);

const isHost = (host) => (host === 'bilibili.com' || host.endsWith('.bilibili.com')) && host !== 'live.bilibili.com';
const parse = (href) => {
  try {
    return new URL(href);
  } catch {
    return null;
  }
};

// The part number when it is past the first.
function partOf(u) {
  const p = Number(u.searchParams.get('p'));
  return Number.isSafeInteger(p) && p > 1 ? `:p${p}` : '';
}

function mediaId(href) {
  const u = parse(href);
  if (!u || !isHost(u.hostname)) return null;
  const bv = BV.exec(u.pathname)?.[1];
  if (bv) return bv + partOf(u);
  const av = AV.exec(u.pathname)?.[1];
  if (av) return `av${av}${partOf(u)}`;
  return BANGUMI.exec(u.pathname)?.[1].toLowerCase() ?? null;
}

const isBody = (u) => u.hostname.endsWith('hdslb.com') && SUBTITLE_PATH.test(u.pathname);
const isList = (u) => u.hostname === 'api.bilibili.com' && LIST_PATHS.has(u.pathname);

function isSubtitleRequest(href) {
  const u = parse(href);
  return !!u && (isBody(u) || isList(u));
}

// A body belongs to whatever the page plays now (mediaId null); a list is
// read for the body's URL instead of being parsed as captions.
function subtitleInfo(href) {
  const u = parse(href);
  if (!u) return {};
  if (isList(u)) return { list: true };
  if (isBody(u)) return { lang: '', kind: u.pathname.includes('/ai_subtitle/') ? 'asr' : '', mediaId: null };
  return {};
}

// The player API's subtitle list: [{ lang, url, ai }], [] for anything unreadable.
function listSubtitles(text) {
  let data;
  try {
    data = typeof text === 'string' ? JSON.parse(text) : text;
  } catch {
    return [];
  }
  const list = data?.data?.subtitle?.subtitles;
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const s of list) {
    if (!s || typeof s.subtitle_url !== 'string' || !s.subtitle_url) continue;
    const lang = typeof s.lan === 'string' ? s.lan : '';
    const url = s.subtitle_url.startsWith('//') ? `https:${s.subtitle_url}` : s.subtitle_url;
    out.push({ lang, url, ai: lang.startsWith('ai-') || Number(s.ai_type) > 0 });
  }
  return out;
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
    style.textContent = '.bpx-player-subtitle-wrap, .bilibili-player-video-subtitle { display: none !important; }';
    (doc.head || doc.documentElement).append(style);
    hideStyles.set(doc, style);
  } else if (!on && style) {
    style.remove();
    hideStyles.delete(doc);
  }
  return on;
}

export const bilibili = {
  name: 'bilibili',
  test: isHost,
  mediaId,
  isSubtitleRequest,
  subtitleInfo,
  listSubtitles,
  watchNavigation,
  hideSiteCaptions,
  mainActions: {},
};
