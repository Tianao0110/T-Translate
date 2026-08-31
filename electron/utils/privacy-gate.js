// One definition of "offline mode is on" for the main process.
//
// The predicate had grown three copies (updater IPC, audio pack manager, and
// the OCR gap this file closes), and a promise as absolute as "offline mode
// never touches the network" cannot be spelled out per call site — the third
// copy is where it becomes a shared structure.
//
// The store is a parameter so callers that already hold one (ctx.store) pass
// it; everyone else gets the app-wide instance.

const { PRIVACY_MODES } = require('../shared/channels');

function isOfflineMode(store) {
  const s = store || require('../state').store;
  return s.get('privacyMode', PRIVACY_MODES.STANDARD) === PRIVACY_MODES.OFFLINE;
}

// The refusal every network-touching feature returns, so the renderer can
// tell "offline mode blocked this" apart from "the network failed".
function offlineBlockedError() {
  const err = new Error('offline-mode');
  err.code = 'OFFLINE_BLOCKED';
  return err;
}

module.exports = { isOfflineMode, offlineBlockedError };
