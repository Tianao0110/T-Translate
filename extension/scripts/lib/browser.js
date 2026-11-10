// Chrome / Edge with a throwaway profile, driven over the DevTools pipe
// (release Chrome ignores --load-extension, so extensions go through
// Extensions.loadUnpacked). Used by make-fixture.js and e2e-pipeline.js.
/* eslint-disable no-console */

const fs = require('fs');
const { spawn } = require('child_process');

const CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findBrowser(explicit) {
  if (explicit) return explicit;
  return CANDIDATES.find((p) => fs.existsSync(p)) || null;
}

function makeCdp(sendRaw) {
  let id = 0;
  const waiters = new Map();
  const listeners = new Set();
  return {
    onText(text) {
      const m = JSON.parse(text);
      if (m.id && waiters.has(m.id)) {
        const w = waiters.get(m.id);
        waiters.delete(m.id);
        clearTimeout(w.timer);
        if (m.error) w.reject(new Error(`${w.method}: ${m.error.message}`));
        else w.resolve(m.result);
      } else {
        for (const fn of listeners) fn(m);
      }
    },
    // A call the browser never answers (a page promise that never settles)
    // rejects after timeoutMs instead of hanging the script.
    send(method, params = {}, sessionId, { timeoutMs = 120000 } = {}) {
      return new Promise((resolve, reject) => {
        const i = ++id;
        const timer = setTimeout(() => {
          if (!waiters.delete(i)) return;
          reject(new Error(`${method}: no reply in ${timeoutMs} ms`));
        }, timeoutMs);
        timer.unref?.();
        waiters.set(i, { resolve, reject, method, timer });
        sendRaw(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }));
      });
    },
    listen(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

// Resolves { child, cdp, attach, evaluate, open, close }. headless: false
// opens a real window (some sites refuse headless browsers); still driven
// only over the pipe.
async function launchBrowser({ exe, profile, lang = 'en-US', args = [], headless = true }) {
  const argv = [
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-default-apps',
    '--disable-sync',
    `--lang=${lang}`,
    ...(headless ? ['--headless=new'] : []),
    '--autoplay-policy=no-user-gesture-required',
    '--remote-debugging-pipe',
    '--enable-unsafe-extension-debugging',
    ...args,
    'about:blank',
  ];
  const child = spawn(exe, argv, { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'], windowsHide: true });
  let stderr = '';
  child.stderr.on('data', (b) => {
    stderr += b;
  });
  const out = child.stdio[3];
  const inp = child.stdio[4];
  const cdp = makeCdp((t) => out.write(`${t}\0`));
  let buf = '';
  inp.on('data', (b) => {
    buf += b.toString('utf8');
    let at;
    while ((at = buf.indexOf('\0')) > -1) {
      const msg = buf.slice(0, at);
      buf = buf.slice(at + 1);
      cdp.onText(msg);
    }
  });
  await Promise.race([
    cdp.send('Browser.getVersion'),
    sleep(15000).then(() => {
      throw new Error(`browser did not answer on the pipe; stderr: ${stderr.slice(-400)}`);
    }),
  ]);

  const attach = async (targetId) => {
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Runtime.enable', {}, sessionId);
    return sessionId;
  };
  const evaluate = async (sessionId, expression, opts) => {
    const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId, opts);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const open = async (url) => {
    const { targetId } = await cdp.send('Target.createTarget', { url });
    const sessionId = await attach(targetId);
    await cdp.send('Page.enable', {}, sessionId);
    return { targetId, sessionId };
  };
  // Browser.close, then taskkill by PID if it lingers. Resolves how it ended.
  const close = async () => {
    try {
      await Promise.race([cdp.send('Browser.close'), sleep(3000)]);
    } catch {}
    const exited = await new Promise((r) => {
      if (child.exitCode !== null) return r(true);
      const t = setTimeout(() => r(false), 5000);
      child.once('exit', () => {
        clearTimeout(t);
        r(true);
      });
    });
    if (!exited) spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    return exited ? 'Browser.close' : 'taskkill';
  };
  return { child, cdp, attach, evaluate, open, close, stderr: () => stderr };
}

// The service worker target of an unpacked extension loaded from dir.
async function loadExtension(browser, dir) {
  const { id } = await browser.cdp.send('Extensions.loadUnpacked', { path: dir });
  await browser.cdp.send('Target.setDiscoverTargets', { discover: true });
  for (let i = 0; i < 80; i++) {
    const { targetInfos } = await browser.cdp.send('Target.getTargets');
    const sw = targetInfos.find((t) => t.type === 'service_worker' && t.url.startsWith(`chrome-extension://${id}/`));
    if (sw) return { id, sw };
    await sleep(150);
  }
  throw new Error(`extension ${id} has no service worker`);
}

module.exports = { findBrowser, launchBrowser, loadExtension, sleep };
