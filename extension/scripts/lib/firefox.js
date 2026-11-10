// Firefox with a throwaway profile, driven over WebDriver BiDi (Firefox has
// no CDP any more): Node's own WebSocket, no geckodriver, no web-ext.
// Extensions go in as temporary add-ons (webExtension.install), which
// release Firefox allows unsigned. The add-on's moz-extension:// UUID is
// fixed through extensions.webextensions.uuids so its pages can be opened;
// BiDi navigates to them and runs script there only with
// MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1 in Firefox's environment (set here).
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const CANDIDATES = ['C:/Program Files/Mozilla Firefox/firefox.exe', 'C:/Program Files (x86)/Mozilla Firefox/firefox.exe'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findFirefox(explicit) {
  if (explicit) return explicit;
  return CANDIDATES.find((p) => fs.existsSync(p)) || null;
}

// What automation needs from a fresh profile (first-run pages, telemetry,
// updates, autoplay), plus the caller's.
const BASE_PREFS = {
  'browser.shell.checkDefaultBrowser': false,
  'browser.startup.homepage_override.mstone': 'ignore',
  'browser.startup.page': 0,
  'browser.aboutwelcome.enabled': false,
  'browser.newtabpage.enabled': false,
  'datareporting.policy.dataSubmissionEnabled': false,
  'toolkit.telemetry.reportingpolicy.firstRun': false,
  'app.update.disabledForTesting': true,
  'media.autoplay.default': 0,
  'media.autoplay.blocking_policy': 0,
  'extensions.autoDisableScopes': 0,
  'extensions.enabledScopes': 5,
};

function writePrefs(profile, prefs) {
  fs.mkdirSync(profile, { recursive: true });
  const lines = Object.entries({ ...BASE_PREFS, ...prefs }).map(([k, v]) => `user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`);
  fs.writeFileSync(path.join(profile, 'user.js'), `${lines.join('\n')}\n`);
}

function makeBidi(ws) {
  let id = 0;
  const waiters = new Map();
  const listeners = new Set();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(String(ev.data));
    if (m.id && waiters.has(m.id)) {
      const w = waiters.get(m.id);
      waiters.delete(m.id);
      clearTimeout(w.timer);
      if (m.type === 'error') w.reject(new Error(`${w.method}: ${m.error} ${m.message || ''}`.trim()));
      else w.resolve(m.result);
    } else if (m.type === 'event') {
      for (const fn of listeners) fn(m);
    }
  });
  return {
    // A command the browser never answers rejects after timeoutMs.
    send(method, params = {}, { timeoutMs = 120000 } = {}) {
      return new Promise((resolve, reject) => {
        const i = ++id;
        const timer = setTimeout(() => {
          if (waiters.delete(i)) reject(new Error(`${method}: no reply in ${timeoutMs} ms`));
        }, timeoutMs);
        timer.unref?.();
        waiters.set(i, { resolve, reject, method, timer });
        ws.send(JSON.stringify({ id: i, method, params }));
      });
    },
    listen(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

// The port Firefox chose: the profile's WebDriverBiDiServer.json, or its stderr line.
async function waitForPort(profile, logs, ms) {
  const file = path.join(profile, 'WebDriverBiDiServer.json');
  for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(100)) {
    const m = /WebDriver BiDi listening on ws:\/\/[^:]+:(\d+)/.exec(logs());
    if (m) return Number(m[1]);
    try {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (j.ws_port) return j.ws_port;
    } catch {}
  }
  throw new Error(`Firefox did not open its BiDi port; output: ${logs().slice(-600)}`);
}

// Resolves { child, port, bidi, version, open, navigate, evaluate, click, screenshot, installExtension, close, logs, output }.
// uuids: { [addonId]: uuid } for moz-extension:// URLs.
async function launchFirefox({ exe, profile, headless = true, prefs = {}, uuids = {}, width = 1280, height = 900 }) {
  writePrefs(profile, { ...prefs, ...(Object.keys(uuids).length && { 'extensions.webextensions.uuids': JSON.stringify(uuids) }) });
  const argv = ['--remote-debugging-port=0', '-profile', profile, '-no-remote', '-wait-for-browser', ...(headless ? ['-headless'] : [])];
  // System access lets BiDi run script in moz-extension:// pages (refused otherwise).
  const child = spawn(exe, argv, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: '1' } });
  let output = '';
  child.stdout.on('data', (b) => {
    output += b;
  });
  child.stderr.on('data', (b) => {
    output += b;
  });
  const port = await waitForPort(profile, () => output, 30000);
  const ws = new WebSocket(`ws://127.0.0.1:${port}/session`);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error(`cannot reach BiDi on port ${port}`)), { once: true });
  });
  const bidi = makeBidi(ws);
  const session = await bidi.send('session.new', { capabilities: { alwaysMatch: { acceptInsecureCerts: true, unhandledPromptBehavior: { default: 'ignore' } } } });
  // Console calls and uncaught errors of every page, content scripts' included: { at, level, type, text, context, url }.
  const logs = [];
  bidi.listen((m) => {
    if (m.method !== 'log.entryAdded') return;
    const p = m.params;
    logs.push({ at: Date.now(), level: p.level, type: p.type, text: p.text, context: p.source?.context, url: p.stackTrace?.callFrames?.[0]?.url || '' });
  });
  await bidi.send('session.subscribe', { events: ['log.entryAdded'] });

  // The page's value, JSON-round-tripped (a promise is awaited). userActivation: as if just clicked.
  const evaluate = async (context, expression, { sandbox, timeoutMs, userActivation = false } = {}) => {
    const wrapped = `(async () => { const v = await (${expression}); return JSON.stringify(v === undefined ? null : v); })()`;
    const r = await bidi.send('script.evaluate', { expression: wrapped, target: { context, ...(sandbox && { sandbox }) }, awaitPromise: true, resultOwnership: 'none', userActivation }, { timeoutMs });
    if (r.type === 'exception') throw new Error(r.exceptionDetails?.text || JSON.stringify(r.exceptionDetails));
    return JSON.parse(r.result.value);
  };
  const navigate = (context, url, wait = 'complete') => bidi.send('browsingContext.navigate', { context, url, wait });
  const open = async (url, { wait = 'complete' } = {}) => {
    const { context } = await bidi.send('browsingContext.create', { type: 'tab' });
    await bidi.send('browsingContext.setViewport', { context, viewport: { width, height } });
    if (url) await navigate(context, url, wait);
    return context;
  };
  // A trusted click in the page (input.performActions: the page's own input, nothing global).
  const click = (context, x, y) =>
    bidi.send('input.performActions', {
      context,
      actions: [{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: [{ type: 'pointerMove', x: Math.round(x), y: Math.round(y) }, { type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 }] }],
    });
  const screenshot = async (context, file, clip) => {
    const { data } = await bidi.send('browsingContext.captureScreenshot', { context, ...(clip && { clip: { type: 'box', ...clip } }) });
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    return file;
  };
  // A temporary add-on from an unpacked directory; resolves its id.
  const installExtension = async (dir) => (await bidi.send('webExtension.install', { extensionData: { type: 'path', path: dir } })).extension;
  // browser.close, then taskkill by PID if it lingers. Resolves how it ended.
  const close = async () => {
    try {
      await Promise.race([bidi.send('browser.close'), sleep(3000)]);
    } catch {}
    const exited = await new Promise((r) => {
      if (child.exitCode !== null) return r(true);
      const t = setTimeout(() => r(false), 8000);
      child.once('exit', () => {
        clearTimeout(t);
        r(true);
      });
    });
    if (!exited) spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    try {
      ws.close();
    } catch {}
    return exited ? 'browser.close' : 'taskkill';
  };
  return { child, port, bidi, version: session.capabilities?.browserVersion, open, navigate, evaluate, click, screenshot, installExtension, close, logs, output: () => output };
}

module.exports = { findFirefox, launchFirefox, sleep };
