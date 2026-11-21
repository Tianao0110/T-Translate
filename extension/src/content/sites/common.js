// What the site adapters share: a URL or null, and SPA navigation through
// history plus same-document navigations (the Navigation API's
// currententrychange). YouTube has its own navigation event.

export const parse = (href) => {
  try {
    return new URL(href);
  } catch {
    return null;
  }
};

export function watchNavigation({ win }, fn) {
  win.addEventListener('popstate', fn);
  win.navigation?.addEventListener('currententrychange', fn);
  return () => {
    win.removeEventListener('popstate', fn);
    win.navigation?.removeEventListener('currententrychange', fn);
  };
}
