// Page world: Encrypted Media Extensions, reported and never blocked. A key
// system request, a setMediaKeys call with keys or an 'encrypted' event means
// the site's media is (or is about to be) DRM-protected. setMediaKeys(null)
// only clears keys (Bilibili's player calls it on plain videos) and is not
// reported.

import { hookMethod, tryHook } from './patch.js';

export function installEmeHooks(win, { emit }) {
  const eme = tryHook(() => {
    const requested = hookMethod(
      win.Navigator?.prototype,
      'requestMediaKeySystemAccess',
      () => {},
      { before: (_self, args) => emit({ k: 'eme', via: 'request', keySystem: String(args[0] ?? '').slice(0, 128) }) }
    );
    hookMethod(win.HTMLMediaElement?.prototype, 'setMediaKeys', () => {}, {
      before: (_self, args) => {
        if (args[0]) emit({ k: 'eme', via: 'setMediaKeys', on: true });
      },
    });
    // Media events do not bubble; a capture listener on the document still sees them.
    win.document?.addEventListener(
      'encrypted',
      (e) => {
        try {
          emit({ k: 'eme', via: 'encrypted', initDataType: String(e.initDataType ?? '').slice(0, 32) });
        } catch {}
      },
      true
    );
    return requested;
  });
  return { eme };
}
