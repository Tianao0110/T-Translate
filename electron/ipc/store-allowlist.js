// Renderer-writable electron-store surface, enforced in the generic store IPC
// shared by every window. Mode changes go through privacy:setMode only.
// Adding a renderer-persisted key: extend the matching predicate here and
// mirror it in tests/unit/main/store-allowlist.test.js; rejections are loud
// on purpose.

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
// reset only; the opacity override has its own channel.
function isDeletableKey(key) {
  return typeof key === 'string' && (
    key === 'settings' || key.startsWith('settings.') ||
    key === 'onboarding' ||
    key === 'floatingWindowLocal.opacity'
  );
}

module.exports = { isReadableKey, isWritableKey, isDeletableKey };
