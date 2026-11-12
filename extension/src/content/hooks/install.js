// Page world wiring: the site adapter's subtitle rule, the three hook sets
// and its own (installMain), the outbox and the hello listener; commands run
// the adapter's page-world actions. Leaves no global behind.

import { installNetHooks } from './net.js';
import { installMseHooks } from './mse.js';
import { installEmeHooks } from './eme.js';
import { createOutbox, acceptHello } from './outbox.js';
import { siteFor } from '../sites/index.js';

export function installPageHooks(win, { site = siteFor(win.location?.hostname), limits } = {}) {
  const outbox = createOutbox(limits ? { limits } : {});
  const waiting = new Set();

  // Subtitle captures also wake actions waiting for the player to fetch one.
  const emit = (ev) => {
    outbox.push(ev);
    if (ev.k === 'subtitle') for (const w of waiting) w();
  };
  const waitSubtitle = (ms) =>
    new Promise((resolve) => {
      const done = (ok) => {
        waiting.delete(hit);
        clearTimeout(timer);
        resolve(ok);
      };
      const hit = () => done(true);
      const timer = setTimeout(() => done(false), ms);
      waiting.add(hit);
    });

  const status = {
    ...installNetHooks(win, { isSubtitle: (url, type) => site.isSubtitleRequest(url, type), emit }),
    ...installMseHooks(win, { emit }),
    ...installEmeHooks(win, { emit }),
  };
  site.installMain?.(win, { emit });
  emit({ k: 'hooks', status });

  acceptHello(win, outbox, (cmd, args) => {
    const action = Object.hasOwn(site.mainActions, cmd) ? site.mainActions[cmd] : null;
    if (!action) throw Object.assign(new Error(cmd), { code: 'unknown-command' });
    return action({ ...(args && typeof args === 'object' ? args : {}), doc: win.document, win, waitSubtitle });
  });

  return { outbox, status };
}
