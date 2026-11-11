// The extension folder an installer ships (resources/resources/t-caption in
// win-unpacked), loaded as it is: the real companion server and listen engine
// in a sandbox Electron (lib/e2e-shell.js), that folder in Chrome with a
// throwaway profile, paired through its options page, then a real YouTube
// video until the orchestrator shows captions on its own (e2e-auto.js (a)).
//
//   npx electron extension/scripts/e2e-shipped.js --dir <win-unpacked>/resources/resources/t-caption --packs <installed asr-models dir> [--browser <exe>] [--out <screenshots dir>] [--headed] [--video <id>]
//
// Set TEMP to a folder on the packs' drive so they are hard-linked, not
// copied. The sandbox is left in place for the recycle bin.
/* eslint-disable no-console */

const path = require('path');
const fs = require('fs');
const { REPO, arg, has, sleep, checklist, run } = require('../../scripts/lib/electron-smoke');
const { startCompanion, until } = require('./lib/e2e-shell');
const { findBrowser, launchBrowser, loadExtension } = require('./lib/browser');

const { step, summary } = checklist();
const VIDEO = arg('--video') || 'UF8uR6Z6KLc';
const VERSION = 'e2e-shipped';

async function main() {
  const dir = arg('--dir') && path.resolve(arg('--dir'));
  const packsDir = arg('--packs');
  const exe = findBrowser(arg('--browser'));
  if (!dir || !fs.existsSync(path.join(dir, 'manifest.json')) || !packsDir || !fs.existsSync(packsDir) || !exe) {
    console.error('usage: --dir <shipped extension folder> --packs <dir with asr-base-sense-voice/ etc.> [--browser <chrome.exe>] [--out <dir>] [--headed]');
    return 2;
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const appVersion = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')).version;
  step('shipped manifest carries the app version', manifest.version === appVersion, `${manifest.version} vs package.json ${appVersion}`);

  const { box, shotsDir, companion, engineManager } = await startCompanion({ name: 'tt-caption-shipped', step, version: VERSION, packsDir, browserExe: exe });
  const browser = await launchBrowser({ exe, profile: path.join(box.dir, 'profile'), headless: !has('--headed'), args: ['--window-size=1280,900'] });
  const { cdp, attach, evaluate, open } = browser;
  console.log(`browser pid ${browser.child.pid}\nextension folder: ${dir}`);

  try {
    const { id, sw } = await loadExtension(browser, dir);
    await attach(sw.targetId);
    step('shipped folder loads as an unpacked extension', true, id);
    const { sessionId: opt } = await open(`chrome-extension://${id}/options.html`);
    await sleep(500);
    companion.openPairing();
    const paired = await evaluate(opt, `chrome.runtime.sendMessage({ type: 'companion/pair' })`);
    step('paired through its options page', paired?.ok && paired.result.status === 'ready', paired?.result?.status || JSON.stringify(paired?.error));

    const ext = (type, payload) => evaluate(opt, `chrome.runtime.sendMessage(${JSON.stringify({ type, payload })})`);
    const state = async (tabId) => (await ext('tab/state', { tabId }))?.result;
    const tabIdOf = (prefix) => evaluate(opt, `chrome.tabs.query({}).then((ts) => ts.find((t) => (t.url || t.pendingUrl || '').startsWith(${JSON.stringify(prefix)}))?.id ?? null)`);
    const trackInfo = (session) =>
      evaluate(session, `(() => { const v = document.querySelector('video'); if (!v) return null; const t = Array.from(v.textTracks).find((x) => x.label === 'T-Caption'); return { t: v.currentTime, cues: t ? t.cues.length : 0, active: t ? Array.from(t.activeCues || []).map((c) => c.text) : [] }; })()`);
    await evaluate(opt, `chrome.storage.local.set({ prefs: { targetLang: 'zh', mode: 'track' } }).then(() => true)`);

    const { sessionId: page } = await open('about:blank');
    const tOpen = Date.now();
    await cdp.send('Page.navigate', { url: `https://www.youtube.com/watch?v=${VIDEO}` }, page);
    const tab = await until(() => tabIdOf('https://www.youtube.com/watch'), 15000);
    step('YouTube tab known to the extension', Number.isInteger(tab), `tab ${tab}`);
    const adGone = await until(() => evaluate(page, `!document.querySelector('#movie_player.ad-showing') && !!document.querySelector('#movie_player')`), 90000, 500);
    if (!adGone) console.log('  [note] the player still shows an ad after 90 s');

    const captions = await until(async () => {
      const s = await state(tab);
      return s && s.state === 'captions' ? s : null;
    }, 45000);
    step('the orchestrator reaches captions on its own', !!captions && captions.active, `${captions ? Date.now() - tOpen : '-'} ms after opening; ${JSON.stringify(captions?.run)}`);
    const active = await until(async () => {
      const r = await trackInfo(page);
      return r && r.active.some((t) => t.includes('\n')) ? r : null;
    }, 60000, 300);
    step('a bilingual cue shows on the video’s track', !!active, `${active ? Date.now() - tOpen : '-'} ms after opening; ${JSON.stringify(active?.active)}`);
    if (active) {
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, page);
      const file = path.join(shotsDir, 't-caption-p4-shipped-youtube.png');
      fs.writeFileSync(file, Buffer.from(data, 'base64'));
      console.log(`  screenshot: ${file}`);
    }
  } finally {
    const how = await browser.close();
    step('browser closed', true, `pid ${browser.child.pid} via ${how}`);
    await companion.stop();
    await engineManager.stopSessionAndWait?.(VERSION);
    console.log(`  sandbox left for the recycle bin: ${box.dir}`);
  }
  return summary();
}

run(main);
