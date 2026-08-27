// Renderer-writable electron-store surface, enforced in the generic store IPC
// (every window shares that bridge). Without this, a compromised renderer
// could write ANY key — including 'privacyMode', the gate the translation
// facade and the key vault re-read per request. Mode changes go through
// privacy:setMode only, which validates the value.
//
// Adding a renderer-persisted key? Extend the matching predicate here and
// mirror it in tests/unit/store-allowlist.test.js. Rejections are loud
// (logged + failed result) precisely so a forgotten entry surfaces in dev
// instead of becoming a silently dead settings control.

function isReadableKey(key) {
  return typeof key === 'string' && (
    key === 'settings' || key.startsWith('settings.') ||
    key === 'onboarding'
  );
}

function isWritableKey(key) {
  return typeof key === 'string' && (
    key.startsWith('settings.') ||
    key === 'onboarding'
  );
}

// 'settings' whole-key and 'floatingWindowLocal.opacity': the full settings
// reset. The opacity override itself is written by the floating window's own
// dedicated channel, never through the generic bridge.
function isDeletableKey(key) {
  return typeof key === 'string' && (
    key === 'settings' || key.startsWith('settings.') ||
    key === 'onboarding' ||
    key === 'floatingWindowLocal.opacity'
  );
}

module.exports = { isReadableKey, isWritableKey, isDeletableKey };
