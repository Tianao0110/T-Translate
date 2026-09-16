// URL policy for renderer navigation (own pages only) and window.open
// (http / https only), applied by window-manager and the open-external IPC
// handler. Pure functions. Why: docs/design/main-process.md §5.

const EXTERNAL_OPEN_PROTOCOLS = new Set(['http:', 'https:']);

// Own pages: file:// packaged, the dev server in development.
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

// URLs safe to hand to shell.openExternal.
function mayOpenExternally(url) {
  if (typeof url !== 'string' || !url) return false;
  try {
    return EXTERNAL_OPEN_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

module.exports = { isInternalUrl, mayOpenExternally, };
