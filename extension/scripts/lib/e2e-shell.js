// The shell the extension's real-browser scripts share (after e2e-auto.js):
// the real companion server and listen engine in a sandbox Electron, the
// built extension in Chrome with a throwaway profile, paired through its
// options page; helpers that read the worker through the extension's own
// messages, wait, screenshot pages and collect exceptions.
/* eslint-disable no-console */

const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { REPO, arg, has, sleep, sandbox, fakeStore } = require('../../../scripts/lib/electron-smoke');
const { fakeWindow } = require('../../../scripts/lib/listen-sandbox');
const { linkPacks } = require('./speech');
const { findBrowser, launchBrowser, loadExtension } = require('./browser');

async function until(fn, ms, every = 250) {
  for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(every)) {
    const v = await fn().catch(() => null);
    if (v) return v;
  }
  return null;
}

// The listen worker's session logs in the sandbox (one file per worker
// started, the newest three kept): [{ file, records }].
function workerLogs(boxDir) {
  const dir = path.join(boxDir, 'logs');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.startsWith('audio-probe-') && f.endsWith('.jsonl'))
    .sort()
    .map((file) => ({ file, records: fs.readFileSync(path.join(dir, file), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) }));
}

// The channel's logger: warnings and errors printed, the ASR session routes
// kept as { at, route, status, ms } (the server logs each when it answers).
function channelLogger() {
  const routes = [];
  const logger = {
    info: () => {},
    warn: (m) => console.log('  [warn]', m),
    error: (m) => console.log('  [error]', m),
    debug: (m) => {
      const r = /^companion (\w+ \/v1\/asr\/\w+) -> (\d+) \((\d+) ms\)$/.exec(String(m));
      if (r) routes.push({ at: Date.now(), route: r[1], status: Number(r[2]), ms: Number(r[3]) });
    },
  };
  return { logger, routes };
}

// The sandbox (with the listen packs linked in), its screenshot folder and
// the real companion server and engine; Firefox's shell uses it too.
async function startCompanion({ name, step, version, packsDir, browserExe }) {
  const box = sandbox(name);
  const shotsDir = path.resolve(arg('--out') || path.join(box.dir, 'shots'));
  fs.mkdirSync(shotsDir, { recursive: true });
  linkPacks(packsDir, path.join(process.env.TT_MODELS_ROOT, 'asr-models'));
  console.log(`sandbox: ${box.dir}\nbrowser: ${browserExe}${has('--headed') ? ' (window)' : ' (headless)'}\nscreenshots: ${shotsDir}\n`);

  const engineManager = require('../../../electron/listen/audio-engine-manager');
  const { initCompanion } = require('../../../electron/companion');
  const store = fakeStore({ 'settings.companion.enabled': true });
  engineManager.init({ store, getWindow: () => fakeWindow({}) });
  const translateStream = async (text, _o, onChunk) => {
    onChunk(`[译] ${text}`);
    return { success: true, text: `[译] ${text}` };
  };
  engineManager.configureTranslation({ translateStream });
  const { logger, routes } = channelLogger();
  const companion = initCompanion({ store, engineManager, translateStream, logger, version: version, getPrivacyMode: () => 'standard' });
  await companion.ready();
  step('companion channel up', companion.status().running === true, `port ${companion.status().port}`);
  return { box, shotsDir, companion, engineManager, routes };
}

