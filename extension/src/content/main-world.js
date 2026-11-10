// Page (MAIN) world at document_start, before the site's scripts: subtitle
// responses, MSE audio appends and EME use are reported to the isolated
// world over the port its hello brings. No chrome.* here, nothing on window.

import { installPageHooks } from './hooks/install.js';

try {
  installPageHooks(window);
} catch {}
