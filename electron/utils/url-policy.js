// URL policy for renderer navigation and window.open.
//
// Two escalation paths this closes:
//   - Navigation: our preload stays attached across navigations and exposes
//     secureStorage.decrypt, so a renderer talked into loading an attacker
//     page would hand that page the API-key bridge. Only our own pages may
//     be navigated to.
//   - window.open: an ungated shell.openExternal turns any injected
//     window.open into "ask the OS to run this" — file:// to an exe, a UNC
//     path, or a registered handler like ms-msdt:. Only http/https go out,
//     matching the allow-list on the open-external IPC handler.
//
// Pure functions with explicit params (no electron require) so they stay
// testable — same reason crash-guard and open-with are shaped this way.

const EXTERNAL_OPEN_PROTOCOLS = new Set(['http:', 'https:']);

// Our own pages: file:// in a packaged build, the dev server in development.
function isInternalUrl(url, isDev = false) {
  if (typeof url !== 'string' || !url) return false;
  try {
    const u = new URL(url);
    if (u.protocol === 'file:') return true;
    if (isDev && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) return true;
    return false;
  } catch {
    return false;
  }
}

// True only for URLs safe to hand to shell.openExternal.
function mayOpenExternally(url) {
  if (typeof url !== 'string' || !url) return false;
  try {
    return EXTERNAL_OPEN_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

module.exports = { isInternalUrl, mayOpenExternally, EXTERNAL_OPEN_PROTOCOLS };