// Resolves the shell, or null (usage printed) without --packs / a browser.
// extraHosts: host permissions for this build only (build.mjs).
async function startShell({ name, step, version, shotPrefix, extraHosts = [] }) {
  const packsDir = arg('--packs');
  const exe = findBrowser(arg('--browser'));
  if (!packsDir || !fs.existsSync(packsDir) || !exe) {
    console.error('usage: --packs <dir with asr-base-sense-voice/ etc.> [--browser <chrome.exe>] [--out <dir>] [--headed]');
    return null;
  }
  const { box, shotsDir, companion, engineManager, routes } = await startCompanion({ name, step, version, packsDir, browserExe: exe });

  const { build } = await import(pathToFileURL(path.join(REPO, 'extension/scripts/build.mjs')).href);
  const { outDir } = await build({ outDir: path.join(box.dir, 'dist'), logLevel: 'silent', extraHosts });

  const browser = await launchBrowser({ exe, profile: path.join(box.dir, 'profile'), lang: arg('--lang') || 'en-US', headless: !has('--headed'), args: ['--window-size=1280,900'] });
  const { cdp, attach, evaluate, open } = browser;
  console.log(`browser pid ${browser.child.pid}`);
  const shell = { box, shotsDir, companion, engineManager, routes, workerLogs: () => workerLogs(box.dir), browser, cdp, evaluate, open, pages: new Set(), shots: [], extProblems: [], extConsole: [], pageExceptions: { ours: [], site: 0 } };

  cdp.listen((m) => {
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      const where = `${d.url || ''} ${d.stackTrace?.callFrames?.map((f) => f.url).join(' ') || ''}`;
      const text = d.exception?.description || d.text;
      if (where.includes('chrome-extension://') || /content-(main|isolated)/.test(where)) (shell.pages.has(m.sessionId) ? shell.pageExceptions.ours : shell.extProblems).push(text);
      else if (shell.pages.has(m.sessionId)) shell.pageExceptions.site++;
      else shell.extProblems.push(text);
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error' && !shell.pages.has(m.sessionId)) shell.extProblems.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
    // warn / debug lines of the worker and the offscreen document, with when they came
    if (m.method === 'Runtime.consoleAPICalled' && ['warning', 'debug'].includes(m.params.type) && !shell.pages.has(m.sessionId)) shell.extConsole.push({ at: Date.now(), text: m.params.args.map((a) => a.value ?? a.description).join(' ') });
  });

  const { id, sw } = await loadExtension(browser, outDir);
  await attach(sw.targetId);
  step('extension loaded', true, id);
  const { sessionId: opt, targetId: optTarget } = await open(`chrome-extension://${id}/options.html`);
  await sleep(500);
  companion.openPairing();
  const paired = await evaluate(opt, `chrome.runtime.sendMessage({ type: 'companion/pair' })`);
  step('paired through the extension', paired?.ok && paired.result.status === 'ready', paired?.result?.status || JSON.stringify(paired?.error));

  // The offscreen document's console too (its warnings say why a session went the way it did).
  const offscreenTarget = (await cdp.send('Target.getTargets')).targetInfos.find((t) => t.url === `chrome-extension://${id}/offscreen.html`);
  if (offscreenTarget) shell.offscreen = await attach(offscreenTarget.targetId);
  const ext = (type, payload) => evaluate(opt, `chrome.runtime.sendMessage(${JSON.stringify({ type, payload })})`);
  Object.assign(shell, {
    extId: id,
    opt,
    optTarget,
    ext,
    until,
    evidence: async (tabId) => (await ext('tab/evidence', { tabId }))?.result,
    state: async (tabId) => (await ext('tab/state', { tabId }))?.result,
    query: async (tabId) => (await ext('tab/command', { tabId, command: { cmd: 'query' } }))?.result,
    tabIdOf: (prefix) => evaluate(opt, `chrome.tabs.query({}).then((ts) => ts.find((t) => (t.url || t.pendingUrl || '').startsWith(${JSON.stringify(prefix)}))?.id ?? null)`),
    badge: (tabId) => evaluate(opt, `Promise.all([chrome.action.getBadgeText({ tabId: ${tabId} }), chrome.action.getTitle({ tabId: ${tabId} })])`),
    setPrefs: (prefs) => evaluate(opt, `chrome.storage.local.set({ prefs: ${JSON.stringify(prefs)} }).then(() => true)`),
    getPrefs: () => evaluate(opt, `chrome.storage.local.get('prefs').then((r) => r.prefs ?? null)`),
    async stateIs(tabId, want, ms) {
      return until(async () => {
        const s = await shell.state(tabId);
        return s && s.state === want ? s : null;
      }, ms);
    },
    async shoot(session, name, clip) {
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) }, session);
      const file = path.join(shotsDir, `${shotPrefix}-${name}.png`);
      fs.writeFileSync(file, Buffer.from(data, 'base64'));
      shell.shots.push(file);
      return file;
    },
    trackInfo: (session) =>
      evaluate(session, `(() => { const v = document.querySelector('video'); if (!v) return null; const t = Array.from(v.textTracks).find((x) => x.label === 'T-Caption'); return { t: v.currentTime, paused: v.paused, cues: t ? t.cues.length : 0, active: t ? Array.from(t.activeCues || []).map((c) => c.text) : [] }; })()`),
    // What the worker knows about a tab, for a failed step.
    async dump(tabId) {
      const s = await shell.state(tabId);
      const ev = await shell.evidence(tabId);
      const hist = (s?.history || []).map((h) => `${new Date(h.at).toISOString().slice(11, 23)} ${h.state}${h.detail ? ' ' + JSON.stringify(h.detail) : ''}`).join(' | ');
      const streams = (ev?.mse?.streams || []).map((x) => `${x.streamId}:${x.kind}/${x.codec || '?'}${x.alive ? '' : '†'} ${x.chunks}ch`).join(', ');
      const m = ev?.media?.find((x) => x.elId === ev.primaryElId);
      console.log(`  [dump tab ${tabId}] state ${s?.state} block ${s?.block} run ${JSON.stringify(s?.run)}\n    history: ${hist}\n    media: ${m ? `${m.state} t=${m.currentTime} dur=${m.duration} muted=${m.muted} vis=${m.pageVisible}` : 'none'}; streams: ${streams}\n    hooks: ${JSON.stringify(ev?.hooks)} eme: ${JSON.stringify(ev?.eme)} subtitles: ${JSON.stringify((ev?.subtitles || []).map((x) => x.cueCount))}`);
    },
    async close() {
      const how = await browser.close();
      step('browser closed', true, `pid ${browser.child.pid} via ${how}`);
      await companion.stop();
      await engineManager.stopSessionAndWait?.(version);
      console.log(`  sandbox left for the recycle bin: ${box.dir}`);
    },
  });
  return shell;
}

module.exports = { startShell, startCompanion, until, workerLogs, channelLogger };
