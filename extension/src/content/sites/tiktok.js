// TikTok: media id from a video page's URL, else from the player wrapper
// around the playing video (the feed swaps videos under one URL, so feed:
// another id there is another page). The player prefetches WebVTT files for
// the next videos too, so a subtitle file counts only once item data (the
// feed's item lists, the video page's own data) says whose it is; others
// are strays. SPA navigation through history; hiding the caption layer.

const VIDEO = /^\/@[^/]+\/video\/(\d{6,25})(?:[/?#]|$)/;
const WRAPPER = /^xgwrapper-\d+-(\d{6,25})$/;
const ITEM_ID = /^\d{6,25}$/;
const ITEM_API = /^\/api\/(?:[\w-]+\/)*(?:item_list|item\/detail)\/?$/;
// Subtitle files: …/video/tos/<region>/<bucket>/<32 hex>/ (video files are o… ids).
const FILE = /\/video\/tos\/(?:[^/]+\/)+([0-9a-f]{32})\/?$/;
const MAX_FILES = 1000;
const PAGE_DATA = ['__UNIVERSAL_DATA_FOR_REHYDRATION__', 'SIGI_STATE'];
// ISO 639-2/3 codes the item data uses, to the two-letter ones.
const LANGS = { eng: 'en', cmn: 'zh', zho: 'zh', chi: 'zh', jpn: 'ja', kor: 'ko', spa: 'es', fra: 'fr', fre: 'fr', deu: 'de', ger: 'de', por: 'pt', rus: 'ru', ara: 'ar', hin: 'hi', ind: 'id', vie: 'vi', tha: 'th', tur: 'tr', ita: 'it', urd: 'ur', ben: 'bn', msa: 'ms', may: 'ms', nld: 'nl', dut: 'nl', pol: 'pl', ukr: 'uk', heb: 'he', fas: 'fa', per: 'fa', ron: 'ro', rum: 'ro', ell: 'el', gre: 'el', swe: 'sv', ces: 'cs', cze: 'cs' };

const isHost = (host) => host === 'tiktok.com' || host.endsWith('.tiktok.com');
const isCdn = (host) => isHost(host) || /(?:^|\.)tiktokcdn(?:-[a-z]+)?\.com$/.test(host);
const parse = (href) => {
  try {
    return new URL(href);
  } catch {
    return null;
  }
};

function mediaId(href, media) {
  const u = parse(href);
  if (!u || !isHost(u.hostname)) return null;
  const id = VIDEO.exec(u.pathname)?.[1];
  if (id) return id;
  const wrap = media?.closest?.('[id^="xgwrapper-"]');
  return WRAPPER.exec(wrap?.id || '')?.[1] ?? null;
}

const fileOf = (u) => (u && isCdn(u.hostname) ? (FILE.exec(u.pathname)?.[1] ?? null) : null);
const isItemApi = (u) => !!u && isHost(u.hostname) && ITEM_API.test(u.pathname);

function isSubtitleRequest(href) {
  const u = parse(href);
  return isItemApi(u) || !!fileOf(u);
}

// subtitle file id → { mediaId, lang, kind }, newest last
const files = new Map();

function normLang(code) {
  const [p, ...rest] = String(code || '').split('-');
  const two = LANGS[p.toLowerCase()];
  return two ? [two, ...rest].join('-') : String(code || '');
}

function note(url, item, info) {
  const id = fileOf(parse(url));
  if (!id) return;
  files.delete(id);
  files.set(id, { mediaId: item, lang: normLang(info.lang), kind: info.asr ? 'asr' : '' });
  if (files.size > MAX_FILES) files.delete(files.keys().next().value);
}

// Every item in the data (item lists, item detail, the page's own data):
// its subtitle and caption files.
function walk(node, depth) {
  if (!node || typeof node !== 'object' || depth > 12) return;
  if (Array.isArray(node)) {
    for (const x of node) walk(x, depth + 1);
    return;
  }
  const v = node.video;
  if (typeof node.id === 'string' && ITEM_ID.test(node.id) && v && typeof v === 'object') {
    // Caption infos first: subtitle infos (they say ASR) win for a file both list.
    for (const c of Array.isArray(v.claInfo?.captionInfos) ? v.claInfo.captionInfos : []) {
      if (!c) continue;
      for (const url of [c.url, ...(Array.isArray(c.urlList) ? c.urlList : [])]) if (typeof url === 'string') note(url, node.id, { lang: c.language, asr: false });
    }
    for (const s of Array.isArray(v.subtitleInfos) ? v.subtitleInfos : []) {
      if (s && typeof s.Url === 'string') note(s.Url, node.id, { lang: s.LanguageCodeName, asr: s.Source === 'ASR' });
    }
  }
  for (const k of Object.keys(node)) if (k !== 'video') walk(node[k], depth + 1);
}

function readCatalog(text) {
  let data;
  try {
    data = typeof text === 'string' ? JSON.parse(text) : text;
  } catch {
    return;
  }
  walk(data, 0);
}

// The video page's own data (server-rendered, so no item request for it).
function readPage(doc) {
  for (const id of PAGE_DATA) {
    const el = doc?.getElementById?.(id);
    if (el?.textContent) readCatalog(el.textContent);
  }
}

// Item requests are read for whose each subtitle file is; a file no item
// claims (yet) is a stray, never put on the playing video.
function subtitleInfo(href) {
  const u = parse(href);
  if (isItemApi(u)) return { catalog: true };
  const id = fileOf(u);
  if (!id) return {};
  const f = files.get(id);
  return f ? { lang: f.lang, kind: f.kind, mediaId: f.mediaId } : { stray: true };
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
    style.textContent = '[class*="DivCaptionContainer"] { display: none !important; }';
    (doc.head || doc.documentElement).append(style);
    hideStyles.set(doc, style);
  } else if (!on && style) {
    style.remove();
    hideStyles.delete(doc);
  }
  return on;
}

export const tiktok = {
  name: 'tiktok',
  test: isHost,
  feed: true,
  mediaId,
  isSubtitleRequest,
  subtitleInfo,
  readCatalog,
  readPage,
  watchNavigation,
  hideSiteCaptions,
  mainActions: {},
};
