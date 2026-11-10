// Any other site: the media id is the page URL plus the media's duration,
// navigation is history traversal plus same-document navigations (the
// Navigation API sees pushState without patching the page), and only the
// shared subtitle rules apply.

function fnv1a(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(36);
}

function mediaId(href, media) {
  let page;
  try {
    const u = new URL(href);
    u.hash = '';
    page = u.href;
  } catch {
    return null;
  }
  const d = media && Number.isFinite(media.duration) ? Math.round(media.duration) : 0;
  return `${fnv1a(page)}-${d}`;
}

function watchNavigation({ win }, fn) {
  win.addEventListener('popstate', fn);
  win.navigation?.addEventListener('currententrychange', fn);
  return () => {
    win.removeEventListener('popstate', fn);
    win.navigation?.removeEventListener('currententrychange', fn);
  };
}

export const generic = {
  name: 'generic',
  test: () => true,
  mediaId,
  isSubtitleRequest: () => false,
  subtitleInfo: () => ({}),
  watchNavigation,
  hideSiteCaptions: () => false,
  mainActions: {},
};
