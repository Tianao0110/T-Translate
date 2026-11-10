/* global __TC_VERSION__ */
// The app version, stamped in by the build: the offscreen document's
// chrome.runtime has no getManifest().
export const VERSION = typeof __TC_VERSION__ === 'string' ? __TC_VERSION__ : '0.0.0';
