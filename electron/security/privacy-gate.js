// The one definition of "offline mode is on" for the main process. The store
// is a parameter for callers that already hold one; the rest get the app's.

const { PRIVACY_MODES } = require('../shared/channels');

function isOfflineMode(store) {
  const s = store || require('../state').store;
  return s.get('privacyMode', PRIVACY_MODES.STANDARD) === PRIVACY_MODES.OFFLINE;
}

module.exports = { isOfflineMode, };
